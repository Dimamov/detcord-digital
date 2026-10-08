// Monthly client reports: staff generate a draft for one client and month, edit it, then share it.
// Clients see only shared reports, with the same 404 for "not yours" and "missing". The website check
// report lives at /reports/:id; these are /monthly-reports so the two never collide.
import { Hono } from 'hono';
import { fail, now, readJson, logActivity, text, oneOf } from '../lib/util.js';
import { requireUser, requireRole, requireClient, isStaff, clientScopeSql } from '../lib/auth.js';
import { aiReady, originFor } from '../lib/goat.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { getSettings } from '../lib/settings.js';
import { cleanMonth, currentMonth, previousMonth, monthLabel, cleanContent, clientContent, generateReport } from '../lib/reports.js';

const r = new Hono();
const json = (s) => (s ? JSON.parse(s) : null);
const STATUS = { draft: 'Draft', ready: 'Ready to share', shared: 'Shared' };

// Staff see everything; a client login only ever reaches a shared report of its own business.
async function loadReport(c, id, { staffOnly = false } = {}) {
  const user = requireUser(c);
  if (staffOnly && !isStaff(user)) fail(403, 'You do not have access to this.');
  const rep = await c.env.DB.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(id).first();
  if (!rep || (!isStaff(user) && rep.status !== 'shared')) fail(404, 'Report not found.');
  let client;
  try {
    ({ client } = await requireClient(c, rep.client_id));
  } catch {
    fail(404, 'Report not found.');
  }
  return { user, client, rep };
}

