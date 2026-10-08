// Pipeline, deals, follow-up tasks and commission rules.
import { Hono } from 'hono';
import { fail, now, newId, text, cents, oneOf, readJson, logActivity } from '../lib/util.js';
import { requireUser, requireRole, requireClient } from '../lib/auth.js';

const r = new Hono();

// ---------- Pipeline ----------

r.get('/pipeline', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const db = c.env.DB;
  const stages = (await db.prepare('SELECT * FROM pipeline_stages ORDER BY position').all()).results;
  const scope = user.role === 'admin' ? '' : 'WHERE d.client_id IN (SELECT client_id FROM assignments WHERE user_id=?)';
  const deals = (await db.prepare(`SELECT d.*, cl.name AS client_name, cl.industry, u.name AS owner,
      (SELECT MIN(t.due_at) FROM tasks t WHERE t.client_id=d.client_id AND t.done_at IS NULL) AS next_due
    FROM deals d JOIN clients cl ON cl.id=d.client_id LEFT JOIN users u ON u.id=d.owner_id ${scope} ORDER BY d.updated_at DESC`)
    .bind(...(user.role === 'admin' ? [] : [user.id])).all()).results;
  return c.json({ stages, deals });
});

async function loadDeal(c, id) {
  const deal = await c.env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(id).first();
  if (!deal) fail(404, 'Deal not found.');
  const { user, client } = await requireClient(c, deal.client_id, { staffOnly: true });
  return { user, client, deal };
}

async function stageExists(db, id) {
  const s = await db.prepare('SELECT * FROM pipeline_stages WHERE id=?').bind(id).first();
  if (!s) fail(400, 'Choose a valid pipeline stage.');
  return s;
}

r.post('/deals', async (c) => {
  const body = await readJson(c);
  const { user, client } = await requireClient(c, body.clientId, { staffOnly: true });
  const db = c.env.DB;
  const stage = await stageExists(db, body.stageId || 'new');
  const id = newId();
  const t = now();
  await db.prepare('INSERT INTO deals (id, client_id, owner_id, stage_id, title, setup_cents, monthly_cents, expected_close, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, client.id, user.role === 'rep' ? user.id : body.ownerId || user.id, stage.id,
      text(body.title, { max: 160 }) || `${client.name} — new business`, cents(body.setup, 'Setup value'), cents(body.monthly, 'Monthly value'),
      text(body.expectedClose, { max: 10 }), t, t).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'deal', summary: `Opened deal in ${stage.name}` });
  return c.json({ id }, 201);
});

r.patch('/deals/:id', async (c) => {
  const { user, client, deal } = await loadDeal(c, c.req.param('id'));
  const db = c.env.DB;
  const b = await readJson(c);
  const next = { ...deal };
  let stage = null;
  if (b.stageId !== undefined && b.stageId !== deal.stage_id) {
    stage = await stageExists(db, b.stageId);
    next.stage_id = stage.id;
    next.closed_at = stage.outcome === 'open' ? null : now();
    if (stage.outcome === 'lost') next.lost_reason = text(b.lostReason, { max: 300 });
  }
  if (b.title !== undefined) next.title = text(b.title, { max: 160, required: true, label: 'Deal name' });
  if (b.setup !== undefined) next.setup_cents = cents(b.setup, 'Setup value');
  if (b.monthly !== undefined) next.monthly_cents = cents(b.monthly, 'Monthly value');
  if (b.expectedClose !== undefined) next.expected_close = text(b.expectedClose, { max: 10 });
  if (b.ownerId !== undefined && user.role === 'admin') {
    if (b.ownerId && !(await db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('admin','rep')").bind(b.ownerId).first())) fail(400, 'Choose a valid owner.');
    next.owner_id = b.ownerId || null;
  }
  const stmts = [db.prepare('UPDATE deals SET stage_id=?, title=?, setup_cents=?, monthly_cents=?, expected_close=?, owner_id=?, lost_reason=?, closed_at=?, updated_at=? WHERE id=?')
    .bind(next.stage_id, next.title, next.setup_cents, next.monthly_cents, next.expected_close, next.owner_id, next.lost_reason, next.closed_at, now(), deal.id)];
  if (stage?.outcome === 'won' && ['lead', 'prospect'].includes(client.status)) {
    stmts.push(db.prepare("UPDATE clients SET status='active', updated_at=? WHERE id=?").bind(now(), client.id));
  } else if (stage?.outcome === 'open' && client.status === 'lead' && stage.position > 1) {
    stmts.push(db.prepare("UPDATE clients SET status='prospect', updated_at=? WHERE id=?").bind(now(), client.id));
  }
  await db.batch(stmts);
  if (stage) await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'deal', summary: `Deal moved to ${stage.name}${next.lost_reason ? ` (${next.lost_reason})` : ''}` });
  return c.json({ ok: true });
});

