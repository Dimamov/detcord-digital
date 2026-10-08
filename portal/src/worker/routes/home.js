// Role dashboards ("Detcord Today", "My Day", client home) and the service catalog settings.
import { Hono } from 'hono';
import { fail, now, newId, text, cents, readJson } from '../lib/util.js';
import { requireUser, requireRole } from '../lib/auth.js';

const r = new Hono();
const DAY = 86400000;

function startOfDay(tz = 'America/Detroit') {
  // Midnight in Detroit, expressed in epoch ms.
  const d = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + d.getMilliseconds();
  return d.getTime() - elapsed;
}

r.get('/dashboard', async (c) => {
  const user = requireUser(c);
  const db = c.env.DB;
  const sod = startOfDay();
  const eod = sod + DAY;

  if (user.role === 'client') {
    const clients = (await db.prepare(`SELECT cl.id, cl.name, cl.status FROM clients cl JOIN client_members m ON m.client_id=cl.id WHERE m.user_id=?`).bind(user.id).all()).results;
    return c.json({ kind: 'client', clients });
  }

  const rep = user.role === 'rep';
  const scopeClients = rep ? 'client_id IN (SELECT client_id FROM assignments WHERE user_id=?)' : '1=1';
  const sb = rep ? [user.id] : [];

  const myTasks = (await db.prepare(`SELECT t.*, cl.name AS client_name FROM tasks t LEFT JOIN clients cl ON cl.id=t.client_id
    WHERE t.owner_id=? AND t.done_at IS NULL AND (t.due_at IS NULL OR t.due_at < ?) ORDER BY t.due_at IS NULL, t.due_at LIMIT 50`).bind(user.id, eod + 7 * DAY).all()).results;
  const overdue = myTasks.filter((t) => t.due_at && t.due_at < sod);
  const today = myTasks.filter((t) => t.due_at && t.due_at >= sod && t.due_at < eod);
  const upcoming = myTasks.filter((t) => !t.due_at || t.due_at >= eod);

  const stages = (await db.prepare('SELECT * FROM pipeline_stages ORDER BY position').all()).results;
  const dealRows = (await db.prepare(`SELECT d.stage_id, COUNT(*) AS n, COALESCE(SUM(d.setup_cents),0) AS setup, COALESCE(SUM(d.monthly_cents),0) AS monthly
    FROM deals d WHERE ${scopeClients.replace('client_id', 'd.client_id')} GROUP BY d.stage_id`).bind(...sb).all()).results;
  const pipeline = stages.map((s) => ({ ...s, ...(dealRows.find((d) => d.stage_id === s.id) || { n: 0, setup: 0, monthly: 0 }) }));

  // Deals with no activity in 7 days that are still open.
  const stale = (await db.prepare(`SELECT d.id, d.title, d.client_id, cl.name AS client_name, ps.name AS stage_name, d.updated_at,
      (SELECT MAX(a.created_at) FROM activity a WHERE a.client_id=d.client_id) AS last_touch
    FROM deals d JOIN clients cl ON cl.id=d.client_id JOIN pipeline_stages ps ON ps.id=d.stage_id
    WHERE ps.outcome='open' AND ${scopeClients.replace('client_id', 'd.client_id')} ${rep ? 'AND d.owner_id=?' : ''}
    ORDER BY COALESCE((SELECT MAX(a.created_at) FROM activity a WHERE a.client_id=d.client_id), d.updated_at) LIMIT 50`).bind(...sb, ...(rep ? [user.id] : [])).all()).results
    .filter((d) => Math.max(d.last_touch || 0, d.updated_at) < now() - 7 * DAY).slice(0, 8);

  const discoveriesOpen = (await db.prepare(`SELECT dc.id, dc.client_id, cl.name AS client_name, dc.updated_at FROM discoveries dc JOIN clients cl ON cl.id=dc.client_id
    WHERE dc.status='in_progress' AND ${rep ? 'dc.rep_id=?' : '1=1'} ORDER BY dc.updated_at DESC LIMIT 8`).bind(...(rep ? [user.id] : [])).all()).results;
  const intakesNew = (await db.prepare(`SELECT il.id, il.client_id, cl.name AS client_name, il.submitted_at FROM intake_links il JOIN clients cl ON cl.id=il.client_id
    WHERE il.submitted_at > ? AND ${scopeClients.replace('client_id', 'il.client_id')} ORDER BY il.submitted_at DESC LIMIT 8`).bind(now() - 7 * DAY, ...sb).all()).results;

  const base = { kind: rep ? 'rep' : 'admin', tasks: { overdue, today, upcoming }, pipeline, stale, discoveriesOpen, intakesNew };
  if (rep) {
    const counts = await db.prepare('SELECT COUNT(*) AS clients FROM assignments WHERE user_id=?').bind(user.id).first();
    return c.json({ ...base, counts });
  }

  const counts = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM clients WHERE status='active') AS active_clients,
      (SELECT COUNT(*) FROM clients WHERE status IN ('lead','prospect')) AS prospects,
      (SELECT COUNT(*) FROM clients WHERE created_at > ?) AS new_this_week,
      (SELECT COUNT(*) FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE ps.outcome='won' AND d.closed_at > ?) AS won_this_month,
      (SELECT COUNT(*) FROM tasks WHERE done_at IS NULL AND due_at < ?) AS team_overdue,
      (SELECT COUNT(*) FROM clients cl WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.client_id=cl.id)) AS unassigned`)
    .bind(now() - 7 * DAY, now() - 30 * DAY, sod).first();
  const invites = (await db.prepare(`SELECT u.id, u.name, u.email, u.role, t.delivery, t.expires_at FROM users u
    JOIN tokens t ON t.id = (SELECT id FROM tokens WHERE user_id=u.id AND kind='invite' ORDER BY created_at DESC LIMIT 1)
    WHERE u.status='invited' ORDER BY t.created_at DESC LIMIT 20`).all()).results
    .map((i) => ({ ...i, state: i.expires_at < now() ? 'expired' : i.delivery === 'sent' ? 'waiting' : 'not_delivered' }));
  const team = (await db.prepare(`SELECT u.id, u.name,
      (SELECT COUNT(*) FROM assignments a WHERE a.user_id=u.id) AS clients,
      (SELECT COUNT(*) FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.owner_id=u.id AND ps.outcome='open') AS open_deals,
      (SELECT COUNT(*) FROM tasks t WHERE t.owner_id=u.id AND t.done_at IS NULL AND t.due_at < ?) AS overdue
    FROM users u WHERE u.status<>'disabled' AND (u.role='rep' OR (u.role='admin' AND (EXISTS (SELECT 1 FROM assignments a WHERE a.user_id=u.id) OR EXISTS (SELECT 1 FROM deals d WHERE d.owner_id=u.id)))) ORDER BY u.name`).bind(sod).all()).results;
  const activity = (await db.prepare(`SELECT a.*, u.name AS actor, cl.name AS client_name FROM activity a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN clients cl ON cl.id=a.client_id
    ORDER BY a.created_at DESC LIMIT 15`).all()).results;
  const emails = (await db.prepare('SELECT id,provider_id,recipient,subject,status,error,created_at,updated_at FROM outbound_emails WHERE is_alert=0 ORDER BY created_at DESC LIMIT 20').all()).results;
  return c.json({ ...base, counts, invites, team, activity, emails, emailTrackingReady: !!c.env.RESEND_WEBHOOK_SECRET });
});

// ---------- Service catalog ----------

r.get('/services', async (c) => {
  requireRole(c, 'admin', 'rep');
  const rows = (await c.env.DB.prepare('SELECT * FROM services ORDER BY position').all()).results;
  return c.json({ services: rows });
});

r.put('/services/:id', async (c) => {
  requireRole(c, 'admin');
  const b = await readJson(c);
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM services WHERE id=?').bind(id).first();
  if (!existing) fail(404, 'Service not found.');
  await db.prepare('UPDATE services SET name=?, description=?, setup_cents=?, monthly_cents=?, active=? WHERE id=?').bind(
    b.name !== undefined ? text(b.name, { max: 160, required: true, label: 'Name' }) : existing.name,
    b.description !== undefined ? text(b.description, { max: 1000 }) : existing.description,
    b.setup !== undefined ? cents(b.setup, 'Setup price') : existing.setup_cents,
    b.monthly !== undefined ? cents(b.monthly, 'Monthly price') : existing.monthly_cents,
    b.active !== undefined ? (b.active ? 1 : 0) : existing.active, id).run();
  return c.json({ ok: true });
});

r.post('/services', async (c) => {
  requireRole(c, 'admin');
  const b = await readJson(c);
  const db = c.env.DB;
  const max = await db.prepare('SELECT COALESCE(MAX(position),0) AS p FROM services').first();
  const id = `custom-${newId().slice(0, 8)}`;
  await db.prepare('INSERT INTO services (id, name, category, description, setup_cents, monthly_cents, position) VALUES (?,?,?,?,?,?,?)')
    .bind(id, text(b.name, { max: 160, required: true, label: 'Name' }), text(b.category, { max: 40 }) || 'run', text(b.description, { max: 1000 }),
      cents(b.setup, 'Setup price'), cents(b.monthly, 'Monthly price'), max.p + 1).run();
  return c.json({ id }, 201);
});

// Reps the admin can assign; used by forms.
r.get('/team', async (c) => {
  requireRole(c, 'admin', 'rep');
  const rows = (await c.env.DB.prepare("SELECT id, name, role FROM users WHERE role IN ('admin','rep') AND status<>'disabled' ORDER BY name").all()).results;
  return c.json({ team: rows });
});

export default r;
