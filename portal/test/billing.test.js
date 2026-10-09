import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as, PASSWORD } from './helpers.js';
import { verifyCloverSignature, cloverConfig } from '../src/worker/lib/clover.js';
import { signingProblems, termsFor, SERVICE_TERMS, REVIEW_TERMS, TERMS_2026_10 } from '../src/shared/contract.js';
import { SERVICES } from '../src/shared/services.js';

const BASE = 'https://portal.test';

async function clientLogin(admin, clientId, email) {
  const invited = await (await admin.call('POST', '/api/users', { role: 'client', email, name: 'Pat Owner', clientId })).json();
  const act = await SELF.fetch(`${BASE}/api/auth/activate`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ link: invited.manualLink.split('#')[1], password: PASSWORD }) });
  const cookie = act.headers.get('Set-Cookie').split(';')[0];
  return { email, call: (method, path, body) => SELF.fetch(BASE + path, { method, headers: { Origin: BASE, 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }) };
}

async function setup() {
  const admin = await as('admin');
  const repA = await as('rep');
  const repB = await as('rep');
  await admin.call('PUT', '/api/settings/company', { legalName: 'Detcord Digital LLC', address: '1 Main St, Detroit, MI 48226', signer: 'Dima', venueCounty: 'Oakland' });
  const mk = async (name, repId) => (await (await admin.call('POST', '/api/clients', { name, repId, email: `${name.split(' ')[0].toLowerCase()}@example.com`, address: '10 Elm St', city: 'Troy' })).json()).id;
  const clientA = await mk('Alpha Plumbing', repA.id);
  const clientB = await mk('Bravo Dental', repB.id);
  const owner = await clientLogin(admin, clientA, `owner-${clientA.slice(0, 6)}@alpha.com`);
  return { admin, repA, repB, clientA, clientB, owner };
}

async function readyContract(rep, clientId) {
  const { id } = await (await rep.call('POST', `/api/clients/${clientId}/contracts`, {})).json();
  const res = await rep.call('PATCH', `/api/contracts/${id}`, {
    services: [
      { serviceId: 'seo', setup: '1500', monthly: '800', scope: '10 service pages, monthly local SEO' },
      { serviceId: 'gbp', setup: '0', monthly: '200', scope: 'Weekly posts' },
    ],
    deposit: '500', monthlyStart: '2026-11-01',
  });
  expect(res.status).toBe(200);
  return id;
}

