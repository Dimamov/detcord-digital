import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as, BASE } from './helpers.js';
import { analyzeMeeting, toDiscoveryAnswers, questionsFor, readDeepgram } from '../src/worker/lib/meetings.js';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const rep = await as('rep');
  const otherRep = await as('rep');
  const owner = await as('client');
  const id = crypto.randomUUID();
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO clients (id, name, industry, city, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, 'Oak Park Plumbing', 'home', 'Oak Park', 'MI', t, t),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(id, owner.id),
    env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, rep.id, t),
  ]);
  return { rep, otherRep, owner, clientId: id };
}

const AUDIO = new Uint8Array(4096).map((_, i) => i % 251);

function upload(user, clientId, { consent = 'yes', type = 'audio/webm' } = {}) {
  return SELF.fetch(`${BASE}/api/clients/${clientId}/meetings?consent=${consent}&title=First%20visit&filename=meeting.webm`, {
    method: 'PUT', headers: { 'Content-Type': type, Origin: BASE, Cookie: user.cookie }, body: AUDIO,
  });
}

const DEEPGRAM_RESULT = {
  metadata: { duration: 95.2 },
  results: { utterances: [
    { speaker: 0, start: 0, end: 3, transcript: 'Thanks for meeting with me.' },
    { speaker: 1, start: 3.5, end: 8, transcript: 'Sure. Our phones are slow in the winter.' },
    { speaker: 1, start: 8.2, end: 12, transcript: 'We have been in business about twelve years.' },
  ] },
};

