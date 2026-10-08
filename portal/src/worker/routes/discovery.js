// Sales discovery interviews and the public pre-call intake form.
import { Hono } from 'hono';
import { fail, now, newId, sha256, randomToken, readJson, logActivity, EMAIL_RE } from '../lib/util.js';
import { requireClient } from '../lib/auth.js';
import { renderEmail, sendEmail } from '../lib/email.js';
import { computeResult, intakeToAnswers, allQuestionIds, INTAKE } from '../../shared/discovery/engine.js';
import { checkIndustry } from '../lib/industries.js';
import { SERVICE_MODULES } from '../../shared/discovery/services.js';

const r = new Hono();
const INTAKE_MS = 14 * 24 * 3600 * 1000;

function cleanModules(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((id) => typeof id === 'string' && SERVICE_MODULES[id]))].slice(0, 30);
}

// Keeps only known question ids and bounded values.
export function cleanAnswers(raw, industry, modules) {
  if (!raw || typeof raw !== 'object') return {};
  const ids = allQuestionIds(industry, modules);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ids.has(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 5000);
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 80));
  }
  return out;
}

const parse = (d) => ({ ...d, modules: JSON.parse(d.modules), answers: JSON.parse(d.answers), result: d.result ? JSON.parse(d.result) : null });

r.post('/discoveries', async (c) => {
  const b = await readJson(c);
  const { user, client } = await requireClient(c, b.clientId, { staffOnly: true });
  const db = c.env.DB;
  const industry = b.industry || client.industry;
  await checkIndustry(db, industry);
  const modules = cleanModules(b.modules);
  // Pre-fill from the most recent submitted intake form, if any.
  const intake = await db.prepare('SELECT answers FROM intake_links WHERE client_id=? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1').bind(client.id).first();
  const answers = intake ? cleanAnswers(intakeToAnswers(JSON.parse(intake.answers)), industry, modules) : {};
  const deal = await db.prepare("SELECT d.id FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=? AND ps.outcome='open' ORDER BY d.updated_at DESC LIMIT 1").bind(client.id).first();
  const id = newId();
  await db.prepare('INSERT INTO discoveries (id, client_id, deal_id, rep_id, industry, modules, answers, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, client.id, deal?.id || null, user.id, industry || null, JSON.stringify(modules), JSON.stringify(answers), now(), now()).run();
  if (industry && !client.industry) await db.prepare('UPDATE clients SET industry=?, updated_at=? WHERE id=?').bind(industry, now(), client.id).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'discovery', summary: 'Started a discovery call' });
  return c.json({ id, prefilled: Object.keys(answers).length }, 201);
});

async function loadDiscovery(c, id) {
  const d = await c.env.DB.prepare('SELECT * FROM discoveries WHERE id=?').bind(id).first();
  if (!d) fail(404, 'Discovery not found.');
  const { user, client } = await requireClient(c, d.client_id, { staffOnly: true });
  return { user, client, d: parse(d) };
}

r.get('/discoveries/:id', async (c) => {
  const { client, d } = await loadDiscovery(c, c.req.param('id'));
  return c.json({ discovery: d, client: { id: client.id, name: client.name, industry: client.industry, website: client.website, city: client.city } });
});

// Autosave. Merges answers; replaces industry/modules when given.
r.patch('/discoveries/:id', async (c) => {
  const { d } = await loadDiscovery(c, c.req.param('id'));
  const b = await readJson(c);
  const industry = b.industry !== undefined ? await checkIndustry(c.env.DB, b.industry) : d.industry;
  const modules = b.modules !== undefined ? cleanModules(b.modules) : d.modules;
  const answers = { ...d.answers, ...cleanAnswers(b.answers, industry, modules) };
  await c.env.DB.prepare('UPDATE discoveries SET industry=?, modules=?, answers=?, updated_at=? WHERE id=?')
    .bind(industry, JSON.stringify(modules), JSON.stringify(answers), now(), d.id).run();
  return c.json({ ok: true, savedAt: now(), preview: computeResult(answers, industry) });
});

// Completing scores the lead, records recommended services, moves the deal forward and creates the follow-up.
r.post('/discoveries/:id/complete', async (c) => {
  const { user, client, d } = await loadDiscovery(c, c.req.param('id'));
  const db = c.env.DB;
  const result = computeResult(d.answers, d.industry);
  const t = now();
  const stmts = [db.prepare("UPDATE discoveries SET status='complete', result=?, updated_at=? WHERE id=?").bind(JSON.stringify(result), t, d.id)];
  for (const rec of result.recommended.filter((x) => x.priority !== 'later')) {
    stmts.push(db.prepare(`INSERT INTO client_services (client_id, service_id, status, updated_at) VALUES (?,?, 'recommended', ?)
      ON CONFLICT(client_id, service_id) DO NOTHING`).bind(client.id, rec.serviceId, t));
  }
  if (d.deal_id) {
    stmts.push(db.prepare("UPDATE deals SET stage_id='discovery', updated_at=? WHERE id=? AND stage_id='new' AND EXISTS (SELECT 1 FROM pipeline_stages WHERE id='discovery')").bind(t, d.deal_id));
  }
  if (client.status === 'lead') stmts.push(db.prepare("UPDATE clients SET status='prospect', updated_at=? WHERE id=?").bind(t, client.id));
  const followUp = d.answers.next_step === 'not-fit' ? null
    : { title: d.answers.next_step === 'proposal-meeting' ? `Prepare proposal for ${client.name}${d.answers.next_step_date ? ` (meeting ${d.answers.next_step_date})` : ''}` : `Follow up with ${client.name} after discovery`, due: t + (result.score.grade === 'A' ? 1 : result.score.grade === 'B' ? 3 : 14) * 86400000 };
  if (followUp) stmts.push(db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), client.id, user.id, followUp.title, followUp.due, user.id, t));
  await db.batch(stmts);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'discovery', summary: `Discovery complete: grade ${result.score.grade} (${result.score.total}/${result.score.max})` });
  return c.json({ ok: true, result, followUp });
});

