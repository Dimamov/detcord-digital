// GOAT Command requests in the portal. Every read and write checks the client scope on the
// server; requests from unknown senders (no client yet) are visible to admins only.
import { Hono } from 'hono';
import { fail, now, text, oneOf, readJson, logActivity } from '../lib/util.js';
import { requireUser, requireRole, requireClient, isStaff, clientScopeSql } from '../lib/auth.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { toE164 } from '../lib/sms.js';
import {
  CATEGORIES, STATUS_LABEL, createRequest, addEvent, saveProposal, approveRequest, afterCreate, autoDraft,
  notifyClient, aiReady, draftWithClaude, draftContext, originFor,
} from '../lib/goat.js';
import { claimHeldAttachments } from './inbound.js';

const r = new Hono();
const OPEN = ['unmatched', 'new', 'proposed', 'approved', 'in_progress'];

async function loadRequest(c, id, { staffOnly = false } = {}) {
  const user = requireUser(c);
  const req = await c.env.DB.prepare('SELECT * FROM goat_requests WHERE id=?').bind(id).first();
  if (!req) fail(404, 'Request not found.');
  if (!req.client_id) {
    if (user.role !== 'admin') fail(404, 'Request not found.');
    return { user, req, client: null };
  }
  const { client } = await requireClient(c, req.client_id, { staffOnly });
  return { user, req, client };
}

// Media ids a user may attach: the client's files that this user can see.
async function allowedMedia(c, user, clientId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string'))].slice(0, 20);
  if (!list.length) return [];
  const rows = (await c.env.DB.prepare(`SELECT id, visibility FROM media WHERE client_id=? AND deleted_at IS NULL AND id IN (${list.map(() => '?').join(',')})`)
    .bind(clientId, ...list).all()).results;
  const ok = rows.filter((m) => isStaff(user) || m.visibility === 'shared').map((m) => m.id);
  if (ok.length !== list.length) fail(400, 'One of the attached files was not found.');
  return ok;
}

function shape(req, user) {
  const staff = isStaff(user);
  return {
    id: req.id, client_id: req.client_id, client_name: req.client_name, channel: req.channel, sender_name: req.sender_name,
    sender_address: staff ? req.sender_address : undefined, subject: req.subject, body: req.body,
    category: req.category, category_label: CATEGORIES[req.category] || CATEGORIES.other,
    status: req.status, status_label: staff && req.status === 'proposed' ? 'Waiting for client approval' : STATUS_LABEL[req.status],
    proposal: req.proposal ? JSON.parse(req.proposal) : null, proposal_hash: req.proposal_hash, proposal_source: staff ? req.proposal_source : undefined,
    proposed_at: req.proposed_at, approved_at: req.approved_at, approved_via: req.approved_via,
    assignee_id: req.assignee_id, assignee_name: req.assignee_name,
    result_note: req.result_note, result_url: req.result_url, failure: req.failure,
    created_at: req.created_at, updated_at: req.updated_at, completed_at: req.completed_at,
  };
}

// ---------- Lists ----------

