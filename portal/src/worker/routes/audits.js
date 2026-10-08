// Website and local search audits: run, review, and send the customer a no-login report link by email or text.
import { Hono } from 'hono';
import { fail, now, newId, text, oneOf, readJson, logActivity, randomToken, EMAIL_RE } from '../lib/util.js';
import { requireRole, requireClient } from '../lib/auth.js';
import { runAudit, checkTarget, CATEGORIES } from '../lib/audit/index.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { sendSms, toE164, twilioConfig, testTwilio } from '../lib/sms.js';
import { pageSpeed } from '../lib/audit/google.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { SERVICES } from '../../shared/services.js';

const r = new Hono();
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;
const STALE_MS = 5 * 60 * 1000;
const SHARE_MS = 60 * 24 * 3600 * 1000;
const DAILY_LIMIT = 60;
const serviceName = Object.fromEntries(SERVICES.map((s) => [s.id, s.name]));

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

const shareUrl = (c, a) => (a.share_token && a.share_expires_at > now() ? `${originOf(c)}/r/${a.share_token}` : null);

function staffView(c, a, extra = {}) {
  return {
    id: a.id, clientId: a.client_id, url: a.url, status: a.status, score: a.score, error: a.error, note: a.note,
    hidden: JSON.parse(a.hidden || '[]'), result: a.result ? JSON.parse(a.result) : null,
    createdAt: a.created_at, finishedAt: a.finished_at, shareUrl: shareUrl(c, a), shareExpiresAt: a.share_token ? a.share_expires_at : null,
    categories: CATEGORIES, serviceNames: serviceName, ...extra,
  };
}

r.get('/clients/:id/audits', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const rows = (await c.env.DB.prepare(`SELECT a.id, a.url, a.status, a.score, a.error, a.created_at, a.finished_at, u.name AS by_name,
      (SELECT COUNT(*) FROM audit_deliveries d WHERE d.audit_id=a.id AND d.status='sent') AS sent
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
  return c.json(staffView(c, row), row.status === 'done' ? 201 : 200);
});

r.get('/audits/:id', async (c) => {
  const { client, audit } = await loadAudit(c, c.req.param('id'));
  const db = c.env.DB;
  const [deliveries, contacts] = await Promise.all([
    db.prepare('SELECT d.*, u.name AS by_name FROM audit_deliveries d LEFT JOIN users u ON u.id=d.sent_by WHERE d.audit_id=? ORDER BY d.created_at DESC').bind(audit.id).all(),
    db.prepare('SELECT name, email, phone, is_primary FROM contacts WHERE client_id=? ORDER BY is_primary DESC, name').bind(client.id).all(),
  ]);
  const emails = [];
  const phones = [];
  const push = (list, value, label) => { if (value && !list.some((x) => x.value === value)) list.push({ value, label }); };
  for (const ct of contacts.results) { push(emails, ct.email, ct.name); push(phones, ct.phone, ct.name); }
  push(emails, client.email, client.name);
  push(phones, client.phone, `${client.name} (business line)`);
  return c.json(staffView(c, audit, {
    client: { id: client.id, name: client.name, city: client.city },
    deliveries: deliveries.results,
    recipients: { emails, phones },
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

async function ensureShare(c, audit, { rotate = false } = {}) {
  if (!rotate && audit.share_token && audit.share_expires_at > now()) return audit;
  const token = randomToken();
  const expires = now() + SHARE_MS;
  await c.env.DB.prepare('UPDATE audits SET share_token=?, share_expires_at=? WHERE id=?').bind(token, expires, audit.id).run();
  return { ...audit, share_token: token, share_expires_at: expires };
}

// Creates (or with rotate: replaces) the customer's report link. Rotating breaks every link sent before.
r.post('/audits/:id/share', async (c) => {
  const { audit } = await loadAudit(c, c.req.param('id'));
  if (audit.status !== 'done') fail(409, 'The check has not finished.');
  const body = await readJson(c);
  const a = await ensureShare(c, audit, { rotate: body.rotate === true });
  return c.json({ shareUrl: shareUrl(c, a), shareExpiresAt: a.share_expires_at });
});

r.post('/audits/:id/send', async (c) => {
  const { user, client, audit } = await loadAudit(c, c.req.param('id'));
  if (audit.status !== 'done') fail(409, 'The check has not finished.');
  const body = await readJson(c);
  const channel = oneOf(body.channel, ['email', 'sms'], 'Channel');
  const a = await ensureShare(c, audit);
  const link = shareUrl(c, a);
  const result = JSON.parse(a.result);
  const firstName = text(body.firstName, { max: 40 });
  let recipient;
  let sent;
  if (channel === 'email') {
    recipient = String(body.to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(recipient)) fail(400, 'Enter a valid email address.');
    const visible = result.findings.filter((f) => !JSON.parse(a.hidden || '[]').includes(f.id));
    const top = visible.filter((f) => f.severity !== 'minor').slice(0, 3);
    const mail = renderEmail({
      origin: originOf(c),
      heading: `Your website check: ${result.overall}/100`,
      paragraphs: [
        `${firstName ? `Hi ${firstName}, w` : 'W'}e ran a full check of ${client.name}'s website and Google presence: search visibility, local search, mobile experience, speed and security.`,
        ...(a.note ? [a.note] : []),
        top.length ? `The biggest opportunities we found: ${top.map((f) => f.title.replace(/\.$/, '')).join('; ')}.` : 'Your site is in good shape. The report lists a few smaller improvements.',
        'The full report explains each issue in plain English, why it matters and how to fix it.',
      ],
      button: { label: 'View your report', url: link },
      footnote: 'Questions? Just reply to this email. This link works for 60 days.',
    });
    sent = await sendEmail(c.env, { to: recipient, subject: `${client.name}: your website and Google check (${result.overall}/100)`, ...mail, idempotencyKey: `audit/${a.id}/${recipient}/${Math.floor(now() / 60000)}` });
  } else {
    // Texting a customer requires their permission (TCPA). Staff confirm it for every send.
    if (body.consent !== true) fail(400, 'Confirm the customer agreed to receive this by text.');
    recipient = toE164(body.to);
    if (!recipient) fail(400, 'Enter a valid US mobile number.');
    const msg = `${firstName ? `Hi ${firstName}, h` : 'H'}ere's the website and Google check for ${client.name} from Detcord Digital (score ${result.overall}/100): ${link} Reply STOP to opt out.`;
    sent = await sendSms(c.env, { to: recipient, body: msg });
  }
  await c.env.DB.prepare('INSERT INTO audit_deliveries (id, audit_id, channel, recipient, status, error, provider_id, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(newId(), a.id, channel, recipient, sent.status, sent.error || null, sent.id || null, user.id, now()).run();
  if (sent.status === 'sent') {
    await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'audit_sent', summary: `Website check sent by ${channel === 'sms' ? 'text' : 'email'} to ${recipient}` });
    if (channel === 'sms') await putSetting(c.env.DB, 'integration.twilio.lastSend', { ok: true, at: now() }, user.id);
  }
  return c.json({ status: sent.status, error: sent.error || null, shareUrl: link }, sent.status === 'sent' ? 200 : sent.status === 'not_configured' ? 503 : 502);
});

