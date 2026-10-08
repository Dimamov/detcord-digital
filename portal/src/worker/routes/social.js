// Social posts through Zernio. Staff write a post, the client approves exactly what will go out, and
// only an approved post whose hash still matches is sent to Zernio. Clients see only posts sent to
// them; "not yours", "missing" and "not sent yet" are the same 404.
import { Hono } from 'hono';
import { fail, now, newId, text, oneOf, readJson, logActivity, HttpError } from '../lib/util.js';
import { requireRole, requireClient, isStaff } from '../lib/auth.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { aiReady, originFor, addEvent as addGoatEvent } from '../lib/goat.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import {
  PLATFORMS, MEDIA_TYPES, STATUS_LABEL, LIVE, CHECK_EVERY_MS, zernioReady, postHash, hashOf, addEvent,
  ensureProfile, connectUrl, refreshAccounts, createZernioPost, getZernioPost, readZernio, draftPost, testZernio,
} from '../lib/social.js';

const r = new Hono();
const EDITABLE = ['draft', 'pending_approval', 'changes_requested', 'approved'];
const NOT_SET_UP = 'Social posting isn’t set up yet (missing ZERNIO_API_KEY).';

async function loadPost(c, id, { staffOnly = false } = {}) {
  const row = await c.env.DB.prepare('SELECT * FROM social_posts WHERE id=?').bind(id).first();
  if (!row) fail(404, 'Post not found.');
  let scope;
  try {
    scope = await requireClient(c, row.client_id, { staffOnly });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) fail(404, 'Post not found.');
    throw e;
  }
  // Clients only see posts that were sent to them.
  if (!isStaff(scope.user) && !row.sent_at) fail(404, 'Post not found.');
  return { ...scope, row };
}

function shape(p, user) {
  const staff = isStaff(user);
  return {
    id: p.id, client_id: p.client_id, goat_request_id: p.goat_request_id, content: p.content,
    media_ids: JSON.parse(p.media_ids || '[]'), accounts: JSON.parse(p.accounts || '[]'), scheduled_for: p.scheduled_for,
    draft_source: staff ? p.draft_source : undefined,
    status: p.status, status_label: staff && p.status === 'pending_approval' ? 'Waiting for client approval' : STATUS_LABEL[p.status],
    hash: p.content_hash, approved: !!p.approved_hash && p.approved_hash === p.content_hash,
    approved_at: p.approved_at, approved_via: p.approved_via, approved_by_name: p.approved_by_name || null, approval_note: p.approval_note,
    zernio_status: p.zernio_status, platforms: p.zernio_platforms ? JSON.parse(p.zernio_platforms) : [],
    // A failed publish attempt is for staff to fix; clients see errors only once the post is with Zernio.
    error: staff || LIVE.includes(p.status) ? p.zernio_error : null,
    sent_at: p.sent_at, published_at: p.published_at, checked_at: p.checked_at, created_at: p.created_at, updated_at: p.updated_at,
  };
}

