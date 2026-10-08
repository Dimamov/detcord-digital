// GOAT Command: one workflow for requests that arrive through the portal, email or text.
// A request is proposed (by Claude or by staff), approved by the client against the exact
// proposal shown, then carried out by the Detcord team. Nothing is applied to a client's
// website, Google profile or social accounts automatically yet, and the UI says so.
import Anthropic from '@anthropic-ai/sdk';
import { now, newId, sha256, logActivity } from './util.js';
import { digits10 } from './audit/crawl.js';
import { sendEmail, renderEmail } from './email.js';
import { sendSms } from './sms.js';

export const CATEGORIES = {
  website: 'Website change',
  hours: 'Hours or business info',
  google: 'Google Business Profile',
  social: 'Social media post',
  promotion: 'Promotion or offer',
  ads: 'Ad copy or campaign',
  photos: 'Photos or gallery',
  flyer: 'Flyer or print',
  landing: 'Landing page',
  seo: 'Website or SEO problem',
  reviews: 'Reviews',
  services: 'Services',
  locations: 'Locations',
  hiring: 'Hiring announcement',
  qr: 'QR code',
  seasonal: 'Seasonal or scheduled update',
  other: 'Something else',
};

export const STATUS_LABEL = {
  unmatched: 'Waiting for sender check', new: 'Received', proposed: 'Waiting for your approval', approved: 'Approved',
  in_progress: 'In progress', done: 'Done', failed: 'Could not be done', cancelled: 'Cancelled',
};

export const originFor = (env, url) => env.PUBLIC_URL || (url ? new URL(url).origin : '');

// ---------- Senders ----------

// Finds which client an email address or phone number belongs to, using only records staff
// control (client portal logins and client contacts). More than one business is "ambiguous",
// and staff decide; nothing is guessed.
export async function matchSender(db, { email, phone }) {
  let rows = [];
  if (email) {
    const e = email.toLowerCase();
    rows = (await db.prepare(`SELECT m.client_id, u.id AS user_id, u.name FROM users u JOIN client_members m ON m.user_id=u.id
        WHERE lower(u.email)=? AND u.role='client' AND u.status<>'disabled'
      UNION SELECT ct.client_id, NULL, ct.name FROM contacts ct WHERE lower(ct.email)=?`).bind(e, e).all()).results;
  } else if (phone) {
    const d = digits10(phone);
    if (!d) return { status: 'none' };
    const users = (await db.prepare(`SELECT m.client_id, u.id AS user_id, u.name, u.phone FROM users u JOIN client_members m ON m.user_id=u.id
      WHERE u.role='client' AND u.status<>'disabled' AND u.phone IS NOT NULL`).all()).results.filter((r) => digits10(r.phone) === d);
    const contacts = (await db.prepare('SELECT client_id, NULL AS user_id, name, phone FROM contacts WHERE phone IS NOT NULL').all()).results.filter((r) => digits10(r.phone) === d);
    rows = [...users, ...contacts];
  }
  const clients = [...new Set(rows.map((r) => r.client_id))];
  if (!clients.length) return { status: 'none' };
  if (clients.length > 1) return { status: 'ambiguous', clients };
  const best = rows.find((r) => r.user_id) || rows[0];
  return { status: 'match', clientId: clients[0], userId: best.user_id || null, name: best.name };
}

// ---------- Requests ----------

