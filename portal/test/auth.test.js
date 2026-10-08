import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as, api, login, makeUser } from './helpers.js';

const linkFrom = (manualLink) => manualLink.split('#')[1];

describe('sign in', () => {
  it('logs in with the right password and rejects the wrong one', async () => {
    const u = await makeUser('admin');
    expect((await login(u.email, 'wrong password!!')).res.status).toBe(401);
    const { res, cookie } = await login(u.email);
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/^__Host-detcord_portal=/);
    const me = await (await api('GET', '/api/auth/me', undefined, cookie)).json();
    expect(me.user.role).toBe('admin');
  });

  it('throttles repeated failures for one email', async () => {
    const u = await makeUser('rep');
    for (let i = 0; i < 8; i++) await login(u.email, 'nope nope nope');
    expect((await login(u.email)).res.status).toBe(429);
  });

  it('refuses private APIs without a session', async () => {
    for (const path of ['/api/clients', '/api/dashboard', '/api/sales/pipeline', '/api/users']) {
      const res = await api('GET', path);
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('rejects cross-site writes', async () => {
    const res = await fetchWithOrigin('https://evil.example');
    expect(res.status).toBe(403);
  });

  it('logs out and the old cookie stops working', async () => {
    const a = await as('admin');
    expect((await a.call('POST', '/api/auth/logout', {})).status).toBe(200);
    expect((await a.call('GET', '/api/auth/me')).status).toBe(401);
  });
});

async function fetchWithOrigin(origin) {
  const { SELF } = await import('cloudflare:test');
  return SELF.fetch('https://portal.test/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
}

describe('invitations', () => {
  it('invite → set password → correct workspace; link cannot be reused', async () => {
    const admin = await as('admin');
    const res = await admin.call('POST', '/api/users', { role: 'rep', email: 'newrep@example.com', name: 'New Rep' });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Email is not configured in tests, so the admin gets a link to share by hand.
    expect(body.delivery).toBe('not_configured');
    const link = linkFrom(body.manualLink);

    expect((await api('POST', '/api/auth/activate/check', { link })).status).toBe(200);
    expect((await api('POST', '/api/auth/activate', { link, password: 'short' })).status).toBe(400);
    const done = await api('POST', '/api/auth/activate', { link, password: 'a much longer password' });
    expect(done.status).toBe(200);
    const cookie = done.headers.get('Set-Cookie').split(';')[0];
    const me = await (await api('GET', '/api/auth/me', undefined, cookie)).json();
    expect(me.user.role).toBe('rep');

    const again = await api('POST', '/api/auth/activate', { link, password: 'another long password' });
    expect(again.status).toBe(410);
  });

  it('expired and tampered links are refused', async () => {
    const admin = await as('admin');
    const body = await (await admin.call('POST', '/api/users', { role: 'admin', email: 'late@example.com', name: 'Late' })).json();
    const link = linkFrom(body.manualLink);
    const [id] = link.split('.');
    expect((await api('POST', '/api/auth/activate/check', { link: `${id}.not-the-token` })).status).toBe(400);
    await env.DB.prepare('UPDATE tokens SET expires_at=? WHERE id=?').bind(Date.now() - 1, id).run();
    expect((await api('POST', '/api/auth/activate', { link, password: 'a much longer password' })).status).toBe(410);
  });

  it('resending invalidates the previous link', async () => {
    const admin = await as('admin');
    const first = await (await admin.call('POST', '/api/users', { role: 'rep', email: 'resend@example.com', name: 'Resend' })).json();
    const second = await (await admin.call('POST', `/api/users/${first.id}/invite`, {})).json();
    expect((await api('POST', '/api/auth/activate/check', { link: linkFrom(first.manualLink) })).status).toBe(410);
    expect((await api('POST', '/api/auth/activate/check', { link: linkFrom(second.manualLink) })).status).toBe(200);
  });

  it('shows invitation status to admins', async () => {
    const admin = await as('admin');
    await admin.call('POST', '/api/users', { role: 'rep', email: 'status@example.com', name: 'Status' });
    const { users } = await (await admin.call('GET', '/api/users')).json();
    const u = users.find((x) => x.email === 'status@example.com');
    expect(u.status).toBe('invited');
    expect(u.invite.state).toBe('not_delivered');
  });
});

describe('password reset', () => {
  it('answers the same for unknown emails and resets known ones', async () => {
    const u = await makeUser('client');
    const unknown = await (await api('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).json();
    const known = await (await api('POST', '/api/auth/forgot', { email: u.email })).json();
    expect(unknown.message).toBe(known.message);
    const token = await env.DB.prepare("SELECT id FROM tokens WHERE user_id=? AND kind='reset'").bind(u.id).first();
    expect(token).toBeTruthy();
  });
});

describe('account deletion', () => {
  it('revokes sessions, frees the email, and keeps business records', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Keep Me Plumbing', repId: rep.id })).json();
    await rep.call('POST', '/api/clients/' + clientId + '/notes', { body: 'Internal note' });
    expect((await admin.call('DELETE', `/api/users/${rep.id}`)).status).toBe(200);
    expect((await rep.call('GET', '/api/auth/me')).status).toBe(401);
    // Business and its notes survive.
    const record = await (await admin.call('GET', `/api/clients/${clientId}`)).json();
    expect(record.client.name).toBe('Keep Me Plumbing');
    expect(record.notes).toHaveLength(1);
    expect(record.team).toHaveLength(0);
    // Re-inviting the same email works and does not inherit the old assignment.
    const again = await admin.call('POST', '/api/users', { role: 'rep', email: rep.email, name: 'Rep Again' });
    expect(again.status).toBe(201);
    const { id: newId } = await again.json();
    const assignments = await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments WHERE user_id=?').bind(newId).first();
    expect(assignments.n).toBe(0);
  });

  it('will not delete the last admin or yourself', async () => {
    const admin = await as('admin');
    expect((await admin.call('DELETE', `/api/users/${admin.id}`)).status).toBe(400);
  });

  it('disabling an account ends its sessions', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    expect((await admin.call('PATCH', `/api/users/${rep.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await rep.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await login(rep.email)).res.status).toBe(401);
  });
});
