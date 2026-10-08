import { describe, it, expect } from 'vitest';
import { as } from './helpers.js';

describe('Industries typed at intake', () => {
  it('adds a new industry once, reuses existing ones and accepts it on clients and discoveries', async () => {
    const rep = await as('rep');
    const name = `Pool Cleaning ${crypto.randomUUID().slice(0, 4)}`;
    const made = (await (await rep.call('POST', '/api/industries', { name })).json()).industry;
    expect(made.created).toBe(true);
    expect(made.id).toMatch(/^x-/);

    // Same name with different spacing or case is the same industry.
    const again = (await (await rep.call('POST', '/api/industries', { name: `  ${name.toUpperCase()} ` })).json()).industry;
    expect(again).toMatchObject({ id: made.id, created: false });
    // A built-in name maps to the built-in industry.
    const builtIn = (await (await rep.call('POST', '/api/industries', { name: 'plumbing' })).json()).industry;
    expect(builtIn.created).toBe(false);
    expect(builtIn.id).not.toMatch(/^x-/);

    const list = (await (await rep.call('GET', '/api/industries')).json()).custom;
    expect(list.some((i) => i.id === made.id && i.name === name)).toBe(true);

    const res = await rep.call('POST', '/api/clients', { name: `Splash ${crypto.randomUUID().slice(0, 6)}`, industry: made.id });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const d = await rep.call('POST', '/api/discoveries', { clientId: id });
    expect(d.status).toBe(201);

    // Made-up ids are still refused.
    expect((await rep.call('POST', '/api/clients', { name: 'Nope', industry: 'x-not-real' })).status).toBe(400);
    expect((await rep.call('PATCH', `/api/clients/${id}`, { industry: 'made-up' })).status).toBe(400);
  });

  it('is staff only', async () => {
    const client = await as('client');
    expect((await client.call('GET', '/api/industries')).status).toBe(403);
    expect((await client.call('POST', '/api/industries', { name: 'Anything' })).status).toBe(403);
  });
});
