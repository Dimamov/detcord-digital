// Social posting through Zernio (zernio.com). Each client gets one Zernio profile that holds their
// connected Facebook, Instagram, Google Business, LinkedIn and X accounts. Staff write a post, the
// client approves exactly what will go out (bound to a hash), and only then is it sent to Zernio.
// Status is never assumed from a click: it is what Zernio reports.
import Anthropic from '@anthropic-ai/sdk';
import { now, newId, sha256 } from './util.js';

const API = 'https://zernio.com/api/v1';
export const TIMEZONE = 'America/Detroit';
export const CHECK_EVERY_MS = 30 * 1000;

// Slugs as Zernio's connect endpoint names them.
export const PLATFORMS = { facebook: 'Facebook', instagram: 'Instagram', googlebusiness: 'Google Business Profile', linkedin: 'LinkedIn', twitter: 'X (Twitter)' };

// Media Zernio accepts that the portal stores: images and the two video types.
export const MEDIA_TYPES = { 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'image/gif': 'image', 'video/mp4': 'video', 'video/quicktime': 'video' };

export const STATUS_LABEL = {
  draft: 'Draft', pending_approval: 'Waiting for approval', changes_requested: 'Changes requested', approved: 'Approved',
  publishing: 'Publishing', scheduled: 'Scheduled', published: 'Published', partial: 'Partly published', failed: 'Failed', cancelled: 'Cancelled',
};
// Statuses that come from Zernio once a post has been handed over.
const FROM_ZERNIO = ['publishing', 'scheduled', 'published', 'partial', 'failed'];
export const LIVE = ['publishing', 'scheduled', 'published', 'partial', 'failed'];

export const zernioReady = (env) => !!env.ZERNIO_API_KEY;

// ---------- Approval hash ----------

// Approval binds to exactly these four things. Anything else (the GOAT link, the Claude label)
// can change without asking the client again.
export const postHash = ({ content, mediaIds, accountIds, scheduledFor }) =>
  sha256(JSON.stringify([content || '', mediaIds || [], accountIds || [], scheduledFor || null]));

export const hashOf = (row) => postHash({
  content: row.content, mediaIds: JSON.parse(row.media_ids || '[]'), accountIds: JSON.parse(row.accounts || '[]').map((a) => a.id), scheduledFor: row.scheduled_for,
});

