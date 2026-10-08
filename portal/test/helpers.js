import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../src/worker/lib/util.js';

export const BASE = 'https://portal.test';
export const PASSWORD = 'correct horse battery';

// Creates an active user directly in the database.
export async function makeUser(role, { email, name } = {}) {
  const id = crypto.randomUUID();
  const { hash, salt } = await hashPassword(PASSWORD);
  email ??= `${role}-${id.slice(0, 6)}@example.com`;
  await env.DB.prepare("INSERT INTO users (id, email, name, role, status, pw_hash, pw_salt, created_at) VALUES (?,?,?,?, 'active', ?,?,?)")
    .bind(id, email, name || `${role} ${id.slice(0, 4)}`, role, hash, salt, Date.now()).run();
  return { id, email };
}

export async function login(email, password = PASSWORD) {
  const res = await api('POST', '/api/auth/login', { email, password });
  const cookie = res.headers.get('Set-Cookie')?.split(';')[0];
  return { res, cookie };
}

export async function api(method, path, body, cookie) {
  return SELF.fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Logged-in user of the given role. Returns { id, email, cookie, call }.
export async function as(role, opts) {
  const u = await makeUser(role, opts);
  const { cookie } = await login(u.email);
  return { ...u, cookie, call: (method, path, body) => api(method, path, body, cookie) };
}