r.get('/goat', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const q = c.req.query();
  const where = ['r.client_id IS NOT NULL', `(${scope.sql.replace(/cl\.id/g, 'r.client_id')})`];
  const binds = [...scope.binds];
  if (q.client) { where.push('r.client_id=?'); binds.push(q.client); }
  if (q.status === 'open') where.push(`r.status IN (${OPEN.map(() => '?').join(',')})`), binds.push(...OPEN);
  else if (q.status === 'closed') where.push("r.status IN ('done','failed','cancelled')");
  const rows = (await c.env.DB.prepare(`SELECT r.*, cl.name AS client_name, u.name AS assignee_name FROM goat_requests r
      LEFT JOIN clients cl ON cl.id=r.client_id LEFT JOIN users u ON u.id=r.assignee_id
      WHERE ${where.join(' AND ')} ORDER BY CASE r.status WHEN 'proposed' THEN 0 WHEN 'new' THEN 1 WHEN 'approved' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END, r.updated_at DESC LIMIT 200`)
    .bind(...binds).all()).results;
  // Requests from unknown senders have no client; only admins can see and match them.
  const unmatched = user.role === 'admin' && !q.client
    ? (await c.env.DB.prepare(`SELECT r.*, s.claimed_name, s.claimed_business FROM goat_requests r
        LEFT JOIN goat_senders s ON s.address=r.sender_address AND s.channel=r.channel
        WHERE r.client_id IS NULL AND r.status='unmatched' ORDER BY r.created_at DESC LIMIT 50`).all()).results
      .map((x) => ({ ...shape(x, user), claimed_name: x.claimed_name, claimed_business: x.claimed_business }))
    : [];
  return c.json({ requests: rows.map((x) => shape(x, user)), unmatched, categories: CATEGORIES, ai: aiReady(c.env) });
});

// ---------- Create ----------

r.post('/clients/:id/goat', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const b = await readJson(c);
  const body = text(b.body, { max: 4000, required: true, label: 'Your request' });
  const mediaIds = await allowedMedia(c, user, client.id, b.mediaIds);
  const key = typeof b.submitKey === 'string' && /^[\w-]{8,64}$/.test(b.submitKey) ? `portal:${user.id}:${b.submitKey}` : null;
  const { request, duplicate } = await createRequest(c.env, {
    clientId: client.id, channel: 'portal', senderUserId: user.id, senderName: user.name, senderAddress: user.email,
    body, externalKey: key, mediaIds,
  });
  if (b.category && CATEGORIES[b.category]) await c.env.DB.prepare('UPDATE goat_requests SET category=? WHERE id=?').bind(b.category, request.id).run();
  if (!duplicate) c.executionCtx.waitUntil(afterCreate(c.env, request.id, { origin: new URL(c.req.url).origin }));
  return c.json({ id: request.id, duplicate }, duplicate ? 200 : 201);
});

// ---------- Detail ----------

r.get('/goat/:id', async (c) => {
  const { user, req, client } = await loadRequest(c, c.req.param('id'));
  const staff = isStaff(user);
  const db = c.env.DB;
  const events = (await db.prepare(`SELECT e.*, u.name AS actor_name, u.role AS actor_role FROM goat_events e LEFT JOIN users u ON u.id=e.actor_id
    WHERE e.request_id=? ${staff ? '' : 'AND e.internal=0'} ORDER BY e.created_at`).bind(req.id).all()).results
    .map((e) => ({ id: e.id, kind: e.kind, body: e.body, internal: !!e.internal, at: e.created_at, by: e.actor_name || e.actor_label || 'Detcord', byStaff: e.actor_role ? e.actor_role !== 'client' : true }));
  const files = (await db.prepare(`SELECT m.id, m.filename, m.content_type, m.size, m.visibility, a.role FROM goat_attachments a JOIN media m ON m.id=a.media_id
    WHERE a.request_id=? AND m.deleted_at IS NULL ${staff ? '' : "AND m.visibility='shared'"}`).bind(req.id).all()).results;
  const assignee = req.assignee_id ? await db.prepare('SELECT name FROM users WHERE id=?').bind(req.assignee_id).first() : null;
  const out = { request: { ...shape({ ...req, client_name: client?.name, assignee_name: assignee?.name }, user) }, events, files, categories: CATEGORIES, ai: aiReady(c.env) };
  if (staff && !req.client_id) {
    out.sender = await db.prepare('SELECT * FROM goat_senders WHERE channel=? AND address=?').bind(req.channel, req.sender_address).first();
    const scope = clientScopeSql(user);
    out.clients = (await db.prepare(`SELECT cl.id, cl.name, cl.city FROM clients cl WHERE ${scope.sql} ORDER BY cl.name LIMIT 500`).bind(...scope.binds).all()).results;
  }
  return c.json(out);
});