async function sign(owner, id, overrides = {}) {
  const { contract } = await (await owner.call('GET', `/api/contracts/${id}`)).json();
  return owner.call('POST', `/api/contracts/${id}/sign`, { name: 'Pat Owner', title: 'Owner', password: PASSWORD, consent: true, documentHash: contract.document_hash, ...overrides });
}

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signClover(body, secret = 'test-webhook-secret', t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${sig}`;
}

const webhook = async (payload, header) => {
  const body = JSON.stringify(payload);
  return SELF.fetch(`${BASE}/api/webhooks/clover`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Clover-Signature': header ?? await signClover(body) }, body });
};

afterEach(() => vi.restoreAllMocks());

describe('contract language', () => {
  it('every catalog service has terms in both terms versions', () => {
    for (const s of SERVICES) {
      expect(termsFor(s.id), s.id).toBeTruthy();
      expect(termsFor(s.id, TERMS_2026_10), s.id).toBeTruthy();
    }
    // The retired combined service keeps its wording so older agreements still render.
    expect(termsFor('email-sms')).toBe(SERVICE_TERMS['email-sms']);
    expect(Object.keys(REVIEW_TERMS).sort()).toEqual(['accessibility', 'booking', 'citations', 'lsa']);
  });

  it('lists what blocks sending', () => {
    const p = signingProblems({ services: [{ name: 'SEO', setupCents: null, monthlyCents: 100, scope: '' }] });
    expect(p.join(' ')).toMatch(/legal business name/);
    expect(p.join(' ')).toMatch(/Both prices for SEO/);
    expect(p.join(' ')).toMatch(/Scope for SEO/);
  });
});

describe('contracts', () => {
  it('draft → send → client signs → locked, with invoices and a won deal', async () => {
    const { repA, clientA, owner, admin } = await setup();
    const id = await readyContract(repA, clientA);

    // Clients never see drafts.
    expect((await owner.call('GET', `/api/contracts/${id}`)).status).toBe(404);
    expect((await owner.call('GET', `/api/contracts/${id}/document`)).status).toBe(404);
    expect((await (await owner.call('GET', `/api/clients/${clientA}/contracts`)).json()).contracts).toHaveLength(0);

    const sent = await repA.call('POST', `/api/contracts/${id}/send`);
    expect(sent.status).toBe(200);
    const doc = await (await owner.call('GET', `/api/contracts/${id}/document`)).text();
    // The hash the client signs is the hash of exactly what they were shown.
    expect(await sha(doc)).toBe((await sent.json()).hash);
    expect(doc).toContain('Michigan law governs');
    expect(doc).toContain('$500.00'); // deposit
    expect(doc).toContain('$1,000.00'); // monthly total
    expect(doc).toContain('$1,000.00'); // one-time after deposit

    // Staff cannot sign for the client; wrong password and stale hash are refused.
    expect((await repA.call('POST', `/api/contracts/${id}/sign`, {})).status).toBe(403);
    expect((await sign(owner, id, { password: 'wrong password' })).status).toBe(400);
    expect((await sign(owner, id, { documentHash: 'a'.repeat(64) })).status).toBe(409);

    const signed = await sign(owner, id);
    expect(signed.status).toBe(200);
    const { invoices } = await signed.json();
    expect(invoices).toHaveLength(2);

    // Locked: API refuses edits and the database refuses direct changes.
    expect((await repA.call('PATCH', `/api/contracts/${id}`, { additional: 'sneaky change' })).status).toBe(409);
    await expect(env.DB.prepare("UPDATE contracts SET data='{}' WHERE id=?").bind(id).run()).rejects.toThrow();
    expect((await sign(owner, id)).status).toBe(409);
    const signedDoc = await (await owner.call('GET', `/api/contracts/${id}/document`)).text();
    expect(signedDoc).toContain('Electronic signature: Pat Owner');

    // Automation: deposit invoice open, setup balance drafted with deposit credit, services active, deal won.
    const deposit = await env.DB.prepare("SELECT * FROM invoices WHERE contract_id=? AND kind='deposit'").bind(id).first();
    expect(deposit).toMatchObject({ status: 'open', total_cents: 50000 });
    const setupInv = await env.DB.prepare("SELECT * FROM invoices WHERE contract_id=? AND kind='setup'").bind(id).first();
    expect(setupInv).toMatchObject({ status: 'draft', total_cents: 100000 });
    const services = (await env.DB.prepare('SELECT service_id, status FROM client_services WHERE client_id=?').bind(clientA).all()).results;
    expect(services.filter((s) => s.status === 'active').map((s) => s.service_id).sort()).toEqual(['gbp', 'seo']);
    const deal = await env.DB.prepare('SELECT ps.outcome FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=?').bind(clientA).first();
    expect(deal.outcome).toBe('won');
    // Client never sees the draft setup invoice.
    const clientInvoices = await (await owner.call('GET', '/api/invoices')).json();
    expect(clientInvoices.invoices.map((i) => i.kind)).toEqual(['deposit']);
    expect((await admin.call('GET', `/api/invoices/${setupInv.id}`)).status).toBe(200);
    expect((await owner.call('GET', `/api/invoices/${setupInv.id}`)).status).toBe(404);
  });

  it('editing a sent agreement withdraws it and bumps the version', async () => {
    const { repA, clientA, owner } = await setup();
    const id = await readyContract(repA, clientA);
    await repA.call('POST', `/api/contracts/${id}/send`);
    const res = await (await repA.call('PATCH', `/api/contracts/${id}`, { additional: 'Rush delivery' })).json();
    expect(res.reopened).toBe(true);
    expect(res.contract.version).toBe(2);
    expect((await owner.call('GET', `/api/contracts/${id}`)).status).toBe(404);
  });

  it('cannot send with missing details, and reps are scoped', async () => {
    const { repA, repB, clientA } = await setup();
    const { id } = await (await repA.call('POST', `/api/clients/${clientA}/contracts`, {})).json();
    const res = await repA.call('POST', `/api/contracts/${id}/send`);
    expect(res.status).toBe(400);
    expect((await res.json()).problems.length).toBeGreaterThan(0);
    expect((await repB.call('GET', `/api/contracts/${id}`)).status).toBe(404);
    expect((await repB.call('POST', `/api/clients/${clientA}/contracts`, {})).status).toBe(404);
  });
});

describe('invoices and Clover payments', () => {
  async function openInvoice() {
    const s = await setup();
    const { id } = await (await s.repA.call('POST', `/api/clients/${s.clientA}/invoices`, { title: 'Website deposit', lines: [{ description: 'Deposit', amount: '250' }] })).json();
    expect((await s.repA.call('POST', `/api/invoices/${id}/issue`)).status).toBe(200);
    return { ...s, invoiceId: id };
  }

  it('creates a Clover checkout for the balance, and a click alone never marks it paid', async () => {
    const { owner, invoiceId } = await openInvoice();
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ href: 'https://sandbox.dev.clover.com/checkout/abc', checkoutSessionId: 'sess-1', expirationTime: Date.now() + 900000 }), { status: 200 });
    });
    const res = await owner.call('POST', `/api/invoices/${invoiceId}/checkout`);
    expect(res.status).toBe(200);
    expect((await res.json()).href).toContain('clover.com');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts');
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.shoppingCart.lineItems[0].price).toBe(25000);
    expect(calls[0].init.headers['X-Clover-Merchant-Id']).toBe('TESTMERCHANT');
    // A second click reuses the session instead of creating another.
    expect((await (await owner.call('POST', `/api/invoices/${invoiceId}/checkout`)).json()).reused).toBe(true);
    // Coming back from Clover's page changes nothing until the signed webhook arrives.
    const inv = await (await owner.call('GET', `/api/invoices/${invoiceId}`)).json();
    expect(inv.invoice.status).toBe('open');
    expect(inv.payments).toHaveLength(0);
  });

  it('records a signed webhook once, rejects bad signatures, and sends no duplicate payment', async () => {
    const { owner, invoiceId } = await openInvoice();
    await env.DB.prepare("INSERT INTO checkout_sessions (id, invoice_id, amount_cents, href, status, created_at) VALUES ('sess-9', ?, 25000, 'https://x', 'open', ?)").bind(invoiceId, Date.now()).run();
    const event = { type: 'PAYMENT', status: 'APPROVED', id: 'PAY123', merchantId: 'TESTMERCHANT', data: 'sess-9', message: 'Approved for 25000', createdTime: Date.now() };

    expect((await webhook(event, 't=1,v1=' + 'a'.repeat(64))).status).toBe(401);
    expect((await webhook(event, await signClover(JSON.stringify(event), 'wrong-secret'))).status).toBe(401);
    const old = Math.floor(Date.now() / 1000) - 7200;
    expect((await webhook(event, await signClover(JSON.stringify(event), 'test-webhook-secret', old))).status).toBe(401);
    expect((await (await owner.call('GET', `/api/invoices/${invoiceId}`)).json()).invoice.status).toBe('open');

    expect((await webhook(event)).status).toBe(200);
    expect((await webhook(event)).status).toBe(200); // Clover retry
    const inv = await (await owner.call('GET', `/api/invoices/${invoiceId}`)).json();
    expect(inv.invoice.status).toBe('paid');
    expect(inv.invoice.paid_cents).toBe(25000);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ provider: 'clover', provider_payment_id: 'PAY123', status: 'approved' });
    const outcomes = (await env.DB.prepare("SELECT outcome FROM webhook_events WHERE body LIKE '%sess-9%'").all()).results.map((r) => r.outcome);
    expect(outcomes).toContain('duplicate: already recorded');
  });

  it('a declined payment leaves the invoice open', async () => {
    const { owner, invoiceId } = await openInvoice();
    await env.DB.prepare("INSERT INTO checkout_sessions (id, invoice_id, amount_cents, href, status, created_at) VALUES ('sess-d', ?, 25000, 'https://x', 'open', ?)").bind(invoiceId, Date.now()).run();
    await webhook({ type: 'PAYMENT', status: 'DECLINED', id: 'PAYD', data: 'sess-d' });
    const inv = await (await owner.call('GET', `/api/invoices/${invoiceId}`)).json();
    expect(inv.invoice.status).toBe('open');
    expect(inv.payments[0].status).toBe('declined');
    expect(inv.pay.available).toBe(true);
  });

  it('only admins record manual payments or void; clients and other reps are kept out', async () => {
    const { admin, repA, repB, owner, invoiceId } = await openInvoice();
    expect((await repA.call('POST', `/api/invoices/${invoiceId}/payments`, { amount: '100' })).status).toBe(403);
    expect((await owner.call('POST', `/api/invoices/${invoiceId}/payments`, { amount: '100' })).status).toBe(403);
    expect((await repB.call('GET', `/api/invoices/${invoiceId}`)).status).toBe(404);
    expect((await admin.call('POST', `/api/invoices/${invoiceId}/payments`, { amount: '300' })).status).toBe(400);
    expect((await admin.call('POST', `/api/invoices/${invoiceId}/payments`, { amount: '100', method: 'check', reference: '#1042' })).status).toBe(200);
    expect((await admin.call('POST', `/api/invoices/${invoiceId}/void`, { reason: 'x' })).status).toBe(409);
    const inv = await (await owner.call('GET', `/api/invoices/${invoiceId}`)).json();
    expect(inv.balanceCents).toBe(15000);
    expect(inv.payments[0].recorded_by).toBeUndefined();
  });

  it('integration status never claims connected without a successful test', async () => {
    const { admin } = await setup();
    const before = await (await admin.call('GET', '/api/settings/integrations')).json();
    expect(['untested', 'connected', 'failing']).toContain(before.clover.state);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"Unauthorized"}', { status: 401 }));
    expect((await admin.call('POST', '/api/settings/integrations/clover/test')).status).toBe(502);
    expect((await (await admin.call('GET', '/api/settings/integrations')).json()).clover.state).toBe('failing');
    expect(cloverConfig({}).ready).toBe(false);
  });

  it('verifies Clover signatures exactly', async () => {
    const body = '{"a":1}';
    expect(await verifyCloverSignature('s', await signClover(body, 's'), body)).toBe(true);
    expect(await verifyCloverSignature('s', await signClover(body, 's'), '{"a":2}')).toBe(false);
    expect(await verifyCloverSignature('', 't=1,v1=' + 'a'.repeat(64), body)).toBe(false);
  });
});

describe('files', () => {
  const put = (who, clientId, bytes, q, type) => who.call ? SELF.fetch(`${BASE}/api/clients/${clientId}/media?${new URLSearchParams(q)}`, {
    method: 'PUT', headers: { Origin: BASE, 'Content-Type': type, Cookie: who.cookie }, body: bytes }) : null;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it('keeps internal files from clients and other reps', async () => {
    const { repA, repB, clientA } = await setup();
    const shared = await (await put(repA, clientA, png, { filename: 'logo.png', visibility: 'shared', purpose: 'logo' }, 'image/png')).json();
    const internal = await (await put(repA, clientA, png, { filename: 'raw-data.png', visibility: 'internal' }, 'image/png')).json();
    expect((await put(repA, clientA, png, { filename: 'x.png' }, 'image/png')).status).toBe(400); // must choose visibility
    expect((await put(repA, clientA, new TextEncoder().encode('<script>'), { filename: 'evil.png', visibility: 'shared' }, 'image/png')).status).toBe(415);
    expect((await put(repA, clientA, png, { filename: 'run.exe', visibility: 'shared' }, 'application/x-msdownload')).status).toBe(415);

    const ownerCookie = await (async () => {
      const admin = await as('admin');
      const o = await clientLogin(admin, clientA, `o2-${clientA.slice(0, 6)}@alpha.com`);
      return o;
    })();
    const list = await (await ownerCookie.call('GET', `/api/clients/${clientA}/media`)).json();
    expect(list.media.map((m) => m.id)).toEqual([shared.id]);
    expect((await ownerCookie.call('GET', `/api/media/${internal.id}/file`)).status).toBe(404);
    const file = await ownerCookie.call('GET', `/api/media/${shared.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('Cache-Control')).toContain('no-store');
    expect(file.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect((await repB.call('GET', `/api/media/${shared.id}/file`)).status).toBe(404);
    expect((await repB.call('DELETE', `/api/media/${shared.id}`)).status).toBe(404);
  });
});