r.delete('/deals/:id', async (c) => {
  requireRole(c, 'admin');
  const { deal } = await loadDeal(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM deals WHERE id=?').bind(deal.id).run();
  return c.json({ ok: true });
});

// Stage configuration (admin)
r.post('/stages', async (c) => {
  requireRole(c, 'admin');
  const b = await readJson(c);
  const db = c.env.DB;
  const max = await db.prepare('SELECT COALESCE(MAX(position),0) AS p FROM pipeline_stages').first();
  const id = newId();
  await db.prepare('INSERT INTO pipeline_stages (id, name, position, outcome, provisional) VALUES (?,?,?,?,0)')
    .bind(id, text(b.name, { max: 60, required: true, label: 'Stage name' }), max.p + 1, oneOf(b.outcome || 'open', ['open', 'won', 'lost'], 'Outcome')).run();
  return c.json({ id }, 201);
});

// Replace order/names in one call: [{id, name, outcome}] in display order. Saving approves the stages.
r.put('/stages', async (c) => {
  requireRole(c, 'admin');
  const b = await readJson(c);
  const db = c.env.DB;
  const existing = (await db.prepare('SELECT id FROM pipeline_stages').all()).results.map((s) => s.id);
  if (!Array.isArray(b.stages) || b.stages.length !== existing.length || !b.stages.every((s) => existing.includes(s.id))) fail(400, 'Send every stage exactly once.');
  if (!b.stages.some((s) => s.outcome === 'won') || !b.stages.some((s) => s.outcome === 'lost')) fail(400, 'Keep at least one Won and one Lost stage.');
  await db.batch(b.stages.map((s, i) => db.prepare('UPDATE pipeline_stages SET name=?, outcome=?, position=?, provisional=0 WHERE id=?')
    .bind(text(s.name, { max: 60, required: true, label: 'Stage name' }), oneOf(s.outcome, ['open', 'won', 'lost'], 'Outcome'), i + 1, s.id)));
  return c.json({ ok: true });
});

r.delete('/stages/:id', async (c) => {
  requireRole(c, 'admin');
  const db = c.env.DB;
  const id = c.req.param('id');
  const used = await db.prepare('SELECT COUNT(*) AS n FROM deals WHERE stage_id=?').bind(id).first();
  if (used.n) fail(409, `Move the ${used.n} deal(s) in this stage first.`);
  await db.prepare('DELETE FROM pipeline_stages WHERE id=?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- Tasks ----------

r.get('/tasks', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const db = c.env.DB;
  const where = [];
  const binds = [];
  const scope = c.req.query('scope') || 'mine';
  if (scope === 'mine' || user.role === 'rep') { where.push('t.owner_id=?'); binds.push(user.id); }
  if (user.role === 'rep') { where.push('(t.client_id IS NULL OR t.client_id IN (SELECT client_id FROM assignments WHERE user_id=?))'); binds.push(user.id); }
  if (c.req.query('open') !== 'false') where.push('t.done_at IS NULL');
  const rows = (await db.prepare(`SELECT t.*, cl.name AS client_name, u.name AS owner FROM tasks t LEFT JOIN clients cl ON cl.id=t.client_id
    JOIN users u ON u.id=t.owner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.done_at IS NOT NULL, t.due_at IS NULL, t.due_at LIMIT 500`).bind(...binds).all()).results;
  return c.json({ tasks: rows });
});

function dueAt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n)) fail(400, 'Choose a valid due date.');
  return n;
}

