import { Hono } from 'hono';
import { fail, now, newId, sha256, hashPassword, safeEqual, cleanEmail, text, readJson } from '../lib/util.js';
import { createSession, sessionCookie, requireUser, issueLink, checkLink } from '../lib/auth.js';

const r = new Hono();

const MAX_PER_EMAIL = 8;
const MAX_PER_IP = 40;
const WINDOW_MS = 15 * 60 * 1000;

function checkPassword(p) {
  const s = String(p ?? '');
  if (s.length < 12) fail(400, 'Use a password with at least 12 characters.');
  if (s.length > 256) fail(400, 'That password is too long.');
  return s;
}

async function throttle(db, key, max = MAX_PER_EMAIL) {
  const row = await db.prepare('SELECT count, expires_at FROM login_attempts WHERE key=?').bind(key).first();
  if (row && row.expires_at > now() && row.count >= max) fail(429, 'Too many attempts. Wait 15 minutes and try again.');
}

async function recordFailure(db, key) {
  await db.prepare(`INSERT INTO login_attempts (key, count, expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at < ? THEN excluded.expires_at ELSE expires_at END`)
    .bind(key, now() + WINDOW_MS, now(), now()).run();
}

r.post('/login', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  const keys = [`ip:${await sha256(ip)}`, `email:${await sha256(email)}`];
  await throttle(db, keys[0], MAX_PER_IP);
  await throttle(db, keys[1], MAX_PER_EMAIL);
  const user = email && password.length <= 256
    ? await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first()
    : null;
  let ok = false;
  if (user?.pw_hash && user.status === 'active') {
    const { hash } = await hashPassword(password, user.pw_salt);
    ok = safeEqual(hash, user.pw_hash);
  } else {
    await hashPassword(password || 'x'); // keep timing similar for unknown emails
  }
  if (!ok) {
    for (const k of keys) await recordFailure(db, k);
    fail(401, 'That email and password do not match.');
  }
  await db.prepare('DELETE FROM login_attempts WHERE key=?').bind(keys[1]).run();
  const session = await createSession(db, user.id);
  c.header('Set-Cookie', sessionCookie(session.token, session.maxAge));
  return c.json({ ok: true });
});

r.post('/logout', async (c) => {
  const hash = c.get('sessionHash');
  if (hash) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
  c.header('Set-Cookie', sessionCookie('', 0));
  return c.json({ ok: true });
});

r.get('/me', async (c) => {
  const user = requireUser(c);
  let clients = [];
  if (user.role === 'client') {
    clients = (await c.env.DB.prepare('SELECT cl.id, cl.name FROM clients cl JOIN client_members m ON m.client_id=cl.id WHERE m.user_id=? ORDER BY cl.name')
      .bind(user.id).all()).results;
  }
  return c.json({ user, clients });
});

// Activation and reset share one flow: check the link, then set a password.
for (const kind of ['invite', 'reset']) {
  const path = kind === 'invite' ? '/activate' : '/reset';
  r.post(`${path}/check`, async (c) => {
    const body = await readJson(c);
    const row = await checkLink(c.env.DB, body.link, kind);
    return c.json({ name: row.name, email: row.email });
  });
  r.post(path, async (c) => {
    const db = c.env.DB;
    const body = await readJson(c);
    const password = checkPassword(body.password);
    const row = await checkLink(db, body.link, kind);
    const { hash, salt } = await hashPassword(password);
    // Mark used first; the conditional update makes a second concurrent use fail.
    const used = await db.prepare('UPDATE tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(now(), row.id).run();
    if (!used.meta.changes) fail(410, 'This link has already been used.');
    await db.batch([
      db.prepare("UPDATE users SET pw_hash=?, pw_salt=?, status='active' WHERE id=?").bind(hash, salt, row.user_id),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
    ]);
    const session = await createSession(db, row.user_id);
    c.header('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return c.json({ ok: true });
  });
}

// Always answers the same way so it cannot be used to discover accounts.
r.post('/forgot', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c);
  const email = String(body.email ?? '').trim().toLowerCase();
  const ip = c.req.header('CF-Connecting-IP') || 'local';
  const key = `forgot:${await sha256(ip)}`;
  await throttle(db, key, 10);
  await recordFailure(db, key);
  const user = email ? await db.prepare("SELECT * FROM users WHERE email=? AND status='active'").bind(email).first() : null;
  if (user) await issueLink(c, user, 'reset');
  return c.json({ ok: true, message: 'If that email has a portal account, a reset link is on its way.' });
});

r.post('/password', async (c) => {
  const user = requireUser(c);
  const db = c.env.DB;
  const body = await readJson(c);
  const row = await db.prepare('SELECT pw_hash, pw_salt FROM users WHERE id=?').bind(user.id).first();
  const { hash: current } = await hashPassword(String(body.current ?? ''), row.pw_salt);
  if (!safeEqual(current, row.pw_hash)) fail(400, 'Your current password is not correct.');
  const { hash, salt } = await hashPassword(checkPassword(body.password));
  await db.batch([
    db.prepare('UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?').bind(hash, salt, user.id),
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(user.id, c.get('sessionHash')),
  ]);
  return c.json({ ok: true });
});

r.patch('/profile', async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  const phone = text(body.phone, { max: 40 });
  await c.env.DB.prepare('UPDATE users SET name=?, phone=? WHERE id=?').bind(name, phone, user.id).run();
  return c.json({ ok: true });
});

// First-run only: creates the first admin when none exists. Requires the BOOTSTRAP_TOKEN secret.
r.post('/bootstrap', async (c) => {
  const db = c.env.DB;
  const secret = c.env.BOOTSTRAP_TOKEN;
  const given = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || secret.length < 24 || !safeEqual(await sha256(given), await sha256(secret))) fail(404, 'Not found.');
  if (await db.prepare("SELECT 1 FROM users WHERE role='admin'").first()) fail(409, 'An administrator already exists.');
  const body = await readJson(c);
  const email = cleanEmail(body.email);
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  const user = { id: newId(), email, name, role: 'admin' };
  await db.prepare("INSERT INTO users (id, email, name, role, status, created_at) VALUES (?,?,?,?,'invited',?)")
    .bind(user.id, email, name, 'admin', now()).run();
  const link = await issueLink(c, user, 'invite');
  // The bootstrap caller holds the deploy secret, so returning the link is acceptable here.
  return c.json({ ok: true, delivery: link.delivery, setupUrl: link.url });
});

export default r;
