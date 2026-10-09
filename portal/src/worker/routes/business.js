// Client self-service on the Business page: business details, team logins, service requests.
// Every route goes through requireClient, so another business's data answers 404 like a missing one.
import { Hono } from 'hono';
import { fail, now, newId, cleanEmail, text, oneOf, readJson, logActivity, EMAIL_RE } from '../lib/util.js';
import { requireClient, issueLink, addMember, isStaff } from '../lib/auth.js';
import { renderEmail, sendEmail } from '../lib/email.js';
import { normalizeUrl } from './clients.js';

const r = new Hono();
const DAY = 24 * 3600 * 1000;
const INVITES_PER_DAY = 20;
const REQUESTS_PER_DAY = 10;
const REQUEST_STATUSES = ['new', 'quoted', 'added', 'declined'];
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;

// ---------- Business details ----------

// What a client may change. Name, status and industry stay with Detcord staff.
const DETAIL_FIELDS = ['phone', 'email', 'website', 'address', 'city', 'state', 'zip'];

function detailFields(body) {
  const out = {};
  const set = (k, fn) => { if (body[k] !== undefined) out[k] = fn(body[k]); };
  set('phone', (v) => text(v, { max: 40 }));
  set('email', (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s && !EMAIL_RE.test(s)) fail(400, 'Enter a valid business email.');
    return s || null;
  });
  set('website', normalizeUrl);
  set('address', (v) => text(v, { max: 200 }));
  set('city', (v) => text(v, { max: 80 }));
  set('state', (v) => text(v, { max: 40 }));
  set('zip', (v) => text(v, { max: 12 }));
  return out;
}

