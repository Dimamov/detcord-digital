// Invoices, payments and the Clover integration.
// Payment success comes only from Clover's signed webhook or an admin recording a manual payment.
import { Hono } from 'hono';
import { fail, now, newId, text, cents, oneOf, readJson, logActivity } from '../lib/util.js';
import { requireUser, requireRole, requireClient, isStaff, clientScopeSql } from '../lib/auth.js';
import { createInvoice, recalcInvoice, recordPayment, lineTotal } from '../lib/invoices.js';
import { cloverConfig, createCheckout, verifyCloverSignature, readCloverEvent } from '../lib/clover.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { sendEmail, renderEmail } from '../lib/email.js';

const r = new Hono();
const DAY = 86400000;
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;
const KINDS = ['deposit', 'setup', 'monthly', 'custom'];
const LINE_KINDS = ['setup', 'monthly', 'deposit', 'credit', 'other'];
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);

async function loadInvoice(c, id, { write = false } = {}) {
  const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(id).first();
  if (!inv) fail(404, 'Invoice not found.');
  const { user, client } = await requireClient(c, inv.client_id, { write });
  if (!isStaff(user) && inv.status === 'draft') fail(404, 'Invoice not found.');
  return { user, client, invoice: inv };
}

function payability(env, inv) {
  const balance = Math.max(0, inv.total_cents - inv.paid_cents);
  if (inv.status === 'paid') return { available: false, reason: 'Paid in full.' };
  if (inv.status !== 'open') return { available: false, reason: inv.status === 'void' ? 'This invoice was voided.' : 'Not issued yet.' };
  if (balance <= 0) return { available: false, reason: 'Nothing is due.' };
  const cfg = cloverConfig(env);
  if (!cfg.ready) return { available: false, reason: 'Online card payment is not set up yet. To pay now, contact info@detcorddigital.com.', notConfigured: true };
  return { available: true, balance, sandbox: cfg.sandbox };
}

function parseLines(body) {
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 50) fail(400, 'Add at least one line.');
  return body.lines.map((l) => {
    const raw = String(l.amount ?? '').replace(/[$,\s]/g, '');
    const negative = raw.startsWith('-');
    const amount = cents(negative ? raw.slice(1) : raw, 'Line amount');
    if (amount === null) fail(400, 'Every line needs an amount.');
    const kind = oneOf(l.kind || (negative ? 'credit' : 'other'), LINE_KINDS, 'Line type');
    const quantity = Math.max(1, Math.min(999, Math.round(Number(l.quantity) || 1)));
    return { kind, description: text(l.description, { max: 300, required: true, label: 'Line description' }), quantity, unitCents: negative ? -amount : amount };
  });
}

const dueFrom = (v) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) fail(400, 'Due date is not valid.');
  return Date.parse(`${v}T17:00:00Z`);
};

// ---- lists ----------------------------------------------------------------

r.get('/invoices', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const where = [scope.sql];
  const binds = [...scope.binds];
  if (!isStaff(user)) where.push("i.status!='draft'");
  const status = c.req.query('status');
  if (status === 'unpaid') where.push("i.status='open'");
  else if (['draft', 'open', 'paid', 'void'].includes(status)) { where.push('i.status=?'); binds.push(status); }
  const rows = (await c.env.DB.prepare(`SELECT i.id, i.number, i.title, i.kind, i.status, i.total_cents, i.paid_cents, i.due_at, i.issued_at, i.paid_at, i.client_id, cl.name AS client_name
    FROM invoices i JOIN clients cl ON cl.id=i.client_id WHERE ${where.join(' AND ')} ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, COALESCE(i.due_at, i.created_at) DESC LIMIT 500`)
    .bind(...binds).all()).results;
  const open = rows.filter((i) => i.status === 'open');
  return c.json({
    invoices: rows,
    summary: {
      outstandingCents: open.reduce((s, i) => s + i.total_cents - i.paid_cents, 0),
      overdueCents: open.filter((i) => i.due_at && i.due_at < now()).reduce((s, i) => s + i.total_cents - i.paid_cents, 0),
      paidCents: rows.reduce((s, i) => s + i.paid_cents, 0),
    },
    payments: cloverConfig(c.env).ready ? 'online' : 'not_configured',
  });
});

