// Proposals. Staff check the services; the facts come only from what this one client told us and what
// we measured (discovery, pre-call answers, meetings, the latest website check). Claude explains why each
// service fits, in their terms, and staff edit and share. Prices are set by staff per service and the
// investment totals are computed here, never by Claude, which doesn't see a price.
import Anthropic from '@anthropic-ai/sdk';
import { fail, now, newId, cents, HttpError } from './util.js';
import { aiReady } from './goat.js';
import { CATEGORIES as AUDIT_CATEGORIES } from './audit/checks.js';
import { buildSections, intakeToAnswers, INTAKE } from '../../shared/discovery/engine.js';
import { industryById } from '../../shared/discovery/industries.js';

const DAY = 86400000;
const json = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const clip = (s, n) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

// Money questions (ticket size, ad budget, marketing spend) never reach Claude: the only figures in a
// proposal are the prices staff set, and Claude can't misquote a figure it never saw.
const MONEYISH = /(^|_)(budget|spend|revenue|cpl|fee)(_|$)/;
const skipQuestion = (q) => q.type === 'money' || MONEYISH.test(q.id);

// An answer as the client would read it: option labels instead of codes.
function answerText(q, v) {
  const label = (x) => q.options?.find((o) => o.v === x)?.l || x;
  if (q.type === 'yesno') return v === true ? 'Yes' : v === false ? 'No' : String(v);
  if (q.type === 'scale') return `${v} of 5`;
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (q.type === 'single') return label(v);
  return clip(v, 1500);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Services ----------

// The checked services from a request body, in catalog order, with staff's prices (dollars in, cents stored).
export async function cleanServices(db, raw) {
  if (!Array.isArray(raw) || raw.length > 30) fail(400, 'The services list is not valid.');
  const catalog = (await db.prepare('SELECT id, name, position FROM services WHERE active=1').all()).results;
  const known = new Map(catalog.map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const id = String(s?.serviceId || '');
    if (!known.has(id) || seen.has(id)) fail(400, 'Choose each service once from the catalog.');
    seen.add(id);
    const name = known.get(id).name;
    out.push({ serviceId: id, name, setupCents: cents(s.setup, `${name} one-time price`), monthlyCents: cents(s.monthly, `${name} monthly price`), scope: String(s.scope ?? '').trim().slice(0, 600) });
  }
  if (!out.length) fail(400, 'Check at least one service.');
  return out.sort((a, b) => known.get(a.serviceId).position - known.get(b.serviceId).position);
}

// What the builder starts with: every active service, checked when the latest discovery recommended it
// (start with / next) or the client record has it as recommended or proposed, priced from the client
// record or else the catalog.
export async function builderServices(db, clientId) {
  const [catalog, picked, disc] = (await db.batch([
    db.prepare('SELECT id, name, category, description, setup_cents, monthly_cents FROM services WHERE active=1 ORDER BY position'),
    db.prepare('SELECT service_id, status, setup_cents, monthly_cents FROM client_services WHERE client_id=?').bind(clientId),
    db.prepare("SELECT result FROM discoveries WHERE client_id=? AND result IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(clientId),
  ])).map((r) => r.results);
  const recommended = new Map((json(disc[0]?.result)?.recommended || []).map((x) => [x.serviceId, x]));
  const mine = new Map(picked.map((p) => [p.service_id, p]));
  const status = new Map(picked.filter((p) => p.status !== 'ended').map((p) => [p.service_id, p.status]));
  return catalog.map((s) => {
    const rec = recommended.get(s.id);
    const cs = mine.get(s.id);
    return {
      serviceId: s.id, name: s.name, category: s.category, description: s.description,
      setupCents: cs?.setup_cents ?? s.setup_cents ?? null, monthlyCents: cs?.monthly_cents ?? s.monthly_cents ?? null,
      status: status.get(s.id) || null, priority: rec?.priority || null, reasons: rec?.reasons || [],
      checked: (rec && rec.priority !== 'later') || ['recommended', 'proposed'].includes(status.get(s.id)),
    };
  });
}

// ---------- Facts ----------

// Everything we know about this one client that a proposal can draw on. Every query is scoped to the
// client here, so nothing from another business can reach the draft. No prices, budgets or transcripts:
// the investment section is computed by the portal.
export async function gatherFacts(db, client, services) {
  const id = client.id;
  const q = (sql, ...binds) => db.prepare(sql).bind(...binds);
  const [discs, intakes, audits, meetings, catalog, custom] = (await db.batch([
    q("SELECT industry, modules, answers, result, status, updated_at FROM discoveries WHERE client_id=? ORDER BY status='complete' DESC, updated_at DESC LIMIT 1", id),
    q('SELECT answers, submitted_at FROM intake_links WHERE client_id=? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1', id),
    q("SELECT url, score, result, hidden, created_at FROM audits WHERE client_id=? AND status='done' ORDER BY created_at DESC LIMIT 1", id),
    q('SELECT title, analysis, created_at FROM meetings WHERE client_id=? AND analysis IS NOT NULL ORDER BY created_at DESC LIMIT 5', id),
    db.prepare('SELECT id, name, description FROM services'),
    q('SELECT name FROM custom_industries WHERE id=?', client.industry || ''),
  ])).map((r) => r.results);
  const catalogById = new Map(catalog.map((s) => [s.id, s]));

  // Pre-call questions: the client's own words.
  const intakeRaw = json(intakes[0]?.answers) || {};
  const intake = INTAKE.questions.filter((qu) => !empty(intakeRaw[qu.id]) && !skipQuestion(qu) && qu.id !== 'monthly_spend')
    .map((qu) => ({ question: qu.q, answer: answerText(qu, intakeRaw[qu.id]) }));

  // Discovery: the rep records answers during the call; answers prefilled from the pre-call form and
  // left unchanged are marked as the client's own.
  const d = discs[0];
  let discovery = null;
  if (d) {
    const answers = json(d.answers) || {};
    const fromIntake = intakeToAnswers(intakeRaw);
    const result = json(d.result);
    discovery = {
      status: d.status === 'complete' ? 'complete' : 'in progress', date: day(d.updated_at),
      answers: buildSections(d.industry, json(d.modules) || []).flatMap((s) => s.questions
        .filter((qu) => !empty(answers[qu.id]) && !skipQuestion(qu))
        .map((qu) => ({ section: s.title, question: qu.q, answer: answerText(qu, answers[qu.id]), entered_by: same(answers[qu.id], fromIntake[qu.id]) ? 'client (pre-call form)' : 'rep (discovery call notes)' }))),
      result: result ? {
        internal_lead_score: { total: result.score?.total, max: result.score?.max, grade: result.score?.grade, dimensions: (result.score?.dimensions || []).map((x) => ({ name: x.name, score: x.score })) },
        internal_red_flags: result.redFlags || [],
        recommended_services: (result.recommended || []).map((x) => ({ service_id: x.serviceId, name: x.name, priority: x.priority, reasons: x.reasons })),
      } : null,
    };
  }

  // The latest website check, with only the findings staff left visible to the customer.
  const a = audits[0];
  let website_check = null;
  if (a) {
    const res = json(a.result) || {};
    const hidden = new Set(json(a.hidden) || []);
    const area = (cat) => AUDIT_CATEGORIES.find((x) => x.id === cat)?.label || cat;
    website_check = {
      date: day(a.created_at), url: a.url, score: a.score,
      area_scores: Object.fromEntries(Object.entries(res.scores || {}).map(([k, v]) => [area(k), v])),
      findings: (res.findings || []).filter((f) => !hidden.has(f.id)).slice(0, 25)
        .map((f) => ({ area: area(f.cat), severity: f.severity, title: clip(f.title, 200), detail: clip(f.detail, 400), related_service: f.service || null })),
    };
  }

  const meetingFacts = meetings.map((m) => {
    const x = json(m.analysis) || {};
    return {
      date: day(m.created_at), title: m.title, summary: clip(x.summary, 1200) || null,
      pain_points: (x.pain_points || []).map((p) => clip(p, 300)), goals: (x.goals || []).map((g) => clip(g, 300)),
      timeline: clip(x.timeline, 200) || null, objections: (x.objections || []).map((o) => clip(o, 300)),
      client_quotes: (x.answers || []).filter((v) => v.quote && !MONEYISH.test(v.id)).map((v) => clip(v.quote, 400)).slice(0, 20),
      services_they_showed_interest_in: (x.service_interest || []).map((s) => ({ service_id: s.service_id, reason: clip(s.reason, 300) })),
    };
  });

  const recs = new Map((discovery?.result?.recommended_services || []).map((x) => [x.service_id, x]));
  return {
    business: {
      name: client.name, industry: industryById[client.industry]?.name || custom[0]?.name || (client.industry === 'other' ? 'Other' : null),
      city: client.city || null, state: client.state || null, website: client.website || null,
    },
    services_chosen: services.map((s) => ({
      service_id: s.serviceId, name: s.name, what_it_is: catalogById.get(s.serviceId)?.description || null, scope_note_from_rep: s.scope || null,
      discovery_reasons: recs.get(s.serviceId)?.reasons || [],
      website_check_findings: (website_check?.findings || []).filter((f) => f.related_service === s.serviceId).map((f) => f.title),
    })),
    pre_call_answers: intake.length ? { submitted: day(intakes[0].submitted_at), answers: intake } : null,
    discovery,
    meetings: meetingFacts,
    website_check,
  };
}

// ---------- Content ----------

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

// The proposal as staff edit it and the client reads it, with one entry per checked service in the
// checked order. staff_notes never reach the client. Prices live on the services, not in the content.
export function cleanContent(c = {}, services = []) {
  const given = new Map((Array.isArray(c.services) ? c.services : []).map((s) => [s?.serviceId, s]));
  return {
    intro: str(c.intro, 4000),
    services: services.map((svc) => {
      const s = given.get(svc.serviceId) || {};
      return {
        serviceId: svc.serviceId, name: svc.name,
        why: str(s.why, 2000),
        features: list(s.features, 400, 12),
        benefits: list(s.benefits, 400, 12),
        concerns: (Array.isArray(s.concerns) ? s.concerns : []).map((x) => ({ concern: str(x?.concern, 600), quote: str(x?.quote, 600), source: str(x?.source, 120) }))
          .filter((x) => x.concern || x.quote).slice(0, 8),
        timeline: str(s.timeline, 1000),
      };
    }),
    next_steps: list(c.next_steps, 400, 10),
    staff_notes: list(c.staff_notes, 600, 20),
  };
}

export const clientContent = (c) => ({ intro: c.intro, services: c.services, next_steps: c.next_steps });

// The investment summary, always computed here from the prices staff set. A service without a price
// is listed as to be confirmed rather than counted as free.
export function investment(services) {
  const lines = services.map((s) => ({ serviceId: s.serviceId, name: s.name, setupCents: s.setupCents ?? null, monthlyCents: s.monthlyCents ?? null }));
  const sum = (k) => lines.reduce((t, l) => t + (l[k] || 0), 0);
  return {
    lines,
    setupCents: sum('setupCents'),
    monthlyCents: sum('monthlyCents'),
    unpriced: lines.filter((l) => l.setupCents == null && l.monthlyCents == null).map((l) => l.name),
  };
}

export const DEFAULT_NEXT_STEPS = [
  'Read this proposal and send us any questions from your portal.',
  'When it looks right, press Accept. We then prepare your service agreement with these services and prices for you to review and sign.',
  'Once the agreement is signed, we schedule a kickoff call and get started.',
];

// Normalizes text for quote matching: case, curly quotes and dashes, and whitespace don't count.
const norm = (s) => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

// A quote must appear word for word in the facts. Any that doesn't is removed and listed for staff.
export function checkQuotes(content, facts) {
  const hay = strings(facts).map(norm);
  const dropped = [];
  for (const s of content.services) {
    for (const x of s.concerns) {
      const q = norm(x.quote.replace(/^["'“‘]+|["'”’]+$/g, '').replace(/[.…]+$/, ''));
      if (!q) { x.quote = ''; continue; }
      if (hay.some((h) => h.includes(q))) { x.quote = x.quote.replace(/^["'“‘]+|["'”’]+$/g, ''); continue; }
      dropped.push(`Removed a quote under ${s.name} that isn’t in the facts word for word: "${clip(x.quote, 160)}"`);
      x.quote = '';
    }
    s.concerns = s.concerns.filter((x) => x.concern || x.quote);
  }
  content.staff_notes = [...content.staff_notes, ...dropped].slice(0, 20);
  return content;
}

// Without Claude, staff start from the catalog and the facts and write the rest by hand.
export function factsToContent(f, services) {
  const own = f.pre_call_answers?.answers || [];
  const pick = (re) => own.find((x) => re.test(x.question))?.answer;
  const problem = pick(/biggest challenge/i);
  const goal = pick(/next 12 months/i);
  const intro = [
    `${f.business.name}${f.business.city ? ` in ${f.business.city}` : ''}: here’s what we recommend and why.`,
    problem ? `You told us your biggest challenge is: "${problem}"` : '',
    goal ? `And that a great next 12 months would look like: "${goal}"` : '',
  ].filter(Boolean).join(' ');
  return cleanContent({
    intro,
    services: f.services_chosen.map((s) => ({
      serviceId: s.service_id,
      why: s.discovery_reasons.join(' '),
      features: [s.what_it_is, s.scope_note_from_rep].filter(Boolean),
      benefits: [],
      concerns: s.website_check_findings.map((t) => ({ concern: t, quote: '', source: `Website check${f.website_check?.date ? ` (${f.website_check.date})` : ''}` })),
      timeline: '',
    })),
    next_steps: DEFAULT_NEXT_STEPS,
    staff_notes: [],
  }, services);
}

// ---------- Claude ----------

function schemaFor(services) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['intro', 'services', 'next_steps', 'staff_notes'],
    properties: {
      intro: { type: 'string', description: 'Two short paragraphs: their situation and goals in their own terms, and what this proposal sets out to fix.' },
      services: {
        type: 'array',
        description: 'Exactly one entry per chosen service, in the order given.',
        items: {
          type: 'object', additionalProperties: false,
          required: ['service_id', 'why', 'features', 'benefits', 'what_you_told_us', 'timeline'],
          properties: {
            service_id: { type: 'string', enum: services.map((s) => s.serviceId) },
            why: { type: 'string', description: 'Two to four sentences: why we chose this for them specifically, tied to the facts.' },
            features: { type: 'array', items: { type: 'string' }, description: 'What we will actually do: three to six concrete items.' },
            benefits: { type: 'array', items: { type: 'string' }, description: 'What it means for their business, without promises of results.' },
            what_you_told_us: {
              type: 'array',
              description: 'The specific concerns this service addresses.',
              items: {
                type: 'object', additionalProperties: false, required: ['concern', 'quote', 'source'],
                properties: {
                  concern: { type: 'string', description: 'The concern in one sentence, or what we observed when there is no quote.' },
                  quote: { type: 'string', description: 'A short quote copied character for character from the facts, or "" when there is none.' },
                  source: { type: 'string', description: 'Where it came from, e.g. "Pre-call questions", "Discovery call", "Meeting on 2026-09-30", "Website check".' },
                },
              },
            },
            timeline: { type: 'string', description: 'What happens first and roughly how the first weeks and months go, in general terms. No dates or guarantees.' },
          },
        },
      },
      next_steps: { type: 'array', items: { type: 'string' }, description: 'Three or four short steps from here.' },
      staff_notes: { type: 'array', items: { type: 'string' }, description: 'For the Detcord team only: weak spots, missing facts, services that look like a poor fit, anything you left out on purpose.' },
    },
  };
}

const SYSTEM = `You write a proposal from Detcord Digital, a marketing agency in Michigan, to a small-business owner.
You get FACTS: a JSON snapshot of what this one business told us (pre-call answers, discovery call notes, recorded meeting notes), what we measured on their website, and the services our team chose for them. Use only these facts.
For each chosen service explain: why we chose it for them, what we will do (features), what it means for them (benefits), what they told us that it addresses, and how the first weeks and months go in general terms.
"what_you_told_us": name the specific concern. When the facts contain their own words about it, add a short quote copied exactly, character for character, from the facts: pre-call answers, discovery answers, meeting client_quotes, pain points or goals. Never paraphrase inside a quote, never join fragments, and never invent one. When there is no quote, leave quote empty and describe what we observed (for example a website check finding) in the concern, with that source.
Never invent numbers, statistics, names, dates, results or facts. Never promise or guarantee rankings, traffic, leads, calls or revenue; say what we will do and what it is designed to improve.
The portal adds the investment section (prices and totals) itself. Never write prices, fees, costs, budgets, discounts, totals or dollar amounts anywhere in your text.
The lead score, grade and red flags in discovery.result are internal sales notes. Use them only to understand priorities; never mention them in the proposal.
Write for a busy owner: plain language, short sentences, no jargon or hype. Address the client as "you" and Detcord as "we". Use their words for their business, services and towns.
next_steps: they can ask questions in their portal; when they accept, we prepare the service agreement for them to review and sign; then we schedule a kickoff.
staff_notes are read only by the Detcord team; keep them out of every other field.`;

export async function draftProposal(env, facts, services) {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 150000 });
  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaFor(services) } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `FACTS:\n${JSON.stringify(facts, null, 1)}` }],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to write this proposal.'), { status: 'refusal' });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The proposal was too long to write in one pass.'), { status: 'max_tokens' });
  return JSON.parse(response.content.find((b) => b.type === 'text')?.text || '{}');
}

