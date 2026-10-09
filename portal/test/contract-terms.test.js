import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as, PASSWORD } from './helpers.js';
import {
  renderContract, signingProblems, contractTotals, generalTermsFor, termsFor, GENERAL_TERMS, SERVICE_TERMS, REVIEW_TERMS, SIGNING_STATEMENT,
  SIGNING_STATEMENT_2026_10, EARLY_TERMINATION, TERMS_2026_10,
} from '../src/shared/contract.js';

const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// A version 1 agreement as stored before terms versions existed: no termsVersion, no term fields.
const V1_DATA = {
  providerName: 'Detcord Digital LLC', providerAddress: '1 Main St, Detroit, MI 48226', providerEmail: 'info@detcorddigital.com', providerSigner: 'Dima',
  clientLegalName: 'Alpha Plumbing LLC', clientAddress: '10 Elm St, Troy, MI', clientEmail: 'alpha@example.com',
  services: [{ serviceId: 'seo', name: 'Local SEO', setupCents: 150000, monthlyCents: 80000, scope: '10 service pages' }, { serviceId: 'citations', name: 'Citations', setupCents: 0, monthlyCents: 20000, scope: 'Top 40 directories' }],
  depositCents: 50000, paymentTerms: 'Half at signing', thirdParty: '', additional: 'Rush delivery', paymentDays: 15, feedbackDays: 10, monthlyStart: '2026-11-01',
  attachments: [{ id: 'm1', filename: 'logo.png', contentType: 'image/png' }],
};
const V1_DOC = { number: 'DD-2026-0001', version: 2, title: 'Alpha agreement', status: 'sent', createdAt: 1790000000000, issuedAt: 1790000100000, data: V1_DATA, origin: 'https://portal.test' };
const SIG = { id: 'sig1', name: 'Pat Owner', title: 'Owner', email: 'pat@alpha.com', at: 1790000200000, consent: SIGNING_STATEMENT, documentHash: 'abc', ip: '1.2.3.4', userAgent: 'UA' };
const REVISED = (extra = {}) => ({ ...V1_DOC, data: { ...V1_DATA, termsVersion: TERMS_2026_10, venueCounty: 'Oakland', ...extra } });

// Hashes taken from the renderer before terms versions were added. Signed agreements reference this text.
describe('version 1 terms', () => {
  it('text and rendered documents are byte-identical to before', async () => {
    expect(await sha(JSON.stringify(GENERAL_TERMS))).toBe('7321ef64671ceb18ba67e5b89e8431f90ec9c8aecbf01816830b01c27a7f6753');
    expect(await sha(JSON.stringify(SERVICE_TERMS))).toBe('c3e1a7c1531518fa57322d57993163c09dc646a50a30506a2bb2e085ad0b48f5');
    expect(await sha(JSON.stringify(REVIEW_TERMS))).toBe('2d578fd0a05b292cecaf22f2cabc3dccc01293ced9c70ff556d0f6ce3dda956c');
    expect(await sha(SIGNING_STATEMENT)).toBe('c11ac61693e37598329a3703b6c19b96eec0ca75e6676c3d0e06121ce3d8c359');
    expect(await sha(renderContract(V1_DOC))).toBe('8a3d96b90ccebbf52381b34cfd1c690521374d134addb0b5bbe2e94c71480cf1');
    expect(await sha(renderContract({ ...V1_DOC, status: 'signed' }, SIG))).toBe('458b3f9a7aa6f73c5dc3d2af9e4a7c6a172bdc81bf3eaf199258f4c047f04af8');
    expect(await sha(renderContract({ ...V1_DOC, status: 'draft', issuedAt: null }))).toBe('e67c44104ee0b478f56be869314ab89f4a4656b933cc604340c3c2627610992d');
    // Explicit version 1 with month-to-month defaults renders the same document.
    expect(renderContract({ ...V1_DOC, data: { ...V1_DATA, termsVersion: '1', termMonths: 0, termDiscountPct: 0, earlyTermination: 'half-remaining' } })).toBe(renderContract(V1_DOC));
  });

  it('a fixed term is added as additional scope naming the section it changes, with no early termination wording', () => {
    const html = renderContract({ ...V1_DOC, data: { ...V1_DATA, termMonths: 6, termDiscountPct: 10, earlyTermination: 'all-remaining' } });
    expect(html).toContain('Change to “Term and cancellation”: the monthly services in this agreement have a minimum term of 6 months');
    expect(html).toContain('10% term discount');
    expect(html).toContain('Rush delivery');
    expect(html).toContain('<td>Term</td><td class="n">6 months from the monthly billing start date, then month to month</td>');
    for (const rule of Object.values(EARLY_TERMINATION)) expect(html).not.toContain(rule.text);
    expect(html).toContain(GENERAL_TERMS[2][1]);
    expect(html).not.toContain('Michigan law, venue and disputes');
  });
});