async function ownerFor(c, user, ownerId, clientId) {
  if (!ownerId || ownerId === user.id) return user.id;
  if (user.role !== 'admin') fail(403, 'Only an admin can assign tasks to someone else.');
  const owner = await c.env.DB.prepare("SELECT id, role FROM users WHERE id=? AND role IN ('admin','rep') AND status<>'disabled'").bind(ownerId).first();
  if (!owner) fail(400, 'Choose a valid owner.');
  if (owner.role === 'rep' && clientId && !(await c.env.DB.prepare('SELECT 1 FROM assignments WHERE user_id=? AND client_id=?').bind(owner.id, clientId).first())) {
    fail(400, 'That rep is not assigned to this client.');
  }
  return owner.id;
}

r.post('/tasks', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const b = await readJson(c);
  if (b.clientId) await requireClient(c, b.clientId, { staffOnly: true });
  const id = newId();
  await c.env.DB.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, b.clientId || null, await ownerFor(c, user, b.ownerId, b.clientId), text(b.title, { max: 300, required: true, label: 'Task' }), dueAt(b.dueAt), user.id, now()).run();
  return c.json({ id }, 201);
});

async function loadTask(c, id) {
  const user = requireRole(c, 'admin', 'rep');
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();
  if (!task) fail(404, 'Task not found.');
  if (user.role === 'rep') {
    if (task.owner_id !== user.id) fail(404, 'Task not found.');
    if (task.client_id) await requireClient(c, task.client_id, { staffOnly: true });
  }
  return { user, task };
}

r.patch('/tasks/:id', async (c) => {
  const { user, task } = await loadTask(c, c.req.param('id'));
  const b = await readJson(c);
  const next = { ...task };
  if (b.done !== undefined) next.done_at = b.done ? now() : null;
  if (b.title !== undefined) next.title = text(b.title, { max: 300, required: true, label: 'Task' });
  if (b.dueAt !== undefined) next.due_at = dueAt(b.dueAt);
  if (b.ownerId !== undefined) next.owner_id = await ownerFor(c, user, b.ownerId, task.client_id);
  await c.env.DB.prepare('UPDATE tasks SET done_at=?, title=?, due_at=?, owner_id=? WHERE id=?').bind(next.done_at, next.title, next.due_at, next.owner_id, task.id).run();
  if (b.done && task.client_id) await logActivity(c.env.DB, { clientId: task.client_id, actorId: user.id, kind: 'task', summary: `Completed: ${task.title}` });
  return c.json({ ok: true });
});

r.delete('/tasks/:id', async (c) => {
  const { task } = await loadTask(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(task.id).run();
  return c.json({ ok: true });
});

// ---------- Commissions ----------
// Nothing about commissions is pre-approved: rules are configured by an admin and every
// calculation says which rule and source record it came from, and whether the rule is provisional.

r.get('/commission-rules', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const rows = (await c.env.DB.prepare(`SELECT cr.*, u.name AS rep_name FROM commission_rules cr LEFT JOIN users u ON u.id=cr.rep_id
    ${user.role === 'rep' ? 'WHERE cr.rep_id IS NULL OR cr.rep_id=?' : ''} ORDER BY cr.created_at`).bind(...(user.role === 'rep' ? [user.id] : [])).all()).results;
  return c.json({ rules: rows });
});

