// Service agreements: draft → send (Detcord signs, document frozen and hashed) → client e-signs → locked.
// Signing also sets up the money side: deposit invoice, setup balance draft, active services, deal won.
import { Hono } from 'hono';
import { fail, now, newId, sha256, safeEqual, hashPassword, text, cents, readJson, logActivity, EMAIL_RE } from '../lib/util.js';
import { requireUser, requireRole, requireClient, isStaff, clientScopeSql } from '../lib/auth.js';
import { getSettings, nextNumber } from '../lib/settings.js';
import { createInvoice } from '../lib/invoices.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { renderContract, signingProblems, contractTotals, needsReview, SIGNING_STATEMENT } from '../../shared/contract.js';

const r = new Hono();
const DAY = 86400000;
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;

async function loadContract(c, id, { write = false } = {}) {
  const row = await c.env.DB.prepare('SELECT * FROM contracts WHERE id=?').bind(id).first();
  if (!row) fail(404, 'Contract not found.');
  const { user, client } = await requireClient(c, row.client_id, { write });
  // Clients only ever see agreements that were sent to them. Drafts and voided drafts stay internal.
  if (!isStaff(user) && !['sent', 'signed'].includes(row.status) && !(row.status === 'void' && row.issued_at)) fail(404, 'Contract not found.');
  return { user, client, contract: { ...row, data: JSON.parse(row.data) } };
}

function publicView(contract, user, company = {}) {
  const { presented_html, signed_html, signer_ip, signer_ua, ...rest } = contract;
  const out = { ...rest, totals: contractTotals(contract.data) };
  if (isStaff(user)) {
    // Drafts pick up the current company details when sent, so check against those.
    const live = contract.status === 'draft'
      ? { ...contract.data, providerName: company.legalName || contract.data.providerName, providerAddress: company.address || contract.data.providerAddress }
      : contract.data;
    out.problems = signingProblems(live);
    out.reviewServices = contract.data.services.filter((s) => needsReview(s.serviceId)).map((s) => s.name);
  } else {
    delete out.created_by; delete out.void_reason;
  }
  return out;
}

const docInput = (contract, origin) => ({
  number: contract.number, version: contract.version, title: contract.title, status: contract.status,
  createdAt: contract.created_at, issuedAt: contract.issued_at, data: contract.data, origin,
});

// ---- list -----------------------------------------------------------------

r.get('/clients/:id/contracts', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const staff = isStaff(user);
  const rows = (await c.env.DB.prepare(`SELECT id, number, title, status, version, issued_at, signed_at, signer_name, voided_at, created_at, updated_at, data
    FROM contracts WHERE client_id=? ${staff ? '' : "AND (status IN ('sent','signed') OR (status='void' AND issued_at IS NOT NULL))"} ORDER BY created_at DESC`).bind(client.id).all()).results;
  return c.json({ contracts: rows.map(({ data, ...row }) => ({ ...row, totals: contractTotals(JSON.parse(data)) })) });
});

// Everything awaiting signature across the user's clients (dashboards).
r.get('/contracts', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const rows = (await c.env.DB.prepare(`SELECT ct.id, ct.number, ct.title, ct.status, ct.issued_at, ct.signed_at, ct.client_id, cl.name AS client_name
    FROM contracts ct JOIN clients cl ON cl.id=ct.client_id WHERE ${scope.sql} AND ct.status IN ('sent','signed'${isStaff(user) ? ",'draft'" : ''})
    ORDER BY ct.updated_at DESC LIMIT 200`).bind(...scope.binds).all()).results;
  return c.json({ contracts: rows });
});

// ---- create ---------------------------------------------------------------

