// Website and local search audits: run, review, and send the customer an email or text that opens the report in their portal.
import { Hono } from 'hono';
import { fail, now, newId, text, oneOf, readJson, logActivity, cleanEmail } from '../lib/util.js';
import { requireRole, requireClient, requireUser, isStaff, issueLink, addMember } from '../lib/auth.js';
import { runAudit, checkTarget, CATEGORIES } from '../lib/audit/index.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { sendSms, toE164, twilioConfig, testTwilio } from '../lib/sms.js';
import { pageSpeed } from '../lib/audit/google.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { serviceById } from '../../shared/services.js';

const r = new Hono();
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;
const STALE_MS = 5 * 60 * 1000;
// A prospect may open the report days after the call, so report invites last longer than team invites.
const REPORT_INVITE_MS = 7 * 24 * 3600 * 1000;
const DAILY_LIMIT = 60;
const serviceName = Object.fromEntries(Object.values(serviceById).map((s) => [s.id, s.name]));

// An audit whose request died mid-run is reported as failed rather than "running" forever.
async function settleStale(db, row) {
  if (row?.status === 'running' && now() - row.created_at > STALE_MS) {
    await db.prepare("UPDATE audits SET status='failed', error='The check was interrupted. Run it again.', finished_at=? WHERE id=? AND status='running'").bind(now(), row.id).run();
    return { ...row, status: 'failed', error: 'The check was interrupted. Run it again.' };
  }
  return row;
}

async function loadAudit(c, id) {
  const row = await c.env.DB.prepare('SELECT * FROM audits WHERE id=?').bind(id).first();
  if (!row) fail(404, 'Audit not found.');
  const { user, client } = await requireClient(c, row.client_id, { staffOnly: true });
  return { user, client, audit: await settleStale(c.env.DB, row) };
}

function staffView(a, extra = {}) {
  return {
    id: a.id, clientId: a.client_id, url: a.url, status: a.status, score: a.score, error: a.error, note: a.note,
    hidden: JSON.parse(a.hidden || '[]'), result: a.result ? JSON.parse(a.result) : null,
    createdAt: a.created_at, finishedAt: a.finished_at, sharedAt: a.shared_at,
    categories: CATEGORIES, serviceNames: serviceName, ...extra,
  };
}

r.get('/clients/:id/audits', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const rows = (await c.env.DB.prepare(`SELECT a.id, a.url, a.status, a.score, a.error, a.created_at, a.finished_at, u.name AS by_name,
      a.shared_at, json_extract(a.result, '$.scores.design') AS design_score, json_extract(a.result, '$.design.visual.impression') AS design_impression
    FROM audits a LEFT JOIN users u ON u.id=a.created_by WHERE a.client_id=? ORDER BY a.created_at DESC LIMIT 50`).bind(client.id).all()).results;
  const settled = [];
  for (const row of rows) settled.push(await settleStale(c.env.DB, row));
  return c.json({ audits: settled });
});

// Runs the audit inside this request (about 20 to 60 seconds) and returns the finished result.
r.post('/clients/:id/audits', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const body = await readJson(c);
  const raw = text(body.url, { max: 400 }) || client.website;
  if (!raw) fail(400, 'Add the customer\'s website address first.');
  const target = checkTarget(raw, { allowPrivate: c.env.AUDIT_ALLOW_PRIVATE === '1' });
  if (target.error) fail(400, target.error);
  const url = target.url.href;
  const running = await db.prepare("SELECT id FROM audits WHERE client_id=? AND status='running' AND created_at>?").bind(client.id, now() - STALE_MS).first();
  if (running) return c.json({ error: 'A check is already running for this customer.', id: running.id }, 409);
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM audits WHERE created_by=? AND created_at>?').bind(user.id, now() - 24 * 3600 * 1000).first();
  if (n >= DAILY_LIMIT) fail(429, `You've run ${DAILY_LIMIT} checks in the last 24 hours. Try again later.`);
  if (!client.website) await db.prepare('UPDATE clients SET website=?, updated_at=? WHERE id=?').bind(url.replace(/\/$/, ''), now(), client.id).run();

  const id = newId();
  await db.prepare("INSERT INTO audits (id, client_id, url, status, created_by, created_at) VALUES (?,?,?,'running',?,?)").bind(id, client.id, url, user.id, now()).run();
  const work = runAudit(c.env, { auditId: id, client, url });
  // Keeps the audit running briefly if the browser disconnects.
  try { c.executionCtx.waitUntil(work); } catch {}
  await work;
  const row = await db.prepare('SELECT * FROM audits WHERE id=?').bind(id).first();
  if (row.status === 'done') await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'audit', summary: `Website check: ${row.score}/100 for ${url}` });
  return c.json(staffView(row), row.status === 'done' ? 201 : 200);
});