// Clients edit their own details; anything else in the body (name, status, industry) is ignored.
r.patch('/clients/:id/details', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const f = detailFields(await readJson(c));
  const changed = DETAIL_FIELDS.filter((k) => k in f && (f[k] ?? null) !== (client[k] ?? null));
  if (!changed.length) return c.json({ ok: true, changed: [] });
  await c.env.DB.prepare(`UPDATE clients SET ${changed.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .bind(...changed.map((k) => f[k]), now(), client.id).run();
  const show = (v) => (v ? `"${v}"` : 'blank');
  const who = isStaff(user) ? 'Staff' : 'Client';
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'details', summary: `${who} updated business details: ${changed.map((k) => `${k} ${show(client[k])} → ${show(f[k])}`).join('; ')}` });
  return c.json({ ok: true, changed });
});

// ---------- Team logins ----------

const inviteState = (m) => m.status === 'active' ? 'active' : m.status === 'disabled' ? 'disabled'
  : !m.invite_expires ? 'not_delivered' : m.invite_expires < now() ? 'expired' : m.invite_delivery === 'sent' ? 'sent' : 'not_delivered';

async function listMembers(db, clientId) {
  const rows = (await db.prepare(`SELECT u.id, u.name, u.email, u.status, u.last_login_at, m.is_owner, m.created_at AS added_at,
      (SELECT delivery FROM tokens t WHERE t.user_id=u.id AND t.kind='invite' ORDER BY created_at DESC LIMIT 1) AS invite_delivery,
      (SELECT expires_at FROM tokens t WHERE t.user_id=u.id AND t.kind='invite' ORDER BY created_at DESC LIMIT 1) AS invite_expires
    FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? ORDER BY m.is_owner DESC, u.name`).bind(clientId).all()).results;
  return rows.map((m) => ({ id: m.id, name: m.name, email: m.email, owner: !!m.is_owner, state: inviteState(m), lastLoginAt: m.last_login_at, addedAt: m.added_at }));
}

// Owners (and the business's Detcord staff) manage the team. Other teammates only see the list.
async function requireTeamManager(c, clientId) {
  const ctx = await requireClient(c, clientId);
  if (ctx.user.role === 'client') {
    const me = await c.env.DB.prepare('SELECT is_owner FROM client_members WHERE client_id=? AND user_id=?').bind(ctx.client.id, ctx.user.id).first();
    if (!me?.is_owner) fail(403, 'Only an owner of this business can change its team.');
  }
  return ctx;
}

async function loadMember(db, clientId, userId) {
  const m = await db.prepare(`SELECT u.*, m.is_owner FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND m.user_id=?`)
    .bind(clientId, userId).first();
  if (!m) fail(404, 'Teammate not found.');
  return m;
}

const ownerCount = async (db, clientId) => (await db.prepare('SELECT COUNT(*) AS n FROM client_members WHERE client_id=? AND is_owner=1').bind(clientId).first()).n;

// Invites and resends per business per day, counted from the activity log.
async function checkInviteLimit(db, clientId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM activity WHERE client_id=? AND kind='team_invite' AND created_at>?").bind(clientId, now() - DAY).first();
  if (row.n >= INVITES_PER_DAY) fail(429, 'That’s a lot of invitations for one day. Try again tomorrow, or ask your Detcord team.');
}

// Staff see the one-time link when email didn't go out, to share by hand. Client owners never do:
// a setup link is someone else's password, so they are told to ask Detcord instead.
const linkResponse = (link, user) => ({
  delivery: link.delivery, error: link.error, expiresAt: link.expiresAt,
  ...(link.delivery !== 'sent' && isStaff(user) ? { manualLink: link.url } : {}),
});

r.get('/clients/:id/members', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const members = await listMembers(c.env.DB, client.id);
  const me = members.find((m) => m.id === user.id);
  return c.json({ members, canManage: isStaff(user) || !!me?.owner });
});

r.post('/clients/:id/members', async (c) => {
  const { user, client } = await requireTeamManager(c, c.req.param('id'));
  const db = c.env.DB;
  const body = await readJson(c);
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  const email = cleanEmail(body.email);
  await checkInviteLimit(db, client.id);
  let member = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  // Staff accounts and turned-off logins are never touched from here. The message doesn't say why.
  if (member && (member.role !== 'client' || member.status === 'disabled')) fail(409, 'That email can’t be added here. Ask your Detcord team to help.');
  if (member && await db.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(client.id, member.id).first()) fail(409, `${member.name} is already on your team.`);
  const origin = originOf(c);
  let result;
  if (!member) {
    member = { id: newId(), email, name, role: 'client', status: 'invited' };
    await db.batch([
      db.prepare("INSERT INTO users (id, email, name, role, status, created_at) VALUES (?,?,?,'client','invited',?)").bind(member.id, email, name, now()),
      addMember(db, client.id, member.id),
    ]);
    result = linkResponse(await issueLink(c, member, 'invite'), user);
  } else {
    await addMember(db, client.id, member.id).run();
    if (member.status === 'invited') {
      result = linkResponse(await issueLink(c, member, 'invite'), user);
    } else {
      // Already has a password: tell them they can now see this business too.
      const mail = renderEmail({
        origin,
        heading: `You now have access to ${client.name}`,
        paragraphs: [`Hi ${member.name},`, `${user.name} added you to ${client.name} in the Detcord Digital portal. Sign in with your usual email and password.`],
        button: { label: 'Open the portal', url: `${origin}/` },
      });
      const sent = await sendEmail(c.env, { to: member.email, subject: `You now have access to ${client.name}`, ...mail, idempotencyKey: `team-added/${client.id}/${member.id}/${now()}` });
      result = { delivery: sent.status, error: sent.error || null, existing: true };
    }
  }
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'team_invite', summary: `${user.name} added ${member.name} <${email}> to the business team` });
  return c.json({ id: member.id, ...result }, 201);
});

r.post('/clients/:id/members/:userId/invite', async (c) => {
  const { user, client } = await requireTeamManager(c, c.req.param('id'));
  const db = c.env.DB;
  const member = await loadMember(db, client.id, c.req.param('userId'));
  if (member.status === 'active') fail(409, `${member.name} has already set up their login.`);
  if (member.status === 'disabled') fail(409, 'This login is turned off. Ask your Detcord team.');
  await checkInviteLimit(db, client.id);
  const link = await issueLink(c, member, 'invite');
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'team_invite', summary: `${user.name} resent the invitation to ${member.name}` });
  return c.json(linkResponse(link, user));
});

r.patch('/clients/:id/members/:userId', async (c) => {
  const { user, client } = await requireTeamManager(c, c.req.param('id'));
  const db = c.env.DB;
  const member = await loadMember(db, client.id, c.req.param('userId'));
  const body = await readJson(c);
  if (typeof body.owner !== 'boolean') fail(400, 'Choose whether this person is an owner.');
  if (!!member.is_owner === body.owner) return c.json({ ok: true });
  if (!body.owner && (await ownerCount(db, client.id)) <= 1) fail(400, 'Every business needs an owner. Make someone else an owner first.');
  await db.prepare('UPDATE client_members SET is_owner=? WHERE client_id=? AND user_id=?').bind(body.owner ? 1 : 0, client.id, member.id).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'team_owner', summary: `${user.name} ${body.owner ? 'made' : 'removed'} ${member.name} ${body.owner ? 'an owner' : 'as an owner'}` });
  return c.json({ ok: true });
});

// Removes the login from this business only; the person keeps any other businesses they belong to.
r.delete('/clients/:id/members/:userId', async (c) => {
  const { user, client } = await requireTeamManager(c, c.req.param('id'));
  const db = c.env.DB;
  const member = await loadMember(db, client.id, c.req.param('userId'));
  if (member.is_owner && (await ownerCount(db, client.id)) <= 1) {
    fail(400, member.id === user.id ? 'You’re the only owner. Make someone else an owner before leaving.' : 'Every business needs an owner. Make someone else an owner first.');
  }
  await db.prepare('DELETE FROM client_members WHERE client_id=? AND user_id=?').bind(client.id, member.id).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'team_removed', summary: `${user.name} removed ${member.name} <${member.email}> from the business team` });
  return c.json({ ok: true });
});

// ---------- Services and service requests ----------

// The active catalog for clients: names and descriptions only. Prices come in a quote from the team.
r.get('/clients/:id/service-catalog', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'));
  const [catalog, current] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, category, description FROM services WHERE active=1 ORDER BY position').all(),
    c.env.DB.prepare("SELECT service_id FROM client_services WHERE client_id=? AND status='active'").bind(client.id).all(),
  ]);
  const active = new Set(current.results.map((s) => s.service_id));
  return c.json({ services: catalog.results.map((s) => ({ ...s, active: active.has(s.id) })) });
});

const requestOut = (row, staff) => ({
  id: row.id,
  services: JSON.parse(row.services),
  note: row.note,
  status: row.status,
  reply: row.reply,
  requestedBy: row.requester,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(staff ? { updatedBy: row.updater } : {}),
});

async function listRequests(db, clientId, staff) {
  const rows = (await db.prepare(`SELECT sr.*, u.name AS requester, s.name AS updater FROM service_requests sr
    LEFT JOIN users u ON u.id=sr.requested_by LEFT JOIN users s ON s.id=sr.updated_by
    WHERE sr.client_id=? ORDER BY sr.created_at DESC LIMIT 100`).bind(clientId).all()).results;
  return rows.map((r) => requestOut(r, staff));
}

r.get('/clients/:id/service-requests', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  return c.json({ requests: await listRequests(c.env.DB, client.id, isStaff(user)) });
});

// A client asks for one or more catalog services. The assigned reps (or the admins, when nobody is
// assigned) get a task and an email. Nothing about the client's services or billing changes.
r.post('/clients/:id/service-requests', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const db = c.env.DB;
  const body = await readJson(c);
  const ids = [...new Set(Array.isArray(body.services) ? body.services.map(String) : [])];
  if (!ids.length) fail(400, 'Pick at least one service.');
  if (ids.length > 15) fail(400, 'Pick up to 15 services in one request.');
  const found = (await db.prepare(`SELECT id, name FROM services WHERE active=1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY position`).bind(...ids).all()).results;
  if (found.length !== ids.length) fail(400, 'One of those services isn’t offered right now. Refresh and try again.');
  const note = text(body.note, { max: 2000 });
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM service_requests WHERE client_id=? AND created_at>?').bind(client.id, now() - DAY).first();
  if (recent.n >= REQUESTS_PER_DAY) fail(429, 'You’ve sent a lot of requests today. Your Detcord team will be in touch; try again tomorrow.');

  const id = newId();
  const t = now();
  const names = found.map((s) => s.name).join(', ');
  let staff = (await db.prepare(`SELECT u.id, u.name, u.email FROM assignments a JOIN users u ON u.id=a.user_id
    WHERE a.client_id=? AND u.status='active' AND u.role IN ('admin','rep')`).bind(client.id).all()).results;
  if (!staff.length) staff = (await db.prepare("SELECT id, name, email FROM users WHERE role='admin' AND status='active'").all()).results;
  await db.batch([
    db.prepare('INSERT INTO service_requests (id, client_id, requested_by, services, note, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, client.id, user.id, JSON.stringify(found), note, 'new', t, t),
    ...staff.map((s) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), client.id, s.id, `Quote ${client.name}: ${names}`.slice(0, 300), t + DAY, user.id, t)),
  ]);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'service_request', summary: `${user.name} asked about ${names}${note ? ` — "${note}"` : ''}` });

  const origin = originOf(c);
  const url = `${origin}/clients/${client.id}`;
  let emailed = 0;
  for (const s of staff) {
    const mail = renderEmail({
      origin,
      heading: `${client.name} asked about a service`,
      paragraphs: [`${user.name} asked about: ${names}.`, ...(note ? [`Their note: ${note}`] : []), 'A task is waiting for you. Send them a quote, then update the request on the client record.'],
      button: { label: 'Open the client', url },
    });
    const res = await sendEmail(c.env, { to: s.email, subject: `Service request: ${client.name}`, ...mail, idempotencyKey: `service-request/${id}/${s.id}` });
    if (res.status === 'sent') emailed++;
  }
  return c.json({ id, notified: staff.length, emailed }, 201);
});

r.patch('/clients/:id/service-requests/:requestId', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const row = await db.prepare('SELECT * FROM service_requests WHERE id=? AND client_id=?').bind(c.req.param('requestId'), client.id).first();
  if (!row) fail(404, 'Request not found.');
  const body = await readJson(c);
  const status = body.status !== undefined ? oneOf(body.status, REQUEST_STATUSES, 'Status') : row.status;
  const reply = body.reply !== undefined ? text(body.reply, { max: 2000 }) : row.reply;
  await db.prepare('UPDATE service_requests SET status=?, reply=?, updated_by=?, updated_at=? WHERE id=?').bind(status, reply, user.id, now(), row.id).run();
  if (status !== row.status) {
    const names = JSON.parse(row.services).map((s) => s.name).join(', ');
    await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'service_request', summary: `Service request (${names}): ${row.status} → ${status}` });
  }
  return c.json({ ok: true });
});

export default r;
