// Small shared helpers for the portal Worker.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// 32 random bytes, URL-safe.
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PBKDF2-SHA256; Workers caps iterations at 100k.
export async function hashPassword(password, salt = randomToken()) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: hex(bits), salt };
}

// Constant-time comparison of two hex strings.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(v) {
  const email = String(v ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) fail(400, 'Enter a valid email address.');
  return email;
}

export function text(v, { max = 500, required = false, label = 'This field' } = {}) {
  const s = String(v ?? '').trim();
  if (required && !s) fail(400, `${label} is required.`);
  return s.slice(0, max) || null;
}

// Accepts dollars (number or "1,250.50") or null; returns integer cents.
export function cents(v, label = 'Amount') {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) fail(400, `${label} must be a dollar amount.`);
  return Math.round(n * 100);
}

export function oneOf(v, allowed, label = 'Value') {
  if (!allowed.includes(v)) fail(400, `${label} is not valid.`);
  return v;
}

export async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    fail(400, 'Request body must be JSON.');
  }
}

export async function logActivity(db, { clientId = null, actorId = null, kind, summary, internal = true }) {
  await db.prepare('INSERT INTO activity (id, client_id, actor_id, kind, summary, internal, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(newId(), clientId, actorId, kind, summary.slice(0, 300), internal ? 1 : 0, now()).run();
}
