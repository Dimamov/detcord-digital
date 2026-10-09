// Recorded in-person sales meetings. Staff only: every route checks the client scope on the
// server, and Deepgram's callback is accepted only with the one-time token issued for that meeting.
import { Hono } from 'hono';
import { fail, now, newId, sha256, randomToken, readJson, logActivity, text, safeEqual } from '../lib/util.js';
import { requireClient } from '../lib/auth.js';
import { aiReady, originFor } from '../lib/goat.js';
import { deepgramReady, MAX_AUDIO, AUDIO_TYPES, startTranscription, readDeepgram, questionsFor, analyzeMeeting, toDiscoveryAnswers } from '../lib/meetings.js';
import { cleanAnswers } from './discovery.js';
import { serviceById } from '../../shared/services.js';

const r = new Hono();
const STALE_ANALYSIS_MS = 10 * 60 * 1000;
const EXT_TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', mov: 'video/quicktime' };

async function loadMeeting(c, id) {
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id=?').bind(id).first();
  if (!m) fail(404, 'Meeting not found.');
  const { user, client } = await requireClient(c, m.client_id, { staffOnly: true });
  return { user, client, m };
}

function shape(m) {
  return {
    id: m.id, client_id: m.client_id, client_name: m.client_name, title: m.title, rep_id: m.rep_id, rep_name: m.rep_name,
    consent_by: m.consent_by, consent_name: m.consent_name, consent_at: m.consent_at,
    has_audio: !!m.r2_key, content_type: m.content_type, size: m.size, duration_sec: m.duration_sec,
    status: m.status, error: m.error, discovery_id: m.discovery_id, saved_at: m.saved_at,
    created_at: m.created_at, updated_at: m.updated_at,
  };
}

// Sends the stored audio to Deepgram with a fresh one-time callback token.
async function transcribe(c, m) {
  if (!deepgramReady(c.env)) {
    await c.env.DB.prepare("UPDATE meetings SET status='failed', error=?, updated_at=? WHERE id=?").bind('Transcription is not set up yet (DEEPGRAM_API_KEY).', now(), m.id).run();
    return;
  }
  const obj = await c.env.MEDIA.get(m.r2_key);
  if (!obj) fail(404, 'The recording is missing.');
  const token = randomToken();
  const callbackUrl = `${originFor(c.env, c.req.url)}/api/webhooks/deepgram/${m.id}?token=${token}`;
  await c.env.DB.prepare("UPDATE meetings SET status='transcribing', error=NULL, callback_hash=?, updated_at=? WHERE id=?").bind(await sha256(token), now(), m.id).run();
  const res = await startTranscription(c.env, { audio: obj.body, contentType: m.content_type, callbackUrl });
  if (res.ok) await c.env.DB.prepare('UPDATE meetings SET provider_request_id=?, updated_at=? WHERE id=?').bind(res.requestId, now(), m.id).run();
  else await c.env.DB.prepare("UPDATE meetings SET status='failed', error=?, callback_hash=NULL, updated_at=? WHERE id=?").bind(res.error, now(), m.id).run();
}

// ---------- Record / upload ----------