r.get('/audits/:id', async (c) => {
  const { client, audit } = await loadAudit(c, c.req.param('id'));
  const db = c.env.DB;
  const [deliveries, contacts, logins] = await Promise.all([
    db.prepare('SELECT d.*, COALESCE(e.status,d.status) AS status, COALESCE(e.error,d.error) AS error, u.name AS by_name FROM audit_deliveries d LEFT JOIN users u ON u.id=d.sent_by LEFT JOIN outbound_emails e ON e.provider_id=d.provider_id AND d.channel=\'email\' WHERE d.audit_id=? ORDER BY d.created_at DESC').bind(audit.id).all(),
    db.prepare('SELECT name, email, phone FROM contacts WHERE client_id=? ORDER BY is_primary DESC, name').bind(client.id).all(),
    db.prepare('SELECT u.name, u.email, u.phone, u.status FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? ORDER BY u.name').bind(client.id).all(),
  ]);
  // People who could receive the report, with whether they already have a portal login.
  const people = [];
  for (const p of [...logins.results.map((l) => ({ ...l, login: l.status })), ...contacts.results]) {
    const same = people.find((x) => (p.email && x.email === p.email) || (!p.email && x.name === p.name));
    if (same) { same.phone ||= p.phone; same.login ||= p.login; continue; }
    people.push({ name: p.name, email: p.email || '', phone: p.phone || '', login: p.login || null });
  }
  if (!people.length) people.push({ name: '', email: client.email || '', phone: client.phone || '', login: null });
  return c.json(staffView(audit, {
    client: { id: client.id, name: client.name, city: client.city },
    deliveries: deliveries.results,
    people,
    channels: { email: !!c.env.RESEND_API_KEY, sms: twilioConfig(c.env).ready },
  }));
});

// Staff choose what the customer sees: hide findings and add a personal note.
r.patch('/audits/:id', async (c) => {
  const { audit } = await loadAudit(c, c.req.param('id'));
  const body = await readJson(c);
  const sets = [];
  const binds = [];
  if (body.hidden !== undefined) {
    if (!Array.isArray(body.hidden)) fail(400, 'Hidden findings must be a list.');
    const ids = new Set((JSON.parse(audit.result || '{}').findings || []).map((f) => f.id));
    sets.push('hidden=?');
    binds.push(JSON.stringify([...new Set(body.hidden.filter((h) => ids.has(h)))]));
  }
  if (body.note !== undefined) { sets.push('note=?'); binds.push(text(body.note, { max: 1500 })); }
  if (sets.length) await c.env.DB.prepare(`UPDATE audits SET ${sets.join(', ')} WHERE id=?`).bind(...binds, audit.id).run();
  return c.json({ ok: true });
});

r.delete('/audits/:id', async (c) => {
  const { user, audit } = await loadAudit(c, c.req.param('id'));
  if (user.role !== 'admin' && audit.created_by !== user.id) fail(403, 'Only the person who ran this check or an admin can delete it.');
  if (audit.status === 'running') fail(409, 'Wait for the check to finish.');
  await c.env.DB.prepare('DELETE FROM audits WHERE id=?').bind(audit.id).run();
  if (c.env.MEDIA) await c.env.MEDIA.delete([`audits/${audit.id}/mobile`, `audits/${audit.id}/desktop`]);
  return c.json({ ok: true });
});

// Finds or creates the customer's portal login and returns the link that opens the report:
// a password-setup invite for new or not-yet-activated logins, or the report page for active ones.
async function portalLink(c, client, auditId, { name, email, phone }) {
  const db = c.env.DB;
  let user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (user) {
    const member = user.role === 'client' && await db.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(client.id, user.id).first();
    if (!member) fail(409, 'That email already has a portal login for a different account. Use another email.');
    if (user.status === 'disabled') fail(409, 'That person\'s portal login is turned off. An admin can turn it back on under Portal access.');
  } else {
    user = { id: newId(), email, name, role: 'client', status: 'invited' };
    await db.batch([
      db.prepare("INSERT INTO users (id, email, name, role, status, phone, created_at) VALUES (?,?,?,'client','invited',?,?)").bind(user.id, email, name, phone || null, now()),
      addMember(db, client.id, user.id),
    ]);
    await logActivity(db, { clientId: client.id, actorId: requireUser(c).id, kind: 'invite', summary: `Created a portal login for ${name} to view a website check` });
  }
  const next = `/reports/${auditId}`;
  if (user.status === 'active') return { user, kind: 'login', url: `${originOf(c)}${next}` };
  const link = await issueLink(c, user, 'invite', { notify: false, ttlMs: REPORT_INVITE_MS, next });
  return { user, kind: 'invite', url: link.url };
}