describe('Recorded meetings', () => {
  it('needs consent, stays staff-only, and accepts the transcript only with the one-time token', async () => {
    const { rep, otherRep, owner, clientId } = await setup();
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input?.url || input);
      if (url.startsWith('https://api.deepgram.com/')) {
        calls.push({ url, auth: (init.headers || {}).Authorization, size: (await new Response(init.body).arrayBuffer()).byteLength });
        return new Response(JSON.stringify({ request_id: 'dg-req-1' }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}');
    });

    expect((await upload(rep, clientId, { consent: 'no' })).status).toBe(400);
    expect((await upload(owner, clientId)).status).toBe(403);
    expect((await upload(otherRep, clientId)).status).toBe(404);
    expect((await upload(rep, clientId, { type: 'text/html' })).status).toBe(415);

    const res = await upload(rep, clientId);
    expect(res.status).toBe(201);
    const { meeting } = await res.json();
    expect(meeting).toMatchObject({ status: 'transcribing', has_audio: true, title: 'First visit' });
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe('Token test-deepgram-key');
    expect(calls[0].size).toBe(AUDIO.length);
    const callback = new URL(new URL(calls[0].url).searchParams.get('callback'));
    expect(callback.pathname).toBe(`/api/webhooks/deepgram/${meeting.id}`);

    // Clients and unassigned reps can't see it.
    expect((await owner.call('GET', `/api/meetings/${meeting.id}`)).status).toBe(403);
    expect((await otherRep.call('GET', `/api/meetings/${meeting.id}`)).status).toBe(404);
    expect((await owner.call('GET', `/api/meetings/${meeting.id}/audio`)).status).toBe(403);
    expect((await owner.call('GET', `/api/clients/${clientId}/meetings`)).status).toBe(403);

    // Wrong token is ignored.
    const post = (url) => SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEEPGRAM_RESULT) });
    expect((await post(`${BASE}/api/webhooks/deepgram/${meeting.id}?token=wrong`)).status).toBe(404);
    expect((await post(`${BASE}${callback.pathname}${callback.search}`)).status).toBe(200);
    // The token works once.
    expect((await post(`${BASE}${callback.pathname}${callback.search}`)).status).toBe(404);

    const detail = await (await rep.call('GET', `/api/meetings/${meeting.id}`)).json();
    expect(detail.meeting.status).toBe('transcribed');
    expect(detail.meeting.duration_sec).toBe(95.2);
    expect(detail.meeting.transcript).toEqual([
      { speaker: 0, start: 0, end: 3, text: 'Thanks for meeting with me.' },
      { speaker: 1, start: 3.5, end: 12, text: 'Sure. Our phones are slow in the winter. We have been in business about twelve years.' },
    ]);
    expect(detail.meeting.consent_by).toBe(rep.id);

    const audio = await SELF.fetch(`${BASE}/api/meetings/${meeting.id}/audio`, { headers: { Cookie: rep.cookie, Range: 'bytes=0-99' } });
    expect(audio.status).toBe(206);
    expect(audio.headers.get('Cache-Control')).toContain('no-store');
    expect((await audio.arrayBuffer()).byteLength).toBe(100);

    // Claude isn't configured in tests, so analysis says so instead of pretending.
    expect((await rep.call('POST', `/api/meetings/${meeting.id}/analyze`)).status).toBe(400);

    // Deleting the recording keeps the transcript.
    expect((await rep.call('DELETE', `/api/meetings/${meeting.id}/audio`)).status).toBe(200);
    const row = await env.DB.prepare('SELECT r2_key, transcript FROM meetings WHERE id=?').bind(meeting.id).first();
    expect(row.r2_key).toBeNull();
    expect(row.transcript).toBeTruthy();
    expect(await env.MEDIA.get(`meetings/${clientId}/${meeting.id}`)).toBeNull();
  });

  it('marks the meeting failed when Deepgram rejects the key', async () => {
    const { rep, clientId } = await setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ err_msg: 'Invalid credentials.' }), { status: 401 }));
    const { meeting } = await (await upload(rep, clientId)).json();
    expect(meeting).toMatchObject({ status: 'failed', error: 'Deepgram rejected the API key.' });
  });

  it('drafts notes with Claude and saves only what the rep picked', async () => {
    const { rep, clientId } = await setup();
    const client = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
    const questions = questionsFor(client.industry);
    const years = questions.find((q) => q.id === 'years');
    expect(years).toBeTruthy();
    const analysis = {
      summary: 'Twelve-year plumbing company; winter calls are slow.', prospect_speaker: 1, pain_points: ['Slow winter'], goals: ['More winter calls'],
      budget: 'Not discussed', timeline: 'Before November', decision_makers: 'Owner', objections: [],
      next_steps: [{ title: 'Send a proposal', owner: 'rep', due_in_days: 2 }, { title: 'Share Google login', owner: 'prospect', due_in_days: 5 }],
      answers: [{ id: 'years', value: '10+', quote: 'about twelve years' }, { id: 'team_size', value: 'lots', quote: '' }],
      service_interest: [], follow_up_email: 'Thanks for your time today.',
    };
    let sent;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(analysis) }] }), { headers: { 'Content-Type': 'application/json' } });
    });
    const { lines } = readDeepgram(DEEPGRAM_RESULT);
    const out = await analyzeMeeting({ ANTHROPIC_API_KEY: 'test-key' }, { client, lines, questions });
    expect(out.summary).toBe(analysis.summary);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config.format.schema.properties.answers.items.properties.id.enum).toContain('years');
    expect(sent.messages[0].content).toContain('[Speaker 1 0:03] Sure. Our phones are slow in the winter.');

    // Seed a ready meeting and save part of it.
    const id = crypto.randomUUID();
    const t = Date.now();
    await env.DB.prepare(`INSERT INTO meetings (id, client_id, rep_id, title, consent_by, consent_at, status, transcript, analysis, created_at, updated_at)
        VALUES (?,?,?,?,?,?, 'ready', ?, ?, ?, ?)`).bind(id, clientId, rep.id, 'First visit', rep.id, t, JSON.stringify(lines), JSON.stringify(analysis), t, t).run();
    const res = await rep.call('POST', `/api/meetings/${id}/save`, { note: true, next_steps: [0], answers: ['years', 'team_size'] });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ note: true, tasks: 1, answers: 1 });
    const d = await env.DB.prepare('SELECT * FROM discoveries WHERE id=?').bind(saved.discovery_id).first();
    expect(JSON.parse(d.answers)).toEqual({ years: '10+' });
    expect(d.status).toBe('in_progress');
    const tasks = (await env.DB.prepare('SELECT title FROM tasks WHERE client_id=?').bind(clientId).all()).results;
    expect(tasks.map((x) => x.title)).toEqual(['Send a proposal']);
    const note = await env.DB.prepare('SELECT body, visibility FROM notes WHERE client_id=?').bind(clientId).first();
    expect(note.visibility).toBe('internal');
    expect(note.body).toContain('Slow winter');
  });
});

describe('toDiscoveryAnswers', () => {
  it('converts Claude’s strings to the runner’s types and drops invalid values', () => {
    const qs = [
      { id: 's', type: 'single', options: [{ v: 'a' }, { v: 'b' }] }, { id: 'm', type: 'multi', options: [{ v: 'x' }, { v: 'y' }] },
      { id: 'yn', type: 'yesno' }, { id: 'sc', type: 'scale' }, { id: 'n', type: 'money' }, { id: 't', type: 'text' }, { id: 'bad', type: 'single', options: [{ v: 'a' }] },
    ];
    expect(toDiscoveryAnswers([
      { id: 's', value: 'b' }, { id: 'm', value: 'x | z | y' }, { id: 'yn', value: 'No' }, { id: 'sc', value: '4' },
      { id: 'n', value: '$2,500' }, { id: 't', value: 'Word of mouth' }, { id: 'bad', value: 'c' }, { id: 'nope', value: '1' }, { id: 't', value: 'Not discussed' },
    ], qs)).toEqual({ s: 'b', m: ['x', 'y'], yn: false, sc: 4, n: 2500, t: 'Word of mouth' });
  });
});