describe('version 2026-10 terms', () => {
  it('render their own sections, signing statement and the county', () => {
    const html = renderContract(REVISED());
    expect(html).toContain('Terms 2026-10');
    expect(html).toContain('state courts for Oakland County, Michigan');
    expect(html).toContain('simple interest at 7% per year');
    expect(html).toContain(SIGNING_STATEMENT_2026_10);
    expect(html).not.toContain(GENERAL_TERMS[0][1]);
    expect(html).toContain('<td>Term</td><td class="n">Month to month</td>');
    expect(html).toContain('No minimum term or early termination fee applies.');
    expect(termsFor('email-sms', TERMS_2026_10)).toContain('Email, text message and phone marketing');
    expect(termsFor('email-sms')).toBe(SERVICE_TERMS['email-sms']);
    // Email and SMS marketing (split from email-sms) have wording in both versions.
    expect(termsFor('sms', TERMS_2026_10)).toContain('prior express written consent for every marketing text');
    expect(termsFor('email', TERMS_2026_10)).toContain('postal address');
    expect(termsFor('sms')).toContain('prior express written consent');
  });

  it('show the chosen early termination wording only for fixed terms', () => {
    for (const [key, rule] of Object.entries(EARLY_TERMINATION)) {
      const fixed = generalTermsFor(REVISED({ termMonths: 12, termDiscountPct: 10, earlyTermination: key }).data).find(([h]) => h === 'Term, renewal and cancellation')[1];
      expect(fixed).toContain(rule.text);
      expect(fixed).toContain('initial term of 12 months');
      expect(fixed).toContain('never renews into a new fixed term automatically');
      for (const [other, r] of Object.entries(EARLY_TERMINATION)) if (other !== key) expect(fixed).not.toContain(r.text);
      const monthToMonth = renderContract(REVISED({ earlyTermination: key }));
      expect(monthToMonth).not.toContain(rule.text);
    }
    // Default when nothing was chosen (owner's decision): 50% of the remaining monthly fees.
    expect(renderContract(REVISED({ termMonths: 3 }))).toContain(EARLY_TERMINATION['half-remaining'].text);
    expect(EARLY_TERMINATION['half-remaining'].text).toContain('50% of its remaining monthly fees, after any term discount, for the rest of the term');
  });

  it('term and discount appear in totals and the document', () => {
    const t = contractTotals({ ...V1_DATA, termMonths: 12, termDiscountPct: 10 });
    expect(t).toMatchObject({ monthly: 100000, discountPct: 10, monthlyDiscount: 10000, monthlyNet: 90000, termMonths: 12, termValue: 150000 + 90000 * 12 });
    // A discount without a fixed term is not applied.
    expect(contractTotals({ ...V1_DATA, termDiscountPct: 10 })).toMatchObject({ monthlyDiscount: 0, monthlyNet: 100000, termValue: null });
    const html = renderContract(REVISED({ termMonths: 12, termDiscountPct: 10 }));
    expect(html).toContain('Term discount (10% of monthly fees)</td><td class="n">−$100.00/mo');
    expect(html).toContain('Monthly fees after discount</td><td class="n">$900.00/mo');
    expect(html).toContain('Contract value for the term (one-time fees plus 12 months of monthly fees)</td><td class="n">$12,300.00');
  });

  it('signingProblems checks term, discount and county', () => {
    const base = { ...V1_DATA };
    expect(signingProblems(base)).toEqual([]);
    expect(signingProblems({ ...base, termMonths: 7 })).toContain('Term: month to month, or 3, 6, 9 or 12 months');
    expect(signingProblems({ ...base, termDiscountPct: 5 })).toContain('A term discount needs a fixed term');
    expect(signingProblems({ ...base, termMonths: 6, termDiscountPct: 60 })).toContain('Term discount between 0 and 50%');
    expect(signingProblems({ ...base, termMonths: 6, services: [{ ...base.services[0], monthlyCents: 0 }] })).toContain('A fixed term needs at least one monthly fee');
    expect(signingProblems({ ...base, termMonths: 6, termDiscountPct: 10 })).toEqual([]);
    expect(signingProblems({ ...base, termsVersion: TERMS_2026_10 })).toEqual(['Michigan county for disputes (Settings → Company)']);
    expect(signingProblems({ ...base, termsVersion: TERMS_2026_10, venueCounty: 'Wayne' })).toEqual([]);
  });
});

// ---- API ----------------------------------------------------------------------