// ---------- Client actions ----------

r.post('/goat/:id/approve', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client approves their plan.');
  const b = await readJson(c);
  const res = await approveRequest(c.env, req, { userId: user.id, via: 'portal', hash: b.hash });
  if (!res.ok) fail(409, res.error);
  return c.json({ ok: true });
});

// The client asks for something different. The plan goes back for a new draft.
r.post('/goat/:id/change', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client can ask for changes to their plan.');
  if (!['new', 'proposed', 'approved'].includes(req.status)) fail(409, 'This request can no longer be changed. Send a new request instead.');
  const b = await readJson(c);
  const message = text(b.message, { max: 2000, required: true, label: 'What to change' });
  await c.env.DB.prepare(`UPDATE goat_requests SET status='new', approved_hash=NULL, approved_by=NULL, approved_via=NULL, approved_at=NULL, updated_at=? WHERE id=?`).bind(now(), req.id).run();
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'change', body: message });
  c.executionCtx.waitUntil((async () => {
    if (aiReady(c.env)) await autoDraft(c.env, req.id);
  })());
  return c.json({ ok: true });
});

r.post('/goat/:id/cancel', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  if (!['unmatched', 'new', 'proposed', 'approved'].includes(req.status)) fail(409, 'Work has already started. Message your Detcord team instead.');
  await c.env.DB.prepare(`UPDATE goat_requests SET status='cancelled', updated_at=?, completed_at=? WHERE id=?`).bind(now(), now(), req.id).run();
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'cancelled', body: 'Cancelled' });
  return c.json({ ok: true });
});

r.post('/goat/:id/comment', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  const b = await readJson(c);
  const internal = isStaff(user) && b.internal === true;
  if (!req.client_id && !internal) fail(400, 'Match this sender to a client before replying.');
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'comment', body: text(b.body, { max: 2000, required: true, label: 'Message' }), internal });
  await c.env.DB.prepare('UPDATE goat_requests SET updated_at=? WHERE id=?').bind(now(), req.id).run();
  return c.json({ ok: true });
});

// ---------- Staff actions ----------

r.put('/goat/:id/proposal', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  if (!req.client_id) fail(409, 'Match this sender to a client first.');
  if (!['new', 'proposed', 'approved', 'in_progress'].includes(req.status)) fail(409, 'This request is closed.');
  const b = await readJson(c);
  const category = b.category && CATEGORIES[b.category] ? b.category : undefined;
  const res = await saveProposal(c.env, req, b, { source: 'staff', actorId: user.id, category });
  if (res.error) fail(400, res.error);
  if (res.changed && res.status === 'proposed') c.executionCtx.waitUntil(notifyClient(c.env, req.id, 'proposed', { origin: new URL(c.req.url).origin }));
  return c.json({ ok: true, ...res });
});

// Staff ask Claude for a draft without sending it; they review it in the editor.
r.post('/goat/:id/draft', async (c) => {
  const { req, client } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  if (!client) fail(409, 'Match this sender to a client first.');
  if (!aiReady(c.env)) fail(503, 'Claude is not set up yet (missing ANTHROPIC_API_KEY).');
  const { files, followUps } = await draftContext(c.env.DB, req.id);
  let draft;
  try { draft = await draftWithClaude(c.env, req, client, files, followUps); } catch (e) { fail(502, `Claude could not draft this (${e?.status || 'network error'}).`); }
  if (!draft) fail(502, 'Claude could not draft this request. Write the plan by hand.');
  return c.json({ draft });
});

r.post('/goat/:id/start', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  if (req.status !== 'approved') fail(409, 'Work starts after the client approves the plan.');
  await c.env.DB.prepare(`UPDATE goat_requests SET status='in_progress', assignee_id=COALESCE(assignee_id, ?), updated_at=? WHERE id=?`).bind(user.id, now(), req.id).run();
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'started', body: 'Work started' });
  return c.json({ ok: true });
});

