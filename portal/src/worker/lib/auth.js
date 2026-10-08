// Sessions, one-time links and the role/permission checks every route goes through.
import { fail, now, sha256, randomToken, newId } from './util.js';
import { renderEmail, sendEmail } from './email.js';

export const SESSION_COOKIE = '__Host-detcord_portal';
const SESSION_MS = 12 * 3600 * 1000;
export const INVITE_MS = 24 * 3600 * 1000;
export const RESET_MS = 60 * 60 * 1000;

export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function createSession(db, userId) {
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), userId, now(), now() + SESSION_MS).run();
  await db.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), userId).run();
  return { token, maxAge: SESSION_MS / 1000 };
}

function readCookie(c) {
  const m = (c.req.header('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE.replace(/[-]/g, '\\-')}=([^;]+)`));
  return m?.[1] || null;
}

// Hono middleware: attaches c.get('user') when a valid session exists.
export async function loadUser(c, next) {
  const token = readCookie(c);
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.phone, s.token_hash FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
      .bind(await sha256(token), now()).first();
    if (row && row.status === 'active') {
      c.set('user', { id: row.id, email: row.email, name: row.name, role: row.role, phone: row.phone });
      c.set('sessionHash', row.token_hash);
    }
  }
  await next();
}

export function requireUser(c) {
  const user = c.get('user');
  if (!user) fail(401, 'Please sign in.');
  return user;
}

export function requireRole(c, ...roles) {
  const user = requireUser(c);
  if (!roles.includes(user.role)) fail(403, 'You do not have access to this.');
  return user;
}

export const isStaff = (user) => user.role === 'admin' || user.role === 'rep';

// Central client permission check. Admin: all. Rep: assigned only. Client: own business only.
// `staffOnly` blocks client logins (internal notes, pipeline, discovery...).
export async function requireClient(c, clientId, { staffOnly = false, write = false } = {}) {
  const user = requireUser(c);
  if (typeof clientId !== 'string' || !clientId) fail(400, 'Choose a client.');
  if (staffOnly && !isStaff(user)) fail(403, 'You do not have access to this.');
  if (write && user.role === 'client') fail(403, 'You do not have access to this.');
  const db = c.env.DB;
  let allowed;
  if (user.role === 'admin') allowed = true;
  else if (user.role === 'rep') allowed = !!(await db.prepare('SELECT 1 FROM assignments WHERE client_id=? AND user_id=?').bind(clientId, user.id).first());
  else allowed = !!(await db.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(clientId, user.id).first());
  // Same answer for "missing" and "not yours" so IDs cannot be probed.
  if (!allowed) fail(404, 'Client not found.');
  const client = await db.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
  if (!client) fail(404, 'Client not found.');
  return { user, client };
}

// SQL fragment limiting a clients query to what this user may see. Use with alias `cl`.
export function clientScopeSql(user) {
  if (user.role === 'admin') return { sql: '1=1', binds: [] };
  if (user.role === 'rep') return { sql: 'cl.id IN (SELECT client_id FROM assignments WHERE user_id=?)', binds: [user.id] };
  return { sql: 'cl.id IN (SELECT client_id FROM client_members WHERE user_id=?)', binds: [user.id] };
}

// Creates a one-time link (invite or reset), invalidating earlier unused links of that kind, and emails it.
export async function issueLink(c, user, kind) {
  const db = c.env.DB;
  const token = randomToken();
  const id = newId();
  const expires = now() + (kind === 'invite' ? INVITE_MS : RESET_MS);
  await db.batch([
    db.prepare('UPDATE tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL').bind(now(), user.id, kind),
    db.prepare('INSERT INTO tokens (id, user_id, kind, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .bind(id, user.id, kind, await sha256(token), now(), expires),
  ]);
  const origin = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  const url = `${origin}/${kind === 'invite' ? 'activate' : 'reset'}#${id}.${token}`;
  const roleLabel = { admin: 'administrator', rep: 'sales', client: 'client' }[user.role];
  const email = kind === 'invite'
    ? renderEmail({
      origin,
      heading: 'Your Detcord Digital portal is ready',
      paragraphs: [`Hi ${user.name},`, `You've been invited to the Detcord Digital ${roleLabel} portal. Create your password to get started.`],
      button: { label: 'Create my password', url },
      footnote: 'This link works once and expires in 24 hours. If you did not expect it, you can ignore this email.',
    })
    : renderEmail({
      origin,
      heading: 'Reset your portal password',
      paragraphs: [`Hi ${user.name},`, 'Someone asked to reset the password for your Detcord Digital portal account.'],
      button: { label: 'Choose a new password', url },
      footnote: 'This link works once and expires in 1 hour. If you did not ask for this, ignore this email and your password stays the same.',
    });
  const result = await sendEmail(c.env, {
    to: user.email,
    subject: kind === 'invite' ? 'Set up your Detcord Digital portal account' : 'Reset your Detcord Digital portal password',
    ...email,
    idempotencyKey: `token/${id}`,
  });
  await db.prepare('UPDATE tokens SET delivery=?, delivery_error=? WHERE id=?').bind(result.status, result.error || null, id).run();
  return { id, url, expiresAt: expires, delivery: result.status, error: result.error || null };
}

// Validates "<id>.<token>"; returns the token row with its user, or throws a clear error.
export async function checkLink(db, raw, kind) {
  const [id, token] = String(raw || '').split('.');
  if (!id || !token) fail(400, 'This link is incomplete. Open it straight from your email.');
  const row = await db.prepare('SELECT t.*, u.email, u.name, u.role, u.status FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.kind=?')
    .bind(id, kind).first();
  if (!row || row.token_hash !== (await sha256(token))) fail(400, 'This link is not valid. Ask Detcord for a new one.');
  if (row.used_at) fail(410, 'This link has already been used. Sign in, or ask for a new link.');
  if (row.expires_at < now()) fail(410, 'This link has expired. Ask Detcord for a new one.');
  if (row.status === 'disabled') fail(403, 'This account is disabled.');
  return row;
}