async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  await admin.call('PUT', '/api/settings/company', { legalName: 'Detcord Digital LLC', address: '1 Main St, Detroit, MI 48226', signer: 'Dima', venueCounty: 'Oakland County' });
  const clientId = (await (await admin.call('POST', '/api/clients', { name: 'Alpha Plumbing', repId: rep.id, email: 'alpha@example.com', address: '10 Elm St', city: 'Troy' })).json()).id;
  return { admin, rep, clientId };
}
const SERVICES = [{ serviceId: 'seo', setup: '1500', monthly: '800', scope: '10 service pages' }];
const newDraft = async (who, clientId, body = {}) => (await (await who.call('POST', `/api/clients/${clientId}/contracts`, body)).json()).id;
const getContract = async (who, id) => (await (await who.call('GET', `/api/contracts/${id}`)).json()).contract;

// An agreement created before terms versions existed: no termsVersion in its data.
async function legacyDraft(rep, clientId) {
  const id = await newDraft(rep, clientId);
  const row = await env.DB.prepare('SELECT data FROM contracts WHERE id=?').bind(id).first();
  const { termsVersion, termMonths, termDiscountPct, ...old } = JSON.parse(row.data);
  await env.DB.prepare('UPDATE contracts SET data=? WHERE id=?').bind(JSON.stringify(old), id).run();
  return id;
}

describe('terms versions and settings', () => {
  it('new agreements use 2026-10; older ones keep version 1 until moved in the editor', async () => {
    const { rep, clientId } = await setup();
    const id = await newDraft(rep, clientId);
    expect((await getContract(rep, id)).data).toMatchObject({ termsVersion: TERMS_2026_10, termMonths: 0, termDiscountPct: 0 });

    const old = await legacyDraft(rep, clientId);
    expect((await getContract(rep, old)).data.termsVersion).toBeUndefined();
    let doc = await (await rep.call('GET', `/api/contracts/${old}/document`)).text();
    expect(doc).toContain(GENERAL_TERMS[0][1]);
    expect(doc).not.toContain('Terms 2026-10');
    // Staff move the draft to the current terms, or back, from the editor.
    expect((await rep.call('PATCH', `/api/contracts/${old}`, { termsVersion: 'nonsense' })).status).toBe(400);
    expect((await rep.call('PATCH', `/api/contracts/${old}`, { termsVersion: TERMS_2026_10 })).status).toBe(200);
    doc = await (await rep.call('GET', `/api/contracts/${old}/document`)).text();
    expect(doc).toContain('Terms 2026-10');
    expect(doc).toContain('state courts for Oakland County, Michigan');
    expect((await rep.call('PATCH', `/api/contracts/${old}`, { termsVersion: '1' })).status).toBe(200);
    expect((await getContract(rep, old)).data.termsVersion).toBe('1');
  });

  it('only admins change the early termination rule; 50% of remaining fees is the default', async () => {
    const { admin, rep } = await setup();
    await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'contracts.%'").run();
    expect(await (await rep.call('GET', '/api/settings/contracts')).json()).toEqual({ termsForNew: TERMS_2026_10, earlyTermination: 'half-remaining' });
    expect((await rep.call('PUT', '/api/settings/contracts', { earlyTermination: 'notice-only' })).status).toBe(403);
    expect((await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'nonsense' })).status).toBe(400);
    expect(await (await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'notice-only' })).json()).toMatchObject({ earlyTermination: 'notice-only' });
    await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'half-remaining' });
  });
});