async function shot(c, auditId, name) {
  if (!['mobile', 'desktop'].includes(name) || !c.env.MEDIA) fail(404, 'Not found.');
  const obj = await c.env.MEDIA.get(`audits/${auditId}/${name}`);
  if (!obj) fail(404, 'Not found.');
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

r.get('/audits/:id/shot/:name', async (c) => {
  const { audit } = await loadAudit(c, c.req.param('id'));
  return shot(c, audit.id, c.req.param('name'));
});

// ---------- Customer's no-login report ----------
async function byToken(c) {
  const token = c.req.param('token');
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) fail(404, 'This report link is not valid.');
  const a = await c.env.DB.prepare("SELECT * FROM audits WHERE share_token=? AND status='done'").bind(token).first();
  if (!a || a.share_expires_at < now()) fail(404, 'This report link has expired or is not valid. Ask us for a new one.');
  return a;
}

r.get('/public/reports/:token', async (c) => {
  const a = await byToken(c);
  const client = await c.env.DB.prepare('SELECT name, city, state FROM clients WHERE id=?').bind(a.client_id).first();
  const company = await getSettings(c.env.DB, 'company.');
  const res = JSON.parse(a.result);
  const hidden = new Set(JSON.parse(a.hidden || '[]'));
  const findings = res.findings.filter((f) => !hidden.has(f.id)).map(({ id, cat, severity, title, detail, why, fix, service }) => ({ id, cat, severity, title, detail, why, fix, service: serviceName[service] || null }));
  return c.json({
    business: client?.name || 'Your business',
    city: client?.city || null,
    url: res.url,
    checkedAt: res.checkedAt,
    overall: res.overall,
    grade: res.grade,
    scores: res.scores,
    categories: CATEGORIES,
    findings,
    counts: { critical: findings.filter((f) => f.severity === 'critical').length, important: findings.filter((f) => f.severity === 'important').length, minor: findings.filter((f) => f.severity === 'minor').length },
    passed: res.passed,
    speed: res.speed,
    google: res.google ? { profile: res.google.profile && { name: res.google.profile.name, rating: res.google.profile.rating, reviews: res.google.profile.reviews, mapsUrl: res.google.profile.mapsUrl, photos: res.google.profile.photos, hours: !!res.google.profile.hours }, competitors: res.google.competitors } : null,
    coverage: { pagespeed: res.coverage.pagespeed, google: res.coverage.google },
    pagesChecked: res.pagesChecked,
    note: a.note,
    shots: res.shots || {},
    contact: { email: company.email || 'info@detcorddigital.com', phone: company.phone || null },
    expiresAt: a.share_expires_at,
  });
});

r.get('/public/reports/:token/shot/:name', async (c) => {
  const a = await byToken(c);
  return shot(c, a.id, c.req.param('name'));
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
