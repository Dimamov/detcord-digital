import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';
import { requestLink, cleanCustomerId } from '../src/worker/lib/google-ads.js';

afterEach(() => vi.restoreAllMocks());

function mockGoogle(handler) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input?.url || input);
    calls.push({ url, headers: init.headers || {}, body: init.body ? String(init.body) : '' });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.test' });
    return handler(url, init);
  });
  return calls;
}

describe('Google Ads link requests', () => {
  it('reads customer IDs with or without dashes', () => {
    expect(cleanCustomerId('123-456-7890')).toBe('1234567890');
    expect(cleanCustomerId(' 123 456 7890 ')).toBe('1234567890');
    expect(cleanCustomerId('12345')).toBeNull();
  });

  it('saves the ID and waits when Google Ads is not set up', async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(id, 'Waiting Co', 1, 1).run();
    const res = await requestLink({}, env.DB, { id, ads_customer_id: '1234567890' }, null);
    expect(res.status).toBe('waiting_setup');
  });

  it('sends the request from the MCC at intake, tracks status, and stays staff-only', async () => {
    const admin = await as('admin');
    const calls = mockGoogle((url) => url.includes('customerClientLinks:mutate')
      ? Response.json({ result: { resourceName: 'customers/4482626468/customerClientLinks/1234567890~1' } })
      : Response.json({ results: [{ customerClientLink: { status: 'ACTIVE', clientCustomer: 'customers/1234567890' } }] }));
    const res = await admin.call('POST', '/api/clients', { name: `Ads Co ${crypto.randomUUID().slice(0, 6)}`, googleAdsId: '123-456-7890' });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const mutate = calls.find((x) => x.url.includes('customerClientLinks:mutate'));
    expect(mutate.url).toBe('https://googleads.googleapis.com/v25/customers/4482626468/customerClientLinks:mutate');
    expect(mutate.headers['login-customer-id']).toBe('4482626468');
    expect(mutate.headers['developer-token']).toBe('test-dev-token');
    expect(JSON.parse(mutate.body)).toEqual({ operation: { create: { clientCustomer: 'customers/1234567890', status: 'PENDING' } } });

    let ads = (await (await admin.call('GET', `/api/clients/${id}/google-ads`)).json()).ads;
    expect(ads).toMatchObject({ customer_id: '123-456-7890', status: 'pending' });
    ads = (await (await admin.call('POST', `/api/clients/${id}/google-ads/check`)).json()).ads;
    expect(ads.status).toBe('active');

    const client = await as('client');
    await env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(id, client.id).run();
    expect((await client.call('GET', `/api/clients/${id}/google-ads`)).status).toBe(403);
    expect((await admin.call('POST', '/api/clients', { name: 'Bad ID Co', googleAdsId: '42' })).status).toBe(400);
  });

  it('records Google’s refusal reason instead of claiming success', async () => {
    const admin = await as('admin');
    const { id } = await (await admin.call('POST', '/api/clients', { name: `Nope Co ${crypto.randomUUID().slice(0, 6)}` })).json();
    mockGoogle(() => Response.json({ error: { message: 'bad', details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' }, message: 'not approved' }] }] } }, { status: 403 }));
    const ads = (await (await admin.call('PUT', `/api/clients/${id}/google-ads`, { customerId: '2223334444' })).json()).ads;
    expect(ads.status).toBe('failed');
    expect(ads.error).toContain('Basic access');
  });
});

describe('Google Ads without a developer token', () => {
  it('counts as set up', async () => {
    const { adsReady } = await import('../src/worker/lib/google-ads.js');
    expect(adsReady({ GOOGLE_ADS_CLIENT_ID: 'a', GOOGLE_ADS_CLIENT_SECRET: 'b', GOOGLE_ADS_REFRESH_TOKEN: 'c' })).toBe(true);
  });
});