r.get('/clients/:id/invoices', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const rows = (await c.env.DB.prepare(`SELECT id, number, title, kind, status, total_cents, paid_cents, due_at, issued_at, paid_at, contract_id FROM invoices
    WHERE client_id=? ${isStaff(user) ? '' : "AND status!='draft'"} ORDER BY created_at DESC`).bind(client.id).all()).results;
  return c.json({ invoices: rows });
});

// ---- create / edit ----------------------------------------------------------

r.post('/clients/:id/invoices', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { write: true });
  const db = c.env.DB;
  const body = await readJson(c);
  let lines; let title; let kind; let contractId = null;
  if (body.monthlyFromContract) {
    const ct = await db.prepare("SELECT * FROM contracts WHERE id=? AND client_id=? AND status='signed'").bind(String(body.monthlyFromContract), client.id).first();
    if (!ct) fail(400, 'Choose a signed agreement.');
    const d = JSON.parse(ct.data);
    lines = d.services.filter((s) => s.monthlyCents > 0).map((s) => ({ kind: 'monthly', description: `${s.name}: monthly`, unitCents: s.monthlyCents }));
    if (!lines.length) fail(400, 'That agreement has no monthly services.');
    const month = text(body.period, { max: 40 }) || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Detroit' });
    title = `Monthly services: ${month}`; kind = 'monthly'; contractId = ct.id;
    lines = lines.map((l) => ({ ...l, description: `${l.description} (${month})` }));
  } else {
    lines = parseLines(body);
    title = text(body.title, { max: 160, required: true, label: 'Title' });
    kind = oneOf(body.kind || 'custom', KINDS, 'Invoice type');
  }
  const inv = await createInvoice(db, {
    clientId: client.id, contractId, kind, title, status: 'draft', userId: user.id,
    dueAt: dueFrom(body.dueDate) || now() + 15 * DAY, notes: text(body.notes, { max: 2000 }), lines,
  });
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'invoice', summary: `Drafted invoice ${inv.number}` });
  return c.json(inv, 201);
});

r.get('/invoices/:id', async (c) => {
  const { user, client, invoice } = await loadInvoice(c, c.req.param('id'));
  const db = c.env.DB;
  const staff = isStaff(user);
  const [lines, payments, contract] = await Promise.all([
    db.prepare('SELECT id, kind, description, quantity, unit_cents FROM invoice_lines WHERE invoice_id=? ORDER BY position').bind(invoice.id).all(),
    db.prepare(`SELECT p.id, p.provider, p.provider_payment_id, p.status, p.amount_cents, p.method, p.reference, p.received_at${staff ? ', p.message, u.name AS recorded_by' : ''}
      FROM payments p LEFT JOIN users u ON u.id=p.recorded_by WHERE p.invoice_id=? ORDER BY p.received_at`).bind(invoice.id).all(),
    invoice.contract_id ? db.prepare('SELECT id, number, title, status FROM contracts WHERE id=?').bind(invoice.contract_id).first() : null,
  ]);
  const out = { ...invoice };
  if (!staff) { delete out.created_by; delete out.void_reason; }
  return c.json({
    invoice: out,
    client: { id: client.id, name: client.name },
    lines: lines.results.map((l) => ({ ...l, amount_cents: lineTotal(l) })),
    payments: payments.results,
    contract: contract && (staff || contract.status !== 'draft') ? contract : null,
    balanceCents: Math.max(0, invoice.total_cents - invoice.paid_cents),
    pay: payability(c.env, invoice),
  });
});

