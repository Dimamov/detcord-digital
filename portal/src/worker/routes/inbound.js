// Inbound GOAT requests by text (Twilio webhook) and email (Cloudflare Email Routing).
// A sender is trusted only when their phone or address belongs to a client login or contact
// that Detcord set up. Anyone else is held for an admin to confirm, whatever business they claim.
import { Hono } from 'hono';
import PostalMime from 'postal-mime';
import { now, newId } from '../lib/util.js';
import { putSetting } from '../lib/settings.js';
import { toE164 } from '../lib/sms.js';
import { matchSender, createRequest, approveRequest, addEvent, afterCreate } from '../lib/goat.js';
import { storeInboundFile } from './media.js';

const r = new Hono();
const MAX_FILES = 10;

const twiml = (message) => new Response(
  `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>` : ''}</Response>`,
  { headers: { 'Content-Type': 'text/xml' } });

// Twilio signs the full webhook URL plus the POST fields sorted by name (HMAC-SHA1, auth token).
export async function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Picture messages: Twilio media links need the account credentials.
async function fetchTwilioMedia(env, url) {
  const res = await fetch(url, { headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}` }, redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) return null;
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') || '' };
}

const YES = /^\s*(yes|y|approve|approved|ok|okay)\s*[.!]*\s*$/i;

