import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { as, api } from './helpers.js';
import { auditToAnswers, prefillCandidates, applyPrefill, applyClientAnswers } from '../src/shared/discovery/prefill.js';
import { buildRecap } from '../src/shared/discovery/recap.js';
import { questionnaireIds } from '../src/shared/discovery/questionnaire.js';

const json = (res) => res.json();

async function setup(extra = {}) {
  const admin = await as('admin');
  const rep = await as('rep');
  const { id: clientId } = await json(await admin.call('POST', '/api/clients', { name: 'Delta Plumbing', industry: 'plumbing', website: 'https://delta.example', city: 'Troy', repId: rep.id, ...extra }));
  return { admin, rep, clientId };
}

async function addAudit(clientId, result) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO audits (id, client_id, url, status, score, result, created_at, finished_at) VALUES (?,?,?,'done',?,?,?,?)")
    .bind(id, clientId, 'https://delta.example/', 61, JSON.stringify({ overall: 61, findings: [], coverage: { google: 'skipped' }, ...result }), Date.now(), Date.now()).run();
  return id;
}

const AUDIT = {
  speed: { mobile: { scores: { performance: 42 } }, desktop: { scores: { performance: 88 } } },
  facts: { title: 'Delta' },
  findings: [{ id: 'viewport', severity: 'critical' }],
  coverage: { google: 'checked' },
  google: { profile: { name: 'Delta Plumbing', rating: 4.6, reviews: 38 } },
};

describe('website check facts', () => {
  it('map onto the matching discovery questions, and skipped checks map to nothing', () => {
    expect(auditToAnswers(AUDIT)).toEqual({ speed_mobile: 42, speed_desktop: 88, mobile_friendly: false, gbp_exists: true, reviews_count: '38 Google reviews, 4.6 average rating' });
    expect(auditToAnswers({ ...AUDIT, findings: [], google: { profile: null } })).toMatchObject({ mobile_friendly: true, gbp_exists: false, gbp_claimed: 'no' });
    expect(auditToAnswers({ coverage: { google: 'skipped' }, speed: { mobile: null, desktop: null }, facts: null, findings: [] })).toEqual({});
  });

  it('never replace an answer the rep or the client gave', () => {
    const state = { answers: { speed_mobile: 70, reviews_count: null, gbp_exists: true }, marks: { gbp_exists: { source: 'client' } } };
    const changed = applyPrefill(state, prefillCandidates({ audit: { result: AUDIT } }));
    expect(state.answers.speed_mobile).toBe(70); // typed by the rep
    expect(state.answers.reviews_count).toBeNull(); // cleared by the rep
    expect(state.marks.gbp_exists.source).toBe('client');
    expect(changed.sort()).toEqual(['mobile_friendly', 'speed_desktop']);
    expect(state.marks.speed_desktop.source).toBe('audit');
  });
});