r.patch('/invoices/:id', async (c) => {
  const { user, invoice } = await loadInvoice(c, c.req.param('id'), { write: true });
  if (invoice.status !== 'draft') fail(409, 'Only drafts can be edited. Void and recreate an issued invoice instead.');
  const db = c.env.DB;
  const body = await readJson(c);
  const stmts = [db.prepare('UPDATE invoices SET title=?, due_at=?, notes=?, updated_at=? WHERE id=?').bind(
    body.title !== undefined ? text(body.title, { max: 160, required: true, label: 'Title' }) : invoice.title,
    body.dueDate !== undefined ? dueFrom(body.dueDate) : invoice.due_at,
    body.notes !== undefined ? text(body.notes, { max: 2000 }) : invoice.notes, now(), invoice.id)];
  if (body.lines !== undefined) {
    const lines = parseLines(body);
    stmts.push(db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').bind(invoice.id));
    lines.forEach((l, i) => stmts.push(db.prepare('INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_cents, position) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), invoice.id, l.kind, l.description, l.quantity, l.unitCents, i)));
  }
  await db.batch(stmts);
  await recalcInvoice(db, invoice.id);
  await logActivity(db, { clientId: invoice.client_id, actorId: user.id, kind: 'invoice', summary: `Edited draft ${invoice.number}` });
  return c.json({ ok: true });
});

r.delete('/invoices/:id', async (c) => {
  const { user, invoice } = await loadInvoice(c, c.req.param('id'), { write: true });
  if (invoice.status !== 'draft') fail(409, 'Only drafts can be deleted.');
  await c.env.DB.prepare('DELETE FROM invoices WHERE id=?').bind(invoice.id).run();
  await logActivity(c.env.DB, { clientId: invoice.client_id, actorId: user.id, kind: 'invoice', summary: `Deleted draft ${invoice.number}` });
  return c.json({ ok: true });
});

r.post('/invoices/:id/issue', async (c) => {
  const { user, client, invoice } = await loadInvoice(c, c.req.param('id'), { write: true });
  if (invoice.status !== 'draft') fail(409, 'Already issued.');
  if (invoice.total_cents <= 0) fail(400, 'The invoice total must be more than $0.');
  const db = c.env.DB;
  const t = now();
  await db.prepare("UPDATE invoices SET status='open', issued_at=?, due_at=COALESCE(due_at, ?), updated_at=? WHERE id=? AND status='draft'").bind(t, t + 15 * DAY, t, invoice.id).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'invoice', internal: false, summary: `Invoice ${invoice.number} issued for ${usd(invoice.total_cents)}` });
  const origin = originOf(c);
  const members = (await db.prepare("SELECT u.email, u.name FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.status!='disabled'").bind(client.id).all()).results;
  const deliveries = [];
  for (const m of members) {
    const mail = renderEmail({
      origin,
      heading: `Invoice ${invoice.number}: ${usd(invoice.total_cents)}`,
      paragraphs: [`Hi ${m.name},`, `${invoice.title} is ready in your portal.`],
      button: { label: 'View invoice', url: `${origin}/invoices/${invoice.id}` },
      footnote: 'Questions about this invoice? Reply to this email or write to info@detcorddigital.com.',
    });
    const res = await sendEmail(c.env, { to: m.email, subject: `Invoice ${invoice.number} from Detcord Digital`, ...mail, idempotencyKey: `invoice-issued/${invoice.id}/${m.email}` });
    deliveries.push({ email: m.email, status: res.status });
  }
  return c.json({ ok: true, deliveries, noLogins: members.length === 0 });
});

r.post('/invoices/:id/void', async (c) => {
  const user = requireRole(c, 'admin');
  const { invoice } = await loadInvoice(c, c.req.param('id'));
  if (invoice.status === 'void') fail(409, 'Already voided.');
  if (invoice.paid_cents > 0) fail(409, 'This invoice has payments. Refund them in Clover first, then record the adjustment.');
  const reason = text((await readJson(c)).reason, { max: 300, required: true, label: 'Reason' });
  await c.env.DB.prepare("UPDATE invoices SET status='void', voided_at=?, void_reason=?, updated_at=? WHERE id=?").bind(now(), reason, now(), invoice.id).run();
  await logActivity(c.env.DB, { clientId: invoice.client_id, actorId: user.id, kind: 'invoice', summary: `Voided ${invoice.number}: ${reason}` });
  return c.json({ ok: true });
});

// Admin records a check, cash or bank transfer. Labeled as manual everywhere it shows.
r.post('/invoices/:id/payments', async (c) => {
  const user = requireRole(c, 'admin');
  const { invoice } = await loadInvoice(c, c.req.param('id'));
  if (invoice.status !== 'open') fail(409, 'Payments can only be recorded on issued, unpaid invoices.');
  const body = await readJson(c);
  const amount = cents(body.amount, 'Amount');
  if (!amount) fail(400, 'Enter the amount received.');
  if (amount > invoice.total_cents - invoice.paid_cents) fail(400, `That is more than the ${usd(invoice.total_cents - invoice.paid_cents)} balance.`);
  const method = oneOf(body.method || 'check', ['check', 'cash', 'ach', 'card-in-person', 'other'], 'Method');
  const res = await recordPayment(c.env, {
    invoice, provider: 'manual', status: 'approved', amountCents: amount, method,
    reference: text(body.reference, { max: 120 }), userId: user.id, origin: originOf(c),
  });
  return c.json({ ok: true, invoice: res.invoice, receipt: res.receipt });
});

// ---- Clover checkout --------------------------------------------------------

r.post('/invoices/:id/checkout', async (c) => {
  const { user, client, invoice } = await loadInvoice(c, c.req.param('id'));
  const pay = payability(c.env, invoice);
  if (!pay.available) return c.json({ error: pay.reason, notConfigured: !!pay.notConfigured }, pay.notConfigured ? 503 : 409);
  const db = c.env.DB;
  const t = now();
  // Reuse a fresh session for the same amount instead of creating duplicates on double clicks.
  const recent = await db.prepare("SELECT * FROM checkout_sessions WHERE invoice_id=? AND status='open' AND amount_cents=? AND created_at>? ORDER BY created_at DESC LIMIT 1")
    .bind(invoice.id, pay.balance, t - 10 * 60000).first();
  if (recent) return c.json({ href: recent.href, sessionId: recent.id, reused: true });
  const origin = originOf(c);
  const [first, ...rest] = (user.name || '').split(' ');
  let session;
  try {
    session = await createCheckout(c.env, {
      amountCents: pay.balance,
      name: `Invoice ${invoice.number}`,
      note: `${client.name}: ${invoice.title}`,
      customer: user.role === 'client' ? { email: user.email, firstName: first || undefined, lastName: rest.join(' ') || undefined } : {},
      successUrl: `${origin}/invoices/${invoice.id}?checkout=done`,
      failureUrl: `${origin}/invoices/${invoice.id}?checkout=failed`,
    });
  } catch (e) {
    console.error('Clover checkout failed', e.message);
    fail(502, 'Clover could not start the payment page. Please try again, or contact info@detcorddigital.com.');
  }
  await db.prepare('INSERT INTO checkout_sessions (id, invoice_id, amount_cents, href, status, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(session.checkoutSessionId, invoice.id, pay.balance, session.href, 'open', user.id, t, session.expirationTime || t + 15 * 60000).run();
  return c.json({ href: session.href, sessionId: session.checkoutSessionId });
});

// Public endpoint for Clover. Signature checked against CLOVER_WEBHOOK_SECRET; nothing else is trusted.
r.post('/webhooks/clover', async (c) => {
  const db = c.env.DB;
  const raw = await c.req.text();
  if (raw.length > 64 * 1024) return c.json({ error: 'Too large.' }, 413);
  const ok = await verifyCloverSignature(c.env.CLOVER_WEBHOOK_SECRET, c.req.header('Clover-Signature'), raw);
  const eventId = newId();
  const log = (outcome) => db.prepare('INSERT INTO webhook_events (id, provider, signature_ok, body, outcome, received_at) VALUES (?,?,?,?,?,?)')
    .bind(eventId, 'clover', ok ? 1 : 0, raw.slice(0, 16000), outcome, now()).run();
  if (!ok) { await log('rejected: bad signature'); return c.json({ error: 'Invalid signature.' }, 401); }
  let json;
  try { json = JSON.parse(raw); } catch { await log('rejected: not json'); return c.json({ error: 'Bad body.' }, 400); }
  const ev = readCloverEvent(json);
  await putSetting(db, 'integration.clover.webhook', { at: now(), status: ev.status || null });
  if (ev.type && ev.type !== 'PAYMENT') { await log(`ignored: ${ev.type}`); return c.json({ ok: true }); }
  if (c.env.CLOVER_MERCHANT_ID && ev.merchantId && ev.merchantId !== c.env.CLOVER_MERCHANT_ID) { await log('ignored: other merchant'); return c.json({ ok: true }); }
  const session = ev.sessionId ? await db.prepare('SELECT * FROM checkout_sessions WHERE id=?').bind(ev.sessionId).first() : null;
  if (!session) { await log('ignored: unknown checkout session'); return c.json({ ok: true }); }
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id=?').bind(session.invoice_id).first();
  const approved = ev.status === 'APPROVED';
  const res = await recordPayment(c.env, {
    invoice, provider: 'clover', providerPaymentId: ev.paymentId || `session:${session.id}:${ev.status}`, checkoutSessionId: session.id,
    status: approved ? 'approved' : 'declined', amountCents: session.amount_cents, message: ev.message, origin: originOf(c),
  });
  if (!res.duplicate) await db.prepare('UPDATE checkout_sessions SET status=? WHERE id=?').bind(approved ? 'paid' : 'declined', session.id).run();
  await log(res.duplicate ? 'duplicate: already recorded' : approved ? 'payment recorded' : 'decline recorded');
  return c.json({ ok: true });
});

// ---- settings: company details and integration status -----------------------

r.get('/settings/company', async (c) => {
  requireRole(c, 'admin', 'rep');
  return c.json({ company: await getSettings(c.env.DB, 'company.') });
});

r.put('/settings/company', async (c) => {
  const user = requireRole(c, 'admin');
  const body = await readJson(c);
  const db = c.env.DB;
  for (const [k, max] of [['legalName', 160], ['address', 300], ['signer', 120], ['email', 160]]) {
    if (body[k] !== undefined) await putSetting(db, `company.${k}`, text(body[k], { max }) || '', user.id);
  }
  return c.json({ company: await getSettings(db, 'company.') });
});

r.get('/settings/integrations', async (c) => {
  requireRole(c, 'admin');
  const cfg = cloverConfig(c.env);
  const s = await getSettings(c.env.DB, 'integration.clover.');
  return c.json({
    clover: {
      configured: cfg.ready, missing: cfg.missing, sandbox: cfg.sandbox,
      lastTest: s.test || null, lastWebhook: s.webhook || null,
      // Connected means we proved it: a checkout page was created with these credentials.
      state: !cfg.ready ? 'not_configured' : s.test?.ok ? 'connected' : s.test ? 'failing' : 'untested',
    },
    email: { configured: !!c.env.RESEND_API_KEY },
  });
});

// Creates (but never pays) a $1 checkout page to prove the credentials work.
r.post('/settings/integrations/clover/test', async (c) => {
  const user = requireRole(c, 'admin');
  const cfg = cloverConfig(c.env);
  if (!cfg.ready) return c.json({ error: `Missing Worker secrets: ${cfg.missing.join(', ')}.` }, 400);
  const origin = originOf(c);
  let result;
  try {
    const s = await createCheckout(c.env, { amountCents: 100, name: 'Detcord portal connection test', note: 'Not a charge. Created to test the connection.', successUrl: `${origin}/settings`, failureUrl: `${origin}/settings` });
    result = { ok: true, at: now(), by: user.name, sandbox: cfg.sandbox, sessionId: s.checkoutSessionId };
  } catch (e) {
    result = { ok: false, at: now(), by: user.name, error: String(e.message || e).slice(0, 300) };
  }
  await putSetting(c.env.DB, 'integration.clover.test', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

export default r;
