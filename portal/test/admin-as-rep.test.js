import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';

describe('Admins can also sell', () => {
  it('lets an admin be assigned to clients, filter to their own and see their own commissions', async () => {
    const admin = await as('admin');
    const res = await admin.call('POST', '/api/clients', { name: `Admin Sold ${crypto.randomUUID().slice(0, 6)}`, repId: admin.id });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const other = await (await admin.call('POST', '/api/clients', { name: `Someone Else ${crypto.randomUUID().slice(0, 6)}` })).json();

    const list = (await (await admin.call('GET', '/api/clients')).json()).clients;
    expect(list.find((c) => c.id === id).mine).toBe(1);
    expect(list.find((c) => c.id === other.id).mine).toBe(0);

    // Assigning an admin from the client record works too.
    expect((await admin.call('PUT', `/api/users/${admin.id}/clients/${other.id}`)).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 AS ok FROM assignments WHERE client_id=? AND user_id=?').bind(other.id, admin.id).first()).toEqual({ ok: 1 });

    // A client login still can't be assigned as a rep.
    const client = await as('client');
    expect((await admin.call('PUT', `/api/users/${client.id}/clients/${other.id}`)).status).toBe(404);

    const mine = await admin.call('GET', '/api/sales/commissions?mine=1');
    expect(mine.status).toBe(200);
    for (const l of (await mine.json()).lines) expect(l.ownerId ?? admin.id).toBe(admin.id);
  });
});
