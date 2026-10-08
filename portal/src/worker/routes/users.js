// Team and account management (admin only), plus client-login invites (admin or assigned rep).
import { Hono } from 'hono';
import { fail, now, newId, cleanEmail, text, oneOf, readJson, logActivity } from '../lib/util.js';
import { requireRole, requireClient, issueLink } from '../lib/auth.js';

const r = new Hono();

const inviteState = (t) => !t ? null : {
  sentAt: t.created_at,
  expiresAt: t.expires_at,
  usedAt: t.used_at,
  delivery: t.delivery,
  error: t.delivery_error,
  state: t.used_at ? 'accepted' : t.expires_at < now() ? 'expired' : t.delivery === 'sent' ? 'sent' : 'not_delivered',
};

async function listUsers(db, where = '1=1', binds = []) {
  const users = (await db.prepare(`SELECT id, email, name, role, status, phone, created_at, last_login_at FROM users WHERE ${where} ORDER BY role, name`).bind(...binds).all()).results;
  const tokens = (await db.prepare("SELECT * FROM tokens WHERE kind='invite' ORDER BY created_at").all()).results;
  const latest = {};
  for (const t of tokens) latest[t.user_id] = t;
  const assignments = (await db.prepare('SELECT a.user_id, a.client_id, cl.name FROM assignments a JOIN clients cl ON cl.id=a.client_id').all()).results;
  const members = (await db.prepare('SELECT m.user_id, m.client_id, cl.name FROM client_members m JOIN clients cl ON cl.id=m.client_id').all()).results;
  return users.map((u) => ({
    ...u,
    invite: inviteState(latest[u.id]),
    clients: [...assignments, ...members].filter((a) => a.user_id === u.id).map((a) => ({ id: a.client_id, name: a.name })),
  }));
}

// Link details are shown to the inviter only when email did not go out, so they can share it by hand.
const linkResponse = (link) => ({ delivery: link.delivery, error: link.error, expiresAt: link.expiresAt, ...(link.delivery === 'sent' ? {} : { manualLink: link.url }) });

r.get('/', async (c) => {
  requireRole(c, 'admin');
  return c.json({ users: await listUsers(c.env.DB) });
});

r.post('/', async (c) => {
  const actor = requireRole(c, 'admin', 'rep');
  const db = c.env.DB;
  const body = await readJson(c);
  const role = oneOf(body.role, ['admin', 'rep', 'client'], 'Role');
  if (actor.role === 'rep' && role !== 'client') fail(403, 'Only an administrator can add team members.');
  const email = cleanEmail(body.email);
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  let clientId = null;
  if (role === 'client') {
    clientId = body.clientId;
    await requireClient(c, clientId, { write: true });
  }
  if (await db.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) fail(409, 'Someone already has a portal account with that email.');
  const user = { id: newId(), email, name, role };
  const stmts = [db.prepare("INSERT INTO users (id, email, name, role, status, phone, created_at) VALUES (?,?,?,?,'invited',?,?)")
    .bind(user.id, email, name, role, text(body.phone, { max: 40 }), now())];
  if (clientId) stmts.push(db.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(clientId, user.id));
  await db.batch(stmts);
  const link = await issueLink(c, user, 'invite');
  await logActivity(db, { clientId, actorId: actor.id, kind: 'invite', summary: `Invited ${name} (${role})` });
  return c.json({ id: user.id, ...linkResponse(link) }, 201);
});

async function loadTarget(c, id) {
  const actor = requireRole(c, 'admin', 'rep');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!user) fail(404, 'Account not found.');
  if (actor.role === 'rep') {
    // Reps may only manage client logins of businesses assigned to them.
    if (user.role !== 'client') fail(404, 'Account not found.');
    const ok = await c.env.DB.prepare('SELECT 1 FROM client_members m JOIN assignments a ON a.client_id=m.client_id WHERE m.user_id=? AND a.user_id=?').bind(id, actor.id).first();
    if (!ok) fail(404, 'Account not found.');
  }
  return { actor, user };
}