r.post('/goat/:id/done', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  if (!['approved', 'in_progress'].includes(req.status)) fail(409, 'Only approved requests can be marked done.');
  const b = await readJson(c);
  const note = text(b.note, { max: 2000, required: true, label: 'What was done' });
  let url = text(b.url, { max: 500 });
  if (url && !/^https?:\/\//i.test(url)) fail(400, 'The link must start with http:// or https://.');
  const mediaIds = await allowedMedia(c, user, req.client_id, b.mediaIds);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`UPDATE goat_requests SET status='done', result_note=?, result_url=?, assignee_id=COALESCE(assignee_id, ?), updated_at=?, completed_at=? WHERE id=?`).bind(note, url, user.id, now(), now(), req.id),
    ...mediaIds.map((m) => db.prepare('INSERT OR IGNORE INTO goat_attachments (request_id, media_id, role) VALUES (?,?,?)').bind(req.id, m, 'result')),
  ]);
  await addEvent(db, req.id, { actorId: user.id, kind: 'done', body: note });
  await logActivity(db, { clientId: req.client_id, actorId: user.id, kind: 'goat', internal: false, summary: `Finished GOAT request: ${req.body.slice(0, 100)}` });
  c.executionCtx.waitUntil(notifyClient(c.env, req.id, 'done', { origin: new URL(c.req.url).origin }));
  return c.json({ ok: true });
});

r.post('/goat/:id/fail', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  if (!OPEN.includes(req.status) || !req.client_id) fail(409, 'This request is already closed.');
  const b = await readJson(c);
  const reason = text(b.reason, { max: 1000, required: true, label: 'Why it could not be done' });
  await c.env.DB.prepare(`UPDATE goat_requests SET status='failed', failure=?, updated_at=?, completed_at=? WHERE id=?`).bind(reason, now(), now(), req.id).run();
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'failed', body: reason });
  c.executionCtx.waitUntil(notifyClient(c.env, req.id, 'failed', { origin: new URL(c.req.url).origin }));
  return c.json({ ok: true });
});