// The audio is streamed straight into storage so long meetings don't have to fit in memory.
r.put('/clients/:id/meetings', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const q = c.req.query();
  if (q.consent !== 'yes') fail(400, 'Confirm the client agreed to be recorded.');
  const declared = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = String(q.filename || '').split('.').pop().toLowerCase();
  // The file extension decides only when the browser didn't name a type.
  const type = AUDIO_TYPES.includes(declared) ? declared : !declared || declared === 'application/octet-stream' ? EXT_TYPES[ext] : null;
  if (!type) fail(415, 'Use an audio recording (webm, m4a, mp3, wav, ogg or flac).');
  const length = Number(c.req.header('Content-Length') || 0);
  if (!length) fail(411, 'The recording is empty.');
  if (length > MAX_AUDIO) fail(413, 'Recordings can be up to 95 MB, about 3 hours from the browser recorder.');
  const id = newId();
  const key = `meetings/${client.id}/${id}`;
  const obj = await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: type }, customMetadata: { clientId: client.id, uploader: user.id } });
  if (!obj?.size) { await c.env.MEDIA.delete(key); fail(400, 'The recording is empty.'); }
  const t = now();
  const title = text(q.title, { max: 120 }) || `Meeting with ${client.name}`;
  await c.env.DB.prepare(`INSERT INTO meetings (id, client_id, rep_id, title, consent_by, consent_at, r2_key, content_type, size, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'uploaded',?,?)`)
    .bind(id, client.id, user.id, title, user.id, t, key, type, obj.size, t, t).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'meeting', summary: `Recorded a meeting: ${title}` });
  await transcribe(c, { id, r2_key: key, content_type: type });
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id=?').bind(id).first();
  return c.json({ meeting: shape(m) }, 201);
});

// ---------- Deepgram callback (no session; the one-time token is the credential) ----------

r.post('/webhooks/deepgram/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token') || '';
  const m = await c.env.DB.prepare('SELECT id, status, callback_hash FROM meetings WHERE id=?').bind(id).first();
  if (!m || !m.callback_hash || !token || !safeEqual(await sha256(token), m.callback_hash)) return c.json({ error: 'Not found.' }, 404);
  if (m.status !== 'transcribing') return c.json({ ok: true, duplicate: true });
  const json = await c.req.json().catch(() => null);
  const { lines, duration } = readDeepgram(json);
  if (!lines.length) {
    await c.env.DB.prepare("UPDATE meetings SET status='failed', error=?, callback_hash=NULL, updated_at=? WHERE id=? AND status='transcribing'")
      .bind(json?.err_msg ? `Deepgram: ${String(json.err_msg).slice(0, 160)}` : 'No speech was found in the recording.', now(), id).run();
    return c.json({ ok: true });
  }
  await c.env.DB.prepare("UPDATE meetings SET status='transcribed', transcript=?, duration_sec=?, callback_hash=NULL, error=NULL, updated_at=? WHERE id=? AND status='transcribing'")
    .bind(JSON.stringify(lines), duration, now(), id).run();
  return c.json({ ok: true });
});

// ---------- Read ----------

r.get('/clients/:id/meetings', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const rows = (await c.env.DB.prepare(`SELECT m.*, u.name AS rep_name FROM meetings m LEFT JOIN users u ON u.id=m.rep_id
      WHERE m.client_id=? ORDER BY m.created_at DESC LIMIT 100`).bind(client.id).all()).results;
  return c.json({ meetings: rows.map(shape), ready: { transcription: deepgramReady(c.env), ai: aiReady(c.env) } });
});

r.get('/meetings/:id', async (c) => {
  const { client, m } = await loadMeeting(c, c.req.param('id'));
  const names = (await c.env.DB.prepare('SELECT id, name FROM users WHERE id IN (?, ?)').bind(m.rep_id, m.consent_by).all()).results;
  const name = (id) => names.find((u) => u.id === id)?.name || null;
  return c.json({
    meeting: { ...shape({ ...m, client_name: client.name, rep_name: name(m.rep_id), consent_name: name(m.consent_by) }), transcript: m.transcript ? JSON.parse(m.transcript) : [], analysis: m.analysis ? JSON.parse(m.analysis) : null },
    questions: m.analysis ? Object.fromEntries(questionsFor(client.industry).map((q) => [q.id, { q: q.q, section: q.section, type: q.type, options: q.options }])) : {},
    services: Object.fromEntries(Object.values(serviceById).map((s) => [s.id, s.name])),
    ready: { transcription: deepgramReady(c.env), ai: aiReady(c.env) },
  });
});

