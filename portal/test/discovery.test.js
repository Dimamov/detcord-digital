import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as, api } from './helpers.js';
import { MASTER } from '../src/shared/discovery/master.js';
import { SERVICE_MODULES } from '../src/shared/discovery/services.js';
import { INDUSTRIES } from '../src/shared/discovery/industries.js';
import { RECOMMENDATIONS, INTAKE } from '../src/shared/discovery/playbook.js';
import { SERVICES, serviceById } from '../src/shared/services.js';
import { needsReview, termsFor } from '../src/shared/contract.js';
import { computeResult } from '../src/shared/discovery/engine.js';

describe('discovery content', () => {
  it('has 42 industries and a follow-up module for every service', () => {
    expect(INDUSTRIES).toHaveLength(42);
    for (const s of SERVICES) expect(SERVICE_MODULES[s.id], s.id).toBeTruthy();
  });

  it('uses unique question ids and only real service ids', () => {
    const ids = [
      ...MASTER.sections.flatMap((s) => s.questions),
      ...Object.values(SERVICE_MODULES).flatMap((m) => m.questions),
      ...INDUSTRIES.flatMap((i) => i.questions),
    ].map((q) => q.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    const serviceIds = new Set(SERVICES.map((s) => s.id));
    for (const i of INDUSTRIES) for (const s of i.keyServices) expect(serviceIds.has(s), `${i.id}: ${s}`).toBe(true);
    for (const r of RECOMMENDATIONS) for (const s of r.services) expect(serviceIds.has(s), s).toBe(true);
    const masterIds = new Set(MASTER.sections.flatMap((s) => s.questions.map((q) => q.id)));
    for (const q of INTAKE.questions) if (q.mapTo) expect(masterIds.has(q.mapTo), q.mapTo).toBe(true);
  });

  it('scores a hot lead A and recommends lead response when calls are missed', () => {
    const r = computeResult({ pain_level: 5, timeline: 'now', budget: '3000-6000', attendees_dm: 'yes', capacity: 'yes', avg_ticket: 900, missed_calls: 'many', rank_check: 'not-found' }, 'plumbing');
    expect(r.score.grade).toBe('A');
    expect(r.recommended.slice(0, 3).map((x) => x.serviceId)).toContain('lead-response');
    const cold = computeResult({ timeline: 'later', budget: 'lt750', attendees_dm: 'other', capacity: 'no' }, null);
    expect(cold.score.grade).toBe('C');
    expect(cold.redFlags.length).toBeGreaterThan(2);
  });
});

describe('discovery flow', () => {
  it('intake prefill → discovery → complete creates recommendations and a follow-up task', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Charlie HVAC', industry: 'hvac', repId: rep.id })).json();

    const intake = await (await rep.call('POST', `/api/clients/${clientId}/intake`, {})).json();
    const link = intake.url.split('#')[1];
    const check = await (await api('POST', '/api/intake/check', { link })).json();
    expect(check.business).toBe('Charlie HVAC');
    const answers = { top_services: 'Furnace replacements', service_area: 'Troy, Rochester', lead_sources: ['referral'], biggest_problem: 'Phones ring off the hook in winter and we miss calls', goal_12mo: '+30% installs', monthly_spend: 'lt500', timeline: 'now' };
    expect((await api('POST', '/api/intake/submit', { link, answers })).status).toBe(200);
    expect((await api('POST', '/api/intake/submit', { link, answers })).status).toBe(410);

    const { id, prefilled } = await (await rep.call('POST', '/api/discoveries', { clientId })).json();
    expect(prefilled).toBeGreaterThanOrEqual(6);
    const save = await (await rep.call('PATCH', `/api/discoveries/${id}`, { answers: { pain_level: 5, budget: '1500-3000', attendees_dm: 'yes', missed_calls: 'many', not_a_question: 'dropped' } })).json();
    expect(save.preview.score.total).toBeGreaterThan(0);
    const stored = await env.DB.prepare('SELECT answers FROM discoveries WHERE id=?').bind(id).first();
    expect(JSON.parse(stored.answers).not_a_question).toBeUndefined();

    const done = await (await rep.call('POST', `/api/discoveries/${id}/complete`, {})).json();
    expect(done.result.score.grade).toMatch(/[AB]/);
    const record = await (await rep.call('GET', `/api/clients/${clientId}`)).json();
    expect(record.services.length).toBeGreaterThan(0);
    expect(record.tasks.some((t) => /Follow up|Prepare proposal/.test(t.title))).toBe(true);
    expect(record.client.status).toBe('prospect');
  });
});

describe('service catalog', () => {
  it('splits email and SMS marketing and retires email-sms without deleting it', async () => {
    const ids = SERVICES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['email', 'sms']));
    expect(ids).not.toContain('email-sms');
    expect(serviceById.email).toMatchObject({ name: 'Email marketing', category: 'convert' });
    expect(serviceById.email.description).toMatch(/CAN-SPAM/);
    expect(serviceById.sms).toMatchObject({ name: 'SMS marketing', category: 'convert' });
    expect(serviceById['email-sms']).toMatchObject({ active: false, replacedBy: ['email', 'sms'] });
    expect(SERVICE_MODULES['email-sms']).toBeUndefined();

    const rows = Object.fromEntries((await env.DB.prepare("SELECT id, name, category, active FROM services WHERE id IN ('email','sms','email-sms')").all()).results.map((r) => [r.id, r]));
    expect(rows.email).toMatchObject({ name: 'Email marketing', category: 'convert', active: 1 });
    expect(rows.sms).toMatchObject({ name: 'SMS marketing', category: 'convert', active: 1 });
    expect(rows['email-sms']).toMatchObject({ active: 0 });
    const rep = await as('rep');
    const catalog = (await (await rep.call('GET', '/api/services')).json()).services;
    expect(catalog.filter((s) => s.active).map((s) => s.id)).toEqual(expect.arrayContaining(['email', 'sms']));
    expect(catalog.find((s) => s.id === 'email-sms').active).toBe(0);

    // Both have agreement wording; version 1 agreements flag them because the wording postdates version 1.
    expect(needsReview('email')).toBe(true);
    expect(needsReview('sms')).toBe(true);
    expect(termsFor('email')).toMatch(/^Approved email campaigns/);
    expect(termsFor('sms')).toMatch(/^Approved text message campaigns/);
  });
});