// One send = one message to one person, pointing at the report inside their portal.
r.post('/audits/:id/send', async (c) => {
  const { user, client, audit } = await loadAudit(c, c.req.param('id'));
  if (audit.status !== 'done') fail(409, 'The check has not finished.');
  const body = await readJson(c);
  const channel = oneOf(body.channel, ['email', 'sms'], 'Channel');
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  const email = cleanEmail(body.email);
  let to = email;
  if (channel === 'sms') {
    // Texting a customer requires their permission (TCPA). Staff confirm it for every send.
    to = toE164(body.phone);
    if (!to) fail(400, 'Enter a valid US mobile number.');
    if (body.consent !== true) fail(400, 'Confirm the customer agreed to receive this by text.');
  }
  const link = await portalLink(c, client, audit.id, { name, email, phone: channel === 'sms' ? to : text(body.phone, { max: 40 }) });
  if (!audit.shared_at) await c.env.DB.prepare('UPDATE audits SET shared_at=? WHERE id=?').bind(now(), audit.id).run();
  const result = JSON.parse(audit.result);
  const first = name.split(/\s+/)[0];
  const invite = link.kind === 'invite';
  let sent;
  if (channel === 'email') {
    const visible = result.findings.filter((f) => !JSON.parse(audit.hidden || '[]').includes(f.id));
    const top = visible.filter((f) => f.severity !== 'minor').slice(0, 3);
    const mail = renderEmail({
      origin: originOf(c),
      omitLogo: user.role === 'admin' && body.omitLogo === true,
      heading: `Your website check: ${result.overall}/100`,
      paragraphs: [
        `Hi ${first}, we ran a full check of ${client.name}'s website and Google presence: search visibility, local search, mobile experience, speed and security, plus a review of the site's design and user experience.`,
        ...(audit.note ? [audit.note] : []),
        top.length ? `The biggest opportunities we found: ${top.map((f) => f.title.replace(/\.$/, '')).join('; ')}.` : 'Your site is in good shape. The report lists a few smaller improvements.',
        invite ? 'Your report is waiting in your Detcord portal. Create a password to open it; you can sign in any time after that to see it again.' : 'Your report is in your Detcord portal. Sign in to see it.',
      ],
      button: { label: invite ? 'Open my report' : 'View my report', url: link.url },
      footnote: invite ? `This setup link works once and expires in 7 days. After that, sign in at ${originOf(c)}. Questions? Just reply to this email.` : 'Questions? Just reply to this email.',
    });
    sent = await sendEmail(c.env, { to: email, subject: `${client.name}: your website and Google check (${result.overall}/100)`, ...mail, idempotencyKey: `audit/${audit.id}/${email}/${Math.floor(now() / 60000)}/${body.omitLogo === true ? "no-logo" : "logo"}` });
  } else {
    const msg = `Hi ${first}, your website and Google check for ${client.name} is ready in your Detcord portal (score ${result.overall}/100): ${link.url} Reply STOP to opt out.`;
    sent = await sendSms(c.env, { to, body: msg });
  }
  await c.env.DB.prepare('INSERT INTO audit_deliveries (id, audit_id, channel, recipient, user_id, link_kind, status, error, provider_id, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(newId(), audit.id, channel, to, link.user.id, link.kind, sent.status, sent.error || null, sent.id || null, user.id, now()).run();
  if (sent.status === 'sent') {
    await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'audit_sent', summary: `Website check sent by ${channel === 'sms' ? 'text' : 'email'} to ${name} (${to})` });
    if (channel === 'sms') await putSetting(c.env.DB, 'integration.twilio.lastSend', { ok: true, at: now() }, user.id);
  }
  return c.json({
    status: sent.status, error: sent.error || null, linkKind: link.kind,
    // When nothing was delivered, staff get the link to pass on themselves, as with team invites.
    manualLink: sent.status === 'sent' ? null : link.url,
  }, sent.status === 'sent' ? 200 : sent.status === 'not_configured' ? 503 : 502);
});