r.get('/meetings/:id/audio', async (c) => {
  const { m } = await loadMeeting(c, c.req.param('id'));
  if (!m.r2_key) fail(404, 'The recording was deleted.');
  const range = c.req.header('Range');
  const obj = await c.env.MEDIA.get(m.r2_key, range ? { range: c.req.raw.headers } : undefined);
  if (!obj) fail(404, 'The recording is missing.');
  const headers = { 'Content-Type': m.content_type, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' };
  if (range && obj.range) {
    const start = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - start;
    return new Response(obj.body, { status: 206, headers: { ...headers, 'Content-Length': String(len), 'Content-Range': `bytes ${start}-${start + len - 1}/${obj.size}` } });
  }
  return new Response(obj.body, { headers: { ...headers, 'Content-Length': String(obj.size) } });
});

// ---------- Process ----------

r.post('/meetings/:id/retry', async (c) => {
  const { m } = await loadMeeting(c, c.req.param('id'));
  if (!m.r2_key) fail(400, 'The recording was deleted, so it cannot be transcribed again.');
  if (m.status === 'transcribing' && now() - m.updated_at < STALE_ANALYSIS_MS) fail(409, 'This recording is still being transcribed.');
  if (m.transcript) {
    await c.env.DB.prepare("UPDATE meetings SET status='transcribed', error=NULL, updated_at=? WHERE id=?").bind(now(), m.id).run();
  } else {
    await transcribe(c, m);
  }
  return c.json({ ok: true });
});

// Claude drafts the notes. The page calls this once the transcript is in; it can take a minute.
r.post('/meetings/:id/analyze', async (c) => {
  const { client, m } = await loadMeeting(c, c.req.param('id'));
  if (!aiReady(c.env)) fail(400, 'Claude is not set up yet (ANTHROPIC_API_KEY).');
  if (!m.transcript) fail(400, 'The transcript is not ready yet.');
  if (m.status === 'analyzing' && now() - m.updated_at < STALE_ANALYSIS_MS) fail(409, 'Claude is already working on this meeting.');
  const claimed = await c.env.DB.prepare("UPDATE meetings SET status='analyzing', error=NULL, updated_at=? WHERE id=? AND updated_at=?").bind(now(), m.id, m.updated_at).run();
  if (!claimed.meta.changes) fail(409, 'Claude is already working on this meeting.');
  let analysis;
  try {
    analysis = await analyzeMeeting(c.env, { client, lines: JSON.parse(m.transcript), questions: questionsFor(client.industry) });
  } catch (e) {
    const error = e?.status === 401 ? 'Anthropic rejected the API key.' : e?.status === 'refusal' || e?.status === 'max_tokens' ? e.message : 'Claude could not summarize this meeting. Try again.';
    await c.env.DB.prepare("UPDATE meetings SET status='transcribed', error=?, updated_at=? WHERE id=?").bind(error, now(), m.id).run();
    fail(502, error);
  }
  await c.env.DB.prepare("UPDATE meetings SET status='ready', analysis=?, error=NULL, updated_at=? WHERE id=?").bind(JSON.stringify(analysis), now(), m.id).run();
  return c.json({ analysis });
});

r.patch('/meetings/:id', async (c) => {
  const { m } = await loadMeeting(c, c.req.param('id'));
  const b = await readJson(c);
  const title = text(b.title, { max: 120, required: true, label: 'Title' });
  await c.env.DB.prepare('UPDATE meetings SET title=?, updated_at=? WHERE id=?').bind(title, now(), m.id).run();
  return c.json({ ok: true });
});

// ---------- Save to the CRM (only what the rep ticked) ----------

r.post('/meetings/:id/save', async (c) => {
  const { user, client, m } = await loadMeeting(c, c.req.param('id'));
  if (!m.analysis) fail(400, 'There are no notes to save yet.');
  const a = JSON.parse(m.analysis);
  const b = await readJson(c);
  const db = c.env.DB;
  const t = now();
  const pick = (list, idx) => (Array.isArray(idx) ? [...new Set(idx)] : []).filter((i) => Number.isInteger(i) && list?.[i]).map((i) => list[i]);
  const out = { note: false, tasks: 0, answers: 0, discovery_id: m.discovery_id };

  if (b.note) {
    const lines = [`Meeting notes: ${m.title}`, '', a.summary];
    const list = (label, items) => items?.length && lines.push('', `${label}:`, ...items.map((x) => `- ${x}`));
    list('Pain points', a.pain_points);
    list('Goals', a.goals);
    list('Objections', a.objections);
    for (const [label, v] of [['Budget', a.budget], ['Timeline', a.timeline], ['Decision makers', a.decision_makers]]) if (v) lines.push('', `${label}: ${v}`);
    const services = pick(a.service_interest, b.services).map((s) => `- ${serviceById[s.service_id]?.name || s.service_id}: ${s.reason}`);
    if (services.length) lines.push('', 'Services to recommend:', ...services);
    await db.prepare("INSERT INTO notes (id, client_id, author_id, body, visibility, created_at) VALUES (?,?,?,?,'internal',?)")
      .bind(newId(), client.id, user.id, lines.join('\n').slice(0, 20000), t).run();
    out.note = true;
  }

  for (const s of pick(a.next_steps, b.next_steps)) {
    const title = `${s.owner === 'prospect' ? 'Follow up: client to ' : ''}${s.title}`.slice(0, 200);
    const days = Math.min(Math.max(Number(s.due_in_days) || 3, 0), 90);
    await db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), client.id, user.id, title, t + days * 86400000, user.id, t).run();
    out.tasks++;
  }

  const chosen = new Set(Array.isArray(b.answers) ? b.answers : []);
  const items = (a.answers || []).filter((x) => chosen.has(x.id));
  if (items.length) {
    const industry = client.industry || null;
    let d = m.discovery_id ? await db.prepare("SELECT * FROM discoveries WHERE id=? AND client_id=? AND status='in_progress'").bind(m.discovery_id, client.id).first() : null;
    const modules = d ? JSON.parse(d.modules) : [];
    const answers = cleanAnswers(toDiscoveryAnswers(items, questionsFor(industry)), d?.industry ?? industry, modules);
    out.answers = Object.keys(answers).length;
    if (d) {
      await db.prepare('UPDATE discoveries SET answers=?, updated_at=? WHERE id=?').bind(JSON.stringify({ ...JSON.parse(d.answers), ...answers }), t, d.id).run();
    } else if (out.answers) {
      const deal = await db.prepare("SELECT d.id FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=? AND ps.outcome='open' ORDER BY d.updated_at DESC LIMIT 1").bind(client.id).first();
      d = { id: newId() };
      await db.prepare('INSERT INTO discoveries (id, client_id, deal_id, rep_id, industry, modules, answers, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(d.id, client.id, deal?.id || null, user.id, industry, '[]', JSON.stringify(answers), t, t).run();
    }
    if (d) out.discovery_id = d.id;
  }

  await db.prepare('UPDATE meetings SET discovery_id=?, saved_at=?, saved_by=?, updated_at=? WHERE id=?').bind(out.discovery_id, t, user.id, t, m.id).run();
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'meeting', summary: `Saved meeting notes: ${m.title}` });
  return c.json(out);
});

// ---------- Delete ----------

r.delete('/meetings/:id/audio', async (c) => {
  const { user, client, m } = await loadMeeting(c, c.req.param('id'));
  if (m.status === 'transcribing') fail(409, 'Wait until the transcript is ready.');
  if (m.r2_key) await c.env.MEDIA.delete(m.r2_key);
  await c.env.DB.prepare('UPDATE meetings SET r2_key=NULL, updated_at=? WHERE id=?').bind(now(), m.id).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'meeting', summary: `Deleted the recording of ${m.title}` });
  return c.json({ ok: true });
});

r.delete('/meetings/:id', async (c) => {
  const { user, client, m } = await loadMeeting(c, c.req.param('id'));
  if (m.r2_key) await c.env.MEDIA.delete(m.r2_key);
  await c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(m.id).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'meeting', summary: `Deleted meeting ${m.title}` });
  return c.json({ ok: true });
});

export default r;