async function names(db, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = (await db.prepare(`SELECT id, name FROM users WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all()).results;
  return Object.fromEntries(rows.map((u) => [u.id, u.name]));
}

function listRow(x) {
  return {
    id: x.id, client_id: x.client_id, client_name: x.client_name, month: x.month, month_label: monthLabel(x.month), status: x.status, status_label: STATUS[x.status],
    headline: json(x.content)?.headline || '', draft_source: x.draft_source, edited: !!x.edited, error: x.error,
    generated_at: x.generated_at, edited_at: x.edited_at, shared_at: x.shared_at,
  };
}

async function staffView(c, rep, client) {
  const who = await names(c.env.DB, [rep.generated_by, rep.edited_by, rep.shared_by, rep.unshared_by]);
  return {
    ...listRow({ ...rep, client_name: client.name }),
    content: json(rep.content), facts: json(rep.facts), draft: json(rep.draft), meeting_notes: !!rep.meeting_notes,
    generated_by: who[rep.generated_by] || null, edited_by: who[rep.edited_by] || null, shared_by: who[rep.shared_by] || null,
    unshared_by: who[rep.unshared_by] || null, unshared_at: rep.unshared_at, delivery: json(rep.delivery),
    ready: { ai: aiReady(c.env), email: !!c.env.RESEND_API_KEY },
  };
}

// ---------- Staff: one client's reports ----------

r.get('/clients/:id/monthly-reports', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const rows = (await c.env.DB.prepare('SELECT * FROM monthly_reports WHERE client_id=? ORDER BY month DESC LIMIT 60').bind(client.id).all()).results;
  const tz = client.timezone || 'America/Detroit';
  return c.json({
    reports: rows.map((x) => listRow({ ...x, client_name: client.name })),
    defaultMonth: previousMonth(currentMonth(tz)), currentMonth: currentMonth(tz),
    ready: { ai: aiReady(c.env), email: !!c.env.RESEND_API_KEY },
  });
});

// Generates or regenerates the draft for a month. Shared reports are never replaced; a report staff
// edited is replaced only with overwrite: true, which the page asks for first.
r.post('/clients/:id/monthly-reports', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  const month = cleanMonth(b.month, client.timezone);
  let out;
  try {
    out = await generateReport(c.env, { client, month, userId: user.id, meetingNotes: b.meetingNotes === true, overwrite: b.overwrite === true });
  } catch (e) {
    if (e.needsConfirm) return c.json({ error: e.message, needsConfirm: true }, 409);
    throw e;
  }
  // When Claude fails on a report that already exists, the existing version is kept as it was.
  if (!out.kept) await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'report', summary: `${out.replaced ? 'Regenerated' : 'Started'} the ${monthLabel(month)} report${out.source === 'ai' ? ' (drafted by Claude)' : ''}` });
  const rep = await c.env.DB.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(out.id).first();
  return c.json({ report: await staffView(c, rep, client), error: out.error }, out.kept ? 502 : 201);
});

// ---------- Reports list (clients: shared ones of their business; staff: their clients') ----------

r.get('/monthly-reports', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const where = [scope.sql];
  const binds = [...scope.binds];
  if (!isStaff(user)) where.push("m.status='shared'");
  else if (c.req.query('status')) { where.push('m.status=?'); binds.push(oneOf(c.req.query('status'), ['draft', 'ready', 'shared'], 'Status')); }
  const rows = (await c.env.DB.prepare(`SELECT m.*, cl.name AS client_name FROM monthly_reports m JOIN clients cl ON cl.id=m.client_id
    WHERE ${where.join(' AND ')} ORDER BY m.month DESC, cl.name LIMIT 100`).bind(...binds).all()).results;
  return c.json({ reports: rows.map((x) => (isStaff(user) ? listRow(x) : { id: x.id, client_name: x.client_name, month: x.month, month_label: monthLabel(x.month), headline: json(x.content)?.headline || '', shared_at: x.shared_at })) });
});

r.get('/monthly-reports/:id', async (c) => {
  const { user, client, rep } = await loadReport(c, c.req.param('id'));
  if (isStaff(user)) return c.json({ staff: true, report: await staffView(c, rep, client) });
  const company = await getSettings(c.env.DB, 'company.');
  return c.json({
    staff: false,
    report: { id: rep.id, business: client.name, month: rep.month, month_label: monthLabel(rep.month), shared_at: rep.shared_at, content: clientContent(json(rep.content)) },
    contact: { email: company.email || 'info@detcorddigital.com', phone: company.phone || null },
  });
});

// ---------- Edit, share, unshare ----------

r.patch('/monthly-reports/:id', async (c) => {
  const { user, client, rep } = await loadReport(c, c.req.param('id'), { staffOnly: true });
  if (rep.status === 'shared') fail(409, 'This report is shared with the client. Unshare it before editing.');
  const b = await readJson(c);
  const sets = ['updated_at=?'];
  const binds = [now()];
  if (b.content !== undefined) {
    const content = JSON.stringify(cleanContent(b.content));
    if (content !== rep.content) {
      sets.push('content=?', 'edited=1', 'edited_by=?', 'edited_at=?');
      binds.push(content, user.id, now());
    }
  }
  if (b.status !== undefined) { sets.push('status=?'); binds.push(oneOf(b.status, ['draft', 'ready'], 'Status')); }
  const res = await c.env.DB.prepare(`UPDATE monthly_reports SET ${sets.join(', ')} WHERE id=? AND status<>'shared'`).bind(...binds, rep.id).run();
  if (!res.meta.changes) fail(409, 'This report was shared while you were editing. Unshare it to make changes.');
  if (b.status === 'ready' && rep.status !== 'ready') await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'report', summary: `Marked the ${monthLabel(rep.month)} report ready to share` });
  const fresh = await c.env.DB.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(rep.id).first();
  return c.json({ report: await staffView(c, fresh, client) });
});

// Shares the report with the client, and optionally emails their portal logins a link to it.
// Without email set up, nothing is claimed as sent and staff get the link to pass on.
r.post('/monthly-reports/:id/share', async (c) => {
  const { user, client, rep } = await loadReport(c, c.req.param('id'), { staffOnly: true });
  if (rep.status === 'shared') fail(409, 'This report is already shared.');
  const content = json(rep.content);
  if (!content.headline || (!content.summary && !content.sections.length)) fail(400, 'Write a headline and a summary or at least one section before sharing.');
  const b = await readJson(c);
  const db = c.env.DB;
  const t = now();
  const res = await db.prepare("UPDATE monthly_reports SET status='shared', shared_by=?, shared_at=?, updated_at=? WHERE id=? AND status<>'shared'").bind(user.id, t, t, rep.id).run();
  if (!res.meta.changes) fail(409, 'This report is already shared.');
  const label = monthLabel(rep.month);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'report', internal: false, summary: `Shared the ${label} report` });

  const link = `${originFor(c.env, c.req.url)}/reports/monthly/${rep.id}`;
  const delivery = [];
  if (b.email === true) {
    const people = (await db.prepare("SELECT u.name, u.email, u.status FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.role='client' AND u.status<>'disabled' ORDER BY u.name").bind(client.id).all()).results;
    for (const p of people) {
      if (p.status !== 'active') { delivery.push({ name: p.name, email: p.email, status: 'skipped', error: 'Hasn’t set up their portal password yet.' }); continue; }
      if (!c.env.RESEND_API_KEY) { delivery.push({ name: p.name, email: p.email, status: 'not_configured', error: 'Email sending is not set up (RESEND_API_KEY).' }); continue; }
      const mail = renderEmail({
        origin: originFor(c.env, c.req.url),
        heading: `Your ${label} report`,
        paragraphs: [`Hi ${p.name.split(/\s+/)[0]},`, ...(content.headline ? [content.headline] : []), `Your monthly report for ${client.name} is ready in your Detcord portal. It covers what we worked on in ${label} and what's next.`],
        button: { label: 'Read my report', url: link },
        footnote: 'Questions? Just reply to this email.',
      });
      const sent = await sendEmail(c.env, { to: p.email, subject: `${client.name}: your ${label} report`, ...mail, idempotencyKey: `monthly-report/${rep.id}/${t}/${p.email}` });
      delivery.push({ name: p.name, email: p.email, status: sent.status, error: sent.error || null });
    }
    await db.prepare('UPDATE monthly_reports SET delivery=? WHERE id=?').bind(JSON.stringify(delivery), rep.id).run();
    const ok = delivery.filter((d) => d.status === 'sent');
    if (ok.length) await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'report', summary: `Emailed the ${label} report to ${ok.map((d) => d.email).join(', ')}` });
  }
  const fresh = await db.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(rep.id).first();
  return c.json({ report: await staffView(c, fresh, client), delivery, link, email: { configured: !!c.env.RESEND_API_KEY } });
});