r.post('/:id/invite', async (c) => {
  const { actor, user } = await loadTarget(c, c.req.param('id'));
  if (user.status === 'active') fail(409, 'This person has already set up their account. Use password reset instead.');
  if (user.status === 'disabled') fail(409, 'Re-enable this account before inviting again.');
  const link = await issueLink(c, user, 'invite');
  await logActivity(c.env.DB, { actorId: actor.id, kind: 'invite', summary: `Resent invitation to ${user.name}` });
  return c.json(linkResponse(link));
});

r.patch('/:id', async (c) => {
  const actor = requireRole(c, 'admin');
  const db = c.env.DB;
  const id = c.req.param('id');
  const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!user) fail(404, 'Account not found.');
  const body = await readJson(c);
  if (body.status !== undefined) {
    const status = oneOf(body.status, ['active', 'disabled'], 'Status');
    if (id === actor.id) fail(400, 'You cannot disable your own account.');
    if (status === 'active' && !user.pw_hash) fail(400, 'This person has not set a password yet. Resend the invitation instead.');
    await db.batch([
      db.prepare('UPDATE users SET status=? WHERE id=?').bind(status, id),
      ...(status === 'disabled' ? [db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)] : []),
    ]);
  }
  if (body.name !== undefined) {
    await db.prepare('UPDATE users SET name=? WHERE id=?').bind(text(body.name, { max: 120, required: true, label: 'Name' }), id).run();
  }
  return c.json({ ok: true });
});

// Deleting a login revokes access everywhere but keeps business, sales and financial records.
r.delete('/:id', async (c) => {
  const actor = requireRole(c, 'admin');
  const db = c.env.DB;
  const id = c.req.param('id');
  const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!user) fail(404, 'Account not found.');
  if (id === actor.id) fail(400, 'You cannot delete your own account.');
  if (user.role === 'admin') {
    const others = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active' AND id<>?").bind(id).first();
    if (!others.n) fail(400, 'Keep at least one active administrator.');
  }
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
    db.prepare('DELETE FROM tokens WHERE user_id=?').bind(id),
    db.prepare('DELETE FROM assignments WHERE user_id=?').bind(id),
    db.prepare('DELETE FROM client_members WHERE user_id=?').bind(id),
    // Open tasks move to the admin who deleted the account so nothing is silently dropped.
    db.prepare('UPDATE tasks SET owner_id=? WHERE owner_id=? AND done_at IS NULL').bind(actor.id, id),
    db.prepare('DELETE FROM tasks WHERE owner_id=?').bind(id),
    db.prepare('UPDATE deals SET owner_id=NULL WHERE owner_id=?').bind(id),
    db.prepare('UPDATE notes SET author_id=NULL WHERE author_id=?').bind(id),
    db.prepare('UPDATE discoveries SET rep_id=NULL WHERE rep_id=?').bind(id),
    db.prepare('DELETE FROM commission_rules WHERE rep_id=?').bind(id),
    db.prepare('DELETE FROM users WHERE id=?').bind(id),
  ]);
  await logActivity(db, { actorId: actor.id, kind: 'account_deleted', summary: `Deleted ${user.role} account ${user.name} <${user.email}>` });
  return c.json({ ok: true });
});

// Assign or unassign a rep to a client.
r.put('/:id/clients/:clientId', async (c) => {
  const actor = requireRole(c, 'admin');
  const db = c.env.DB;
  const { id, clientId } = c.req.param();
  const rep = await db.prepare("SELECT * FROM users WHERE id=? AND role='rep'").bind(id).first();
  if (!rep) fail(404, 'Sales rep not found.');
  const client = await db.prepare('SELECT name FROM clients WHERE id=?').bind(clientId).first();
  if (!client) fail(404, 'Client not found.');
  await db.prepare('INSERT OR IGNORE INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(clientId, id, now()).run();
  await logActivity(db, { clientId, actorId: actor.id, kind: 'assignment', summary: `Assigned ${rep.name} to ${client.name}` });
  return c.json({ ok: true });
});

r.delete('/:id/clients/:clientId', async (c) => {
  const actor = requireRole(c, 'admin');
  const { id, clientId } = c.req.param();
  await c.env.DB.prepare('DELETE FROM assignments WHERE client_id=? AND user_id=?').bind(clientId, id).run();
  await logActivity(c.env.DB, { clientId, actorId: actor.id, kind: 'assignment', summary: 'Removed a rep assignment' });
  return c.json({ ok: true });
});

export default r;