export async function addEvent(db, postId, { actorId = null, actorLabel = null, kind, body = null }) {
  await db.prepare('INSERT INTO social_events (id, post_id, actor_id, actor_label, kind, body, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(newId(), postId, actorId, actorLabel, kind, body ? String(body).slice(0, 2000) : null, now()).run();
}

// ---------- Zernio API ----------

function friendly(status, data) {
  const code = String(data?.code || '');
  const map = {
    PLATFORM_BETA_RESTRICTED: 'Zernio hasn’t opened this platform to Detcord’s account yet.',
    platform_account_limit: 'Detcord’s Zernio plan can’t connect more accounts of this platform.',
    invalid_field_value: `Zernio didn’t accept the post${data?.param ? ` (${data.param})` : ''}.`,
  };
  if (map[code]) return map[code];
  if (status === 401) return 'Zernio rejected the API key.';
  if (status === 403) return 'Zernio refused this for Detcord’s account.';
  if (status === 404) return 'Zernio couldn’t find that profile, account or post.';
  if (status === 429) return 'Zernio is rate limiting us. Try again in a minute.';
  if (status >= 500) return 'Zernio is having trouble. Try again shortly.';
  return `Zernio: ${String(data?.error || data?.message || `answered ${status}`).slice(0, 200)}`;
}

// Calls Zernio. Throws an Error with a friendly message, `status` and `code` on failure.
async function call(env, method, path, { body, headers = {}, allow = [] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.ZERNIO_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res) throw Object.assign(new Error('Could not reach Zernio.'), { status: 0 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !allow.includes(res.status)) throw Object.assign(new Error(friendly(res.status, data)), { status: res.status, code: data?.code || null, data });
  return { status: res.status, data };
}

// Connection test: lists profiles.
export async function testZernio(env) {
  const { data } = await call(env, 'GET', '/profiles');
  const list = data.profiles || data.data || [];
  return { profiles: Array.isArray(list) ? list.length : 0 };
}

// Creates the client's Zernio profile once. Zernio wants unique names per team, so the name
// carries the start of our client id.
export async function ensureProfile(env, db, client) {
  if (client.zernio_profile_id) return client.zernio_profile_id;
  const { data } = await call(env, 'POST', '/profiles', { body: { name: `${client.name} · ${client.id.slice(0, 6)}`.slice(0, 100) } });
  const id = data?.profile?._id;
  if (!id) throw new Error('Zernio answered, but without a profile.');
  // Another tab may have created one at the same moment; keep whichever was saved first.
  await db.prepare('UPDATE clients SET zernio_profile_id=COALESCE(zernio_profile_id, ?), updated_at=? WHERE id=?').bind(id, now(), client.id).run();
  return (await db.prepare('SELECT zernio_profile_id FROM clients WHERE id=?').bind(client.id).first()).zernio_profile_id;
}

export async function connectUrl(env, profileId, platform, redirectUrl) {
  const q = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const { data } = await call(env, 'GET', `/connect/${platform}?${q}`);
  if (!data?.authUrl) throw new Error('Zernio answered, but without a connect link.');
  return data.authUrl;
}

// The profile's accounts from Zernio, saved as the client's known accounts.
export async function refreshAccounts(env, db, client) {
  if (!client.zernio_profile_id) return [];
  const { data } = await call(env, 'GET', `/accounts?${new URLSearchParams({ profileId: client.zernio_profile_id })}`);
  const pid = (a) => (typeof a.profileId === 'object' && a.profileId ? a.profileId._id : a.profileId);
  const list = (data.accounts || [])
    .filter((a) => a?._id && (!a.profileId || pid(a) === client.zernio_profile_id))
    .map((a) => ({ id: a._id, platform: a.platform, username: a.username || null, display_name: a.displayName || null, is_active: a.isActive !== false }));
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM social_accounts WHERE client_id=?').bind(client.id),
    ...list.map((a) => db.prepare('INSERT OR REPLACE INTO social_accounts (id, client_id, platform, username, display_name, is_active, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(a.id, client.id, a.platform, a.username, a.display_name, a.is_active ? 1 : 0, t)),
  ]);
  return list;
}

// "2026-10-10T14:30:00" in Detroit time; Zernio reads scheduledFor in the timezone we send.
export function localTime(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// Copies a portal file from R2 to Zernio's storage and returns the media item for the post.
async function uploadMedia(env, media) {
  const obj = await env.MEDIA.get(media.r2_key);
  if (!obj) throw new Error(`${media.filename} is missing from storage.`);
  const bytes = await obj.arrayBuffer();
  const { data } = await call(env, 'POST', '/media/presign', { body: { filename: media.filename, contentType: media.content_type, size: bytes.byteLength } });
  if (!data?.uploadUrl || !data?.publicUrl) throw new Error('Zernio answered, but without an upload link.');
  const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': media.content_type }, body: bytes, signal: AbortSignal.timeout(60000) }).catch(() => null);
  if (!put?.ok) throw new Error(`Could not upload ${media.filename} to Zernio.`);
  return { type: MEDIA_TYPES[media.content_type], url: data.publicUrl };
}

// Sends an approved post to Zernio. Returns { post } (Zernio's post) or throws. The idempotency key
// is our post id plus the approved hash, so a retry of the same approval can't post twice.
export async function createZernioPost(env, row, mediaRows) {
  const mediaItems = [];
  for (const m of mediaRows) mediaItems.push(await uploadMedia(env, m));
  const accounts = JSON.parse(row.accounts);
  const body = {
    content: row.content,
    ...(mediaItems.length ? { mediaItems } : {}),
    platforms: accounts.map((a) => ({ platform: a.platform, accountId: a.id })),
    ...(row.scheduled_for ? { scheduledFor: localTime(row.scheduled_for), timezone: TIMEZONE } : { publishNow: true }),
  };
  const { status, data } = await call(env, 'POST', '/posts', { body, headers: { 'Idempotency-Key': `${row.id}-${row.approved_hash}` }, allow: [409] });
  if (status === 409) {
    if (data?.post?._id) return { post: data.post, duplicate: true };
    throw Object.assign(new Error('Zernio already received this post. Check it in Zernio before trying again.'), { status: 409 });
  }
  if (!data?.post?._id) throw new Error('Zernio answered, but without the post.');
  // 207: some platforms failed. The post and its per-platform errors are still in the body.
  return { post: data.post, partialError: status === 207 ? String(data.error || 'Some platforms failed.') : null };
}

export async function getZernioPost(env, zernioId) {
  const { data } = await call(env, 'GET', `/posts/${encodeURIComponent(zernioId)}`);
  return data.post || data;
}

// Zernio's post → our columns.
export function readZernio(post) {
  const zs = String(post?.status || '');
  const platforms = (post?.platforms || []).map((p) => ({
    platform: p.platform, status: p.status || null, url: p.platformPostUrl || null, error: p.errorMessage || p.error || null,
  }));
  // Zernio "draft" or anything unknown means it is with Zernio but not out yet.
  return { status: FROM_ZERNIO.includes(zs) ? zs : 'publishing', zernioStatus: zs || null, platforms };
}

// ---------- Claude drafts ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: { content: { type: 'string', description: 'The post text, ready to publish, in the business’s voice.' } },
};

const SYSTEM = `You draft social media posts for small businesses that are clients of Detcord Digital, a marketing agency in Michigan.
Staff give you a short brief. Write one post the business could publish as is. The client reviews and approves it before anything is posted.
Use only the details given; never invent prices, dates, hours, addresses, phone numbers, staff names or offers. Leave a clear [placeholder] where a needed detail is missing.
Keep it under 280 characters unless the brief asks for longer, and fit every platform listed. At most three relevant hashtags. No text addressed to Detcord staff.`;

export async function draftPost(env, client, { brief, platforms = [] }) {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60000 });
  const details = [
    `Business: ${client.name}`,
    client.industry && `Industry: ${client.industry}`,
    client.website && `Website: ${client.website}`,
    (client.city || client.state) && `Location: ${[client.city, client.state].filter(Boolean).join(', ')}`,
    platforms.length && `Platforms: ${platforms.map((p) => PLATFORMS[p] || p).join(', ')}`,
  ].filter(Boolean).join('\n');
  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `${details}\n\nBrief:\n"""\n${brief}\n"""` }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  try {
    return JSON.parse(response.content.find((b) => b.type === 'text')?.text || '').content || null;
  } catch {
    return null;
  }
}