// Validates what staff wrote: the client's own shared images and videos, the client's own connected
// accounts, and a time in the future.
async function cleanPost(c, client, b) {
  const db = c.env.DB;
  const content = text(b.content, { max: 5000 }) || '';
  const ids = [...new Set((Array.isArray(b.mediaIds) ? b.mediaIds : []).filter((x) => typeof x === 'string'))];
  if (ids.length > 10) fail(400, 'Attach up to 10 photos or videos.');
  if (ids.length) {
    const rows = (await db.prepare(`SELECT id, content_type FROM media WHERE client_id=? AND deleted_at IS NULL AND visibility='shared' AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(client.id, ...ids).all()).results;
    if (rows.length !== ids.length) fail(400, 'One of the files was not found in this client’s shared files.');
    if (rows.some((m) => !MEDIA_TYPES[m.content_type])) fail(400, 'Only photos (JPG, PNG, WebP, GIF) and videos (MP4, MOV) can be posted.');
  }
  const accountIds = [...new Set((Array.isArray(b.accountIds) ? b.accountIds : []).filter((x) => typeof x === 'string'))];
  let accounts = [];
  if (accountIds.length) {
    const rows = (await db.prepare(`SELECT id, platform, username, display_name FROM social_accounts WHERE client_id=? AND is_active=1 AND id IN (${accountIds.map(() => '?').join(',')})`)
      .bind(client.id, ...accountIds).all()).results;
    if (rows.length !== accountIds.length) fail(400, 'One of the accounts isn’t connected for this client.');
    accounts = accountIds.map((id) => rows.find((x) => x.id === id)).map((a) => ({ id: a.id, platform: a.platform, username: a.username || a.display_name || null }));
  }
  let scheduledFor = null;
  if (b.scheduledFor !== null && b.scheduledFor !== undefined && b.scheduledFor !== '') {
    scheduledFor = Number(b.scheduledFor);
    if (!Number.isFinite(scheduledFor) || scheduledFor < now() + 60000) fail(400, 'Pick a time in the future, or publish right away.');
    scheduledFor = Math.round(scheduledFor);
  }
  let goat = null;
  if (b.goatRequestId) {
    goat = await db.prepare('SELECT id FROM goat_requests WHERE id=? AND client_id=?').bind(String(b.goatRequestId), client.id).first();
    if (!goat) fail(400, 'That GOAT request belongs to another client.');
  }
  const draftSource = b.draftSource === 'claude' ? 'claude' : null;
  return { content, mediaIds: ids, accounts, scheduledFor, goatRequestId: goat?.id || null, draftSource, hash: await postHash({ content, mediaIds: ids, accountIds: accounts.map((a) => a.id), scheduledFor }) };
}

// Asks Zernio for the post's status, at most every 30 seconds per post.
async function refreshStatus(c, row, { force = false } = {}) {
  if (!row.zernio_post_id || !zernioReady(c.env)) return row;
  if (row.checked_at && now() - row.checked_at < CHECK_EVERY_MS && !force) return row;
  const db = c.env.DB;
  try {
    const z = readZernio(await getZernioPost(c.env, row.zernio_post_id));
    await db.prepare('UPDATE social_posts SET status=?, zernio_status=?, zernio_platforms=?, zernio_error=NULL, checked_at=?, updated_at=? WHERE id=?')
      .bind(z.status, z.zernioStatus, JSON.stringify(z.platforms), now(), now(), row.id).run();
    if (z.status !== row.status) await statusChanged(c, row, z);
  } catch (e) {
    await db.prepare('UPDATE social_posts SET zernio_error=?, checked_at=? WHERE id=?').bind(`Status check failed: ${e.message}`, now(), row.id).run();
  }
  return db.prepare('SELECT * FROM social_posts WHERE id=?').bind(row.id).first();
}

// Records a status Zernio reported, and mentions it on the linked GOAT request.
async function statusChanged(c, row, z) {
  const links = z.platforms.filter((p) => p.url).map((p) => `${PLATFORMS[p.platform] || p.platform}: ${p.url}`);
  const errors = z.platforms.filter((p) => p.error).map((p) => `${PLATFORMS[p.platform] || p.platform}: ${p.error}`);
  const body = [`Zernio reports: ${STATUS_LABEL[z.status]}`, ...links, ...errors].join('\n');
  await addEvent(c.env.DB, row.id, { actorLabel: 'Zernio', kind: 'status', body });
  if (row.goat_request_id && ['scheduled', 'published', 'partial', 'failed'].includes(z.status)) {
    await addGoatEvent(c.env.DB, row.goat_request_id, { actorLabel: 'Social', kind: 'social', body: `Social post ${STATUS_LABEL[z.status].toLowerCase()}. ${originFor(c.env, c.req.url)}/social/${row.id}${links.length ? `\n${links.join('\n')}` : ''}` });
  }
  if (['published', 'partial', 'failed'].includes(z.status)) {
    await logActivity(c.env.DB, { clientId: row.client_id, kind: 'social', internal: z.status === 'failed', summary: `Social post ${STATUS_LABEL[z.status].toLowerCase()}: ${row.content.slice(0, 100)}` });
  }
}

// Emails the client's portal logins that a post is waiting for them.
async function notifyClient(c, row) {
  const env = c.env;
  const users = (await env.DB.prepare("SELECT u.name, u.email FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.status='active'").bind(row.client_id).all()).results;
  const base = originFor(env, c.req.url);
  for (const u of users) {
    const mail = renderEmail({ origin: base, heading: 'A social post is ready for your approval', paragraphs: [`Hi ${u.name.split(' ')[0]},`, 'Here is a post your Detcord team wrote for you. Nothing is posted until you approve it.', `“${row.content.slice(0, 300)}”`], button: { label: 'Review the post', url: `${base}/social/${row.id}` } });
    await sendEmail(env, { to: u.email, subject: 'Approve your social post', ...mail, idempotencyKey: `social/${row.id}/${row.content_hash}/${u.email}` });
  }
}

// ---------- Accounts ----------

r.get('/clients/:id/social', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const staff = isStaff(user);
  const ready = zernioReady(c.env);
  let accounts = [];
  let accountsError = null;
  if (ready && client.zernio_profile_id) {
    try { accounts = await refreshAccounts(c.env, c.env.DB, client); } catch (e) { accountsError = e.message; }
  }
  const rows = (await c.env.DB.prepare(`SELECT * FROM social_posts WHERE client_id=? ${staff ? '' : 'AND sent_at IS NOT NULL'}
      ORDER BY CASE status WHEN 'pending_approval' THEN 0 WHEN 'changes_requested' THEN 1 WHEN 'approved' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, updated_at DESC LIMIT 200`).bind(client.id).all()).results;
  return c.json({ ready, ai: staff ? aiReady(c.env) : undefined, platforms: PLATFORMS, accounts, accountsError, posts: rows.map((p) => shape(p, user)) });
});

// A connect link for one platform. Clients use it from their Social page; staff open it or copy it
// to send. Zernio sends the browser back to the portal, which then reads the accounts from Zernio.
r.post('/clients/:id/social/connect', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  if (!zernioReady(c.env)) fail(503, NOT_SET_UP);
  const b = await readJson(c);
  const platform = oneOf(b.platform, Object.keys(PLATFORMS), 'Platform');
  const origin = originFor(c.env, c.req.url);
  const forClient = !isStaff(user) || b.for === 'client';
  const back = forClient ? `${origin}/social` : `${origin}/clients/${client.id}?tab=social`;
  let url;
  try {
    const profileId = await ensureProfile(c.env, c.env.DB, client);
    url = await connectUrl(c.env, profileId, platform, back);
  } catch (e) {
    fail(502, e.message);
  }
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'social', summary: `${b.for === 'client' && isStaff(user) ? 'Made a link to connect' : 'Started connecting'} ${PLATFORMS[platform]}` });
  return c.json({ url });
});

// ---------- Posts ----------

r.post('/clients/:id/social/posts', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const p = await cleanPost(c, client, b);
  const id = newId();
  const t = now();
  await c.env.DB.prepare(`INSERT INTO social_posts (id, client_id, goat_request_id, content, media_ids, accounts, scheduled_for, draft_source, status, content_hash, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?, 'draft', ?,?,?,?)`)
    .bind(id, client.id, p.goatRequestId, p.content, JSON.stringify(p.mediaIds), JSON.stringify(p.accounts), p.scheduledFor, p.draftSource, p.hash, user.id, t, t).run();
  await addEvent(c.env.DB, id, { actorId: user.id, kind: 'created', body: p.draftSource === 'claude' ? 'Draft started from Claude’s suggestion' : 'Draft created' });
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'social', summary: `Started a social post: ${p.content.slice(0, 100) || '(no text yet)'}` });
  return c.json({ id }, 201);
});

r.get('/social/posts/:id', async (c) => {
  let { user, client, row } = await loadPost(c, c.req.param('id'));
  // Opening a post that is with Zernio refreshes its status (throttled).
  if (['publishing', 'scheduled'].includes(row.status)) row = await refreshStatus(c, row);
  const db = c.env.DB;
  const ids = JSON.parse(row.media_ids || '[]');
  const media = ids.length ? (await db.prepare(`SELECT id, filename, content_type, size FROM media WHERE client_id=? AND id IN (${ids.map(() => '?').join(',')})`).bind(client.id, ...ids).all()).results : [];
  const events = (await db.prepare(`SELECT e.*, u.name AS actor_name FROM social_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.post_id=? ${isStaff(user) ? '' : "AND e.kind<>'error'"} ORDER BY e.created_at`).bind(row.id).all()).results
    .map((e) => ({ id: e.id, kind: e.kind, body: e.body, at: e.created_at, by: e.actor_name || e.actor_label || 'Detcord' }));
  const approver = row.approved_by ? await db.prepare('SELECT name FROM users WHERE id=?').bind(row.approved_by).first() : null;
  const goat = row.goat_request_id ? await db.prepare('SELECT id, body, status FROM goat_requests WHERE id=?').bind(row.goat_request_id).first() : null;
  return c.json({
    post: { ...shape({ ...row, approved_by_name: approver?.name }, user), client_name: client.name },
    media: ids.map((id) => media.find((m) => m.id === id)).filter(Boolean),
    events, goat: goat ? { id: goat.id, body: goat.body.slice(0, 200), status: goat.status } : null,
    ready: zernioReady(c.env), ai: isStaff(user) ? aiReady(c.env) : undefined, platforms: PLATFORMS,
  });
});

// Staff edit. A change to the text, media, accounts or time after approval clears the approval.
r.put('/social/posts/:id', async (c) => {
  const { user, client, row } = await loadPost(c, c.req.param('id'), { staffOnly: true });
  if (!EDITABLE.includes(row.status)) fail(409, 'This post was already handed to Zernio and can’t be changed.');
  const b = await readJson(c);
  const p = await cleanPost(c, client, { ...b, draftSource: b.draftSource ?? row.draft_source });
  const changed = p.hash !== row.content_hash;
  const lostApproval = changed && !!row.approved_hash;
  const status = lostApproval ? 'pending_approval' : row.status;
  const res = await c.env.DB.prepare(`UPDATE social_posts SET content=?, media_ids=?, accounts=?, scheduled_for=?, goat_request_id=?, draft_source=?, content_hash=?, status=?, updated_at=?
      ${lostApproval ? ', approved_hash=NULL, approved_by=NULL, approved_via=NULL, approval_note=NULL, approved_at=NULL' : ''} WHERE id=? AND status=?`)
    .bind(p.content, JSON.stringify(p.mediaIds), JSON.stringify(p.accounts), p.scheduledFor, p.goatRequestId, p.draftSource, p.hash, status, now(), row.id, row.status).run();
  if (!res.meta.changes) fail(409, 'This post changed while you were editing. Reload and try again.');
  if (changed) {
    await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'edited', body: lostApproval ? 'Changed after approval, so it needs approval again.' : 'Edited' });
    if (lostApproval) c.executionCtx.waitUntil(notifyClient(c, { ...row, content: p.content, content_hash: p.hash }));
  }
  return c.json({ ok: true, changed, reapproval: lostApproval });
});

r.post('/social/posts/:id/send', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'), { staffOnly: true });
  if (!['draft', 'changes_requested'].includes(row.status)) fail(409, 'This post isn’t a draft.');
  if (!row.content.trim()) fail(400, 'Write the post before sending it for approval.');
  if (row.scheduled_for && row.scheduled_for < now() + 60000) fail(400, 'The scheduled time has passed. Pick a new time first.');
  await c.env.DB.prepare("UPDATE social_posts SET status='pending_approval', sent_at=COALESCE(sent_at, ?), updated_at=? WHERE id=? AND status=?").bind(now(), now(), row.id, row.status).run();
  await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'sent', body: 'Sent to the client for approval' });
  await logActivity(c.env.DB, { clientId: row.client_id, actorId: user.id, kind: 'social', internal: false, summary: `Social post sent for approval: ${row.content.slice(0, 100)}` });
  c.executionCtx.waitUntil(notifyClient(c, row));
  return c.json({ ok: true });
});

// The client approves exactly the version they saw (its hash).
r.post('/social/posts/:id/approve', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client approves their post. Admins can record an approval given by phone.');
  if (row.status !== 'pending_approval') fail(409, 'This post isn’t waiting for approval.');
  const b = await readJson(c);
  const t = now();
  const res = await c.env.DB.prepare(`UPDATE social_posts SET status='approved', approved_hash=content_hash, approved_by=?, approved_via='portal', approval_note=NULL, approved_at=?, updated_at=?
      WHERE id=? AND status='pending_approval' AND content_hash=?`).bind(user.id, t, t, row.id, String(b.hash || '')).run();
  if (!res.meta.changes) fail(409, 'The post changed while you were looking at it. Review the latest version and approve again.');
  await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'approved', body: 'Approved in the portal' });
  await logActivity(c.env.DB, { clientId: row.client_id, actorId: user.id, kind: 'social', internal: false, summary: `Approved a social post: ${row.content.slice(0, 100)}` });
  return c.json({ ok: true });
});

r.post('/social/posts/:id/changes', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client can ask for changes.');
  if (!['pending_approval', 'approved'].includes(row.status)) fail(409, 'This post can no longer be changed. Message your Detcord team.');
  const b = await readJson(c);
  const note = text(b.note, { max: 2000, required: true, label: 'What to change' });
  await c.env.DB.prepare(`UPDATE social_posts SET status='changes_requested', approved_hash=NULL, approved_by=NULL, approved_via=NULL, approval_note=NULL, approved_at=NULL, updated_at=? WHERE id=? AND status=?`)
    .bind(now(), row.id, row.status).run();
  await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'changes', body: note });
  await logActivity(c.env.DB, { clientId: row.client_id, actorId: user.id, kind: 'social', internal: false, summary: `Asked for changes to a social post: ${note.slice(0, 100)}` });
  return c.json({ ok: true });
});

// An admin records an approval the client gave outside the portal. The note is required and shown.
r.post('/social/posts/:id/approve-for-client', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'), { staffOnly: true });
  if (user.role !== 'admin') fail(403, 'Only an admin can record a client’s approval.');
  if (row.status !== 'pending_approval') fail(409, 'Send the post for approval first.');
  const b = await readJson(c);
  const note = text(b.note, { max: 500, required: true, label: 'How the client approved' });
  const t = now();
  const res = await c.env.DB.prepare(`UPDATE social_posts SET status='approved', approved_hash=content_hash, approved_by=?, approved_via='admin', approval_note=?, approved_at=?, updated_at=?
      WHERE id=? AND status='pending_approval' AND content_hash=?`).bind(user.id, note, t, t, row.id, String(b.hash || '')).run();
  if (!res.meta.changes) fail(409, 'The post changed. Reload it and record the approval again.');
  await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'approved', body: `Approval recorded for the client: ${note}` });
  await logActivity(c.env.DB, { clientId: row.client_id, actorId: user.id, kind: 'social', summary: `Recorded the client’s approval of a social post (${note.slice(0, 80)})` });
  return c.json({ ok: true });
});

// Hands the approved post to Zernio. The hash is checked again here, on the server.
r.post('/social/posts/:id/publish', async (c) => {
  const { user, client, row } = await loadPost(c, c.req.param('id'), { staffOnly: true });
  if (row.status !== 'approved' || !row.approved_hash) fail(409, 'The client has to approve this post before it can be published.');
  if (row.approved_hash !== row.content_hash || (await hashOf(row)) !== row.approved_hash) fail(409, 'The post changed after approval. Send it for approval again.');
  if (!zernioReady(c.env)) fail(503, NOT_SET_UP);
  const accounts = JSON.parse(row.accounts);
  if (!accounts.length) fail(400, 'Choose at least one account. That change goes back to the client for approval.');
  if (row.scheduled_for && row.scheduled_for < now() + 60000) fail(409, 'The scheduled time has passed. Pick a new time; the client approves it again.');
  const db = c.env.DB;

  // The accounts must still be this client's, according to Zernio itself.
  let live;
  try { live = await refreshAccounts(c.env, db, client); } catch (e) { fail(502, e.message); }
  const missing = accounts.filter((a) => !live.some((l) => l.id === a.id && l.is_active));
  if (missing.length) fail(409, `${missing.map((a) => `${PLATFORMS[a.platform] || a.platform}${a.username ? ` (${a.username})` : ''}`).join(', ')} is no longer connected. Reconnect it, or remove it and get approval again.`);
  const ids = JSON.parse(row.media_ids);
  const mediaRows = ids.length ? (await db.prepare(`SELECT * FROM media WHERE client_id=? AND deleted_at IS NULL AND visibility='shared' AND id IN (${ids.map(() => '?').join(',')})`).bind(client.id, ...ids).all()).results : [];
  if (mediaRows.length !== ids.length) fail(409, 'One of the attached files was deleted or made internal. Change the post and get approval again.');

  // Claim it so a double click can't publish twice.
  const claimed = await db.prepare("UPDATE social_posts SET status='publishing', zernio_error=NULL, published_by=?, published_at=?, updated_at=? WHERE id=? AND status='approved' AND approved_hash=content_hash")
    .bind(user.id, now(), now(), row.id).run();
  if (!claimed.meta.changes) fail(409, 'This post is already being published.');
  let out;
  try {
    out = await createZernioPost(c.env, row, ids.map((id) => mediaRows.find((m) => m.id === id)));
  } catch (e) {
    // Nothing went out (or Zernio says it already has it); the approval stands and staff can retry
    // with the same idempotency key.
    await db.prepare("UPDATE social_posts SET status='approved', zernio_error=?, published_at=NULL, updated_at=? WHERE id=?").bind(e.message, now(), row.id).run();
    await addEvent(db, row.id, { actorId: user.id, kind: 'error', body: `Publishing failed: ${e.message}` });
    fail(e.status === 409 ? 409 : 502, e.message);
  }
  const z = readZernio(out.post);
  await db.prepare('UPDATE social_posts SET status=?, zernio_post_id=?, zernio_status=?, zernio_platforms=?, zernio_error=?, checked_at=?, updated_at=? WHERE id=?')
    .bind(z.status, out.post._id, z.zernioStatus, JSON.stringify(z.platforms), out.partialError, now(), now(), row.id).run();
  await addEvent(db, row.id, { actorId: user.id, kind: 'published', body: row.scheduled_for ? 'Handed to Zernio to post at the scheduled time' : 'Handed to Zernio to post now' });
  await statusChanged(c, row, z);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'social', summary: `Sent a social post to Zernio (${STATUS_LABEL[z.status]})` });
  const fresh = await db.prepare('SELECT * FROM social_posts WHERE id=?').bind(row.id).first();
  return c.json({ post: shape(fresh, user) });
});

r.post('/social/posts/:id/check', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'));
  if (!row.zernio_post_id) fail(409, 'This post hasn’t been sent to Zernio yet.');
  if (!zernioReady(c.env)) fail(503, NOT_SET_UP);
  const throttled = !!row.checked_at && now() - row.checked_at < CHECK_EVERY_MS;
  const fresh = await refreshStatus(c, row);
  return c.json({ post: shape(fresh, user), throttled });
});

r.post('/social/posts/:id/cancel', async (c) => {
  const { user, row } = await loadPost(c, c.req.param('id'), { staffOnly: true });
  if (!EDITABLE.includes(row.status)) fail(409, 'This post is already with Zernio. Delete it there if it must come down.');
  await c.env.DB.prepare("UPDATE social_posts SET status='cancelled', updated_at=? WHERE id=?").bind(now(), row.id).run();
  await addEvent(c.env.DB, row.id, { actorId: user.id, kind: 'cancelled', body: 'Cancelled' });
  return c.json({ ok: true });
});

// Claude suggests post text from a short brief. It is only a draft for staff to edit.
r.post('/clients/:id/social/draft', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  if (!aiReady(c.env)) fail(503, 'Claude is not set up yet (missing ANTHROPIC_API_KEY).');
  const b = await readJson(c);
  const brief = text(b.brief, { max: 2000, required: true, label: 'The brief' });
  const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => PLATFORMS[p]);
  let content;
  try { content = await draftPost(c.env, client, { brief, platforms }); } catch (e) { fail(502, `Claude could not draft this (${e?.status || 'network error'}).`); }
  if (!content) fail(502, 'Claude could not draft this post. Write it by hand.');
  return c.json({ content });
});

// ---------- Integration status ----------

r.get('/settings/integrations/zernio', async (c) => {
  requireRole(c, 'admin');
  const s = await getSettings(c.env.DB, 'integration.zernio.');
  const ready = zernioReady(c.env);
  return c.json({ configured: ready, missing: ready ? [] : ['ZERNIO_API_KEY'], lastTest: s.test || null, state: !ready ? 'not_configured' : s.test?.ok ? 'connected' : s.test ? 'failing' : 'untested' });
});

r.post('/settings/integrations/zernio/test', async (c) => {
  const user = requireRole(c, 'admin');
  if (!zernioReady(c.env)) return c.json({ ok: false, error: 'Missing Worker secret: ZERNIO_API_KEY.' }, 400);
  let result;
  try { result = { ok: true, ...(await testZernio(c.env)) }; } catch (e) { result = { ok: false, error: e.message }; }
  result = { ...result, at: now(), by: user.name };
  await putSetting(c.env.DB, 'integration.zernio.test', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

export default r;