r.delete('/discoveries/:id', async (c) => {
  const { d } = await loadDiscovery(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM discoveries WHERE id=?').bind(d.id).run();
  return c.json({ ok: true });
});

// ---------- Pre-call intake ----------

r.post('/clients/:id/intake', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const b = await readJson(c);
  const token = randomToken();
  const id = newId();
  await db.prepare('INSERT INTO intake_links (id, client_id, token_hash, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(id, client.id, await sha256(token), user.id, now(), now() + INTAKE_MS).run();
  const origin = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  const url = `${origin}/intake#${id}.${token}`;
  let delivery = null;
  if (b.email) {
    const to = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(to)) fail(400, 'Enter a valid email.');
    const email = renderEmail({
      origin,
      heading: `A few questions before our call`,
      paragraphs: [`Hi${b.name ? ` ${String(b.name).slice(0, 60)}` : ''},`, `${user.name} from Detcord Digital is preparing for your strategy call about ${client.name}. These quick questions take about 3 minutes and help us come prepared with ideas specific to your business.`],
      button: { label: 'Answer the questions', url },
      footnote: 'This link is for your business only and expires in 14 days.',
    });
    delivery = await sendEmail(c.env, { to, subject: `Quick questions before your Detcord Digital call`, ...email, idempotencyKey: `intake/${id}` });
  }
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'intake', summary: b.email ? `Sent pre-call questions to ${b.email}` : 'Created a pre-call questions link' });
  return c.json({ id, url, delivery }, 201);
});

async function intakeLink(db, raw) {
  const [id, token] = String(raw || '').split('.');
  const row = id && token ? await db.prepare('SELECT il.*, cl.name AS client_name FROM intake_links il JOIN clients cl ON cl.id=il.client_id WHERE il.id=?').bind(id).first() : null;
  if (!row || row.token_hash !== (await sha256(token))) fail(404, 'This link is not valid.');
  if (row.submitted_at) fail(410, 'Thanks, we already have your answers.');
  if (row.expires_at < now()) fail(410, 'This link has expired. Ask your Detcord contact for a new one.');
  return row;
}

r.post('/intake/check', async (c) => {
  const b = await readJson(c);
  const row = await intakeLink(c.env.DB, b.link);
  return c.json({ business: row.client_name, form: INTAKE });
});

r.post('/intake/submit', async (c) => {
  const db = c.env.DB;
  const b = await readJson(c);
  const row = await intakeLink(db, b.link);
  const answers = {};
  for (const qu of INTAKE.questions) {
    const v = b.answers?.[qu.id];
    if (v === undefined || v === null || v === '') { if (!qu.optional) fail(400, `Please answer: ${qu.q}`); continue; }
    if (qu.type === 'multi') answers[qu.id] = Array.isArray(v) ? v.filter((x) => qu.options.some((o) => o.v === x)) : [];
    else if (qu.type === 'single') { if (!qu.options.some((o) => o.v === v)) fail(400, `Please choose an answer for: ${qu.q}`); answers[qu.id] = v; }
    else answers[qu.id] = String(v).slice(0, 3000);
  }
  const done = await db.prepare('UPDATE intake_links SET submitted_at=?, answers=? WHERE id=? AND submitted_at IS NULL').bind(now(), JSON.stringify(answers), row.id).run();
  if (!done.meta.changes) fail(410, 'Thanks, we already have your answers.');
  if (answers.website) {
    const cl = await db.prepare('SELECT website FROM clients WHERE id=?').bind(row.client_id).first();
    if (!cl.website && /^[\w.-]+\.[a-z]{2,}/i.test(answers.website.replace(/^https?:\/\//, ''))) {
      await db.prepare('UPDATE clients SET website=? WHERE id=?').bind(answers.website.startsWith('http') ? answers.website : `https://${answers.website}`, row.client_id).run();
    }
  }
  // Notify the assigned rep(s) with a task.
  const reps = (await db.prepare('SELECT user_id FROM assignments WHERE client_id=?').bind(row.client_id).all()).results;
  const owners = reps.length ? reps.map((x) => x.user_id) : row.created_by ? [row.created_by] : [];
  if (owners.length) await db.batch(owners.map((o) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,NULL,?)')
    .bind(newId(), row.client_id, o, `Review pre-call answers from ${row.client_name}`, now() + 86400000, now())));
  await logActivity(db, { clientId: row.client_id, kind: 'intake', summary: 'Prospect submitted pre-call answers' });
  return c.json({ ok: true });
});

export default r;
