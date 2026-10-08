// In-person sales meetings: Deepgram turns the recording into a transcript with speakers,
// then Claude drafts CRM notes and fills the discovery questions it can answer from what was
// said. The rep reviews all of it before anything is saved to the client record.
import Anthropic from '@anthropic-ai/sdk';
import { buildSections } from '../../shared/discovery/engine.js';
import { visible } from '../../shared/discovery/schema.js';
import { SERVICES } from '../../shared/services.js';

export const deepgramReady = (env) => !!env.DEEPGRAM_API_KEY;
export const MAX_AUDIO = 95 * 1024 * 1024; // Workers accept request bodies up to 100 MB
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'video/mp4', 'video/quicktime', 'video/webm'];

// Sends the audio to Deepgram. Deepgram answers later at the callback URL, so long meetings
// don't depend on this request staying open.
export async function startTranscription(env, { audio, contentType, callbackUrl }) {
  const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', diarize: 'true', utterances: 'true', punctuate: 'true', callback: callbackUrl });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': contentType },
    body: audio,
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!res) return { ok: false, error: 'Could not reach Deepgram.' };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: res.status === 401 ? 'Deepgram rejected the API key.' : `Deepgram: ${String(data.err_msg || data.message || res.status).slice(0, 160)}` };
  return { ok: true, requestId: data.request_id || null };
}

// Deepgram's result → [{ speaker, start, end, text }] and the duration in seconds.
export function readDeepgram(json) {
  const utterances = json?.results?.utterances;
  let lines = [];
  if (Array.isArray(utterances) && utterances.length) {
    lines = utterances.map((u) => ({ speaker: Number(u.speaker ?? 0), start: u.start, end: u.end, text: String(u.transcript || '').trim() })).filter((l) => l.text);
  } else {
    const text = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (text) lines = [{ speaker: 0, start: 0, end: json?.metadata?.duration || 0, text }];
  }
  // Merge consecutive lines from the same speaker so the transcript reads like a conversation.
  const merged = [];
  for (const l of lines) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === l.speaker && l.start - last.end < 2) { last.text += ` ${l.text}`; last.end = l.end; } else merged.push({ ...l });
  }
  return { lines: merged, duration: json?.metadata?.duration ?? null };
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Questions Claude may answer: the master interview plus the client's industry questions.
export function questionsFor(industry, answers = {}) {
  return buildSections(industry, []).flatMap((s) => s.questions.filter((q) => visible(q, answers)).map((q) => ({ ...q, section: s.title })));
}

const SYSTEM = `You turn the transcript of an in-person sales meeting into CRM notes for Detcord Digital, a marketing agency in Michigan.
The meeting is between a Detcord sales rep and a business owner (the prospect). Speakers are labeled by number; work out which one is the prospect.
Only record what was actually said. Never invent numbers, names, budgets, dates or commitments. If something was not discussed, leave it out or say "Not discussed".
For discovery answers, answer only questions the conversation clearly answers, in the prospect's words where possible, and give a short supporting quote.
Value formats: single = one option value exactly as listed; multi = option values separated by "|"; yesno = "yes" or "no"; scale = a whole number 1-5; number and money = digits only; text and long = plain text.`;

export async function analyzeMeeting(env, { client, lines, questions }) {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 180000 });
  const ids = questions.map((q) => q.id);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'prospect_speaker', 'pain_points', 'goals', 'budget', 'timeline', 'decision_makers', 'objections', 'next_steps', 'answers', 'service_interest', 'follow_up_email'],
    properties: {
      summary: { type: 'string', description: 'Five sentences or fewer: who they are, what they want, where it stands.' },
      prospect_speaker: { type: 'integer', description: 'Speaker number of the business owner.' },
      pain_points: { type: 'array', items: { type: 'string' } },
      goals: { type: 'array', items: { type: 'string' } },
      budget: { type: 'string' },
      timeline: { type: 'string' },
      decision_makers: { type: 'string' },
      objections: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'owner', 'due_in_days'], properties: { title: { type: 'string' }, owner: { type: 'string', enum: ['rep', 'prospect'] }, due_in_days: { type: 'integer' } } } },
      answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'value', 'quote'], properties: { id: { type: 'string', enum: ids }, value: { type: 'string' }, quote: { type: 'string' } } } },
      service_interest: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['service_id', 'reason'], properties: { service_id: { type: 'string', enum: SERVICES.map((s) => s.id) }, reason: { type: 'string' } } }, description: 'Services the prospect showed interest in or clearly needs, based on what was said.' },
      follow_up_email: { type: 'string', description: 'A short thank-you email from the rep recapping the meeting and the agreed next step. No prices unless they were agreed in the meeting.' },
    },
  };
  const qList = questions.map((q) => `${q.id} | ${q.type} | ${q.q}${q.options ? ` | options: ${q.options.map((o) => `${o.v}=${o.l}`).join('; ')}` : ''}`).join('\n');
  const transcript = lines.map((l) => `[Speaker ${l.speaker} ${clock(l.start)}] ${l.text}`).join('\n');
  const services = SERVICES.map((s) => `${s.id}: ${s.name}`).join('\n');
  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Prospect business: ${client.name}${client.industry ? ` (${client.industry})` : ''}${client.city ? `, ${client.city}, ${client.state || 'MI'}` : ''}\n\nDiscovery questions (id | type | question | options):\n${qList}\n\nDetcord services (id: name):\n${services}\n\nTranscript:\n${transcript}` }],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to summarize this meeting.'), { status: 'refusal' });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The meeting was too long to summarize in one pass.'), { status: 'max_tokens' });
  return JSON.parse(response.content.find((b) => b.type === 'text')?.text || '{}');
}

// Converts Claude's string answers to the discovery runner's value types; drops anything invalid.
export function toDiscoveryAnswers(items, questions) {
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
  const out = {};
  for (const { id, value } of items || []) {
    const q = byId[id];
    const v = String(value ?? '').trim();
    if (!q || !v || /^not discussed$/i.test(v)) continue;
    const allowed = new Set((q.options || []).map((o) => o.v));
    if (q.type === 'single') { if (allowed.has(v)) out[id] = v; }
    else if (q.type === 'multi') { const vals = v.split('|').map((x) => x.trim()).filter((x) => allowed.has(x)); if (vals.length) out[id] = vals; }
    else if (q.type === 'yesno') { if (/^(yes|true)$/i.test(v)) out[id] = true; else if (/^(no|false)$/i.test(v)) out[id] = false; }
    else if (q.type === 'scale') { const n = Math.round(Number(v)); if (n >= 1 && n <= 5) out[id] = n; }
    else if (q.type === 'number' || q.type === 'money') { const n = Number(v.replace(/[^0-9.]/g, '')); if (Number.isFinite(n) && v.replace(/[^0-9.]/g, '')) out[id] = n; }
    else out[id] = v.slice(0, 5000);
  }
  return out;
}
