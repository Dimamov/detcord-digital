import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';
import { gatherFacts, generateProposal, builderServices } from '../src/worker/lib/proposals.js';

afterEach(() => vi.restoreAllMocks());

const T = Date.UTC(2026, 8, 20, 16);
const PROBLEM = 'Our phone goes to voicemail after 5pm and we lose emergency jobs to whoever answers first.';
const MEETING_QUOTE = 'I hate that Saturday calls just ring out.';

async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const otherRep = await as('rep');
  const owner = await as('client');
  const otherOwner = await as('client');
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const db = env.DB;
  const discovery = (client, answers, recommended) => db.prepare(`INSERT INTO discoveries (id, client_id, industry, modules, answers, result, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,'complete',?,?)`).bind(crypto.randomUUID(), client, 'home', '[]', JSON.stringify(answers),
    JSON.stringify({ score: { total: 14, max: 20, grade: 'B', dimensions: [{ name: 'Need', score: 4 }] }, redFlags: [], recommended }), T, T);
  await db.batch([
    db.prepare("INSERT INTO clients (id, name, industry, city, state, website, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'prospect',?,?)").bind(a, 'Oak Park Plumbing', 'home', 'Oak Park', 'MI', 'https://oakpark.example', T, T),
    db.prepare("INSERT INTO clients (id, name, status, created_at, updated_at) VALUES (?,?,'prospect',?,?)").bind(b, 'Ferndale Bakery', T, T),
    db.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(a, owner.id),
    db.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(b, otherOwner.id),
    db.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(a, rep.id, T),
    db.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(b, otherRep.id, T),
    db.prepare('UPDATE services SET setup_cents=75000, monthly_cents=45000 WHERE id=?').bind('seo'),
    db.prepare("INSERT INTO client_services (client_id, service_id, status, monthly_cents, updated_at) VALUES (?, 'gbp', 'recommended', 30000, ?)").bind(a, T),
    db.prepare('INSERT INTO intake_links (id, client_id, token_hash, created_at, expires_at, submitted_at, answers) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), a, 'x', T, T, T,
      JSON.stringify({ biggest_problem: PROBLEM, goal_12mo: 'Two more trucks on the road.', monthly_spend: '1500-3000', top_services: 'Drain cleaning' })),
    db.prepare('INSERT INTO intake_links (id, client_id, token_hash, created_at, expires_at, submitted_at, answers) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), b, 'y', T, T, T,
      JSON.stringify({ biggest_problem: 'OTHER CLIENT SECRET problem' })),
    discovery(a, { biggest_problem: PROBLEM, top_services: 'Drain cleaning and water heaters', avg_ticket: 650, budget: 'lt1000' },
      [{ serviceId: 'lead-response', name: 'Lead response', priority: 'start-with', reasons: ['Misses calls after hours.'] }, { serviceId: 'seo', name: 'SEO', priority: 'start-with', reasons: ['Wants more drain jobs.'] }, { serviceId: 'pr', name: 'PR', priority: 'later', reasons: [] }]),
    discovery(b, { biggest_problem: 'OTHER CLIENT SECRET discovery' }, [{ serviceId: 'social', name: 'Social', priority: 'start-with', reasons: [] }]),
    db.prepare(`INSERT INTO meetings (id, client_id, title, consent_at, status, transcript, analysis, created_at, updated_at) VALUES (?,?,?,?, 'ready', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), a, 'First visit', T, JSON.stringify([{ speaker: 0, start: 0, end: 1, text: 'PRIVATE TRANSCRIPT LINE' }]),
        JSON.stringify({ summary: 'Owner loses after-hours calls.', pain_points: ['Missed calls on weekends'], goals: ['Book more drain jobs'], budget: 'About $2,000 a month',
          answers: [{ id: 'biggest_problem', value: 'calls', quote: MEETING_QUOTE }, { id: 'budget', value: 'x', quote: 'We could do $2,000 a month' }] }), T, T),
    db.prepare("INSERT INTO audits (id, client_id, url, status, score, result, hidden, created_at) VALUES (?,?,?,'done',?,?,?,?)").bind(crypto.randomUUID(), a, 'https://oakpark.example/', 62,
      JSON.stringify({ scores: { seo: 55, ux: 70 }, findings: [
        { id: 'title-missing', cat: 'seo', severity: 'critical', title: 'Your homepage has no page title', detail: 'No title tag.', service: 'seo' },
        { id: 'tap-call', cat: 'ux', severity: 'important', title: 'No tap-to-call button on phones', detail: 'Phone number is not a link.', service: 'lead-response' },
        { id: 'hidden-one', cat: 'tech', severity: 'minor', title: 'HIDDEN FINDING', detail: 'x', service: 'hosting' },
      ] }), JSON.stringify(['hidden-one']), T),
    db.prepare("INSERT INTO audits (id, client_id, url, status, score, result, created_at) VALUES (?,?,?,'done',?,?,?)").bind(crypto.randomUUID(), b, 'https://bakery.example/', 41,
      JSON.stringify({ findings: [{ id: 'x', cat: 'seo', severity: 'critical', title: 'OTHER CLIENT SECRET finding', detail: '', service: 'seo' }] }), T + 1),
  ]);
  const client = await db.prepare('SELECT * FROM clients WHERE id=?').bind(a).first();
  return { admin, rep, otherRep, owner, otherOwner, clientId: a, otherId: b, client };
}

const CHECKED = [{ serviceId: 'seo', setup: '900', monthly: 500, scope: 'Drain cleaning pages for Oak Park and Ferndale' }, { serviceId: 'lead-response', setup: '', monthly: '199', scope: '' }];
const STORED = [
  { serviceId: 'seo', name: 'SEO (on-page, technical and local)', setupCents: 90000, monthlyCents: 50000, scope: 'Drain cleaning pages for Oak Park and Ferndale' },
  { serviceId: 'lead-response', name: 'Lead response: call tracking, missed-call text-back and AI receptionist', setupCents: null, monthlyCents: 19900, scope: '' },
];

const DRAFT = {
  intro: 'You lose emergency jobs when calls go to voicemail after 5pm.',
  services: [
    { service_id: 'lead-response', why: 'Calls after hours go unanswered.', features: ['Missed-call text-back'], benefits: ['Fewer lost jobs'], timeline: 'Set up in the first two weeks.',
      what_you_told_us: [
        { concern: 'Calls after 5pm go to voicemail', quote: `“${PROBLEM.slice(0, 37)}”`, source: 'Pre-call questions' },
        { concern: 'Weekend calls', quote: MEETING_QUOTE, source: 'Meeting' },
        { concern: 'Made up', quote: 'We get 400 calls a week and lose half of them', source: 'Meeting' },
      ] },
    { service_id: 'seo', why: 'You want more drain jobs.', features: ['Service pages'], benefits: ['Found for drain cleaning'], timeline: 'First pages in month one.',
      what_you_told_us: [{ concern: 'Your homepage has no page title', quote: '', source: 'Website check' }] },
  ],
  next_steps: ['Ask us anything.', 'Accept, and we prepare your agreement.'],
  staff_notes: ['Ask about weekend staffing.'],
};

function mockClaude(draft = DRAFT) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input?.url || input);
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(draft) }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}');
  });
  return calls;
}

// A shared proposal for client A, drafted by Claude.
async function sharedProposal(ctx) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO proposals (id, client_id, title, status, services, content, created_by, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)")
    .bind(id, ctx.clientId, 'Plan for Oak Park Plumbing', JSON.stringify(STORED), '{"intro":"","services":[],"next_steps":[],"staff_notes":[]}', ctx.rep.id, T, T).run();
  mockClaude();
  const p = await env.DB.prepare('SELECT * FROM proposals WHERE id=?').bind(id).first();
  await generateProposal({ ...env, ANTHROPIC_API_KEY: 'test-key' }, { proposal: p, client: ctx.client, userId: ctx.rep.id });
  const res = await ctx.rep.call('POST', `/api/proposals/${id}/share`, { email: true });
  expect(res.status).toBe(200);
  return { id, share: await res.json() };
}

const noPrices = (s) => {
  expect(s).not.toMatch(/\$\s?\d/);
  for (const k of ['setupCents', 'monthlyCents', 'setup_cents', 'monthly_cents', '75000', '45000', '30000']) expect(s).not.toContain(k);
};

describe('Proposals', () => {
  it('gathers facts for only this client, with no prices, budgets, transcripts or hidden findings', async () => {
    const { client } = await setup();
    const f = await gatherFacts(env.DB, client, [{ serviceId: 'seo', name: 'SEO', scope: 'Drain pages' }, { serviceId: 'lead-response', name: 'Lead response', scope: '' }]);
    const all = JSON.stringify(f);
    expect(f.business).toMatchObject({ name: 'Oak Park Plumbing', city: 'Oak Park' });
    expect(f.pre_call_answers.answers).toEqual(expect.arrayContaining([expect.objectContaining({ answer: PROBLEM })]));
    // The rep's discovery answer that came unchanged from the pre-call form counts as the client's own.
    expect(f.discovery.answers.find((x) => x.answer === PROBLEM).entered_by).toBe('client (pre-call form)');
    expect(f.discovery.answers.find((x) => x.answer.startsWith('Drain cleaning and')).entered_by).toBe('rep (discovery call notes)');
    expect(f.discovery.result.recommended_services.map((x) => x.service_id)).toEqual(['lead-response', 'seo', 'pr']);
    expect(f.meetings[0].client_quotes).toEqual([MEETING_QUOTE]);
    expect(f.website_check.findings.map((x) => x.title)).toEqual(['Your homepage has no page title', 'No tap-to-call button on phones']);
    expect(f.website_check.area_scores).toMatchObject({ 'Search visibility': 55, 'Mobile and customer experience': 70 });
    expect(f.services_chosen).toEqual([
      expect.objectContaining({ service_id: 'seo', scope_note_from_rep: 'Drain pages', discovery_reasons: ['Wants more drain jobs.'], website_check_findings: ['Your homepage has no page title'] }),
      expect.objectContaining({ service_id: 'lead-response', website_check_findings: ['No tap-to-call button on phones'] }),
    ]);
    for (const leak of ['OTHER CLIENT SECRET', 'PRIVATE TRANSCRIPT', 'HIDDEN FINDING', '2,000', '1500-3000', '$1,500', '650', 'lt1000', 'Ferndale Bakery']) expect(all).not.toContain(leak);
    noPrices(all);

    // The builder preselects the discovery's start-with/next services and the client's recommended ones.
    // Default prices come from the client record, else the catalog.
    const builder = await builderServices(env.DB, client.id);
    expect(builder.filter((s) => s.checked).map((s) => s.serviceId).sort()).toEqual(['gbp', 'lead-response', 'seo']);
    expect(builder.find((s) => s.serviceId === 'seo')).toMatchObject({ setupCents: 75000, monthlyCents: 45000 });
    expect(builder.find((s) => s.serviceId === 'gbp')).toMatchObject({ setupCents: null, monthlyCents: 30000 });
  });

  it('sends Claude those facts, keeps verbatim quotes, and drops any it cannot find', async () => {
    const { rep, clientId } = await setup();
    const calls = mockClaude();
    const res = await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: CHECKED });
    expect(res.status).toBe(201);
    const { proposal } = await res.json();
    // Without the key in the test env the route uses the facts; call the generator with a key for the Claude path.
    expect(proposal.draft_source).toBe('staff');
    expect(calls.filter((x) => x.url.includes('anthropic'))).toHaveLength(0);

    const row = await env.DB.prepare('SELECT * FROM proposals WHERE id=?').bind(proposal.id).first();
    const client = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
    const out = await generateProposal({ ...env, ANTHROPIC_API_KEY: 'test-key' }, { proposal: row, client, userId: rep.id, overwrite: true });
    expect(out).toMatchObject({ source: 'ai', error: null });

    const req = calls.find((x) => x.url.includes('api.anthropic.com'));
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.output_config.format.type).toBe('json_schema');
    expect(req.body.output_config.format.schema.properties.services.items.properties.service_id.enum).toEqual(['seo', 'lead-response']);
    expect(req.body.system).toContain('Use only these facts');
    expect(req.body.system).toContain('Never promise or guarantee rankings');
    expect(req.body.system).toContain('Never write prices');
    const prompt = req.body.messages[0].content;
    expect(prompt).toContain(PROBLEM);
    expect(prompt).toContain(MEETING_QUOTE);
    expect(prompt).toContain('Your homepage has no page title');
    expect(prompt).not.toContain('OTHER CLIENT SECRET');
    noPrices(prompt);

    const saved = await env.DB.prepare('SELECT * FROM proposals WHERE id=?').bind(proposal.id).first();
    expect(JSON.parse(saved.draft)).toEqual(DRAFT);
    const content = JSON.parse(saved.content);
    // Content follows the checked order (catalog order), whatever order Claude used.
    expect(content.services.map((s) => s.serviceId)).toEqual(['seo', 'lead-response']);
    const lead = content.services[1];
    // Curly quote marks are trimmed; the invented quote is removed but its concern stays, for staff to fix.
    expect(lead.concerns.map((x) => x.quote)).toEqual([PROBLEM.slice(0, 37), MEETING_QUOTE, '']);
    expect(lead.concerns[2].concern).toBe('Made up');
    expect(content.staff_notes.some((n) => n.includes('400 calls a week'))).toBe(true);
    expect(content.services[0].concerns).toEqual([{ concern: 'Your homepage has no page title', quote: '', source: 'Website check' }]);
    expect(JSON.parse(saved.facts).pre_call_answers.answers.length).toBeGreaterThan(0);
    const versions = (await env.DB.prepare("SELECT kind FROM proposal_versions WHERE proposal_id=?").bind(proposal.id).all()).results;
    expect(versions.map((v) => v.kind)).toEqual(['generated', 'generated']);
  });

  it('keeps drafts from clients, shares with server-computed totals, blocks edits until unshared, and 404s other businesses', async () => {
    const ctx = await setup();
    const { rep, otherRep, owner, otherOwner, clientId } = ctx;
    mockClaude();
    const created = await (await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: CHECKED })).json();
    const id = created.proposal.id;
    expect((await owner.call('GET', `/api/proposals/${id}`)).status).toBe(404);
    expect((await owner.call('GET', `/api/proposals/${crypto.randomUUID()}`)).status).toBe(404);
    await expect((await owner.call('GET', '/api/proposals')).json()).resolves.toEqual({ proposals: [] });
    expect((await owner.call('PATCH', `/api/proposals/${id}`, { title: 'x' })).status).toBe(403);
    expect((await owner.call('POST', `/api/clients/${clientId}/proposals`, { services: CHECKED })).status).toBe(403);
    expect((await otherRep.call('GET', `/api/proposals/${id}`)).status).toBe(404);
    expect((await owner.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(404);

    // Sharing needs an intro and a reason for each service.
    expect((await rep.call('PATCH', `/api/proposals/${id}`, { content: { ...created.proposal.content, intro: '' } })).status).toBe(200);
    expect((await rep.call('POST', `/api/proposals/${id}/share`, {})).status).toBe(400);
    const content = { ...created.proposal.content, intro: 'Hand-written intro.', services: created.proposal.content.services.map((s) => ({ ...s, why: `Because ${s.name}.` })), staff_notes: ['TEAM ONLY NOTE'] };
    const edited = await rep.call('PATCH', `/api/proposals/${id}`, { content });
    expect(edited.status).toBe(200);
    expect((await edited.json()).proposal.edited).toBe(true);
    const shared = await rep.call('POST', `/api/proposals/${id}/share`, { email: true });
    const s = await shared.json();
    expect(s.proposal).toMatchObject({ status: 'shared', version: 1 });
    expect(s.email.configured).toBe(false);
    expect(s.delivery).toEqual([expect.objectContaining({ email: owner.email, status: 'not_configured' })]);
    expect(s.link).toContain(`/proposals/${id}`);

    const view = await owner.call('GET', `/api/proposals/${id}`);
    expect(view.status).toBe(200);
    const v = await view.json();
    expect(v.proposal.content.intro).toBe('Hand-written intro.');
    expect(v.proposal.content.services.map((x) => x.serviceId)).toEqual(['seo', 'lead-response']);
    expect(v.proposal.content.services[0]).toHaveProperty('concerns');
    const text = JSON.stringify(v);
    for (const leak of ['TEAM ONLY NOTE', 'facts', 'staff_notes', 'internal_lead_score']) expect(text).not.toContain(leak);
    // Prices and totals come from the server, from the prices staff set.
    expect(v.proposal.investment).toEqual({
      lines: STORED.map(({ serviceId, name, setupCents, monthlyCents }) => ({ serviceId, name, setupCents, monthlyCents })),
      setupCents: 90000, monthlyCents: 69900, unpriced: [],
    });
    expect((await (await owner.call('GET', '/api/proposals')).json()).proposals.map((x) => x.id)).toEqual([id]);
    expect((await otherOwner.call('GET', `/api/proposals/${id}`)).status).toBe(404);
    expect((await otherOwner.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(404);
    expect((await (await otherOwner.call('GET', '/api/proposals')).json()).proposals).toEqual([]);

    expect((await rep.call('PATCH', `/api/proposals/${id}`, { content })).status).toBe(409);
    expect((await rep.call('POST', `/api/proposals/${id}/generate`, { overwrite: true })).status).toBe(409);
    expect((await rep.call('DELETE', `/api/proposals/${id}`)).status).toBe(409);
    expect((await rep.call('POST', `/api/proposals/${id}/unshare`, { reason: 'Add AI search' })).status).toBe(200);
    const log = (await env.DB.prepare("SELECT summary FROM activity WHERE client_id=? AND kind='proposal'").bind(clientId).all()).results.map((x) => x.summary);
    expect(log).toEqual(expect.arrayContaining(['Shared the proposal "Marketing proposal for Oak Park Plumbing" (version 1)', 'Unshared the proposal "Marketing proposal for Oak Park Plumbing" (version 1): Add AI search']));
    expect((await owner.call('GET', `/api/proposals/${id}`)).status).toBe(404);
    const added = await (await rep.call('PATCH', `/api/proposals/${id}`, { services: [...CHECKED, { serviceId: 'ai-search' }] })).json();
    // Services stay in catalog order; what was written for the ones that stayed is kept, and the new one
    // starts empty and blocks sharing.
    expect(added.proposal.content.services.map((x) => x.why)).toEqual(['Because SEO (on-page, technical and local).', '', expect.stringContaining('Because Lead response')]);
    expect((await rep.call('POST', `/api/proposals/${id}/share`, {})).status).toBe(400);
    const why = { ...added.proposal.content, services: added.proposal.content.services.map((x) => ({ ...x, why: x.why || 'You asked about ChatGPT.' })) };
    expect((await rep.call('PATCH', `/api/proposals/${id}`, { content: why })).status).toBe(200);
    const again = await (await rep.call('POST', `/api/proposals/${id}/share`, {})).json();
    expect(again.proposal.version).toBe(2);
    expect(again.proposal.versions.filter((x) => x.kind === 'shared').map((x) => x.version)).toEqual([2, 1]);
  });

  it('accepting once starts a draft agreement with the checked services, notifies the rep, and nothing else', async () => {
    const ctx = await setup();
    const { rep, admin, owner, clientId } = ctx;
    const { id } = await sharedProposal(ctx);
    const before = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE client_id=?) AS inv, (SELECT COUNT(*) FROM contracts WHERE client_id=?) AS ct, (SELECT status FROM clients WHERE id=?) AS st').bind(clientId, clientId, clientId).first();
    const services = (await env.DB.prepare('SELECT service_id, status FROM client_services WHERE client_id=? ORDER BY service_id').bind(clientId).all()).results;

    expect((await rep.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(403);
    expect((await admin.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(403);
    const res = await owner.call('POST', `/api/proposals/${id}/accept`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, acceptedAt: expect.any(Number) });
    expect((await owner.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(409);
    expect((await owner.call('POST', `/api/proposals/${id}/questions`, { note: 'Late question' })).status).toBe(409);

    const p = await env.DB.prepare('SELECT * FROM proposals WHERE id=?').bind(id).first();
    expect(p).toMatchObject({ status: 'accepted', accepted_by: owner.id });
    expect(p.contract_id).toBeTruthy();
    const contracts = (await env.DB.prepare('SELECT * FROM contracts WHERE client_id=?').bind(clientId).all()).results;
    expect(contracts).toHaveLength(before.ct + 1);
    const ct = contracts.find((x) => x.id === p.contract_id);
    expect(ct).toMatchObject({ status: 'draft', created_by: rep.id, issued_at: null, signed_at: null });
    const data = JSON.parse(ct.data);
    // Exactly the accepted services, prices and scope lines; term and deposit are left for the rep.
    expect(data.services.map(({ serviceId, setupCents, monthlyCents, scope }) => ({ serviceId, setupCents, monthlyCents, scope })))
      .toEqual(STORED.map(({ serviceId, setupCents, monthlyCents, scope }) => ({ serviceId, setupCents, monthlyCents, scope })));
    expect(data).toMatchObject({ depositCents: null, clientLegalName: 'Oak Park Plumbing', attachments: [] });

    // Nothing signed, billed or switched on.
    const after = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE client_id=?) AS inv, (SELECT status FROM clients WHERE id=?) AS st').bind(clientId, clientId).first();
    expect(after).toEqual({ inv: before.inv, st: before.st });
    expect((await env.DB.prepare('SELECT service_id, status FROM client_services WHERE client_id=? ORDER BY service_id').bind(clientId).all()).results).toEqual(services);

    // The rep is told: a task, and an email attempt (email isn't configured in tests).
    const tasks = (await env.DB.prepare('SELECT title FROM tasks WHERE owner_id=? AND client_id=?').bind(rep.id, clientId).all()).results.map((x) => x.title);
    expect(tasks).toEqual([`Oak Park Plumbing accepted the proposal: finish and send agreement ${ct.number}`]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_emails WHERE recipient=? AND subject LIKE 'Proposal accepted%'").bind(rep.email).first()).n).toBe(1);

    // The client sees it as accepted; staff see who accepted and the agreement; it can't be unshared or edited.
    const v = await (await owner.call('GET', `/api/proposals/${id}`)).json();
    expect(v.proposal).toMatchObject({ status: 'accepted', accepted_name: expect.any(String) });
    expect(JSON.stringify(v)).not.toContain(ct.id);
    const sv = await (await rep.call('GET', `/api/proposals/${id}`)).json();
    expect(sv.proposal.contract).toMatchObject({ id: ct.id, status: 'draft' });
    expect((await rep.call('POST', `/api/proposals/${id}/unshare`, {})).status).toBe(409);
    expect((await rep.call('POST', `/api/proposals/${id}/agreement`, {})).status).toBe(409);
  });

  it('lets the client ask a question, and staff start the agreement by hand', async () => {
    const ctx = await setup();
    const { rep, owner, clientId } = ctx;
    const { id } = await sharedProposal(ctx);
    expect((await owner.call('POST', `/api/proposals/${id}/questions`, { note: '' })).status).toBe(400);
    const q = await owner.call('POST', `/api/proposals/${id}/questions`, { note: 'Can we start with SEO only?' });
    expect(q.status).toBe(201);
    const sv = await (await rep.call('GET', `/api/proposals/${id}`)).json();
    expect(sv.proposal.questions).toEqual([expect.objectContaining({ note: 'Can we start with SEO only?', version: 1 })]);
    expect((await env.DB.prepare('SELECT title FROM tasks WHERE owner_id=? AND client_id=?').bind(rep.id, clientId).all()).results.map((x) => x.title))
      .toEqual(["Answer Oak Park Plumbing's question on the proposal"]);
    expect((await env.DB.prepare('SELECT status FROM proposals WHERE id=?').bind(id).first()).status).toBe('shared');

    expect((await owner.call('POST', `/api/proposals/${id}/agreement`, {})).status).toBe(403);
    const made = await rep.call('POST', `/api/proposals/${id}/agreement`, {});
    expect(made.status).toBe(201);
    const { id: contractId } = await made.json();
    const data = JSON.parse((await env.DB.prepare('SELECT data FROM contracts WHERE id=?').bind(contractId).first()).data);
    expect(data.services.map((s) => [s.serviceId, s.setupCents, s.monthlyCents, s.scope])).toEqual([['seo', 90000, 50000, 'Drain cleaning pages for Oak Park and Ferndale'], ['lead-response', null, 19900, '']]);
    expect((await rep.call('POST', `/api/proposals/${id}/agreement`, {})).status).toBe(409);
    // A later acceptance links that agreement instead of starting another.
    expect((await owner.call('POST', `/api/proposals/${id}/accept`, {})).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM contracts WHERE client_id=?').bind(clientId).first()).n).toBe(1);
  });

  it('works without Claude: the draft starts from the catalog and the facts', async () => {
    const { rep, clientId } = await setup();
    const res = await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: CHECKED });
    const { proposal } = await res.json();
    expect(proposal).toMatchObject({ status: 'draft', draft_source: 'staff', draft: null, ready: { ai: false, email: false } });
    expect(proposal.content.intro).toContain(PROBLEM);
    expect(proposal.content.services[0].features).toEqual(expect.arrayContaining(['Drain cleaning pages for Oak Park and Ferndale']));
    expect(proposal.content.services[0].why).toBe('Wants more drain jobs.');
    expect(proposal.content.services[1].concerns[0]).toMatchObject({ concern: 'No tap-to-call button on phones', quote: '' });
    expect((await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: [] })).status).toBe(400);
    expect((await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: [{ serviceId: 'nope' }] })).status).toBe(400);
    expect((await rep.call('POST', `/api/clients/${clientId}/proposals`, { services: [{ serviceId: 'seo', setup: 'lots' }] })).status).toBe(400);
    const list = await (await rep.call('GET', `/api/clients/${clientId}/proposals`)).json();
    expect(list.proposals.map((x) => x.id)).toEqual([proposal.id]);

    // Totals are always recomputed by the server from the service prices; anything else sent is ignored.
    const patched = await rep.call('PATCH', `/api/proposals/${proposal.id}`, { services: [...CHECKED, { serviceId: 'ai-search' }], investment: { setupCents: 1 } });
    expect((await patched.json()).proposal.investment).toMatchObject({ setupCents: 90000, monthlyCents: 69900, unpriced: ['AI search visibility'] });
  });
});