// Claude's field names → the stored content.
const fromClaude = (d) => ({
  intro: d.intro,
  services: (d.services || []).map((s) => ({ serviceId: s.service_id, why: s.why, features: s.features, benefits: s.benefits, concerns: s.what_you_told_us, timeline: s.timeline })),
  next_steps: d.next_steps,
  staff_notes: d.staff_notes,
});

// ---------- Generate ----------

// Builds (or rebuilds) the draft of one proposal from its checked services. A shared or accepted proposal
// is never replaced, and one staff edited is replaced only when they confirm (overwrite). Claude is used
// when set up; otherwise, or if Claude fails on a proposal never generated, the facts start the draft.
export async function generateProposal(env, { proposal, client, userId, overwrite = false }) {
  const db = env.DB;
  if (proposal.status !== 'draft') fail(409, 'This proposal is shared with the client. Unshare it before generating it again.');
  if (proposal.edited && !overwrite) {
    throw Object.assign(new HttpError(409, 'Your team edited this proposal. Generating it again replaces those edits.'), { needsConfirm: true });
  }
  const services = JSON.parse(proposal.services);
  const facts = await gatherFacts(db, client, services.map(({ serviceId, name, scope }) => ({ serviceId, name, scope })));
  let draft = null;
  let error = null;
  if (aiReady(env)) {
    try {
      draft = await draftProposal(env, facts, services);
    } catch (e) {
      error = e?.status === 401 ? 'Anthropic rejected the API key.' : e?.status === 'refusal' || e?.status === 'max_tokens' ? e.message : 'Claude could not write this proposal. Try again, or write it by hand.';
    }
  }
  const t = now();
  if (error && proposal.generated_at) {
    await db.prepare('UPDATE proposals SET error=?, updated_at=? WHERE id=?').bind(error, t, proposal.id).run();
    return { error, kept: true };
  }
  const content = draft ? checkQuotes(cleanContent(fromClaude(draft), services), facts) : factsToContent(facts, services);
  const res = await db.prepare(`UPDATE proposals SET facts=?, draft=?, draft_source=?, content=?, edited=0, error=?, generated_by=?, generated_at=?,
      edited_by=NULL, edited_at=NULL, updated_at=? WHERE id=? AND status='draft'`)
    .bind(JSON.stringify(facts), draft ? JSON.stringify(draft) : null, draft ? 'ai' : 'staff', JSON.stringify(content), error, userId, t, t, proposal.id).run();
  if (!res.meta.changes) fail(409, 'This proposal was shared while it was being generated.');
  await saveVersion(db, { id: proposal.id, kind: 'generated', version: proposal.version, services, content, userId });
  return { error, kept: false, source: draft ? 'ai' : 'staff' };
}

export const saveVersion = (db, { id, kind, version, services, content, userId }) => db.prepare(
  'INSERT INTO proposal_versions (id, proposal_id, kind, version, services, content, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
).bind(newId(), id, kind, version, JSON.stringify(services), JSON.stringify(content), userId, now()).run();

// The staff to tell about a client's response: the assigned reps, or every admin when nobody is assigned.
export async function repsFor(db, clientId) {
  const reps = (await db.prepare(`SELECT u.id, u.name, u.email FROM assignments a JOIN users u ON u.id=a.user_id
    WHERE a.client_id=? AND u.status='active' AND u.role IN ('admin','rep')`).bind(clientId).all()).results;
  return reps.length ? reps : (await db.prepare("SELECT id, name, email FROM users WHERE role='admin' AND status='active'").all()).results;
}

export const TASK_DUE = DAY;