export async function addEvent(db, requestId, { actorId = null, actorLabel = null, kind, body = null, internal = false }) {
  await db.prepare('INSERT INTO goat_events (id, request_id, actor_id, actor_label, kind, body, internal, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(newId(), requestId, actorId, actorLabel, kind, body ? String(body).slice(0, 4000) : null, internal ? 1 : 0, now()).run();
}

// Creates a request once per external key. A repeated delivery (Twilio and email retries,
// a double-clicked submit) returns the existing request with duplicate: true.
export async function createRequest(env, { clientId, channel, senderUserId = null, senderName = null, senderAddress = null, subject = null, body, externalKey = null, mediaIds = [], status }) {
  const db = env.DB;
  if (externalKey) {
    const existing = await db.prepare('SELECT * FROM goat_requests WHERE external_key=?').bind(externalKey).first();
    if (existing) return { request: existing, duplicate: true };
  }
  const id = newId();
  const t = now();
  const st = status || (clientId ? 'new' : 'unmatched');
  const res = await db.prepare(`INSERT OR IGNORE INTO goat_requests (id, client_id, channel, sender_user_id, sender_name, sender_address, subject, body, status, external_key, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, clientId || null, channel, senderUserId, senderName, senderAddress, subject, body, st, externalKey, t, t).run();
  if (!res.meta.changes) {
    // Lost a race with a parallel retry.
    return { request: await db.prepare('SELECT * FROM goat_requests WHERE external_key=?').bind(externalKey).first(), duplicate: true };
  }
  if (mediaIds.length) {
    await db.batch(mediaIds.map((m) => db.prepare('INSERT OR IGNORE INTO goat_attachments (request_id, media_id, role) VALUES (?,?,?)').bind(id, m, 'request')));
  }
  const via = { portal: 'the portal', email: 'email', sms: 'text' }[channel];
  await addEvent(db, id, { actorId: senderUserId, actorLabel: senderName || senderAddress, kind: 'created', body: `Sent by ${via}` });
  if (clientId) await logActivity(db, { clientId, actorId: senderUserId, kind: 'goat', internal: false, summary: `New GOAT request by ${via}: ${body.slice(0, 120)}` });
  return { request: await db.prepare('SELECT * FROM goat_requests WHERE id=?').bind(id).first(), duplicate: false };
}

// The proposal as the client sees it. Only these fields are hashed, so approval binds to
// exactly what was displayed.
export function cleanProposal(p = {}) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  return {
    summary: str(p.summary, 600),
    steps: (Array.isArray(p.steps) ? p.steps : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 12),
    content: str(p.content, 6000),
    questions: (Array.isArray(p.questions) ? p.questions : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 6),
    execution: 'team', // no integration applies changes automatically yet
  };
}

export const proposalHash = (p) => sha256(JSON.stringify([p.summary, p.steps, p.content, p.questions, p.execution]));

// Saves a proposal. If the request was already approved and the proposal changed, the
// approval is cleared and the client must approve again.
export async function saveProposal(env, request, proposal, { source, actorId = null, actorLabel = null, category }) {
  const db = env.DB;
  const p = cleanProposal(proposal);
  if (!p.summary) return { changed: false, error: 'Write a short summary of what will be done.' };
  const hash = await proposalHash(p);
  const wasApproved = ['approved', 'in_progress'].includes(request.status) && request.approved_hash && request.approved_hash !== hash;
  if (hash === request.proposal_hash && !category) return { changed: false };
  const status = ['new', 'proposed'].includes(request.status) || wasApproved ? 'proposed' : request.status;
  await db.prepare(`UPDATE goat_requests SET proposal=?, proposal_source=?, proposal_hash=?, proposed_at=?, status=?, category=COALESCE(?, category), updated_at=?
      ${wasApproved ? ', approved_hash=NULL, approved_by=NULL, approved_via=NULL, approved_at=NULL' : ''} WHERE id=?`)
    .bind(JSON.stringify(p), source, hash, now(), status, category || null, now(), request.id).run();
  await addEvent(db, request.id, { actorId, actorLabel, kind: 'proposal', body: wasApproved ? 'The plan changed after approval, so it needs approval again.' : 'Plan ready for approval.' });
  return { changed: true, status, reapproval: !!wasApproved };
}

export async function approveRequest(env, request, { userId, via, hash }) {
  if (request.status !== 'proposed') return { ok: false, error: 'This request is not waiting for approval.' };
  if (!hash || hash !== request.proposal_hash) return { ok: false, error: 'The plan changed while you were looking at it. Review the latest version and approve again.' };
  const t = now();
  const res = await env.DB.prepare(`UPDATE goat_requests SET status='approved', approved_hash=?, approved_by=?, approved_via=?, approved_at=?, updated_at=?
    WHERE id=? AND status='proposed' AND proposal_hash=?`).bind(hash, userId, via, t, t, request.id, hash).run();
  if (!res.meta.changes) return { ok: false, error: 'The plan changed while you were looking at it. Review the latest version and approve again.' };
  await addEvent(env.DB, request.id, { actorId: userId, kind: 'approved', body: via === 'sms' ? 'Approved by text (YES)' : 'Approved in the portal' });
  await logActivity(env.DB, { clientId: request.client_id, actorId: userId, kind: 'goat', internal: false, summary: `Approved GOAT request: ${request.body.slice(0, 100)}` });
  return { ok: true };
}

// ---------- Claude drafts ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'summary', 'steps', 'content', 'questions'],
  properties: {
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    summary: { type: 'string', description: 'One or two sentences, addressed to the client, saying exactly what Detcord will do.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'The concrete changes, in order, as the client will see them.' },
    content: { type: 'string', description: 'Draft wording to publish (post text, ad copy, website text, hours), or an empty string.' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Anything Detcord must know before doing the work. Empty when nothing is missing.' },
  },
};

const SYSTEM = `You draft plans for GOAT Command, the request desk of Detcord Digital, a marketing agency in Michigan.
A small-business client asked for marketing work in plain language. Write the plan the client will approve before anyone acts.
The Detcord team carries out every approved plan by hand; never say a change has been made or will happen automatically.
Plans are specific: name the page, profile field, platform or wording involved. Use the business details provided; do not invent prices, hours, addresses, phone numbers, staff names or promotions the client did not give. When a detail is missing, ask for it in "questions" instead of guessing.
Keep the client's voice for any wording you draft. Social posts stay under 280 characters unless the client asked for a longer post.
Do not include anything addressed to Detcord staff.`;

export const aiReady = (env) => !!env.ANTHROPIC_API_KEY;

export async function draftWithClaude(env, request, client, attachments = [], followUps = []) {
  if (!aiReady(env)) return null;
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60000 });
  const details = [
    `Business: ${client.name}`,
    client.industry && `Industry: ${client.industry}`,
    client.website && `Website: ${client.website}`,
    client.phone && `Phone on file: ${client.phone}`,
    (client.city || client.state) && `Location: ${[client.address, client.city, client.state].filter(Boolean).join(', ')}`,
    `Time zone: ${client.timezone}`,
  ].filter(Boolean).join('\n');
  const files = attachments.length ? `\nAttached files: ${attachments.map((a) => `${a.filename} (${a.content_type})`).join(', ')}` : '';
  const more = followUps.length ? `\n\nThe client's follow-up messages, oldest first. The newest wins where they differ:\n${followUps.map((f) => `- ${f}`).join('\n')}` : '';
  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `${details}\n\nRequest received by ${request.channel}${request.subject ? ` (subject: ${request.subject})` : ''}:\n"""\n${request.body}\n"""${files}${more}` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const textBlock = response.content.find((b) => b.type === 'text');
  try {
    return JSON.parse(textBlock?.text || '');
  } catch {
    return null;
  }
}

// Attachment names and the client's follow-ups ("Change it" messages and their comments).
export async function draftContext(db, requestId) {
  const files = (await db.prepare('SELECT m.filename, m.content_type FROM goat_attachments a JOIN media m ON m.id=a.media_id WHERE a.request_id=?').bind(requestId).all()).results;
  const followUps = (await db.prepare(`SELECT e.body FROM goat_events e JOIN users u ON u.id=e.actor_id
    WHERE e.request_id=? AND e.internal=0 AND e.kind IN ('change','comment') AND u.role='client' ORDER BY e.created_at`).bind(requestId).all()).results.map((e) => e.body);
  return { files, followUps };
}

// Drafts a plan for a new request when Claude is set up. Failures leave the request
// for staff to plan by hand; they are recorded on the request for staff only.
export async function autoDraft(env, requestId) {
  const db = env.DB;
  const request = await db.prepare('SELECT * FROM goat_requests WHERE id=?').bind(requestId).first();
  if (!request?.client_id || request.status !== 'new' || !aiReady(env)) return;
  const client = await db.prepare('SELECT * FROM clients WHERE id=?').bind(request.client_id).first();
  const { files, followUps } = await draftContext(db, requestId);
  let draft;
  try {
    draft = await draftWithClaude(env, request, client, files, followUps);
  } catch (e) {
    await addEvent(db, requestId, { actorLabel: 'Claude', kind: 'note', internal: true, body: `Could not draft a plan automatically (${e?.status || 'network'}). Write it by hand.` });
    return;
  }
  if (!draft) {
    await addEvent(db, requestId, { actorLabel: 'Claude', kind: 'note', internal: true, body: 'Could not draft a plan automatically. Write it by hand.' });
    return;
  }
  const fresh = await db.prepare('SELECT * FROM goat_requests WHERE id=?').bind(requestId).first();
  if (fresh.status !== 'new') return; // staff got there first
  const saved = await saveProposal(env, fresh, draft, { source: 'ai', actorLabel: 'Claude', category: CATEGORIES[draft.category] ? draft.category : 'other' });
  if (saved.changed) await notifyClient(env, requestId, 'proposed');
}

// ---------- Notifications ----------

async function recipientsFor(db, request) {
  const user = request.sender_user_id ? await db.prepare('SELECT name, email FROM users WHERE id=?').bind(request.sender_user_id).first() : null;
  return { user, name: user?.name || request.sender_name || 'there' };
}

const MESSAGES = {
  received: (r) => ['We got your request', 'GOAT got it. We will send you a plan to approve shortly.'],
  proposed: (r) => ['Your plan is ready to approve', 'Here is what we will do. Nothing happens until you approve it.'],
  done: (r) => ['Your request is done', r.result_note || 'Your Detcord team finished this request.'],
  failed: (r) => ['We could not finish your request', r.failure || 'Your Detcord team will follow up.'],
};

// Tells the client about a change, on the channel they used. Email and portal requests get
// an email; text requests get a text. Delivery problems are recorded for staff.
export async function notifyClient(env, requestId, kind, { origin } = {}) {
  const db = env.DB;
  const r = await db.prepare('SELECT * FROM goat_requests WHERE id=?').bind(requestId).first();
  if (!r?.client_id) return;
  const base = originFor(env) || origin || '';
  const link = `${base}/goat/${r.id}`;
  const [heading, line] = MESSAGES[kind](r);
  const { user, name } = await recipientsFor(db, r);
  let result;
  if (r.channel === 'sms' && r.sender_address) {
    const extra = kind === 'proposed' && r.proposal ? ` ${JSON.parse(r.proposal).summary}` : '';
    const tail = kind === 'proposed' ? ` Reply YES to approve, or review it here: ${link}` : ` ${link}`;
    result = await sendSms(env, { to: r.sender_address, body: `GOAT: ${line}${extra}${tail}`.slice(0, 600) });
  } else {
    const to = user?.email || (r.channel === 'email' ? r.sender_address : null);
    if (!to) return;
    const mail = renderEmail({ origin: base, heading, paragraphs: [`Hi ${name.split(' ')[0]},`, line, `Your request: “${r.body.slice(0, 300)}”`], button: { label: kind === 'proposed' ? 'Review and approve' : 'Open your request', url: link }, footnote: 'You can reply to info@detcorddigital.com with questions.' });
    result = await sendEmail(env, { to, subject: `GOAT: ${heading}`, ...mail, idempotencyKey: `goat/${r.id}/${kind}/${r.proposal_hash || ''}` });
  }
  if (result.status !== 'sent') await addEvent(db, r.id, { actorLabel: 'Portal', kind: 'note', internal: true, body: `Could not notify the client (${result.error || result.status}).` });
}

// Emails the assigned reps (or the agency alert address) about a new or unmatched request.
export async function notifyStaff(env, requestId, { origin } = {}) {
  const db = env.DB;
  const r = await db.prepare('SELECT r.*, cl.name AS client_name FROM goat_requests r LEFT JOIN clients cl ON cl.id=r.client_id WHERE r.id=?').bind(requestId).first();
  if (!r) return;
  const reps = r.client_id ? (await db.prepare("SELECT u.email FROM assignments a JOIN users u ON u.id=a.user_id WHERE a.client_id=? AND u.status='active'").bind(r.client_id).all()).results.map((x) => x.email) : [];
  const to = reps.length ? reps : env.EMAIL_ALERT_TO ? [env.EMAIL_ALERT_TO] : [];
  if (!to.length) return;
  const base = originFor(env) || origin || '';
  const who = r.client_name || `Unknown sender ${r.sender_address}`;
  const mail = renderEmail({ origin: base, heading: r.client_id ? `New GOAT request: ${who}` : 'GOAT request from an unknown sender', paragraphs: [`“${r.body.slice(0, 500)}”`, r.client_id ? 'It is waiting for a plan.' : 'Check who sent it and match it to a client before anything is done.'], button: { label: 'Open request', url: `${base}/goat/${r.id}` } });
  for (const addr of to) await sendEmail(env, { to: addr, subject: `GOAT: ${who}`, ...mail, idempotencyKey: `goat/${r.id}/staff/${addr}` });
}

// Runs after a request is created: a plan from Claude when available, and the right notices.
export async function afterCreate(env, requestId, { origin, notifyReceived = true } = {}) {
  const r = await env.DB.prepare('SELECT status FROM goat_requests WHERE id=?').bind(requestId).first();
  if (r?.status === 'unmatched') return notifyStaff(env, requestId, { origin });
  await notifyStaff(env, requestId, { origin });
  if (aiReady(env)) await autoDraft(env, requestId);
  else if (notifyReceived) await notifyClient(env, requestId, 'received', { origin });
}