describe('agreements with terms', () => {
  it('sends a fixed-term agreement, freezing the early termination rule and county', async () => {
    const { admin, rep, clientId } = await setup();
    await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'notice-only' });
    const id = await newDraft(rep, clientId);
    expect((await rep.call('PATCH', `/api/contracts/${id}`, { services: SERVICES, monthlyStart: '2026-11-01', termMonths: 7 })).status).toBe(400);
    expect((await rep.call('PATCH', `/api/contracts/${id}`, { services: SERVICES, monthlyStart: '2026-11-01', termMonths: 6, termDiscountPct: 80 })).status).toBe(400);
    const res = await (await rep.call('PATCH', `/api/contracts/${id}`, { services: SERVICES, monthlyStart: '2026-11-01', termMonths: 6, termDiscountPct: '10' })).json();
    expect(res.contract.totals).toMatchObject({ termMonths: 6, discountPct: 10, monthlyNet: 72000, termValue: 150000 + 72000 * 6 });
    expect(res.contract.termsSettings).toMatchObject({ earlyTermination: 'notice-only' });
    expect(res.contract.problems).toEqual([]);
    // The county is required by the 2026-10 terms and links to Settings → Company.
    await admin.call('PUT', '/api/settings/company', { venueCounty: '' });
    expect((await getContract(rep, id)).problems).toContain('Michigan county for disputes (Settings → Company)');
    expect((await rep.call('POST', `/api/contracts/${id}/send`)).status).toBe(400);
    await admin.call('PUT', '/api/settings/company', { venueCounty: 'Oakland County' });
    expect((await rep.call('POST', `/api/contracts/${id}/send`)).status).toBe(200);
    const row = await env.DB.prepare('SELECT data, presented_html FROM contracts WHERE id=?').bind(id).first();
    expect(JSON.parse(row.data)).toMatchObject({ termsVersion: TERMS_2026_10, earlyTermination: 'notice-only', venueCounty: 'Oakland', termMonths: 6 });
    expect(row.presented_html).toContain(EARLY_TERMINATION['notice-only'].text);
    expect(row.presented_html).toContain('state courts for Oakland County, Michigan');
    // Changing the setting later does not change the sent agreement.
    await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'all-remaining' });
    const doc = await (await rep.call('GET', `/api/contracts/${id}/document`)).text();
    expect(doc).toContain(EARLY_TERMINATION['notice-only'].text);
    await admin.call('PUT', '/api/settings/contracts', { earlyTermination: 'half-remaining' });
  });

  it('a version 1 agreement still sends and signs with version 1 text', async () => {
    const { rep, clientId } = await setup();
    const id = await legacyDraft(rep, clientId);
    await rep.call('PATCH', `/api/contracts/${id}`, { services: SERVICES, monthlyStart: '2026-11-01' });
    expect((await rep.call('POST', `/api/contracts/${id}/send`)).status).toBe(200);
    const row = await env.DB.prepare('SELECT presented_html FROM contracts WHERE id=?').bind(id).first();
    expect(row.presented_html).toContain(GENERAL_TERMS[8][1]);
    expect(row.presented_html).toContain(SIGNING_STATEMENT);
    expect(row.presented_html).not.toContain('<td>Term</td>');
  });

  it('client signs with the 2026-10 signing statement; monthly invoices apply the discount', async () => {
    const { admin, rep, clientId } = await setup();
    const invited = await (await admin.call('POST', '/api/users', { role: 'client', email: `pat-${clientId.slice(0, 6)}@alpha.com`, name: 'Pat Owner', clientId })).json();
    const { SELF } = await import('cloudflare:test');
    const act = await SELF.fetch('https://portal.test/api/auth/activate', { method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ link: invited.manualLink.split('#')[1], password: PASSWORD }) });
    const cookie = act.headers.get('Set-Cookie').split(';')[0];
    const owner = { call: (method, path, body) => SELF.fetch(`https://portal.test${path}`, { method, headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }) };

    const id = await newDraft(rep, clientId);
    await rep.call('PATCH', `/api/contracts/${id}`, { services: SERVICES, monthlyStart: '2026-11-01', termMonths: 12, termDiscountPct: 5 });
    expect((await rep.call('POST', `/api/contracts/${id}/send`)).status).toBe(200);
    const sent = await getContract(owner, id);
    expect(sent.termsSettings).toBeUndefined();
    expect((await owner.call('POST', `/api/contracts/${id}/sign`, { name: 'Pat Owner', title: 'Owner', password: PASSWORD, consent: true, documentHash: sent.document_hash })).status).toBe(200);
    const signed = await env.DB.prepare('SELECT signed_html FROM contracts WHERE id=?').bind(id).first();
    expect(signed.signed_html.split(SIGNING_STATEMENT_2026_10).length).toBe(3);

    const inv = await (await rep.call('POST', `/api/clients/${clientId}/invoices`, { monthlyFromContract: id, period: 'November 2026' })).json();
    const lines = (await env.DB.prepare('SELECT kind, description, unit_cents FROM invoice_lines WHERE invoice_id=? ORDER BY position').bind(inv.id).all()).results;
    expect(lines.map((l) => [l.kind, l.unit_cents])).toEqual([['monthly', 80000], ['credit', -4000]]);
    expect(lines[1].description).toBe('Term discount, 5% (November 2026)');
  });

  it('templates and duplicates carry the term and discount', async () => {
    const { admin, rep, clientId } = await setup();
    const { id: templateId } = await (await admin.call('POST', '/api/contract-templates', { name: 'Year of SEO', services: SERVICES, termMonths: 12, termDiscountPct: 8 })).json();
    const tpl = (await (await rep.call('GET', '/api/contract-templates')).json()).templates.find((t) => t.id === templateId);
    expect(tpl.data).toMatchObject({ termMonths: 12, termDiscountPct: 8 });
    expect(tpl.totals.termMonths).toBe(12);
    const id = await newDraft(rep, clientId, { from: 'template', templateId });
    expect((await getContract(rep, id)).data).toMatchObject({ termMonths: 12, termDiscountPct: 8, termsVersion: TERMS_2026_10 });
    const copy = (await (await rep.call('POST', `/api/contracts/${id}/duplicate`)).json()).id;
    expect((await getContract(rep, copy)).data).toMatchObject({ termMonths: 12, termDiscountPct: 8, termsVersion: TERMS_2026_10 });
  });
});
