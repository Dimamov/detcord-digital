import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';

const uid = () => crypto.randomUUID().slice(0, 8);

// A business with an owner, a teammate who isn't an owner, and an assigned rep. A second business has its own owner.
async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const owner = await as('client');
  const teammate = await as('client');
  const stranger = await as('client');
  const id = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO clients (id, name, city, state, phone, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, `Oak Dental ${uid()}`, 'Troy', 'MI', '248-555-0100', t, t),
    env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(otherId, `Elm Auto ${uid()}`, t, t),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id, is_owner) VALUES (?,?,1)').bind(id, owner.id),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id, is_owner) VALUES (?,?,0)').bind(id, teammate.id),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id, is_owner) VALUES (?,?,1)').bind(otherId, stranger.id),
    env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, rep.id, t),
  ]);
  return { admin, rep, owner, teammate, stranger, clientId: id, otherId };
}

describe('Client self-service', () => {
  it('lets a client edit contact details but not the business name, and logs old and new values', async () => {
    const { owner, rep, clientId } = await setup();
    const before = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
    const res = await owner.call('PATCH', `/api/clients/${clientId}/details`, { phone: '248-555-0199', website: 'oakdental.example', name: 'Hacked Name', status: 'former', industry: 'dental' });
    expect(res.status).toBe(200);
    expect((await res.json()).changed.sort()).toEqual(['phone', 'website']);
    const after = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
    expect(after).toMatchObject({ name: before.name, status: before.status, industry: before.industry, phone: '248-555-0199', website: 'https://oakdental.example' });
    // Staff see the change with old and new values on the client record.
    const record = await (await rep.call('GET', `/api/clients/${clientId}`)).json();
    expect(record.activity.find((a) => a.kind === 'details').summary).toContain('phone "248-555-0100" → "248-555-0199"');
    // The staff edit route stays closed to clients.
    expect((await owner.call('PATCH', `/api/clients/${clientId}`, { name: 'Hacked Name' })).status).toBe(403);
  });

  it('lets an owner invite a teammate and refuses non-owners', async () => {
    const { owner, teammate, clientId } = await setup();
    const email = `new-${uid()}@oakdental.example`;
    let res = await owner.call('POST', `/api/clients/${clientId}/members`, { name: 'Pat Lee', email });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Email isn't configured in tests: nothing is claimed as sent, and the owner never gets the setup link.
    expect(body.delivery).toBe('not_configured');
    expect(body.manualLink).toBeUndefined();
    const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    expect(user).toMatchObject({ role: 'client', status: 'invited' });
    const m = await env.DB.prepare('SELECT * FROM client_members WHERE client_id=? AND user_id=?').bind(clientId, user.id).first();
    expect(m.is_owner).toBe(0);
    expect((await owner.call('POST', `/api/clients/${clientId}/members`, { name: 'Pat Lee', email })).status).toBe(409);
    expect((await owner.call('POST', `/api/clients/${clientId}/members/${user.id}/invite`, {})).status).toBe(200);

    expect((await teammate.call('POST', `/api/clients/${clientId}/members`, { name: 'Sneaky', email: `x-${uid()}@example.com` })).status).toBe(403);
    expect((await teammate.call('PATCH', `/api/clients/${clientId}/members/${teammate.id}`, { owner: true })).status).toBe(403);
    expect((await teammate.call('DELETE', `/api/clients/${clientId}/members/${owner.id}`)).status).toBe(403);
    // Non-owners can still read the list.
    res = await teammate.call('GET', `/api/clients/${clientId}/members`);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.canManage).toBe(false);
    expect(list.members.map((x) => x.email)).toContain(email);

    // Owners can promote; the new owner can then manage the team.
    expect((await owner.call('PATCH', `/api/clients/${clientId}/members/${teammate.id}`, { owner: true })).status).toBe(200);
    expect((await teammate.call('DELETE', `/api/clients/${clientId}/members/${user.id}`)).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(clientId, user.id).first()).toBeNull();
  });

  it('adds an existing client login without a new password, and refuses staff emails neutrally', async () => {
    const { owner, admin, rep, stranger, clientId } = await setup();
    for (const staff of [admin, rep]) {
      const res = await owner.call('POST', `/api/clients/${clientId}/members`, { name: 'Staff', email: staff.email });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('That email can’t be added here. Ask your Detcord team to help.');
    }
    const roles = (await env.DB.prepare('SELECT role, status FROM users WHERE id IN (?,?)').bind(admin.id, rep.id).all()).results;
    expect(roles.every((r) => r.status === 'active' && r.role !== 'client')).toBe(true);
    expect(await env.DB.prepare('SELECT 1 FROM client_members WHERE user_id IN (?,?)').bind(admin.id, rep.id).first()).toBeNull();

    // An active client login of another business is added without touching its password.
    const res = await owner.call('POST', `/api/clients/${clientId}/members`, { name: 'Someone', email: stranger.email });
    expect(res.status).toBe(201);
    expect((await res.json()).existing).toBe(true);
    expect((await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(stranger.id).first()).status).toBe('active');
    expect(await env.DB.prepare("SELECT 1 FROM tokens WHERE user_id=? AND kind='invite'").bind(stranger.id).first()).toBeNull();
  });

  it('never leaves a business without an owner', async () => {
    const { owner, teammate, rep, clientId } = await setup();
    let res = await owner.call('DELETE', `/api/clients/${clientId}/members/${owner.id}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only owner/);
    expect((await owner.call('PATCH', `/api/clients/${clientId}/members/${owner.id}`, { owner: false })).status).toBe(400);
    expect((await rep.call('DELETE', `/api/clients/${clientId}/members/${owner.id}`)).status).toBe(400);
    // Staff can set the flag from Portal access; with a second owner the first can leave.
    expect((await rep.call('PATCH', `/api/clients/${clientId}/members/${teammate.id}`, { owner: true })).status).toBe(200);
    expect((await owner.call('DELETE', `/api/clients/${clientId}/members/${owner.id}`)).status).toBe(200);
    res = await teammate.call('GET', `/api/clients/${clientId}/members`);
    expect((await res.json()).members).toEqual([expect.objectContaining({ id: teammate.id, owner: true })]);
  });

  it('answers 404 for another business, the same as a missing one', async () => {
    const { owner, stranger, otherId, clientId } = await setup();
    const missing = crypto.randomUUID();
    for (const target of [otherId, missing]) {
      expect((await owner.call('GET', `/api/clients/${target}/members`)).status).toBe(404);
      expect((await owner.call('GET', `/api/clients/${target}/service-requests`)).status).toBe(404);
      expect((await owner.call('POST', `/api/clients/${target}/members`, { name: 'X', email: `x-${uid()}@example.com` })).status).toBe(404);
      expect((await owner.call('PATCH', `/api/clients/${target}/details`, { phone: '1' })).status).toBe(404);
      expect((await owner.call('POST', `/api/clients/${target}/service-requests`, { services: ['seo'] })).status).toBe(404);
    }
    // A member of this business addressed through another business is not found either.
    expect((await stranger.call('DELETE', `/api/clients/${otherId}/members/${owner.id}`)).status).toBe(404);
    expect(await env.DB.prepare('SELECT 1 FROM client_members WHERE client_id=? AND user_id=?').bind(clientId, owner.id).first()).not.toBeNull();
  });

  it('turns a service request into tasks for the assigned rep, without showing prices to the client', async () => {
    const { owner, teammate, rep, stranger, admin, clientId, otherId } = await setup();
    await env.DB.prepare("UPDATE services SET setup_cents=150000, monthly_cents=49900 WHERE id='seo'").run();
    let res = await teammate.call('GET', `/api/clients/${clientId}/service-catalog`);
    const catalog = await res.json();
    expect(catalog.services.find((s) => s.id === 'seo')).toBeTruthy();
    expect(JSON.stringify(catalog)).not.toMatch(/cents|1500|499/);

    res = await teammate.call('POST', `/api/clients/${clientId}/service-requests`, { services: ['seo', 'gbp'], note: 'We want more calls from Troy.' });
    expect(res.status).toBe(201);
    const { id, notified, emailed } = await res.json();
    expect(notified).toBe(1);
    expect(emailed).toBe(0); // email isn't configured in tests, so none is claimed
    const tasks = (await env.DB.prepare('SELECT * FROM tasks WHERE client_id=?').bind(clientId).all()).results;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].owner_id).toBe(rep.id);
    expect(tasks[0].title).toContain('SEO');
    expect(await env.DB.prepare("SELECT 1 FROM activity WHERE client_id=? AND kind='service_request'").bind(clientId).first()).not.toBeNull();

    res = await owner.call('GET', `/api/clients/${clientId}/service-requests`);
    const { requests } = await res.json();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id, status: 'new', note: 'We want more calls from Troy.' });
    expect(requests[0].services.map((s) => s.id)).toEqual(['seo', 'gbp']);
    expect(JSON.stringify(requests)).not.toMatch(/cents/);

    // Unknown or inactive services are refused; clients can't change the status.
    expect((await owner.call('POST', `/api/clients/${clientId}/service-requests`, { services: ['nope'] })).status).toBe(400);
    expect((await owner.call('PATCH', `/api/clients/${clientId}/service-requests/${id}`, { status: 'added' })).status).toBe(403);
    // Staff update it; marking it added changes nothing else.
    res = await rep.call('PATCH', `/api/clients/${clientId}/service-requests/${id}`, { status: 'added', reply: 'Starting next week.' });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM client_services WHERE client_id=?').bind(clientId).first()).toBeNull();
    expect((await (await owner.call('GET', `/api/clients/${clientId}/service-requests`)).json()).requests[0]).toMatchObject({ status: 'added', reply: 'Starting next week.' });
    // Another business, or a request id under the wrong business, is not found.
    expect((await stranger.call('GET', `/api/clients/${clientId}/service-requests`)).status).toBe(404);
    expect((await admin.call('PATCH', `/api/clients/${otherId}/service-requests/${id}`, { status: 'declined' })).status).toBe(404);

    // With no rep assigned, the admins get the task.
    const s2 = await as('client');
    const lone = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(lone, `Lone ${uid()}`, Date.now(), Date.now()),
      env.DB.prepare('INSERT INTO client_members (client_id, user_id, is_owner) VALUES (?,?,1)').bind(lone, s2.id),
    ]);
    expect((await s2.call('POST', `/api/clients/${lone}/service-requests`, { services: ['web'] })).status).toBe(201);
    const owners = (await env.DB.prepare('SELECT owner_id FROM tasks WHERE client_id=?').bind(lone).all()).results.map((t) => t.owner_id);
    expect(owners).toContain(admin.id);
  });

  it('makes the first login of a business its owner when staff invite', async () => {
    const { rep } = await setup();
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(id, `New Biz ${uid()}`, Date.now(), Date.now()).run();
    await env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, rep.id, Date.now()).run();
    for (const n of [1, 2]) {
      const res = await rep.call('POST', '/api/users', { role: 'client', name: `Person ${n}`, email: `p${n}-${uid()}@example.com`, clientId: id });
      expect(res.status).toBe(201);
    }
    const flags = (await env.DB.prepare('SELECT m.is_owner FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? ORDER BY u.name').bind(id).all()).results.map((r) => r.is_owner);
    expect(flags).toEqual([1, 0]);
    const record = await (await rep.call('GET', `/api/clients/${id}`)).json();
    expect(record.logins.filter((l) => l.is_owner)).toHaveLength(1);
  });
});
