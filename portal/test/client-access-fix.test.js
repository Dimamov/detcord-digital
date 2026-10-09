import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { as, api, makeUser } from './helpers.js';

async function invitedClientLogin(clientId, email) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, role, status, created_at) VALUES (?,?,?,'client','invited',?)").bind(id, email, 'Dan Buzzie', Date.now()),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(clientId, id),
  ]);
  return id;
}

describe('inviting someone who already has a login', () => {
  it('re-sends the setup link when the login was never set up', async () => {
    const admin = await as('admin');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Buzzie Exteriors' })).json();
    const userId = await invitedClientLogin(clientId, 'dan@buzzie.example');
    const res = await admin.call('POST', '/api/users', { role: 'client', email: 'dan@buzzie.example', name: 'Dan', clientId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resent).toBe(true);
    const tokens = await env.DB.prepare("SELECT COUNT(*) n FROM tokens WHERE user_id=? AND kind='invite'").bind(userId).first();
    expect(tokens.n).toBe(1);
  });

  it('links an active client login from another business without a new password', async () => {
    const admin = await as('admin');
    const { id: a } = await (await admin.call('POST', '/api/clients', { name: 'First Co' })).json();
    const { id: b } = await (await admin.call('POST', '/api/clients', { name: 'Second Co' })).json();
    const u = await makeUser('client', { email: 'owner@both.example' });
    await env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(a, u.id).run();
    const res = await admin.call('POST', '/api/users', { role: 'client', email: 'owner@both.example', name: 'Owner', clientId: b });
    expect(res.status).toBe(200);
    expect((await res.json()).existing).toBe(true);
    expect(await env.DB.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(b, u.id).first()).toBeTruthy();
    const again = await admin.call('POST', '/api/users', { role: 'client', email: 'owner@both.example', name: 'Owner', clientId: b });
    expect(again.status).toBe(409);
  });

  it('never turns a staff login into a client login', async () => {
    const admin = await as('admin');
    const rep = await makeUser('rep');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Staff Email Co' })).json();
    const res = await admin.call('POST', '/api/users', { role: 'client', email: rep.email, name: 'X', clientId });
    expect(res.status).toBe(409);
    expect(await env.DB.prepare('SELECT 1 FROM client_members WHERE user_id=?').bind(rep.id).first()).toBeNull();
  });
});

describe('forgot password before setup', () => {
  it('sends a fresh setup link to a login that was never set up', async () => {
    const admin = await as('admin');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Never Set Up' })).json();
    const userId = await invitedClientLogin(clientId, 'new@setup.example');
    await api('POST', '/api/auth/forgot', { email: 'new@setup.example' });
    const t = await env.DB.prepare('SELECT kind FROM tokens WHERE user_id=?').bind(userId).first();
    expect(t.kind).toBe('invite');
  });
});

describe('deleting a client', () => {
  it('removes its only-here logins so the email can be invited again', async () => {
    const admin = await as('admin');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Gone Roofing' })).json();
    const userId = await invitedClientLogin(clientId, 'gone@roof.example');
    const res = await admin.call('DELETE', '/api/clients/' + clientId, { confirm: 'Gone Roofing' });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id=?').bind(userId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM clients WHERE id=?').bind(clientId).first()).toBeNull();
  });

  it('is admin only and keeps clients with signed agreements', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Signed Co', repId: rep.id })).json();
    expect((await rep.call('DELETE', '/api/clients/' + clientId, { confirm: 'Signed Co' })).status).toBe(403);
    const cols = (await env.DB.prepare('PRAGMA table_info(contracts)').all()).results;
    const row = { id: crypto.randomUUID(), client_id: clientId, status: 'signed' };
    // Fill any other required columns with simple values.
    for (const col of cols) if (col.notnull && !(col.name in row) && col.dflt_value == null) row[col.name] = col.type.includes('INT') ? Date.now() : col.name === 'number' ? 'DD-T-1' : col.name === 'kind' ? 'service' : '{}';
    const names = Object.keys(row);
    await env.DB.prepare(`INSERT INTO contracts (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).bind(...Object.values(row)).run();
    const res = await admin.call('DELETE', '/api/clients/' + clientId, { confirm: 'Signed Co' });
    expect(res.status).toBe(409);
  });
});