r.patch('/goat/:id', async (c) => {
  const { req } = await loadRequest(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  if (b.category !== undefined) oneOf(b.category, Object.keys(CATEGORIES), 'Category');
  let assignee = req.assignee_id;
  if (b.assigneeId !== undefined) {
    assignee = b.assigneeId || null;
    if (assignee && !(await c.env.DB.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('admin','rep') AND status<>'disabled'").bind(assignee).first())) fail(400, 'Choose someone on the team.');
  }
  await c.env.DB.prepare('UPDATE goat_requests SET category=?, assignee_id=?, updated_at=? WHERE id=?').bind(b.category ?? req.category, assignee, now(), req.id).run();
  return c.json({ ok: true });
});

// An admin confirms who an unknown sender is. The sender becomes a contact of that client,
// so their next email or text is matched automatically. A claimed business name is never
// enough on its own; this is the human check.
r.post('/goat/:id/match', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  if (user.role !== 'admin') fail(404, 'Request not found.');
  if (req.client_id || req.status !== 'unmatched') fail(409, 'This request is already matched.');
  const b = await readJson(c);
  const { client } = await requireClient(c, String(b.clientId || ''));
  const db = c.env.DB;
  const name = text(b.name, { max: 120 }) || req.sender_name || 'Unknown';
  if (b.addContact !== false && req.sender_address) {
    const isPhone = req.channel === 'sms';
    const exists = isPhone
      ? (await db.prepare('SELECT phone FROM contacts WHERE client_id=?').bind(client.id).all()).results.some((x) => toE164(x.phone) === req.sender_address)
      : await db.prepare('SELECT 1 FROM contacts WHERE client_id=? AND lower(email)=?').bind(client.id, req.sender_address.toLowerCase()).first();
    if (!exists) {
      await db.prepare('INSERT INTO contacts (id, client_id, name, email, phone, created_at) VALUES (?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), client.id, name, isPhone ? null : req.sender_address, isPhone ? req.sender_address : null, now()).run();
    }
  }
  await db.batch([
    db.prepare("UPDATE goat_requests SET client_id=?, sender_name=COALESCE(sender_name, ?), status='new', updated_at=? WHERE id=?").bind(client.id, name, now(), req.id),
    db.prepare("UPDATE goat_senders SET status='verified', client_id=?, updated_at=? WHERE channel=? AND address=?").bind(client.id, now(), req.channel, req.sender_address),
  ]);
  await addEvent(db, req.id, { actorId: user.id, kind: 'matched', internal: true, body: `Sender confirmed as ${name} of ${client.name}` });
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'goat', summary: `Confirmed ${req.sender_address} as ${name} and matched their GOAT request` });
  c.executionCtx.waitUntil((async () => {
    await claimHeldAttachments(c.env, req.id, client.id);
    await afterCreate(c.env, req.id, { origin: new URL(c.req.url).origin, notifyReceived: req.channel !== 'sms' });
  })());
  return c.json({ ok: true });
});

r.post('/goat/:id/reject', async (c) => {
  const { user, req } = await loadRequest(c, c.req.param('id'));
  if (user.role !== 'admin' || req.status !== 'unmatched') fail(409, 'Only unmatched requests can be rejected.');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE goat_requests SET status='cancelled', updated_at=?, completed_at=? WHERE id=?").bind(now(), now(), req.id),
    c.env.DB.prepare("UPDATE goat_senders SET status='rejected', updated_at=? WHERE channel=? AND address=?").bind(now(), req.channel, req.sender_address),
  ]);
  await addEvent(c.env.DB, req.id, { actorId: user.id, kind: 'cancelled', internal: true, body: 'Sender rejected' });
  return c.json({ ok: true });
});

// ---------- Integration status ----------

r.get('/settings/integrations/goat', async (c) => {
  requireRole(c, 'admin');
  const s = await getSettings(c.env.DB, 'integration.goat.');
  return c.json({
    claude: { configured: aiReady(c.env), lastTest: s.claudeTest || null, state: !aiReady(c.env) ? 'not_configured' : s.claudeTest?.ok ? 'connected' : s.claudeTest ? 'failing' : 'untested' },
    // Inbound channels count as connected only once a real message has arrived and been verified.
    email: { lastReceived: s.emailLast || null, state: s.emailLast ? 'connected' : 'untested', address: c.env.GOAT_INBOUND_ADDRESS || null },
    sms: { configured: !!c.env.TWILIO_AUTH_TOKEN, lastReceived: s.smsLast || null, webhook: `${originFor(c.env, c.req.url)}/api/webhooks/twilio`,
      state: !c.env.TWILIO_AUTH_TOKEN ? 'not_configured' : s.smsLast ? 'connected' : 'untested' },
  });
});

r.post('/settings/integrations/claude/test', async (c) => {
  const user = requireRole(c, 'admin');
  if (!aiReady(c.env)) return c.json({ ok: false, error: 'Missing Worker secret: ANTHROPIC_API_KEY.' }, 400);
  let result;
  try {
    const draft = await draftWithClaude(c.env, { channel: 'portal', body: 'Please post that we are closed Monday for Labor Day.' }, { name: 'Test Bakery', timezone: 'America/Detroit', city: 'Detroit', state: 'MI' });
    result = draft?.summary ? { ok: true, sample: draft.summary.slice(0, 200) } : { ok: false, error: 'Claude answered, but not with a plan.' };
  } catch (e) {
    result = { ok: false, error: e?.status === 401 ? 'Anthropic rejected the API key.' : `Could not reach Claude (${e?.status || 'network error'}).` };
  }
  result = { ...result, at: now(), by: user.name };
  await putSetting(c.env.DB, 'integration.goat.claudeTest', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

export default r;
