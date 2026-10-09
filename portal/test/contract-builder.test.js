import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as, PASSWORD } from './helpers.js';

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
  await admin.call('PUT', '/api/settings/company', { legalName: 'Detcord Digital LLC', address: '1 Main St, Detroit, MI 48226', signer: 'Dima' });
  const mk = async (name, repId) => (await (await admin.call('POST', '/api/clients', { name, repId, email: `${name.split(' ')[0].toLowerCase()}@example.com`, address: '10 Elm St', city: 'Troy' })).json()).id;
  const clientA = await mk('Alpha Plumbing', repA.id);
  const clientB = await mk('Bravo Dental', repB.id);
  const owner = await clientLogin(admin, clientA, `owner-${clientA.slice(0, 6)}@alpha.com`);
  const ownerB = await clientLogin(admin, clientB, `owner-${clientB.slice(0, 6)}@bravo.com`);
  return { admin, repA, repB, clientA, clientB, owner, ownerB };
}

const TERMS = {
  services: [{ serviceId: 'seo', setup: '1500', monthly: '800', scope: '10 service pages, monthly local SEO' }, { serviceId: 'gbp', setup: '0', monthly: '200', scope: 'Weekly posts' }],
  deposit: '500', paymentTerms: 'Half at signing, half at launch', thirdParty: 'Ad spend billed by Google', additional: 'Rush delivery', paymentDays: 20, feedbackDays: 7,
};

async function sentContract(rep, clientId) {
  const { id } = await (await rep.call('POST', `/api/clients/${clientId}/contracts`, {})).json();
  expect((await rep.call('PATCH', `/api/contracts/${id}`, { ...TERMS, monthlyStart: '2026-11-01' })).status).toBe(200);
  expect((await rep.call('POST', `/api/contracts/${id}/send`)).status).toBe(200);
  return id;
}

const get = async (who, id) => (await (await who.call('GET', `/api/contracts/${id}`)).json());

describe('agreement templates', () => {
  it('only admins create, edit and archive; reps see active ones', async () => {
    const { admin, repA, owner } = await setup();
    expect((await repA.call('POST', '/api/contract-templates', { name: 'Rep package', ...TERMS })).status).toBe(403);
    const res = await admin.call('POST', '/api/contract-templates', { name: 'Local SEO starter', description: 'Small trades', ...TERMS });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await repA.call('PUT', `/api/contract-templates/${id}`, { name: 'Changed' })).status).toBe(403);
    expect((await owner.call('GET', '/api/contract-templates')).status).toBe(403);

    let list = (await (await repA.call('GET', '/api/contract-templates')).json()).templates;
    const t = list.find((x) => x.id === id);
    expect(t.data.services.map((s) => [s.serviceId, s.setupCents, s.monthlyCents])).toEqual([['seo', 150000, 80000], ['gbp', 0, 20000]]);
    expect(t.data).toMatchObject({ depositCents: 50000, paymentDays: 20, feedbackDays: 7, paymentTerms: 'Half at signing, half at launch' });
    expect(t.data.clientLegalName).toBeUndefined();

    expect((await admin.call('PUT', `/api/contract-templates/${id}`, { name: 'Local SEO plus', deposit: '600' })).status).toBe(200);
    expect((await admin.call('PUT', `/api/contract-templates/${id}`, { archived: true })).status).toBe(200);
    list = (await (await repA.call('GET', '/api/contract-templates')).json()).templates;
    expect(list.some((x) => x.id === id)).toBe(false);
    const all = (await (await admin.call('GET', '/api/contract-templates?archived=1')).json()).templates;
    expect(all.find((x) => x.id === id)).toMatchObject({ name: 'Local SEO plus', data: { depositCents: 60000 } });
    // An archived template cannot start a new agreement.
    expect((await admin.call('POST', `/api/clients/${(await setup()).clientA}/contracts`, { from: 'template', templateId: id })).status).toBe(404);
  });

  it('save as template is admin-only and copies terms, never parties or attachments', async () => {
    const { admin, repA, clientA } = await setup();
    const { id } = await (await repA.call('POST', `/api/clients/${clientA}/contracts`, {})).json();
    await repA.call('PATCH', `/api/contracts/${id}`, { ...TERMS, clientLegalName: 'Alpha Plumbing LLC' });
    expect((await repA.call('POST', `/api/contracts/${id}/template`, { name: 'From rep' })).status).toBe(403);
    const res = await admin.call('POST', `/api/contracts/${id}/template`, { name: 'Alpha package' });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT data FROM contract_templates WHERE id=?').bind((await res.json()).id).first();
    const data = JSON.parse(row.data);
    expect(Object.keys(data).sort()).toEqual(['additional', 'depositCents', 'feedbackDays', 'paymentDays', 'paymentTerms', 'services', 'thirdParty']);
    expect(data.additional).toBe('Rush delivery');
  });
});

