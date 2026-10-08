// Invoice creation and payment bookkeeping shared by contracts, billing and the Clover webhook.
import { now, newId, logActivity } from './util.js';
import { nextNumber } from './settings.js';
import { sendEmail, renderEmail } from './email.js';

export const lineTotal = (l) => (l.quantity || 1) * l.unit_cents;

// lines: [{ kind, description, quantity, unitCents }]
export async function createInvoice(db, { clientId, contractId = null, kind = 'custom', title, status = 'draft', dueAt = null, notes = null, lines, userId }) {
  const id = newId();
  const t = now();
  const number = await nextNumber(db, 'INV');
  const total = lines.reduce((s, l) => s + (l.quantity || 1) * l.unitCents, 0);
  await db.batch([
    db.prepare(`INSERT INTO invoices (id, client_id, contract_id, number, kind, title, status, total_cents, due_at, issued_at, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, clientId, contractId, number, kind, title, status, total, dueAt, status === 'open' ? t : null, notes, userId, t, t),
    ...lines.map((l, i) => db.prepare('INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_cents, position) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), id, l.kind || 'other', l.description, l.quantity || 1, l.unitCents, i)),
  ]);
  return { id, number, total };
}

// Re-derives total, paid and status from lines and approved payments. Paid/void are never reopened by edits.
export async function recalcInvoice(db, invoiceId) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id=?').bind(invoiceId).first();
  if (!inv) return null;
  const { total } = await db.prepare('SELECT COALESCE(SUM(quantity*unit_cents),0) AS total FROM invoice_lines WHERE invoice_id=?').bind(invoiceId).first();
  const { paid } = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS paid FROM payments WHERE invoice_id=? AND status='approved'").bind(invoiceId).first();
  let status = inv.status;
  let paidAt = inv.paid_at;
  if (status === 'open' && total > 0 && paid >= total) { status = 'paid'; paidAt = paidAt || now(); }
  await db.prepare('UPDATE invoices SET total_cents=?, paid_cents=?, status=?, paid_at=?, updated_at=? WHERE id=?')
    .bind(total, paid, status, paidAt, now(), invoiceId).run();
  return { ...inv, total_cents: total, paid_cents: paid, status, paid_at: paidAt };
}

const usd = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);

// Records an approved/declined payment once. Returns { duplicate } when the provider id was seen before.
export async function recordPayment(env, { invoice, provider, providerPaymentId = null, checkoutSessionId = null, status, amountCents, method = null, reference = null, message = null, userId = null, origin }) {
  const db = env.DB;
  const id = newId();
  const res = await db.prepare(`INSERT INTO payments (id, invoice_id, client_id, provider, provider_payment_id, checkout_session_id, status, amount_cents, method, reference, message, recorded_by, received_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(id, invoice.id, invoice.client_id, provider, providerPaymentId, checkoutSessionId, status, amountCents, method, reference, message, userId, now()).run();
  if (!res.meta.changes) return { duplicate: true };
  const after = await recalcInvoice(db, invoice.id);
  if (status === 'approved') {
    await logActivity(db, { clientId: invoice.client_id, actorId: userId, kind: 'payment', internal: false,
      summary: `${usd(amountCents)} payment received on ${invoice.number}${provider === 'manual' ? ` (${method || 'manual'})` : ' (card via Clover)'}` });
    const receipt = await sendReceipt(env, { invoice: after, amountCents, paymentId: id, providerPaymentId, origin });
    return { duplicate: false, id, invoice: after, receipt };
  }
  return { duplicate: false, id, invoice: after, receipt: 'none' };
}

async function sendReceipt(env, { invoice, amountCents, paymentId, providerPaymentId, origin }) {
  const db = env.DB;
  const to = new Set();
  const client = await db.prepare('SELECT name, email FROM clients WHERE id=?').bind(invoice.client_id).first();
  if (client?.email) to.add(client.email);
  const members = (await db.prepare("SELECT u.email FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.status='active'").bind(invoice.client_id).all()).results;
  for (const m of members) to.add(m.email);
  const balance = Math.max(0, invoice.total_cents - invoice.paid_cents);
  const mail = renderEmail({
    origin,
    heading: `Payment received: ${usd(amountCents)}`,
    paragraphs: [
      `Thank you. We received ${usd(amountCents)} for invoice ${invoice.number} (${invoice.title}).`,
      balance ? `Remaining balance on this invoice: ${usd(balance)}.` : 'This invoice is now paid in full.',
      `Receipt reference: ${providerPaymentId || paymentId}`,
    ],
    button: { label: 'View invoice', url: `${origin}/invoices/${invoice.id}` },
  });
  // 'sent' only when every recipient was accepted by the email service.
  if (!to.size) return 'no_recipient';
  const results = [];
  for (const email of to) {
    results.push((await sendEmail(env, { to: email, subject: `Receipt for ${invoice.number} – Detcord Digital`, ...mail, idempotencyKey: `receipt/${paymentId}/${email}` })).status);
  }
  return results.every((r) => r === 'sent') ? 'sent' : results[0];
}
