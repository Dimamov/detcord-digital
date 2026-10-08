// The central client record: business info, contacts, team, services, notes and everything linked to it.
import { Hono } from 'hono';
import { fail, now, newId, text, cents, oneOf, readJson, logActivity, EMAIL_RE } from '../lib/util.js';
import { requireUser, requireRole, requireClient, clientScopeSql, isStaff } from '../lib/auth.js';
import { INDUSTRY_IDS } from '../../shared/discovery/industries.js';

const r = new Hono();
const STATUSES = ['lead', 'prospect', 'active', 'paused', 'former'];

function clientFields(body, { partial = false } = {}) {
  const out = {};
  const set = (k, v) => { if (!partial || body[k] !== undefined) out[k] = v; };
  set('name', text(body.name, { max: 160, required: !partial || body.name !== undefined, label: 'Business name' }));
  set('industry', body.industry ? oneOf(body.industry, [...INDUSTRY_IDS, 'other'], 'Industry') : null);
  set('website', normalizeUrl(body.website));
  set('phone', text(body.phone, { max: 40 }));
  set('email', body.email ? (EMAIL_RE.test(String(body.email).trim()) ? String(body.email).trim().toLowerCase() : fail(400, 'Enter a valid business email.')) : null);
  set('address', text(body.address, { max: 200 }));
  set('city', text(body.city, { max: 80 }));
  set('state', text(body.state, { max: 40 }) || 'MI');
  set('zip', text(body.zip, { max: 12 }));
  set('source', text(body.source, { max: 80 }));
  if (body.status !== undefined || !partial) set('status', oneOf(body.status || 'lead', STATUSES, 'Status'));
  if (body.timezone !== undefined) out.timezone = text(body.timezone, { max: 60 }) || 'America/Detroit';
  return out;
}

function normalizeUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol)) throw 0;
    return u.href.replace(/\/$/, '');
  } catch {
    fail(400, 'Enter a valid website address.');
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

r.get('/', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('status');
  const where = [scope.sql];
  const binds = [...scope.binds];
  if (q) { where.push('(cl.name LIKE ? OR cl.city LIKE ? OR cl.phone LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status && STATUSES.includes(status)) { where.push('cl.status=?'); binds.push(status); }
  const rows = (await c.env.DB.prepare(`SELECT cl.id, cl.name, cl.industry, cl.city, cl.status, cl.phone, cl.website, cl.updated_at,
      (SELECT group_concat(u.name, ', ') FROM assignments a JOIN users u ON u.id=a.user_id WHERE a.client_id=cl.id) AS reps,
      EXISTS (SELECT 1 FROM assignments a WHERE a.client_id=cl.id AND a.user_id=?) AS mine,
      (SELECT ps.name FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=cl.id ORDER BY d.updated_at DESC LIMIT 1) AS stage,
      (SELECT MIN(t.due_at) FROM tasks t WHERE t.client_id=cl.id AND t.done_at IS NULL) AS next_due
    FROM clients cl WHERE ${where.join(' AND ')} ORDER BY cl.updated_at DESC LIMIT 500`).bind(user.id, ...binds).all()).results;
  // Clients never see internal pipeline or task data.
  if (!isStaff(user)) for (const row of rows) { delete row.stage; delete row.next_due; delete row.mine; }
  return c.json({ clients: rows });
});

// "New or existing?" helper: finds likely duplicates. Reps learn only that a match exists outside their book.
r.get('/match', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const name = norm(c.req.query('name'));
  const phone = String(c.req.query('phone') || '').replace(/\D/g, '').slice(-10);
  const site = norm(String(c.req.query('website') || '').replace(/^https?:\/\/(www\.)?/i, ''));
  if (name.length < 3 && phone.length < 10 && site.length < 4) return c.json({ matches: [], hidden: 0 });
  const all = (await c.env.DB.prepare('SELECT id, name, city, phone, website FROM clients').all()).results;
  const hits = all.filter((cl) =>
    (name.length >= 3 && norm(cl.name) === name)
    || (phone.length === 10 && String(cl.phone || '').replace(/\D/g, '').slice(-10) === phone)
    || (site.length >= 4 && norm(String(cl.website || '').replace(/^https?:\/\/(www\.)?/i, '')) === site));
  if (user.role === 'admin') return c.json({ matches: hits, hidden: 0 });
  const mine = new Set((await c.env.DB.prepare('SELECT client_id FROM assignments WHERE user_id=?').bind(user.id).all()).results.map((a) => a.client_id));
  return c.json({ matches: hits.filter((h) => mine.has(h.id)), hidden: hits.filter((h) => !mine.has(h.id)).length });
});

r.post('/', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const db = c.env.DB;
  const body = await readJson(c);
  const f = clientFields(body);
  const id = newId();
  const t = now();
  const stmts = [db.prepare(`INSERT INTO clients (id, name, industry, website, phone, email, address, city, state, zip, status, source, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, f.name, f.industry, f.website, f.phone, f.email, f.address, f.city, f.state, f.zip, f.status, f.source, user.id, t, t)];
  const repId = user.role === 'rep' ? user.id : body.repId || null;
  if (repId) {
    if (user.role === 'admin' && !(await db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('admin','rep') AND status<>'disabled'").bind(repId).first())) fail(400, 'Choose a valid sales rep.');
    stmts.push(db.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, repId, t));
  }
  const contact = body.contact;
  if (contact?.name) {
    stmts.push(db.prepare('INSERT INTO contacts (id, client_id, name, title, email, phone, is_primary, is_decision_maker, created_at) VALUES (?,?,?,?,?,?,1,?,?)')
      .bind(newId(), id, text(contact.name, { max: 120 }), text(contact.title, { max: 80 }), contactEmail(contact.email), text(contact.phone, { max: 40 }), contact.decisionMaker ? 1 : 0, t));
  }
  if (body.createDeal !== false) {
    stmts.push(db.prepare("INSERT INTO deals (id, client_id, owner_id, stage_id, title, created_at, updated_at) VALUES (?,?,?,'new',?,?,?)")
      .bind(newId(), id, repId || user.id, `${f.name} — new business`, t, t));
  }
  await db.batch(stmts);
  await logActivity(db, { clientId: id, actorId: user.id, kind: 'client_created', summary: `Created ${f.name}` });
  return c.json({ id }, 201);
});

function contactEmail(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (!EMAIL_RE.test(s)) fail(400, 'Enter a valid contact email.');
  return s;
}

r.get('/:id', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const db = c.env.DB;
  const id = client.id;
  const staff = isStaff(user);
  const [contacts, reps, services, notes] = await Promise.all([
    db.prepare('SELECT * FROM contacts WHERE client_id=? ORDER BY is_primary DESC, name').bind(id).all(),
    db.prepare('SELECT u.id, u.name, u.email, u.phone FROM assignments a JOIN users u ON u.id=a.user_id WHERE a.client_id=? ORDER BY u.name').bind(id).all(),
    db.prepare('SELECT cs.*, s.name, s.category FROM client_services cs JOIN services s ON s.id=cs.service_id WHERE cs.client_id=? ORDER BY s.position').bind(id).all(),
    db.prepare(`SELECT n.id, n.body, n.visibility, n.created_at, n.author_id, u.name AS author FROM notes n LEFT JOIN users u ON u.id=n.author_id
      WHERE n.client_id=? ${staff ? '' : "AND n.visibility='shared'"} ORDER BY n.created_at DESC LIMIT 200`).bind(id).all(),
  ]);
  const record = {
    client,
    contacts: contacts.results,
    team: reps.results,
    services: staff ? services.results : services.results.filter((s) => s.status === 'active'),
    notes: notes.results,
  };
  if (staff) {
    const [members, deals, tasks, discoveries, activity, intakes] = await Promise.all([
      db.prepare(`SELECT u.id, u.name, u.email, u.status, u.last_login_at,
        (SELECT delivery FROM tokens t WHERE t.user_id=u.id AND t.kind='invite' ORDER BY created_at DESC LIMIT 1) AS invite_delivery,
        (SELECT expires_at FROM tokens t WHERE t.user_id=u.id AND t.kind='invite' ORDER BY created_at DESC LIMIT 1) AS invite_expires
        FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? ORDER BY u.name`).bind(id).all(),
      db.prepare('SELECT d.*, ps.name AS stage_name, ps.outcome, u.name AS owner FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id LEFT JOIN users u ON u.id=d.owner_id WHERE d.client_id=? ORDER BY d.updated_at DESC').bind(id).all(),
      db.prepare('SELECT t.*, u.name AS owner FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.client_id=? ORDER BY t.done_at IS NOT NULL, t.due_at').bind(id).all(),
      db.prepare('SELECT id, industry, status, result, created_at, updated_at FROM discoveries WHERE client_id=? ORDER BY updated_at DESC').bind(id).all(),
      db.prepare('SELECT a.*, u.name AS actor FROM activity a LEFT JOIN users u ON u.id=a.actor_id WHERE a.client_id=? ORDER BY a.created_at DESC LIMIT 50').bind(id).all(),
      db.prepare('SELECT id, created_at, expires_at, submitted_at FROM intake_links WHERE client_id=? ORDER BY created_at DESC').bind(id).all(),
    ]);
    Object.assign(record, {
      logins: members.results,
      deals: deals.results,
      tasks: tasks.results,
      discoveries: discoveries.results.map((d) => ({ ...d, result: d.result ? JSON.parse(d.result) : null })),
      activity: activity.results,
      intakes: intakes.results,
    });
  }
  return c.json(record);
});

r.patch('/:id', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const body = await readJson(c);
  const f = clientFields(body, { partial: true });
  const keys = Object.keys(f);
  if (!keys.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE clients SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`)
    .bind(...keys.map((k) => f[k]), now(), client.id).run();
  if (f.status && f.status !== client.status) {
    await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'status', summary: `Status changed from ${client.status} to ${f.status}` });
  }
  return c.json({ ok: true });
});