describe('starting an agreement', () => {
  it('from a template copies its terms and takes parties from the client', async () => {
    const { admin, repA, clientA } = await setup();
    const { id: templateId } = await (await admin.call('POST', '/api/contract-templates', { name: 'Package', ...TERMS })).json();
    const res = await repA.call('POST', `/api/clients/${clientA}/contracts`, { from: 'template', templateId });
    expect(res.status).toBe(201);
    const { contract } = await get(repA, (await res.json()).id);
    expect(contract.template_id).toBe(templateId);
    expect(contract.data).toMatchObject({
      clientLegalName: 'Alpha Plumbing', clientEmail: 'alpha@example.com', clientAddress: '10 Elm St, Troy, MI',providerName: 'Detcord Digital LLC', providerSigner: 'Dima',
      depositCents: 50000, paymentTerms: 'Half at signing, half at launch', thirdParty: 'Ad spend billed by Google', additional: 'Rush delivery', paymentDays: 20, feedbackDays: 7, attachments: [],
    });
    expect(contract.data.services.map((s) => s.scope)).toEqual(['10 service pages, monthly local SEO', 'Weekly posts']);
  });

  it('blank starts with no services; unknown starting points are rejected', async () => {
    const { repA, clientA } = await setup();
    const { id } = await (await repA.call('POST', `/api/clients/${clientA}/contracts`, { from: 'blank' })).json();
    const { contract } = await get(repA, id);
    expect(contract.data.services).toEqual([]);
    expect(contract.data.clientLegalName).toBe('Alpha Plumbing');
    expect((await repA.call('POST', `/api/clients/${clientA}/contracts`, { from: 'nonsense' })).status).toBe(400);
    expect((await repA.call('POST', `/api/clients/${clientA}/contracts`, { from: 'template', templateId: 'missing' })).status).toBe(404);
  });
});