// Takes a shared report back so it can be edited. The client stops seeing it until it is shared again.
r.post('/monthly-reports/:id/unshare', async (c) => {
  const { user, client, rep } = await loadReport(c, c.req.param('id'), { staffOnly: true });
  if (rep.status !== 'shared') fail(409, 'This report is not shared.');
  const b = await readJson(c);
  const reason = text(b.reason, { max: 300 });
  await c.env.DB.prepare("UPDATE monthly_reports SET status='ready', unshared_by=?, unshared_at=?, updated_at=? WHERE id=?").bind(user.id, now(), now(), rep.id).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'report', summary: `Unshared the ${monthLabel(rep.month)} report${reason ? `: ${reason}` : ''}` });
  const fresh = await c.env.DB.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(rep.id).first();
  return c.json({ report: await staffView(c, fresh, client) });
});

r.delete('/monthly-reports/:id', async (c) => {
  const { user, client, rep } = await loadReport(c, c.req.param('id'), { staffOnly: true });
  if (rep.status === 'shared') fail(409, 'Unshare this report before deleting it.');
  await c.env.DB.prepare("DELETE FROM monthly_reports WHERE id=? AND status<>'shared'").bind(rep.id).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'report', summary: `Deleted the ${monthLabel(rep.month)} report draft` });
  return c.json({ ok: true });
});

// ---------- Admin: draft last month's reports for every active client ----------

// One small chunk per request, one client at a time, so each request stays well inside the Workers
// subrequest and time limits. The page calls again with `next` until it is null. Existing reports
// are skipped, never replaced, and nothing is shared.
r.post('/monthly-reports/bulk', async (c) => {
  const user = requireRole(c, 'admin');
  const b = await readJson(c);
  const db = c.env.DB;
  const month = cleanMonth(b.month || previousMonth(currentMonth()));
  const offset = Math.max(0, Number.parseInt(b.offset, 10) || 0);
  const clients = (await db.prepare("SELECT * FROM clients WHERE status='active' ORDER BY name, id").all()).results;
  const size = aiReady(c.env) ? 2 : 10;
  const chunk = clients.slice(offset, offset + size);
  const results = [];
  for (const client of chunk) {
    const row = { client_id: client.id, name: client.name };
    const existing = await db.prepare('SELECT id FROM monthly_reports WHERE client_id=? AND month=?').bind(client.id, month).first();
    if (existing) { results.push({ ...row, id: existing.id, status: 'skipped' }); continue; }
    try {
      const out = await generateReport(c.env, { client, month, userId: user.id });
      results.push({ ...row, id: out.id, status: out.error ? 'manual' : 'created', source: out.source, error: out.error });
      await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'report', summary: `Started the ${monthLabel(month)} report (bulk)` });
    } catch (e) {
      results.push({ ...row, status: 'failed', error: String(e?.message || e).slice(0, 200) });
    }
  }
  const done = offset + chunk.length;
  return c.json({ month, month_label: monthLabel(month), total: clients.length, done, next: done < clients.length ? done : null, results, ai: aiReady(c.env) });
});

export default r;