// Admin-only hard delete. Requires typing the business name. Removes everything linked to the client.
r.delete('/:id', async (c) => {
  const user = requireRole(c, 'admin');
  const { client } = await requireClient(c, c.req.param('id'));
  const body = await readJson(c);
  if (String(body.confirm || '').trim() !== client.name) fail(400, 'Type the business name exactly to confirm.');
  const db = c.env.DB;
  const ids = ['contacts', 'client_services', 'notes', 'tasks', 'discoveries', 'intake_links', 'deals', 'assignments', 'client_members', 'activity'];
  await db.batch([...ids.map((t) => db.prepare(`DELETE FROM ${t} WHERE client_id=?`).bind(client.id)), db.prepare('DELETE FROM clients WHERE id=?').bind(client.id)]);
  await logActivity(db, { actorId: user.id, kind: 'client_deleted', summary: `Deleted client ${client.name}` });
  return c.json({ ok: true });
});

// Contacts
r.post('/:id/contacts', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const id = newId();
  const db = c.env.DB;
  const stmts = [];
  if (b.isPrimary) stmts.push(db.prepare('UPDATE contacts SET is_primary=0 WHERE client_id=?').bind(client.id));
  stmts.push(db.prepare('INSERT INTO contacts (id, client_id, name, title, email, phone, is_primary, is_decision_maker, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, client.id, text(b.name, { max: 120, required: true, label: 'Name' }), text(b.title, { max: 80 }), contactEmail(b.email), text(b.phone, { max: 40 }), b.isPrimary ? 1 : 0, b.decisionMaker ? 1 : 0, now()));
  await db.batch(stmts);
  return c.json({ id }, 201);
});

r.patch('/:id/contacts/:contactId', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const db = c.env.DB;
  const contact = await db.prepare('SELECT * FROM contacts WHERE id=? AND client_id=?').bind(c.req.param('contactId'), client.id).first();
  if (!contact) fail(404, 'Contact not found.');
  const stmts = [];
  if (b.isPrimary) stmts.push(db.prepare('UPDATE contacts SET is_primary=0 WHERE client_id=?').bind(client.id));
  stmts.push(db.prepare('UPDATE contacts SET name=?, title=?, email=?, phone=?, is_primary=?, is_decision_maker=? WHERE id=?').bind(
    b.name !== undefined ? text(b.name, { max: 120, required: true, label: 'Name' }) : contact.name,
    b.title !== undefined ? text(b.title, { max: 80 }) : contact.title,
    b.email !== undefined ? contactEmail(b.email) : contact.email,
    b.phone !== undefined ? text(b.phone, { max: 40 }) : contact.phone,
    b.isPrimary !== undefined ? (b.isPrimary ? 1 : 0) : contact.is_primary,
    b.decisionMaker !== undefined ? (b.decisionMaker ? 1 : 0) : contact.is_decision_maker,
    contact.id));
  await db.batch(stmts);
  return c.json({ ok: true });
});

r.delete('/:id/contacts/:contactId', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  await c.env.DB.prepare('DELETE FROM contacts WHERE id=? AND client_id=?').bind(c.req.param('contactId'), client.id).run();
  return c.json({ ok: true });
});

// Services on the client
r.put('/:id/services/:serviceId', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const service = await c.env.DB.prepare('SELECT * FROM services WHERE id=?').bind(c.req.param('serviceId')).first();
  if (!service) fail(404, 'Service not found.');
  const status = oneOf(b.status || 'recommended', ['recommended', 'proposed', 'active', 'ended'], 'Service status');
  await c.env.DB.prepare(`INSERT INTO client_services (client_id, service_id, status, setup_cents, monthly_cents, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(client_id, service_id) DO UPDATE SET status=excluded.status, setup_cents=excluded.setup_cents, monthly_cents=excluded.monthly_cents, updated_at=excluded.updated_at`)
    .bind(client.id, service.id, status, cents(b.setup, 'Setup price'), cents(b.monthly, 'Monthly price'), now()).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'service', summary: `${service.name}: ${status}` });
  return c.json({ ok: true });
});

r.delete('/:id/services/:serviceId', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  await c.env.DB.prepare('DELETE FROM client_services WHERE client_id=? AND service_id=?').bind(client.id, c.req.param('serviceId')).run();
  return c.json({ ok: true });
});

// Notes: internal by default. Shared notes are visible to the client's logins.
r.post('/:id/notes', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const id = newId();
  const visibility = oneOf(b.visibility || 'internal', ['internal', 'shared'], 'Visibility');
  await c.env.DB.prepare('INSERT INTO notes (id, client_id, author_id, body, visibility, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, client.id, user.id, text(b.body, { max: 10000, required: true, label: 'Note' }), visibility, now()).run();
  return c.json({ id }, 201);
});

r.delete('/:id/notes/:noteId', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const note = await c.env.DB.prepare('SELECT * FROM notes WHERE id=? AND client_id=?').bind(c.req.param('noteId'), client.id).first();
  if (!note) fail(404, 'Note not found.');
  if (user.role !== 'admin' && note.author_id !== user.id) fail(403, 'Only the author or an admin can delete this note.');
  await c.env.DB.prepare('DELETE FROM notes WHERE id=?').bind(note.id).run();
  return c.json({ ok: true });
});

export default r;
