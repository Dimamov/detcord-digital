import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { as } from './helpers.js';
import { gatherFacts, generateReport, monthRange } from '../src/worker/lib/reports.js';

afterEach(() => vi.restoreAllMocks());

const SEP = Date.UTC(2026, 8, 15, 16);
const AUG = Date.UTC(2026, 7, 20, 16);
const OCT = Date.UTC(2026, 9, 3, 16);

async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const otherRep = await as('rep');
  const owner = await as('client');
  const otherOwner = await as('client');
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const t = Date.now();
  const db = env.DB;
  const goat = (client, body, status, created, completed, note = null) => db.prepare(`INSERT INTO goat_requests (id, client_id, channel, body, category, status, result_note, created_at, updated_at, completed_at)
    VALUES (?,?,'portal',?,'website',?,?,?,?,?)`).bind(crypto.randomUUID(), client, body, status, note, created, created, completed);
  await db.batch([
    db.prepare("INSERT INTO clients (id, name, industry, city, state, status, created_at, updated_at) VALUES (?,?,?,?,?,'active',?,?)").bind(a, 'Oak Park Plumbing', 'home', 'Oak Park', 'MI', t, t),
    db.prepare("INSERT INTO clients (id, name, status, created_at, updated_at) VALUES (?,?,'active',?,?)").bind(b, 'Ferndale Bakery', t, t),
    db.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(a, owner.id),
    db.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(b, otherOwner.id),
    db.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(a, rep.id, t),
    db.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(b, otherRep.id, t),
    goat(a, 'Add winter hours to the website', 'done', SEP - 86400000, SEP, 'Hours page updated'),
    goat(a, 'August flyer request', 'done', AUG, AUG),
    // Just after midnight on Sep 1 in Detroit counts for September; just before does not.
    goat(a, 'Late August photo swap', 'done', Date.UTC(2026, 8, 1, 3, 30), Date.UTC(2026, 8, 1, 3, 30)),
    goat(a, 'Early September coupon', 'new', Date.UTC(2026, 8, 1, 4, 30), null),
    goat(b, 'OTHER CLIENT SECRET request', 'done', SEP, SEP, 'Bakery done'),
    db.prepare("INSERT INTO audits (id, client_id, url, status, score, result, created_at) VALUES (?,?,?,'done',?,?,?)").bind(crypto.randomUUID(), a, 'https://oakpark.example/', 70, JSON.stringify({ scores: { seo: 60 } }), AUG),
    db.prepare("INSERT INTO audits (id, client_id, url, status, score, result, created_at) VALUES (?,?,?,'done',?,?,?)").bind(crypto.randomUUID(), a, 'https://oakpark.example/', 78, JSON.stringify({ scores: { seo: 72 }, counts: { critical: 0, important: 2, minor: 3 } }), SEP),
    db.prepare("INSERT INTO audits (id, client_id, url, status, score, result, created_at) VALUES (?,?,?,'done',?,?,?)").bind(crypto.randomUUID(), b, 'https://bakery.example/', 41, '{}', SEP),
    db.prepare(`INSERT INTO invoices (id, client_id, number, kind, title, status, total_cents, paid_cents, issued_at, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, 'monthly', 'September services', 'paid', 50000, 50000, ?, ?, ?, ?)`).bind(`inv-${a}`, a, `INV-${a}`, SEP, SEP, SEP, SEP),
    db.prepare("INSERT INTO payments (id, invoice_id, client_id, provider, status, amount_cents, received_at) VALUES (?, ?, ?, 'clover', 'approved', 50000, ?)").bind(crypto.randomUUID(), `inv-${a}`, a, SEP),
    db.prepare(`INSERT INTO contracts (id, client_id, number, title, status, data, signed_at, created_at, updated_at) VALUES (?,?,?,?,'signed','{}',?,?,?)`).bind(crypto.randomUUID(), a, `DD-${a}`, 'Local SEO agreement', SEP, SEP, SEP),
    db.prepare(`INSERT INTO meetings (id, client_id, title, consent_at, status, transcript, analysis, created_at, updated_at) VALUES (?,?,?,?, 'ready', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), a, 'Quarterly check-in', SEP, JSON.stringify([{ speaker: 0, start: 0, end: 1, text: 'PRIVATE TRANSCRIPT LINE' }]), JSON.stringify({ summary: 'Owner wants more winter calls.' }), SEP, SEP),
    db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, done_at, created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), a, rep.id, 'Send GBP photos', SEP, SEP),
    db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, done_at, created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), a, rep.id, 'October follow-up', OCT, OCT),
  ]);
  const client = await db.prepare('SELECT * FROM clients WHERE id=?').bind(a).first();
  return { admin, rep, otherRep, owner, otherOwner, clientId: a, otherId: b, client };
}

const DRAFT = {
  headline: 'September: winter hours live, site score up 8',
  summary: 'We finished your winter hours update and your website score rose from 70 to 78.',
  sections: [{ title: 'Requests', bullets: ['Added winter hours to the website.'] }, { title: 'Website', bullets: ['Score 78/100, up 8.'] }],
  next_month: ['Finish the September coupon request.'],
  staff_notes: ['No GA4 data; traffic not mentioned.'],
};

function mockClaude() {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input?.url || input);
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(DRAFT) }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}');
  });
  return calls;
}

describe('Monthly reports', () => {
  it('gathers facts for only this client and this month', async () => {
    const { client } = await setup();
    const { start, end } = monthRange('2026-09', 'America/Detroit');
    expect(start).toBe(Date.UTC(2026, 8, 1, 4));
    expect(end).toBe(Date.UTC(2026, 9, 1, 4));

    const f = await gatherFacts(env.DB, client, '2026-09');
    const all = JSON.stringify(f);
    expect(f.month_label).toBe('September 2026');
    expect(f.requests.completed.map((x) => x.request)).toEqual(['Add winter hours to the website']);
    expect(f.requests.completed[0].result).toBe('Hours page updated');
    expect(f.requests.received.map((x) => x.request)).toEqual(['Early September coupon', 'Add winter hours to the website']);
    expect(f.requests.still_open_today.map((x) => x.request)).toEqual(['Early September coupon']);
    expect(f.website_checks).toHaveLength(1);
    expect(f.website_checks[0]).toMatchObject({ score: 78, previous_score: 70, change: 8 });
    expect(f.billing).toMatchObject({ total_issued_usd: 500, total_paid_usd: 500 });
    expect(f.agreements_signed.map((x) => x.title)).toEqual(['Local SEO agreement']);
    expect(f.meetings).toEqual([{ title: 'Quarterly check-in', date: '2026-09-15' }]);
    expect(f.tasks_completed.map((x) => x.task)).toEqual(['Send GBP photos']);
    for (const leak of ['OTHER CLIENT SECRET', 'August flyer', 'Late August photo', 'October follow-up', 'PRIVATE TRANSCRIPT', 'winter calls', 'bakery']) expect(all).not.toContain(leak);

    // Meeting summaries only when staff opt in; transcripts never.
    const withNotes = await gatherFacts(env.DB, client, '2026-09', { meetingNotes: true });
    expect(withNotes.meetings[0].summary).toBe('Owner wants more winter calls.');
    expect(JSON.stringify(withNotes)).not.toContain('PRIVATE TRANSCRIPT');
  });

  it('sends Claude those facts and stores the result as a draft', async () => {
    const { rep, client } = await setup();
    const calls = mockClaude();
    const out = await generateReport({ ...env, ANTHROPIC_API_KEY: 'test-key' }, { client, month: '2026-09', userId: rep.id });
    expect(out).toMatchObject({ source: 'ai', error: null, replaced: false });

    const req = calls.find((x) => x.url.includes('api.anthropic.com'));
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.output_config.format.type).toBe('json_schema');
    expect(req.body.output_config.format.schema.required).toEqual(['headline', 'summary', 'sections', 'next_month', 'staff_notes']);
    expect(req.body.system).toContain('Use only these facts');
    expect(req.body.system).toContain('Google Analytics');
    const prompt = req.body.messages[0].content;
    expect(prompt).toContain('Add winter hours to the website');
    expect(prompt).not.toContain('OTHER CLIENT SECRET');
    expect(prompt).not.toContain('August flyer');

    const row = await env.DB.prepare('SELECT * FROM monthly_reports WHERE id=?').bind(out.id).first();
    expect(row).toMatchObject({ status: 'draft', draft_source: 'ai', edited: 0, generated_by: rep.id, client_id: client.id, month: '2026-09' });
    expect(JSON.parse(row.draft)).toEqual(DRAFT);
    expect(JSON.parse(row.content).headline).toBe(DRAFT.headline);
    expect(JSON.parse(row.facts).requests.completed[0].request).toBe('Add winter hours to the website');
  });

  it('keeps drafts from clients, shares, blocks edits after sharing, and unshares', async () => {
    const { rep, otherRep, owner, otherOwner, client, clientId } = await setup();
    mockClaude();
    const { id } = await generateReport({ ...env, ANTHROPIC_API_KEY: 'test-key' }, { client, month: '2026-09', userId: rep.id });

    // Drafts are invisible to the client, with the same 404 as a missing report.
    const draft = await owner.call('GET', `/api/monthly-reports/${id}`);
    expect(draft.status).toBe(404);
    expect((await draft.json()).error).toBe('Report not found.');
    expect((await owner.call('GET', `/api/monthly-reports/${crypto.randomUUID()}`)).status).toBe(404);
    await expect((await owner.call('GET', '/api/monthly-reports')).json()).resolves.toEqual({ reports: [] });
    expect((await owner.call('PATCH', `/api/monthly-reports/${id}`, { content: DRAFT })).status).toBe(403);
    expect((await owner.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09' })).status).toBe(403);
    expect((await otherRep.call('GET', `/api/monthly-reports/${id}`)).status).toBe(404);
    expect((await otherRep.call('POST', `/api/monthly-reports/${id}/share`, {})).status).toBe(404);

    // Staff edit, then share; email isn't configured in tests, and the response says so.
    const edited = await rep.call('PATCH', `/api/monthly-reports/${id}`, { content: { ...DRAFT, summary: 'Edited by staff.' }, status: 'ready' });
    expect(edited.status).toBe(200);
    expect((await edited.json()).report).toMatchObject({ status: 'ready', edited: true });
    const shared = await rep.call('POST', `/api/monthly-reports/${id}/share`, { email: true });
    expect(shared.status).toBe(200);
    const s = await shared.json();
    expect(s.report.status).toBe('shared');
    expect(s.email.configured).toBe(false);
    expect(s.delivery).toEqual([expect.objectContaining({ email: owner.email, status: 'not_configured' })]);
    expect(s.link).toContain(`/reports/monthly/${id}`);

    // The client sees the shared report, without staff notes or the raw facts.
    const view = await owner.call('GET', `/api/monthly-reports/${id}`);
    expect(view.status).toBe(200);
    const v = await view.json();
    expect(v.report.content.summary).toBe('Edited by staff.');
    expect(v.report.content.staff_notes).toBeUndefined();
    expect(v.report.facts).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('No GA4 data');
    expect((await (await owner.call('GET', '/api/monthly-reports')).json()).reports.map((x) => x.id)).toEqual([id]);
    // Another business still gets 404.
    expect((await otherOwner.call('GET', `/api/monthly-reports/${id}`)).status).toBe(404);
    expect((await (await otherOwner.call('GET', '/api/monthly-reports')).json()).reports).toEqual([]);

    // Shared reports can't be edited or regenerated.
    expect((await rep.call('PATCH', `/api/monthly-reports/${id}`, { content: DRAFT })).status).toBe(409);
    expect((await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09', overwrite: true })).status).toBe(409);
    expect((await rep.call('DELETE', `/api/monthly-reports/${id}`)).status).toBe(409);

    // Unshare (logged), then edits work and the client loses access again.
    expect((await rep.call('POST', `/api/monthly-reports/${id}/unshare`, { reason: 'Typo in headline' })).status).toBe(200);
    const log = await env.DB.prepare("SELECT summary FROM activity WHERE client_id=? AND kind='report' ORDER BY created_at").bind(clientId).all();
    expect(log.results.map((x) => x.summary)).toEqual(expect.arrayContaining(['Shared the September 2026 report', 'Unshared the September 2026 report: Typo in headline']));
    expect((await owner.call('GET', `/api/monthly-reports/${id}`)).status).toBe(404);
    expect((await rep.call('PATCH', `/api/monthly-reports/${id}`, { content: { ...DRAFT, headline: 'Fixed headline' } })).status).toBe(200);
  });

  it('works without Claude: staff start from the facts, and regenerating asks before replacing edits', async () => {
    const { rep, clientId } = await setup();
    const calls = mockClaude();
    const res = await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09' });
    expect(res.status).toBe(201);
    const { report } = await res.json();
    expect(report).toMatchObject({ status: 'draft', draft_source: 'staff', draft: null, ready: { ai: false, email: false } });
    expect(calls.filter((x) => x.url.includes('anthropic'))).toHaveLength(0);
    const bullets = report.content.sections.flatMap((x) => x.bullets).join('\n');
    expect(bullets).toContain('Done: Add winter hours to the website (Hours page updated)');
    expect(bullets).toContain('78/100 (up 8 from 70)');
    expect(bullets).not.toContain('OTHER CLIENT SECRET');

    expect((await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2099-01' })).status).toBe(400);
    expect((await rep.call('PATCH', `/api/monthly-reports/${report.id}`, { content: { ...report.content, summary: 'Hand written.' } })).status).toBe(200);
    const again = await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09' });
    expect(again.status).toBe(409);
    expect((await again.json()).needsConfirm).toBe(true);
    const replaced = await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09', overwrite: true });
    expect(replaced.status).toBe(201);
    const r2 = (await replaced.json()).report;
    expect(r2.id).toBe(report.id);
    expect(r2.edited).toBe(false);
    expect(r2.content.summary).toBe('');

    const list = await (await rep.call('GET', `/api/clients/${clientId}/monthly-reports`)).json();
    expect(list.reports.map((x) => x.month)).toEqual(['2026-09']);
  });

  it('lets an admin draft a month for every active client in chunks, skipping existing reports', async () => {
    const { admin, rep, clientId, otherId } = await setup();
    mockClaude();
    expect((await rep.call('POST', '/api/monthly-reports/bulk', { month: '2026-09' })).status).toBe(403);
    await rep.call('POST', `/api/clients/${clientId}/monthly-reports`, { month: '2026-09' });
    const results = [];
    let offset = 0;
    for (let i = 0; i < 50 && offset !== null; i++) {
      const out = await (await admin.call('POST', '/api/monthly-reports/bulk', { month: '2026-09', offset })).json();
      results.push(...out.results);
      offset = out.next;
    }
    expect(offset).toBeNull();
    expect(results.find((x) => x.client_id === clientId).status).toBe('skipped');
    expect(results.find((x) => x.client_id === otherId).status).toBe('created');
    const rows = (await env.DB.prepare("SELECT status FROM monthly_reports WHERE month='2026-09' AND client_id IN (?,?)").bind(clientId, otherId).all()).results;
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.status === 'draft')).toBe(true);
  });
});