function ruleFields(b) {
  const rate = Number(b.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) fail(400, 'Rate must be between 0 and 100 percent.');
  const months = b.months === null || b.months === '' || b.months === undefined ? null : Number(b.months);
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) fail(400, 'Months must be a whole number from 1 to 120.');
  return {
    name: text(b.name, { max: 120, required: true, label: 'Rule name' }),
    basis: oneOf(b.basis, ['setup', 'monthly', 'both'], 'Basis'),
    rate_bps: Math.round(rate * 100),
    months,
    trigger: oneOf(b.trigger || 'deal_won', ['deal_won', 'contract_signed', 'invoice_paid'], 'Trigger'),
    rep_id: b.repId || null,
    active: b.active === false ? 0 : 1,
    approved: b.approved ? 1 : 0,
  };
}

r.post('/commission-rules', async (c) => {
  requireRole(c, 'admin');
  const f = ruleFields(await readJson(c));
  const id = newId();
  await c.env.DB.prepare('INSERT INTO commission_rules (id, name, basis, rate_bps, months, trigger, rep_id, active, approved, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, f.name, f.basis, f.rate_bps, f.months, f.trigger, f.rep_id, f.active, f.approved, now()).run();
  return c.json({ id }, 201);
});

r.put('/commission-rules/:id', async (c) => {
  requireRole(c, 'admin');
  const f = ruleFields(await readJson(c));
  await c.env.DB.prepare('UPDATE commission_rules SET name=?, basis=?, rate_bps=?, months=?, trigger=?, rep_id=?, active=?, approved=? WHERE id=?')
    .bind(f.name, f.basis, f.rate_bps, f.months, f.trigger, f.rep_id, f.active, f.approved, c.req.param('id')).run();
  return c.json({ ok: true });
});

r.delete('/commission-rules/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM commission_rules WHERE id=?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// Computes commission lines from won deals. Contract/invoice triggers activate once those modules exist.
export function computeCommissions(rules, deals) {
  const lines = [];
  for (const deal of deals) {
    for (const rule of rules) {
      if (!rule.active || rule.trigger !== 'deal_won') continue;
      if (rule.rep_id && rule.rep_id !== deal.owner_id) continue;
      const setup = rule.basis !== 'monthly' ? deal.setup_cents || 0 : 0;
      const monthlyBase = rule.basis !== 'setup' ? (deal.monthly_cents || 0) * (rule.months || 1) : 0;
      const base = setup + monthlyBase;
      lines.push({
        dealId: deal.id, dealTitle: deal.title, clientId: deal.client_id, clientName: deal.client_name,
        repId: deal.owner_id, repName: deal.owner, wonAt: deal.closed_at,
        ruleId: rule.id, ruleName: rule.name, rateBps: rule.rate_bps,
        baseCents: base, amountCents: Math.round((base * rule.rate_bps) / 10000),
        provisional: !rule.approved,
        explanation: `${(rule.rate_bps / 100).toFixed(2)}% of ${rule.basis === 'setup' ? 'setup' : rule.basis === 'monthly' ? `monthly × ${rule.months || 1} mo` : `setup + monthly × ${rule.months || 1} mo`}`,
      });
    }
  }
  return lines;
}

r.get('/commissions', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const db = c.env.DB;
  const rules = (await db.prepare('SELECT * FROM commission_rules').all()).results;
  const deals = (await db.prepare(`SELECT d.*, cl.name AS client_name, u.name AS owner FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id
    JOIN clients cl ON cl.id=d.client_id LEFT JOIN users u ON u.id=d.owner_id WHERE ps.outcome='won' ${user.role === 'rep' ? 'AND d.owner_id=?' : ''}`)
    .bind(...(user.role === 'rep' ? [user.id] : [])).all()).results;
  const lines = computeCommissions(rules, deals);
  const pending = rules.filter((r2) => r2.active && r2.trigger !== 'deal_won').map((r2) => r2.name);
  return c.json({
    lines,
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    anyProvisional: lines.some((l) => l.provisional) || !rules.some((r2) => r2.approved),
    notYetCalculated: pending.length ? `Rules triggered by signed contracts or paid invoices (${pending.join(', ')}) start calculating once those modules are live.` : null,
  });
});

export default r;