r.post('/clients/:id/contracts', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { write: true });
  const db = c.env.DB;
  const body = await readJson(c).catch(() => ({}));
  const company = await getSettings(db, 'company.');
  const [services, contact, deal] = await Promise.all([
    db.prepare(`SELECT cs.service_id, s.name, COALESCE(cs.setup_cents, s.setup_cents) AS setup_cents, COALESCE(cs.monthly_cents, s.monthly_cents) AS monthly_cents
      FROM client_services cs JOIN services s ON s.id=cs.service_id WHERE cs.client_id=? AND cs.status IN ('recommended','proposed','active') ORDER BY s.position`).bind(client.id).all(),
    db.prepare('SELECT name, email FROM contacts WHERE client_id=? ORDER BY is_primary DESC, is_decision_maker DESC LIMIT 1').bind(client.id).first(),
    db.prepare("SELECT d.id FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=? AND ps.outcome='open' ORDER BY d.updated_at DESC LIMIT 1").bind(client.id).first(),
  ]);
  const address = [client.address, [client.city, client.state].filter(Boolean).join(', '), client.zip].filter(Boolean).join(', ');
  const data = {
    providerName: company.legalName || '', providerAddress: company.address || '', providerEmail: company.email || 'info@detcorddigital.com',
    providerSigner: company.signer || user.name,
    clientLegalName: client.name, clientAddress: address, clientEmail: client.email || contact?.email || '',
    services: services.results.map((s) => ({ serviceId: s.service_id, name: s.name, setupCents: s.setup_cents, monthlyCents: s.monthly_cents, scope: '' })),
    depositCents: null, monthlyStart: '', paymentTerms: '', thirdParty: '', additional: '',
    paymentDays: 15, feedbackDays: 10, attachments: [],
  };
  const id = newId();
  const t = now();
  const number = await nextNumber(db, 'DD');
  const title = text(body.title, { max: 160 }) || `${client.name} marketing services agreement`;
  await db.prepare(`INSERT INTO contracts (id, client_id, deal_id, number, title, status, version, data, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,'draft',1,?,?,?,?)`).bind(id, client.id, deal?.id || null, number, title, JSON.stringify(data), user.id, t, t).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'contract', summary: `Started agreement ${number}` });
  return c.json({ id, number }, 201);
});

// ---- read -----------------------------------------------------------------

r.get('/contracts/:id', async (c) => {
  const { user, client, contract } = await loadContract(c, c.req.param('id'));
  const company = isStaff(user) ? await getSettings(c.env.DB, 'company.') : {};
  return c.json({ contract: publicView(contract, user, company), client: { id: client.id, name: client.name } });
});