describe('discovery recap', () => {
  it('shows answers saved mid-call, grouped by section, with what is still to ask', async () => {
    const { rep, clientId } = await setup();
    const { id } = await json(await rep.call('POST', '/api/discoveries', { clientId }));
    // Two autosaves in flight at once must not drop each other's answers.
    await Promise.all([
      rep.call('PATCH', `/api/discoveries/${id}`, { answers: { trigger: 'Saw a competitor ranking above us' } }),
      rep.call('PATCH', `/api/discoveries/${id}`, { answers: { attendees_dm: 'yes', avg_ticket: 1200 } }),
      rep.call('PATCH', `/api/discoveries/${id}`, { answers: { lead_sources: ['referral', 'google-maps'] } }),
    ]);
    const r = await json(await rep.call('GET', `/api/discoveries/${id}/recap`));
    const items = Object.fromEntries(r.recap.sections.flatMap((s) => s.items.map((i) => [i.id, i])));
    expect(items.trigger.text).toBe('Saw a competitor ranking above us');
    expect(items.attendees_dm.text).toBe('Yes, the decision maker is here');
    expect(items.avg_ticket.text).toBe('$1,200');
    expect(items.lead_sources.text).toBe('Referrals and word of mouth, Google Maps / Business Profile');
    expect(r.recap.sections.find((s) => s.id === 'open').items.map((i) => i.id)).toContain('trigger');
    expect(r.recap.missing.some((m) => m.id === 'budget')).toBe(true);
    expect(r.recap.missing.some((m) => m.id === 'trigger')).toBe(false);
    expect(r.result.score.dimensions.find((d) => d.id === 'authority').score).toBe(4);
    expect(r.text).toContain('Saw a competitor ranking above us');
    expect(r.text).toContain('STILL TO ASK');
    expect(r.email.body).toContain('Delta Plumbing');
  });

  it('prefills from the client record and website check, marked until the rep confirms or edits', async () => {
    const { rep, clientId } = await setup();
    const { id, prefilled } = await json(await rep.call('POST', '/api/discoveries', { clientId }));
    expect(prefilled).toBe(3);
    await rep.call('PATCH', `/api/discoveries/${id}`, { answers: { website: 'delta-plumbing.com', city: null } });
    // A check that finishes after the call started still lands, next time the discovery opens.
    await addAudit(clientId, AUDIT);
    const { discovery: d } = await json(await rep.call('GET', `/api/discoveries/${id}`));
    expect(d.answers).toMatchObject({ business_name: 'Delta Plumbing', website: 'delta-plumbing.com', city: null, speed_mobile: 42, mobile_friendly: false, gbp_exists: true });
    expect(d.marks.business_name.source).toBe('client-record');
    expect(d.marks.speed_mobile.source).toBe('audit');
    expect(d.marks.industry.source).toBe('client-record');
    expect(d.marks.website).toBeUndefined();
    const saved = await json(await rep.call('PATCH', `/api/discoveries/${id}`, { confirm: ['business_name', 'industry'] }));
    expect(saved.marks.business_name).toBeUndefined();
    expect(saved.marks.industry).toBeUndefined();
    expect(saved.marks.speed_mobile.source).toBe('audit');
    // The website-check facts feed the recommendations.
    expect(saved.preview.recommended.find((x) => x.serviceId === 'web').reasons).toContain('The website doesn’t work well on phones.');
  });

  it('returns the full recap when the call is completed, and keeps the result current after edits', async () => {
    const { rep, clientId } = await setup();
    const { id } = await json(await rep.call('POST', '/api/discoveries', { clientId }));
    await rep.call('PATCH', `/api/discoveries/${id}`, { answers: { biggest_problem: 'Missed calls after hours', timeline: 'now', budget: '3000-6000', attendees_dm: 'yes', pain_level: 5 } });
    const done = await json(await rep.call('POST', `/api/discoveries/${id}/complete`, {}));
    expect(done.result.score.grade).toBeTruthy();
    expect(done.recap.sections.flatMap((s) => s.items).find((i) => i.id === 'biggest_problem').text).toBe('Missed calls after hours');
    expect(done.text).toContain(`Lead score: ${done.result.score.grade}`);
    const after = await json(await rep.call('GET', `/api/discoveries/${id}`));
    expect(after.discovery.status).toBe('complete');
    expect(after.recap.sections.length).toBeGreaterThan(0);
    await rep.call('PATCH', `/api/discoveries/${id}`, { answers: { timeline: 'later' } });
    const edited = await json(await rep.call('GET', `/api/discoveries/${id}`));
    expect(edited.discovery.result.score.dimensions.find((x) => x.id === 'urgency').score).toBe(0);
  });

  it('builds the same recap from local state as the server does', () => {
    const recap = buildRecap({ industry: 'plumbing', answers: { plb_trucks: 4, years: '10+' }, marks: { years: { source: 'intake' } } });
    expect(recap.sections.map((s) => s.id)).toEqual(['business', 'industry:plumbing']);
    expect(recap.sections[0].items[0]).toMatchObject({ id: 'years', text: 'More than 10 years', mark: { source: 'intake' } });
    expect(recap.unconfirmed).toBe(1);
  });
});

