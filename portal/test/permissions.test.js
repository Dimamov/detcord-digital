import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';

async function setup() {
  const admin = await as('admin');
  const repA = await as('rep');
  const repB = await as('rep');
  const mk = async (name, repId) => (await (await admin.call('POST', '/api/clients', { name, repId })).json()).id;
  const clientA = await mk('Alpha Roofing', repA.id);
  const clientB = await mk('Bravo Dental', repB.id);
  // A client login for business A.
  const invited = await (await admin.call('POST', '/api/users', { role: 'client', email: `owner-${clientA.slice(0, 6)}@alpha.com`, name: 'Alpha Owner', clientId: clientA })).json();
  const link = invited.manualLink.split('#')[1];
  const { SELF } = await import('cloudflare:test');
  const act = await SELF.fetch('https://portal.test/api/auth/activate', { method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ link, password: 'client password 123' }) });
  const clientCookie = act.headers.get('Set-Cookie').split(';')[0];
  const owner = {
    call: (method, path, body) => SELF.fetch('https://portal.test' + path, { method, headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', Cookie: clientCookie }, body: body === undefined ? undefined : JSON.stringify(body) }),
  };
  return { admin, repA, repB, clientA, clientB, owner };
}

describe('rep boundaries', () => {
  it('a rep sees only assigned clients and cannot open others by ID', async () => {
    const { repA, clientA, clientB } = await setup();
    const list = await (await repA.call('GET', '/api/clients')).json();
    expect(list.clients.map((c) => c.id)).toContain(clientA);
    expect(list.clients.map((c) => c.id)).not.toContain(clientB);
    expect((await repA.call('GET', `/api/clients/${clientB}`)).status).toBe(404);
    expect((await repA.call('PATCH', `/api/clients/${clientB}`, { name: 'Hacked' })).status).toBe(404);
    expect((await repA.call('POST', `/api/clients/${clientB}/notes`, { body: 'x' })).status).toBe(404);
    expect((await repA.call('POST', '/api/sales/deals', { clientId: clientB })).status).toBe(404);
    expect((await repA.call('POST', '/api/discoveries', { clientId: clientB })).status).toBe(404);
    expect((await repA.call('POST', `/api/clients/${clientB}/intake`, {})).status).toBe(404);
  });

  it('pipeline and deals are scoped to assigned clients', async () => {
    const { repA, clientB } = await setup();
    const { deals } = await (await repA.call('GET', '/api/sales/pipeline')).json();
    expect(deals.every((d) => d.client_id !== clientB)).toBe(true);
    const otherDeal = await env.DB.prepare('SELECT id FROM deals WHERE client_id=?').bind(clientB).first();
    expect((await repA.call('PATCH', `/api/sales/deals/${otherDeal.id}`, { stageId: 'won' })).status).toBe(404);
  });

  it('assignment by an admin grants access, unassignment removes it', async () => {
    const { admin, repA, clientB } = await setup();
    expect((await repA.call('GET', `/api/clients/${clientB}`)).status).toBe(404);
    await admin.call('PUT', `/api/users/${repA.id}/clients/${clientB}`, {});
    expect((await repA.call('GET', `/api/clients/${clientB}`)).status).toBe(200);
    await admin.call('DELETE', `/api/users/${repA.id}/clients/${clientB}`);
    expect((await repA.call('GET', `/api/clients/${clientB}`)).status).toBe(404);
  });

  it('reps cannot manage the team or settings', async () => {
    const { repA } = await setup();
    expect((await repA.call('GET', '/api/users')).status).toBe(403);
    expect((await repA.call('POST', '/api/users', { role: 'admin', email: 'x@y.com', name: 'X' })).status).toBe(403);
    expect((await repA.call('PUT', '/api/services/seo', { setup: 100 })).status).toBe(403);
    expect((await repA.call('POST', '/api/sales/commission-rules', { name: 'Me', basis: 'setup', ratePercent: 50 })).status).toBe(403);
  });
});

describe('client boundaries', () => {
  it('a client sees only their own business and none of the internal data', async () => {
    const { owner, admin, clientA, clientB } = await setup();
    await admin.call('POST', `/api/clients/${clientA}/notes`, { body: 'Secret pricing strategy', visibility: 'internal' });
    await admin.call('POST', `/api/clients/${clientA}/notes`, { body: 'Welcome aboard!', visibility: 'shared' });
    const record = await (await owner.call('GET', `/api/clients/${clientA}`)).json();
    expect(record.notes.map((n) => n.body)).toEqual(['Welcome aboard!']);
    for (const key of ['deals', 'tasks', 'discoveries', 'activity', 'logins', 'intakes']) expect(record[key]).toBeUndefined();
    expect((await owner.call('GET', `/api/clients/${clientB}`)).status).toBe(404);
    const list = await (await owner.call('GET', '/api/clients')).json();
    expect(list.clients.map((c) => c.id)).toEqual([clientA]);
    expect(list.clients[0].stage).toBeUndefined();
  });

  it('a client cannot reach staff endpoints', async () => {
    const { owner, clientA } = await setup();
    expect((await owner.call('GET', '/api/sales/pipeline')).status).toBe(403);
    expect((await owner.call('GET', '/api/sales/tasks')).status).toBe(403);
    expect((await owner.call('POST', `/api/clients/${clientA}/notes`, { body: 'x' })).status).toBe(403);
    expect((await owner.call('PATCH', `/api/clients/${clientA}`, { name: 'x' })).status).toBe(403);
    expect((await owner.call('POST', '/api/discoveries', { clientId: clientA })).status).toBe(403);
    expect((await owner.call('GET', '/api/users')).status).toBe(403);
    expect((await owner.call('POST', '/api/users', { role: 'client', email: 'a@b.com', name: 'A', clientId: clientA })).status).toBe(403);
  });
});

describe('commissions', () => {
  it('calculates from won deals, traceable to the rule, and flags provisional rules', async () => {
    const { admin, repA, clientA } = await setup();
    await admin.call('POST', '/api/sales/commission-rules', { name: 'Draft 10% setup', basis: 'setup', ratePercent: 10 });
    const deal = await env.DB.prepare('SELECT id FROM deals WHERE client_id=?').bind(clientA).first();
    await repA.call('PATCH', `/api/sales/deals/${deal.id}`, { setup: 2500, monthly: 1000, stageId: 'won' });
    const out = await (await repA.call('GET', '/api/sales/commissions')).json();
    const line = out.lines.find((l) => l.dealId === deal.id);
    expect(line.amountCents).toBe(25000);
    expect(line.provisional).toBe(true);
    expect(line.ruleName).toBe('Draft 10% setup');
    // Winning the deal activates the client.
    const cl = await env.DB.prepare('SELECT status FROM clients WHERE id=?').bind(clientA).first();
    expect(cl.status).toBe('active');
  });
});