r.post('/webhooks/twilio', async (c) => {
  const env = c.env;
  if (!env.TWILIO_AUTH_TOKEN) return c.text('Texting is not set up.', 503);
  const params = Object.fromEntries(new URLSearchParams(new TextDecoder().decode(await c.req.arrayBuffer())));
  const expected = await twilioSignature(env.TWILIO_AUTH_TOKEN, c.req.url, params);
  if (!timingSafe(c.req.header('X-Twilio-Signature') || '', expected)) return c.text('Invalid signature.', 403);
  if (env.TWILIO_ACCOUNT_SID && params.AccountSid !== env.TWILIO_ACCOUNT_SID) return c.text('Wrong account.', 403);

  const from = toE164(params.From) || params.From;
  const body = String(params.Body || '').trim().slice(0, 4000);
  const sid = params.MessageSid || params.SmsSid;
  if (!from || !sid) return twiml();
  const key = `sms:${sid}`;
  const db = env.DB;
  // Twilio retries a webhook it thinks failed; each message is handled once.
  const first = await db.prepare('INSERT OR IGNORE INTO webhook_events (id, provider, signature_ok, body, outcome, received_at) VALUES (?,?,?,?,?,?)')
    .bind(`twilio:${sid}`, 'twilio', 1, '{}', 'goat', now()).run();
  if (!first.meta.changes) return twiml();
  await putSetting(db, 'integration.goat.smsLast', { at: now(), from: from.slice(0, -4) + '••••' });

  const media = [];
  for (let i = 0; i < Math.min(Number(params.NumMedia || 0), MAX_FILES); i++) if (params[`MediaUrl${i}`]) media.push({ url: params[`MediaUrl${i}`], type: params[`MediaContentType${i}`] });
  const match = await matchSender(db, { phone: from });

  if (match.status === 'match') {
    if (YES.test(body) && !media.length) {
      // Approve only when exactly one plan from this client is waiting; never guess between several.
      const waiting = (await db.prepare("SELECT * FROM goat_requests WHERE client_id=? AND status='proposed' AND channel='sms' AND sender_address=? ORDER BY proposed_at DESC").bind(match.clientId, from).all()).results;
      if (waiting.length === 1) {
        const res = await approveRequest(env, waiting[0], { userId: match.userId, via: 'sms', hash: waiting[0].proposal_hash });
        return twiml(res.ok ? 'GOAT: Approved. Your Detcord team is on it and will text you when it is done.' : `GOAT: ${res.error}`);
      }
      if (waiting.length > 1) return twiml('GOAT: You have more than one plan waiting. Approve the right one in your Detcord portal.');
      return twiml('GOAT: Nothing is waiting for your approval right now. Text us what you need.');
    }
    const mediaIds = [];
    for (const m of media) {
      const file = await fetchTwilioMedia(env, m.url);
      const id = file && await storeInboundFile(env, { clientId: match.clientId, filename: `text-photo-${sid.slice(-6)}-${mediaIds.length + 1}.${(m.type || '').split('/')[1] || 'bin'}`, contentType: m.type || file.type, bytes: file.bytes, purpose: 'photo', note: 'Sent by text' });
      if (id) mediaIds.push(id);
    }
    const { request, duplicate } = await createRequest(env, { clientId: match.clientId, channel: 'sms', senderUserId: match.userId, senderName: match.name, senderAddress: from, body: body || '(photo)', externalKey: key, mediaIds });
    if (!duplicate) c.executionCtx.waitUntil(afterCreate(env, request.id, { origin: new URL(c.req.url).origin, notifyReceived: false }));
    if (media.length && mediaIds.length < media.length) await addEvent(db, request.id, { actorLabel: 'Portal', kind: 'note', internal: true, body: `${media.length - mediaIds.length} attachment(s) could not be saved (unsupported type).` });
    return twiml('GOAT: Got it. We will text you a plan to approve before anything changes.');
  }

  // Unknown or shared number: hold the message and ask who they are, once.
  const t = now();
  await db.prepare('INSERT OR IGNORE INTO goat_senders (id, channel, address, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(newId(), 'sms', from, 'pending', t, t).run();
  const sender = await db.prepare("SELECT * FROM goat_senders WHERE channel='sms' AND address=?").bind(from).first();
  if (sender.status === 'rejected') return twiml();
  if (sender.asked_at && !sender.claimed_business && match.status === 'none') {
    // Their answer to "who is this?" is recorded as a claim for staff to check, not trusted.
    await db.prepare('UPDATE goat_senders SET claimed_business=?, updated_at=? WHERE id=?').bind(body.slice(0, 300), t, sender.id).run();
    const held = await db.prepare("SELECT id FROM goat_requests WHERE channel='sms' AND sender_address=? AND status='unmatched' ORDER BY created_at DESC").bind(from).first();
    if (held) await addEvent(db, held.id, { actorLabel: from, kind: 'note', internal: true, body: `Sender says: ${body.slice(0, 300)}` });
    return twiml('GOAT: Thanks. Our team will confirm your number and get back to you.');
  }
  const { request } = await createRequest(env, { clientId: null, channel: 'sms', senderAddress: from, body: body || '(photo)', externalKey: key });
  if (media.length) await env.MEDIA?.put(`inbound/${request.id}.json`, JSON.stringify(media));
  c.executionCtx.waitUntil(afterCreate(env, request.id, { origin: new URL(c.req.url).origin }));
  if (!sender.asked_at && match.status === 'none') {
    await db.prepare('UPDATE goat_senders SET asked_at=?, updated_at=? WHERE id=?').bind(t, t, sender.id).run();
    return twiml('GOAT: Hi! We don\'t recognize this number yet. Reply with your name and your business name, and our team will confirm it before we do anything.');
  }
  return twiml('GOAT: Thanks. Our team will confirm this number before we do anything.');
});

// ---------- Email ----------

const OWN = /@(in\.)?detcorddigital\.com$/i;

// Drops quoted history so the request is what the client wrote this time.
export function stripQuoted(textBody) {
  const lines = String(textBody || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^On .+ wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/.test(line) && out.length) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Cloudflare Email Routing hands every message for the GOAT address to this function.
export async function handleEmail(message, env, ctx) {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const email = await PostalMime.parse(raw);
  const from = (email.from?.address || message.from || '').toLowerCase();
  const headers = message.headers;
  // Never answer machines or ourselves (bounces, auto-replies, our own notices).
  if (!from || OWN.test(from) || /^(mailer-daemon|postmaster|no-?reply)@/i.test(from)) return;
  const auto = headers.get('auto-submitted');
  if ((auto && auto.toLowerCase() !== 'no') || /bulk|junk|list/i.test(headers.get('precedence') || '')) return;

  const db = env.DB;
  const key = `email:${(email.messageId || '').slice(0, 300) || await crypto.subtle.digest('SHA-256', raw).then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''))}`;
  if (await db.prepare('SELECT 1 FROM goat_requests WHERE external_key=?').bind(key).first()) return;
  await putSetting(db, 'integration.goat.emailLast', { at: now(), from: from.replace(/^(.).*(@.*)$/, '$1•••$2') });

  const body = (stripQuoted(email.text) || String(email.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(no message text)').slice(0, 4000);
  const subject = (email.subject || '').slice(0, 200) || null;
  // A failed DMARC check means the From address may be forged; hold it for a person.
  const failedAuth = /dmarc=fail/i.test(headers.get('authentication-results') || '');
  const match = failedAuth ? { status: 'none' } : await matchSender(db, { email: from });

  if (match.status === 'match') {
    const mediaIds = [];
    for (const a of (email.attachments || []).slice(0, MAX_FILES)) {
      if (a.disposition === 'inline' && !a.filename) continue;
      const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
      const id = await storeInboundFile(env, { clientId: match.clientId, filename: a.filename || 'attachment', contentType: a.mimeType, bytes, purpose: /^image\//.test(a.mimeType) ? 'photo' : 'document', note: 'Sent by email' });
      if (id) mediaIds.push(id);
    }
    const { request, duplicate } = await createRequest(env, { clientId: match.clientId, channel: 'email', senderUserId: match.userId, senderName: email.from?.name || match.name, senderAddress: from, subject, body, externalKey: key, mediaIds });
    if (!duplicate) ctx.waitUntil(afterCreate(env, request.id));
    return;
  }

  const t = now();
  await db.prepare('INSERT OR IGNORE INTO goat_senders (id, channel, address, claimed_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), 'email', from, (email.from?.name || '').slice(0, 120) || null, 'pending', t, t).run();
  const sender = await db.prepare("SELECT status FROM goat_senders WHERE channel='email' AND address=?").bind(from).first();
  if (sender?.status === 'rejected') return;
  const { request, duplicate } = await createRequest(env, { clientId: null, channel: 'email', senderName: email.from?.name || null, senderAddress: from, subject, body, externalKey: key });
  if (duplicate) return;
  // Attachments wait in storage until an admin confirms the sender.
  if ((email.attachments || []).length) await env.MEDIA?.put(`inbound/${request.id}.eml`, raw);
  if (failedAuth) await addEvent(db, request.id, { actorLabel: 'Portal', kind: 'note', internal: true, body: 'This email failed its sender check (DMARC), so the From address may be forged.' });
  ctx.waitUntil(afterCreate(env, request.id));
}

// After an admin matches a held request, its attachments are saved to the client's files.
export async function claimHeldAttachments(env, requestId, clientId) {
  if (!env.MEDIA) return;
  const ids = [];
  const eml = await env.MEDIA.get(`inbound/${requestId}.eml`);
  if (eml) {
    const email = await PostalMime.parse(new Uint8Array(await eml.arrayBuffer()));
    for (const a of (email.attachments || []).slice(0, MAX_FILES)) {
      const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : new Uint8Array(a.content);
      const id = await storeInboundFile(env, { clientId, filename: a.filename || 'attachment', contentType: a.mimeType, bytes, purpose: /^image\//.test(a.mimeType) ? 'photo' : 'document', note: 'Sent by email' });
      if (id) ids.push(id);
    }
    await env.MEDIA.delete(`inbound/${requestId}.eml`);
  }
  const sms = await env.MEDIA.get(`inbound/${requestId}.json`);
  if (sms) {
    for (const m of JSON.parse(await sms.text())) {
      const file = await fetchTwilioMedia(env, m.url);
      const id = file && await storeInboundFile(env, { clientId, filename: `text-photo-${ids.length + 1}.${(m.type || '').split('/')[1] || 'bin'}`, contentType: m.type || file.type, bytes: file.bytes, purpose: 'photo', note: 'Sent by text' });
      if (id) ids.push(id);
    }
    await env.MEDIA.delete(`inbound/${requestId}.json`);
  }
  if (ids.length) await env.DB.batch(ids.map((m) => env.DB.prepare('INSERT OR IGNORE INTO goat_attachments (request_id, media_id, role) VALUES (?,?,?)').bind(requestId, m, 'request')));
}

export default r;