r.get('/contracts/:id/document', async (c) => {
  const { contract } = await loadContract(c, c.req.param('id'));
  const html = contract.signed_html || contract.presented_html || renderContract(docInput(contract, originOf(c)));
  const download = c.req.query('download') === '1';
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Images are absolute URLs on the portal origin so a downloaded copy still shows the logo.
      'Content-Security-Policy': `default-src 'none'; img-src 'self' ${originOf(c)}; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'private, no-store',
      ...(download ? { 'Content-Disposition': `attachment; filename="${contract.number}${contract.status === 'signed' ? '-signed' : ''}.html"` } : {}),
    },
  });
});

// ---- edit -----------------------------------------------------------------

const intIn = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

async function cleanData(db, clientId, prev, body) {
  const d = { ...prev };
  const str = (k, max = 2000) => { if (body[k] !== undefined) d[k] = text(body[k], { max }) || ''; };
  ['providerSigner', 'clientLegalName', 'clientAddress', 'paymentTerms', 'thirdParty'].forEach((k) => str(k, 600));
  str('additional', 8000);
  if (body.clientEmail !== undefined) {
    const e = String(body.clientEmail || '').trim().toLowerCase();
    if (e && !EMAIL_RE.test(e)) fail(400, 'Enter a valid client notice email.');
    d.clientEmail = e;
  }
  if (body.deposit !== undefined) d.depositCents = cents(body.deposit, 'Deposit');
  if (body.monthlyStart !== undefined) {
    const m = String(body.monthlyStart || '');
    if (m && !/^\d{4}-\d{2}-\d{2}$/.test(m)) fail(400, 'Monthly start must be a date.');
    d.monthlyStart = m;
  }
  if (body.paymentDays !== undefined) d.paymentDays = intIn(body.paymentDays, 0, 90, 15);
  if (body.feedbackDays !== undefined) d.feedbackDays = intIn(body.feedbackDays, 1, 30, 10);
  if (body.services !== undefined) {
    if (!Array.isArray(body.services) || body.services.length > 40) fail(400, 'Services list is not valid.');
    const known = new Map((await db.prepare('SELECT id, name FROM services').all()).results.map((s) => [s.id, s.name]));
    const seen = new Set();
    d.services = body.services.map((s) => {
      if (!known.has(s.serviceId) || seen.has(s.serviceId)) fail(400, 'Choose each service once from the catalog.');
      seen.add(s.serviceId);
      return {
        serviceId: s.serviceId,
        name: known.get(s.serviceId),
        setupCents: cents(s.setup, `${known.get(s.serviceId)} one-time price`),
        monthlyCents: cents(s.monthly, `${known.get(s.serviceId)} monthly price`),
        scope: text(s.scope, { max: 6000 }) || '',
      };
    });
  }
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments) || body.attachments.length > 20) fail(400, 'Attachments are not valid.');
    const out = [];
    for (const mid of body.attachments) {
      const m = await db.prepare('SELECT id, filename, content_type, visibility FROM media WHERE id=? AND client_id=? AND deleted_at IS NULL').bind(String(mid), clientId).first();
      if (!m) fail(400, 'An attached file is no longer available.');
      if (m.visibility !== 'shared') fail(400, `${m.filename} is internal. Share it with the client before attaching it to the agreement.`);
      out.push({ id: m.id, filename: m.filename, contentType: m.content_type });
    }
    d.attachments = out;
  }
  return d;
}

r.patch('/contracts/:id', async (c) => {
  const { user, contract } = await loadContract(c, c.req.param('id'), { write: true });
  if (contract.status === 'signed') fail(409, 'This agreement is signed and locked. Create a new agreement for changes.');
  if (contract.status === 'void') fail(409, 'This agreement was voided.');
  const db = c.env.DB;
  const body = await readJson(c);
  const data = await cleanData(db, contract.client_id, contract.data, body);
  const title = body.title !== undefined ? text(body.title, { max: 160, required: true, label: 'Title' }) : contract.title;
  // Editing a sent agreement withdraws it: the client can no longer sign the old version.
  const reopened = contract.status === 'sent';
  await db.prepare(`UPDATE contracts SET title=?, data=?, status='draft', version=?, presented_html=NULL, document_hash=NULL, issued_at=NULL, issued_by=NULL, updated_at=? WHERE id=?`)
    .bind(title, JSON.stringify(data), reopened ? contract.version + 1 : contract.version, now(), contract.id).run();
  if (reopened) await logActivity(db, { clientId: contract.client_id, actorId: user.id, kind: 'contract', summary: `Withdrew ${contract.number} v${contract.version} for edits` });
  const fresh = await loadContract(c, contract.id);
  return c.json({ contract: publicView(fresh.contract, user, await getSettings(db, 'company.')), reopened });
});

r.delete('/contracts/:id', async (c) => {
  const { user, contract } = await loadContract(c, c.req.param('id'), { write: true });
  if (contract.status !== 'draft' || contract.issued_at) fail(409, 'Only unsent drafts can be deleted. Void it instead.');
  await c.env.DB.prepare('DELETE FROM contracts WHERE id=?').bind(contract.id).run();
  await logActivity(c.env.DB, { clientId: contract.client_id, actorId: user.id, kind: 'contract', summary: `Deleted draft ${contract.number}` });
  return c.json({ ok: true });
});

// ---- send -----------------------------------------------------------------

r.post('/contracts/:id/send', async (c) => {
  const { user, client, contract } = await loadContract(c, c.req.param('id'), { write: true });
  if (contract.status !== 'draft') fail(409, contract.status === 'sent' ? 'Already sent.' : 'This agreement cannot be sent.');
  const db = c.env.DB;
  // Freeze current company details into the document.
  const company = await getSettings(db, 'company.');
  const data = { ...contract.data, providerName: company.legalName || contract.data.providerName, providerAddress: company.address || contract.data.providerAddress, providerEmail: company.email || contract.data.providerEmail || 'info@detcorddigital.com' };
  const problems = signingProblems(data);
  if (problems.length) return c.json({ error: 'Finish these before sending.', problems }, 400);
  const t = now();
  const sent = { ...contract, data, status: 'sent', issued_at: t };
  const html = renderContract(docInput(sent, originOf(c)));
  const hash = await sha256(html);
  await db.prepare(`UPDATE contracts SET data=?, status='sent', presented_html=?, document_hash=?, issued_at=?, issued_by=?, updated_at=? WHERE id=? AND status='draft'`)
    .bind(JSON.stringify(data), html, hash, t, user.id, t, contract.id).run();
  // Services on the agreement become "proposed"; the deal moves to the proposal stage if it is earlier.
  const stmts = data.services.map((s) => db.prepare(`INSERT INTO client_services (client_id, service_id, status, setup_cents, monthly_cents, updated_at) VALUES (?,?,'proposed',?,?,?)
    ON CONFLICT(client_id, service_id) DO UPDATE SET status=CASE WHEN status='active' THEN 'active' ELSE 'proposed' END, setup_cents=excluded.setup_cents, monthly_cents=excluded.monthly_cents, updated_at=excluded.updated_at`)
    .bind(client.id, s.serviceId, s.setupCents, s.monthlyCents, t));
  const totals = contractTotals(data);
  if (contract.deal_id) {
    stmts.push(db.prepare(`UPDATE deals SET setup_cents=?, monthly_cents=?, updated_at=?,
      stage_id=CASE WHEN (SELECT position FROM pipeline_stages WHERE id=deals.stage_id) < (SELECT position FROM pipeline_stages WHERE id='proposal') AND EXISTS (SELECT 1 FROM pipeline_stages WHERE id='proposal') THEN 'proposal' ELSE stage_id END
      WHERE id=?`).bind(totals.setup, totals.monthly, t, contract.deal_id));
  }
  if (stmts.length) await db.batch(stmts);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'contract', internal: false, summary: `Agreement ${contract.number} sent for signature` });

  // Tell the client's portal users. Without a login the rep needs to invite someone first.
  const origin = originOf(c);
  const members = (await db.prepare("SELECT u.email, u.name FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.status!='disabled'").bind(client.id).all()).results;
  const deliveries = [];
  for (const m of members) {
    const mail = renderEmail({
      origin,
      heading: 'Your agreement is ready to review and sign',
      paragraphs: [`Hi ${m.name},`, `${contract.title} from Detcord Digital is ready. You can read the full agreement, download a copy, and sign it in your portal.`],
      button: { label: 'Review and sign', url: `${origin}/contracts/${contract.id}` },
      footnote: 'Questions before signing? Reply to this email or write to info@detcorddigital.com.',
    });
    const res = await sendEmail(c.env, { to: m.email, subject: `Please review and sign: ${contract.title}`, ...mail, idempotencyKey: `contract-sent/${contract.id}/${contract.version}/${m.email}` });
    deliveries.push({ email: m.email, status: res.status });
  }
  return c.json({ ok: true, hash, deliveries, noLogins: members.length === 0 });
});

// ---- sign (client) ---------------------------------------------------------

r.post('/contracts/:id/sign', async (c) => {
  const { user, client, contract } = await loadContract(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client can sign their agreement.');
  if (contract.status === 'signed') fail(409, 'This agreement is already signed.');
  if (contract.status !== 'sent') fail(409, 'This agreement is not open for signature.');
  const db = c.env.DB;
  const body = await readJson(c);
  const name = text(body.name, { max: 120, required: true, label: 'Your full name' });
  const title = text(body.title, { max: 120, required: true, label: 'Your title' });
  if (body.consent !== true) fail(400, 'Confirm the signing statement to sign.');
  if (!body.documentHash || !safeEqual(String(body.documentHash), contract.document_hash)) {
    fail(409, 'This agreement changed since you opened it. Reload the page and review the current version.');
  }
  const row = await db.prepare('SELECT pw_hash, pw_salt FROM users WHERE id=?').bind(user.id).first();
  const { hash } = await hashPassword(String(body.password ?? ''), row.pw_salt);
  if (!safeEqual(hash, row.pw_hash)) fail(400, 'That password is not right. Enter your portal password to sign.');

  const t = now();
  const ip = c.req.header('CF-Connecting-IP') || null;
  const ua = c.req.header('User-Agent') || null;
  const signature = { id: newId(), name, title, email: user.email, at: t, consent: SIGNING_STATEMENT, documentHash: contract.document_hash, ip, userAgent: ua };
  const signedHtml = renderContract({ ...docInput(contract, originOf(c)), status: 'signed' }, signature);
  const res = await db.prepare(`UPDATE contracts SET status='signed', signed_html=?, signed_at=?, signer_user_id=?, signer_name=?, signer_title=?, signer_email=?, signer_ip=?, signer_ua=?, signature_id=?, updated_at=?
    WHERE id=? AND status='sent' AND document_hash=?`)
    .bind(signedHtml, t, user.id, name, title, user.email, ip, ua, signature.id, t, contract.id, contract.document_hash).run();
  if (!res.meta.changes) fail(409, 'This agreement changed since you opened it. Reload and try again.');

  const automation = await afterSigning(c, { client, contract, signerId: user.id, t });
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'contract', internal: false, summary: `${name} signed agreement ${contract.number}` });
  return c.json({ ok: true, signedAt: t, ...automation });
});

async function afterSigning(c, { client, contract, signerId, t }) {
  const db = c.env.DB;
  const d = contract.data;
  const totals = contractTotals(d);
  const issuer = contract.issued_by || contract.created_by;
  const due = t + (d.paymentDays ?? 15) * DAY;
  const stmts = d.services.map((s) => db.prepare(`INSERT INTO client_services (client_id, service_id, status, setup_cents, monthly_cents, updated_at) VALUES (?,?,'active',?,?,?)
    ON CONFLICT(client_id, service_id) DO UPDATE SET status='active', setup_cents=excluded.setup_cents, monthly_cents=excluded.monthly_cents, updated_at=excluded.updated_at`)
    .bind(client.id, s.serviceId, s.setupCents, s.monthlyCents, t));
  stmts.push(db.prepare("UPDATE clients SET status='active', updated_at=? WHERE id=?").bind(t, client.id));
  const won = await db.prepare("SELECT id FROM pipeline_stages WHERE outcome='won' ORDER BY position LIMIT 1").first();
  if (contract.deal_id && won) {
    stmts.push(db.prepare("UPDATE deals SET stage_id=?, setup_cents=?, monthly_cents=?, closed_at=COALESCE(closed_at, ?), updated_at=? WHERE id=?")
      .bind(won.id, totals.setup, totals.monthly, t, t, contract.deal_id));
  }
  await db.batch(stmts);

  const invoices = [];
  if (totals.deposit > 0) {
    invoices.push(await createInvoice(db, {
      clientId: client.id, contractId: contract.id, kind: 'deposit', status: 'open', dueAt: t + 3 * DAY, userId: issuer,
      title: `Deposit for agreement ${contract.number}`,
      lines: [{ kind: 'deposit', description: `Deposit due at signing (agreement ${contract.number})`, unitCents: totals.deposit }],
    }));
  }
  const setupLines = d.services.filter((s) => s.setupCents > 0).map((s) => ({ kind: 'setup', description: `${s.name}: one-time`, unitCents: s.setupCents }));
  if (setupLines.length && totals.setup > totals.deposit) {
    if (totals.deposit > 0) setupLines.push({ kind: 'credit', description: `Less deposit (agreement ${contract.number})`, unitCents: -Math.min(totals.deposit, totals.setup) });
    // Draft: staff issue it when the setup work is due (e.g. on completion).
    invoices.push(await createInvoice(db, { clientId: client.id, contractId: contract.id, kind: 'setup', status: 'draft', dueAt: due, userId: issuer, title: `One-time fees for agreement ${contract.number}`, lines: setupLines }));
  }
  // Tell the team and leave them a next step.
  const owners = new Set([issuer, ...(await db.prepare('SELECT user_id FROM assignments WHERE client_id=?').bind(client.id).all()).results.map((a) => a.user_id)].filter(Boolean));
  if (owners.size) {
    await db.batch([...owners].map((o) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,NULL,?)')
      .bind(newId(), client.id, o, `Kick off ${client.name}: agreement ${contract.number} signed`, t + DAY, t)));
  }
  const staff = (await db.prepare(`SELECT DISTINCT u.email, u.name FROM users u WHERE u.status='active' AND (u.role='admin' OR u.id IN (SELECT user_id FROM assignments WHERE client_id=?))`).bind(client.id).all()).results;
  const origin = originOf(c);
  for (const s of staff) {
    const mail = renderEmail({ origin, heading: `${client.name} signed ${contract.number}`, paragraphs: [`${contract.title} was signed in the portal.`, invoices.length ? `Created ${invoices.length === 1 ? 'one invoice' : `${invoices.length} invoices`} from it.` : 'No invoices were needed.'], button: { label: 'Open the agreement', url: `${origin}/contracts/${contract.id}` } });
    await sendEmail(c.env, { to: s.email, subject: `Signed: ${contract.title}`, ...mail, idempotencyKey: `contract-signed/${contract.id}/${s.email}` });
  }
  return { invoices: invoices.map((i) => i.id) };
}

// ---- void (admin) ---------------------------------------------------------

r.post('/contracts/:id/void', async (c) => {
  const user = requireRole(c, 'admin');
  const { contract } = await loadContract(c, c.req.param('id'));
  if (contract.status === 'void') fail(409, 'Already voided.');
  const body = await readJson(c);
  const reason = text(body.reason, { max: 300, required: true, label: 'Reason' });
  await c.env.DB.prepare("UPDATE contracts SET status='void', voided_at=?, void_reason=?, updated_at=? WHERE id=?").bind(now(), reason, now(), contract.id).run();
  await logActivity(c.env.DB, { clientId: contract.client_id, actorId: user.id, kind: 'contract', summary: `Voided ${contract.number}: ${reason}` });
  return c.json({ ok: true });
});

export default r;