// ---------- The report as the customer sees it (their portal; staff can preview) ----------
async function loadReport(c) {
  const user = requireUser(c);
  const a = await c.env.DB.prepare("SELECT * FROM audits WHERE id=? AND status='done'").bind(c.req.param('id')).first();
  if (!a) fail(404, 'Report not found.');
  const { client } = await requireClient(c, a.client_id);
  // Customers only see checks that were sent to them; the same 404 as a missing report.
  if (!isStaff(user) && !a.shared_at) fail(404, 'Report not found.');
  return { user, client, a };
}

r.get('/reports', async (c) => {
  const user = requireUser(c);
  const rows = (await c.env.DB.prepare(`SELECT a.id, a.url, a.score, a.shared_at, cl.name AS business FROM audits a JOIN clients cl ON cl.id=a.client_id
    WHERE a.status='done' AND a.shared_at IS NOT NULL AND a.client_id IN (SELECT client_id FROM client_members WHERE user_id=?) ORDER BY a.shared_at DESC LIMIT 20`).bind(user.id).all()).results;
  return c.json({ reports: rows });
});

r.get('/reports/:id', async (c) => {
  const { user, client, a } = await loadReport(c);
  const company = await getSettings(c.env.DB, 'company.');
  const res = JSON.parse(a.result);
  const hidden = new Set(JSON.parse(a.hidden || '[]'));
  const findings = res.findings.filter((f) => !hidden.has(f.id)).map(({ id, cat, severity, title, detail, why, fix, service, source, view }) => ({ id, cat, severity, title, detail, why, fix, service: serviceName[service] || null, source: source || null, view: view || null }));
  return c.json({
    id: a.id,
    preview: isStaff(user),
    clientId: client.id,
    business: client.name,
    url: res.url,
    checkedAt: res.checkedAt,
    overall: res.overall,
    grade: res.grade,
    scores: res.scores,
    categories: CATEGORIES,
    findings,
    passed: res.passed,
    speed: res.speed,
    google: res.google ? { profile: res.google.profile && { name: res.google.profile.name, rating: res.google.profile.rating, reviews: res.google.profile.reviews, mapsUrl: res.google.profile.mapsUrl, photos: res.google.profile.photos, hours: !!res.google.profile.hours }, competitors: res.google.competitors } : null,
    coverage: { pagespeed: res.coverage.pagespeed, google: res.coverage.google, visual: res.coverage.visual || null },
    // Checks run before the design section existed have none; the page then shows the four original areas only.
    design: res.design ? { lighthouse: res.design.lighthouse, visual: { status: res.design.visual.status, impression: res.design.visual.impression || null } } : null,
    pagesChecked: res.pagesChecked,
    facts: res.facts ? { linksChecked: res.facts.linksChecked } : null,
    note: a.note,
    shots: res.shots || {},
    contact: { email: company.email || 'info@detcorddigital.com', phone: company.phone || null },
  });
});

r.get('/reports/:id/shot/:name', async (c) => {
  const { a } = await loadReport(c);
  const name = c.req.param('name');
  if (!['mobile', 'desktop'].includes(name) || !c.env.MEDIA) fail(404, 'Not found.');
  const obj = await c.env.MEDIA.get(`audits/${a.id}/${name}`);
  if (!obj) fail(404, 'Not found.');
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
});

// ---------- Integration tests (admin) ----------
r.post('/settings/integrations/twilio/test', async (c) => {
  const user = requireRole(c, 'admin');
  let result;
  try { result = { ...(await testTwilio(c.env)), at: now(), by: user.name }; } catch (e) { result = { ok: false, error: String(e.message || e).slice(0, 200), at: now(), by: user.name }; }
  await putSetting(c.env.DB, 'integration.twilio.test', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

r.post('/settings/integrations/google/test', async (c) => {
  const user = requireRole(c, 'admin');
  if (!c.env.GOOGLE_API_KEY) return c.json({ ok: false, error: 'Missing Worker secret: GOOGLE_API_KEY.' }, 400);
  const [psi, places] = await Promise.all([
    pageSpeed(c.env, 'https://www.google.com/', 'mobile'),
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': c.env.GOOGLE_API_KEY, 'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify({ textQuery: 'Detroit Institute of Arts', pageSize: 1 }), signal: AbortSignal.timeout(15000),
    }).then((r2) => r2.ok ? { ok: true } : { ok: false, reason: `Places API returned ${r2.status}. Enable "Places API (New)" for this key.` }).catch(() => ({ ok: false, reason: 'Could not reach Google Places.' })),
  ]);
  const result = { ok: psi.ok && places.ok, pagespeed: psi.ok || psi.reason, places: places.ok || places.reason, at: now(), by: user.name };
  await putSetting(c.env.DB, 'integration.google.test', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

export default r;
