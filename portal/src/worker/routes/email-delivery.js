import { Hono } from 'hono';
import { notifyEmailFailure } from '../lib/email.js';

const r = new Hono();
const statuses = {
  'email.sent': 'accepted', 'email.delivered': 'delivered',
  'email.bounced': 'bounced', 'email.failed': 'failed',
  'email.delivery_delayed': 'delayed', 'email.suppressed': 'suppressed',
};
const failures = new Set(['bounced', 'failed', 'delayed', 'suppressed']);

// Svix protocol, verified using Web Crypto without storing request bodies.
export async function verifySignature(raw, headers, secret, clock = Date.now()) {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature') || '';
  if (!id || !/^\d+$/.test(timestamp || '') || Math.abs(clock / 1000 - Number(timestamp)) > 300) return false;
  try {
    const bytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const data = new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
    for (const part of signatures.split(' ')) {
      const [version, signature] = part.split(',');
      if (version !== 'v1' || !signature) continue;
      const decoded = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      if (await crypto.subtle.verify('HMAC', key, decoded, data)) return true;
    }
  } catch { /* malformed signatures fail closed */ }
  return false;
}

r.post('/webhooks/resend', async (c) => {
  if (!c.env.RESEND_WEBHOOK_SECRET) return c.json({ error: 'Webhook not configured.' }, 503);
  const raw = await c.req.text();
  if (raw.length > 100000) return c.json({ error: 'Payload too large.' }, 413);
  if (!await verifySignature(raw, c.req.raw.headers, c.env.RESEND_WEBHOOK_SECRET)) return c.json({ error: 'Invalid signature.' }, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return c.json({ error: 'Invalid payload.' }, 400); }
  const status = statuses[event.type];
  if (!status) return c.json({ ok: true });
  const data = event.data;
  if (!data || typeof data.email_id !== 'string') return c.json({ error: 'Invalid payload.' }, 400);
  const db = c.env.DB;
  const email = await db.prepare('SELECT * FROM outbound_emails WHERE provider_id=?').bind(data.email_id).first();
  if (!email) {
    // A webhook can beat the send API response. Ask Resend to retry that race.
    const pending = await db.prepare("SELECT 1 FROM outbound_emails WHERE status='pending' AND recipient=? AND created_at>?")
      .bind(Array.isArray(data.to) ? data.to[0] || '' : '', Date.now() - 60000).first();
    return c.json({ ok: !pending }, pending ? 503 : 200);
  }
  const eventId = c.req.header('svix-id');
  const when = Date.parse(event.created_at);
  if (!Number.isFinite(when)) return c.json({ error: 'Invalid event time.' }, 400);
  const reasonValue = data.bounce?.message || data.failed?.reason || data.suppressed?.reason || data.reason;
  const reason = String(reasonValue || ({ bounced: 'Recipient server rejected the message.', failed: 'The provider could not send the message.', delayed: 'Delivery delayed; the provider will retry.', suppressed: 'Recipient is on the suppression list.' }[status]) || '').slice(0, 1000);
  // Ignore late accepted/delayed events after confirmed delivery or permanent failure.
  const terminal = ['delivered', 'bounced', 'failed', 'suppressed'].includes(email.status);
  const advance = when >= email.updated_at && !(terminal && ['accepted', 'delayed'].includes(status));
  const existing = await db.prepare('SELECT * FROM email_events WHERE id=?').bind(eventId).first();
  if (!existing) {
    const statements = [db.prepare('INSERT OR IGNORE INTO email_events (id,email_id,type,created_at) VALUES (?,?,?,?)').bind(eventId, email.id, event.type, when)];
    if (advance) {
      statements.push(db.prepare('UPDATE outbound_emails SET status=?,error=?,updated_at=? WHERE id=? AND updated_at<=?').bind(status, reason || null, when, email.id, when));
      statements.push(db.prepare("UPDATE audit_deliveries SET status=?,error=? WHERE provider_id=? AND channel='email'").bind(status === 'accepted' ? 'sent' : status, reason || null, data.email_id));
    }
    await db.batch(statements);
  }
  if (!email.is_alert && failures.has(status) && (advance || existing) && !existing?.alert_sent) {
    const sent = await notifyEmailFailure(c.env, email, status, reason, eventId);
    if (!sent) return c.json({ error: 'Alert delivery pending.' }, 503);
    await db.prepare('UPDATE email_events SET alert_sent=1 WHERE id=?').bind(eventId).run();
  }
  return c.json({ ok: true });
});

export default r;