describe('duplicating', () => {
  it('copies terms into a new draft with a new number, never signatures or hashes', async () => {
    const { repA, repB, clientA, owner } = await setup();
    const id = await sentContract(repA, clientA);
    const { contract: orig } = await get(owner, id);
    expect((await owner.call('POST', `/api/contracts/${id}/sign`, { name: 'Pat Owner', title: 'Owner', password: PASSWORD, consent: true, documentHash: orig.document_hash })).status).toBe(200);

    expect((await owner.call('POST', `/api/contracts/${id}/duplicate`)).status).toBe(403);
    expect((await repB.call('POST', `/api/contracts/${id}/duplicate`)).status).toBe(404);
    const res = await repA.call('POST', `/api/contracts/${id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = await res.json();
    const row = await env.DB.prepare('SELECT * FROM contracts WHERE id=?').bind(copy.id).first();
    expect(row.number).not.toBe(orig.number);
    expect(copy.number).toBe(row.number);
    expect(row).toMatchObject({ status: 'draft', version: 1, presented_html: null, signed_html: null, document_hash: null, signed_at: null, signer_name: null, signature_id: null, issued_at: null, copied_from: id });
    const data = JSON.parse(row.data);
    expect(data.services.map((s) => s.setupCents)).toEqual([150000, 0]);
    expect(data.additional).toBe('Rush delivery');
    const log = await env.DB.prepare("SELECT summary FROM activity WHERE client_id=? AND summary LIKE 'Duplicated%'").bind(clientA).first();
    expect(log.summary).toBe(`Duplicated ${orig.number} as new draft ${row.number}`);
  });
});

describe('client change requests', () => {
  it('a client asks for changes on a sent agreement; staff see it', async () => {
    const { repA, clientA, owner } = await setup();
    const id = await sentContract(repA, clientA);
    const before = (await env.DB.prepare('SELECT presented_html, document_hash FROM contracts WHERE id=?').bind(id).first());
    expect((await owner.call('POST', `/api/contracts/${id}/changes`, { note: '  ' })).status).toBe(400);
    const res = await owner.call('POST', `/api/contracts/${id}/changes`, { note: 'Please start monthly billing in December.' });
    expect(res.status).toBe(201);
    // Email isn't configured in tests, and the response says so.
    expect((await res.json()).emailed).toBe(0);
    const staff = await get(repA, id);
    expect(staff.changeRequests).toHaveLength(1);
    expect(staff.changeRequests[0]).toMatchObject({ note: 'Please start monthly billing in December.', author_name: 'Pat Owner', version: 1 });
    expect(staff.contract.status).toBe('sent');
    const after = (await env.DB.prepare('SELECT presented_html, document_hash FROM contracts WHERE id=?').bind(id).first());
    expect(after).toEqual(before);
    const list = (await (await repA.call('GET', `/api/clients/${clientA}/contracts`)).json()).contracts;
    expect(list.find((c) => c.id === id).change_requests).toBe(1);
    expect((await get(owner, id)).changeRequests[0].author_id).toBeUndefined();
    const log = await env.DB.prepare("SELECT summary FROM activity WHERE client_id=? AND summary LIKE '%asked for changes%'").bind(clientA).first();
    expect(log.summary).toContain('Pat Owner asked for changes');
    const mail = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_emails WHERE subject LIKE 'Changes requested:%'").first();
    expect(mail.n).toBeGreaterThan(0);
  });

  it('drafts and other clients get 404; staff cannot file requests', async () => {
    const { repA, repB, clientA, clientB, owner, ownerB } = await setup();
    const { id: draft } = await (await repA.call('POST', `/api/clients/${clientA}/contracts`, {})).json();
    expect((await owner.call('POST', `/api/contracts/${draft}/changes`, { note: 'x' })).status).toBe(404);
    const other = await sentContract(repB, clientB);
    expect((await owner.call('POST', `/api/contracts/${other}/changes`, { note: 'x' })).status).toBe(404);
    expect((await ownerB.call('POST', `/api/contracts/${other}/changes`, { note: 'ok' })).status).toBe(201);
    expect((await repB.call('POST', `/api/contracts/${other}/changes`, { note: 'x' })).status).toBe(403);
  });
});

describe('void and redraft', () => {
  it('voids the sent agreement with "Changes requested" and opens a draft copy', async () => {
    const { repA, repB, clientA, owner } = await setup();
    const id = await sentContract(repA, clientA);
    await owner.call('POST', `/api/contracts/${id}/changes`, { note: 'Drop the blog posts.' });
    expect((await owner.call('POST', `/api/contracts/${id}/redraft`)).status).toBe(403);
    expect((await repB.call('POST', `/api/contracts/${id}/redraft`)).status).toBe(404);
    const res = await repA.call('POST', `/api/contracts/${id}/redraft`);
    expect(res.status).toBe(201);
    const copy = await res.json();
    const old = await env.DB.prepare('SELECT status, void_reason FROM contracts WHERE id=?').bind(id).first();
    expect(old).toEqual({ status: 'void', void_reason: 'Changes requested' });
    const { contract } = await get(repA, copy.id);
    expect(contract).toMatchObject({ status: 'draft', copied_from: id, document_hash: null });
    // Already void: no second redraft, and the client can no longer ask on it.
    expect((await repA.call('POST', `/api/contracts/${id}/redraft`)).status).toBe(409);
    expect((await owner.call('POST', `/api/contracts/${id}/changes`, { note: 'more' })).status).toBe(409);
    // Drafts are never voided this way.
    expect((await repA.call('POST', `/api/contracts/${copy.id}/redraft`)).status).toBe(409);
  });
});