describe('client questionnaire', () => {
  async function invited() {
    const { admin, rep, clientId } = await setup();
    await addAudit(clientId, AUDIT);
    const email = `dana-${clientId.slice(0, 8)}@delta.example`;
    const res = await rep.call('POST', `/api/clients/${clientId}/questionnaire/invite`, { channel: 'email', name: 'Dana Owner', email });
    const out = await json(res);
    // Email isn't configured in tests, so the rep gets the link to pass on.
    expect(res.status).toBe(503);
    expect(out.manualLink).toContain(`/activate?next=${encodeURIComponent(`/questionnaire/${clientId}`)}#`);
    const activate = await api('POST', '/api/auth/activate', { link: out.manualLink.split('#')[1], password: 'correct horse battery' });
    expect(activate.status).toBe(200);
    const cookie = activate.headers.get('Set-Cookie').split(';')[0];
    const client = { cookie, call: (m, p, b) => api(m, p, b, cookie) };
    return { admin, rep, clientId, client, email, discoveryId: out.discoveryId };
  }

  it('invite creates the client login, shares the report and links the questionnaire', async () => {
    const { clientId, client, rep, email } = await invited();
    const u = await env.DB.prepare('SELECT u.role, m.client_id FROM users u JOIN client_members m ON m.user_id=u.id WHERE u.email=?').bind(email).first();
    expect(u).toMatchObject({ role: 'client', client_id: clientId });
    const q = await json(await client.call('GET', `/api/questionnaire/${clientId}`));
    expect(q.intro).toMatch(/thorough and honest/);
    expect(q.report.score).toBe(61);
    expect(q.invitedAt).toBeTruthy();
    const ids = q.sections.flatMap((s) => s.questions.map((x) => x.id));
    expect(ids).toContain('plb_trucks');
    expect(ids).not.toContain('budget');
    expect(ids).not.toContain('attendees_dm');
    expect(q.sections.flatMap((s) => s.questions).every((x) => !x.hint)).toBe(true);
    const status = await json(await rep.call('GET', `/api/clients/${clientId}/questionnaire`));
    expect(status.discovery.invitedAt).toBeTruthy();
    expect(status.report.shared).toBe(true);
  });

  it('saves client answers into the rep\'s discovery, marked as client-entered; rep answers win', async () => {
    const { client, clientId, rep, discoveryId } = await invited();
    await rep.call('PATCH', `/api/discoveries/${discoveryId}`, { answers: { years: '3-10' } });
    const save = await client.call('PATCH', `/api/questionnaire/${clientId}`, { answers: { biggest_problem: 'Not enough calls in summer', years: '10+', budget: '6000+', plb_trucks: 3 } });
    expect(save.status).toBe(200);
    let { discovery: d } = await json(await rep.call('GET', `/api/discoveries/${discoveryId}`));
    expect(d.answers.biggest_problem).toBe('Not enough calls in summer');
    expect(d.marks.biggest_problem).toMatchObject({ source: 'client' });
    expect(d.marks.biggest_problem.at).toBeGreaterThan(0);
    expect(d.answers.plb_trucks).toBe(3);
    // The rep's answer stands; the client's different answer is a suggestion.
    expect(d.answers.years).toBe('3-10');
    expect(d.suggestions.years.value).toBe('10+');
    // Rep-only questions can't be written from the questionnaire.
    expect(d.answers.budget).toBeUndefined();

    // Once the rep confirms a client answer, later client edits don't overwrite it.
    await rep.call('PATCH', `/api/discoveries/${discoveryId}`, { confirm: ['biggest_problem'] });
    await client.call('PATCH', `/api/questionnaire/${clientId}`, { answers: { biggest_problem: 'Actually: slow winters' } });
    ({ discovery: d } = await json(await rep.call('GET', `/api/discoveries/${discoveryId}`)));
    expect(d.answers.biggest_problem).toBe('Not enough calls in summer');
    expect(d.suggestions.biggest_problem.value).toBe('Actually: slow winters');
    const recap = await json(await rep.call('GET', `/api/discoveries/${discoveryId}/recap`));
    const item = recap.recap.sections.flatMap((s) => s.items).find((i) => i.id === 'biggest_problem');
    expect(item.suggestion.text).toBe('Actually: slow winters');
    // The client sees their own words back.
    const q = await json(await client.call('GET', `/api/questionnaire/${clientId}`));
    expect(q.answers.biggest_problem).toBe('Actually: slow winters');
    expect(q.answers.years).toBe('10+');
  });

  it('another client\'s questionnaire is not found', async () => {
    const { client } = await invited();
    const other = await setup({ name: 'Echo HVAC' });
    expect((await client.call('GET', `/api/questionnaire/${other.clientId}`)).status).toBe(404);
    expect((await client.call('PATCH', `/api/questionnaire/${other.clientId}`, { answers: { years: '1-3' } })).status).toBe(404);
    expect((await client.call('POST', `/api/questionnaire/${other.clientId}/submit`, {})).status).toBe(404);
  });

  it('submitting creates a task for the rep, once', async () => {
    const { client, clientId, rep } = await invited();
    await client.call('PATCH', `/api/questionnaire/${clientId}`, { answers: { top_services: 'Water heaters' } });
    expect((await client.call('POST', `/api/questionnaire/${clientId}/submit`, {})).status).toBe(200);
    expect((await client.call('POST', `/api/questionnaire/${clientId}/submit`, {})).status).toBe(200);
    const tasks = (await env.DB.prepare('SELECT owner_id, title FROM tasks WHERE client_id=?').bind(clientId).all()).results;
    expect(tasks.filter((t) => /questionnaire/.test(t.title))).toEqual([{ owner_id: rep.id, title: 'Review Delta Plumbing\'s questionnaire answers' }]);
    const q = await json(await client.call('GET', `/api/questionnaire/${clientId}`));
    expect(q.submittedAt).toBeTruthy();
  });

  it('only accepts client-facing question ids', () => {
    const ids = questionnaireIds('plumbing');
    for (const id of ['budget', 'contract_pref', 'other_options', 'next_step', 'rep_notes', 'rank_check', 'attendees_dm']) expect(ids.has(id), id).toBe(false);
    const state = { answers: {}, marks: {}, suggestions: {}, clientAnswers: {} };
    applyClientAnswers(state, { years: '1-3' }, 1);
    expect(state.marks.years).toEqual({ source: 'client', at: 1 });
  });
});
