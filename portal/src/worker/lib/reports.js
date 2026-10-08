// Monthly client reports. The facts come only from what the portal recorded for one client and one
// calendar month; Claude turns them into plain language, staff review and edit, then share.
// Nothing here reads Google Analytics, Search Console or Google Ads results: those aren't connected.
import Anthropic from '@anthropic-ai/sdk';
import { fail, now, newId, HttpError } from './util.js';
import { aiReady, CATEGORIES as GOAT_CATEGORIES } from './goat.js';
import { CATEGORIES as AUDIT_CATEGORIES } from './audit/checks.js';

export const NOT_CONNECTED = ['Google Analytics 4 (website traffic)', 'Google Search Console (search rankings and clicks)', 'Google Ads results (ad spend, clicks and leads)'];
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

// ---------- Months ----------

function parts(t, tz) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(t).map((p) => [p.type, p.value]));
}

// How far the zone's wall clock is ahead of UTC at instant t.
function offsetAt(t, tz) {
  const p = parts(t, tz);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
}

function zonedMonthStart(y, m, tz) {
  const guess = Date.UTC(y, m - 1, 1);
  return guess - offsetAt(guess - offsetAt(guess, tz), tz);
}

// "2026-09" → epoch ms of midnight on the 1st and on the 1st of the next month, in the client's zone.
export function monthRange(month, tz = 'America/Detroit') {
  const [, y, m] = month.match(MONTH_RE).map(Number);
  return { start: zonedMonthStart(y, m, tz), end: zonedMonthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, tz) };
}

export function currentMonth(tz = 'America/Detroit', at = now()) {
  const p = parts(at, tz);
  return `${p.year}-${p.month}`;
}

export function previousMonth(month) {
  const [, y, m] = month.match(MONTH_RE).map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function cleanMonth(v, tz) {
  const s = String(v ?? '').trim();
  if (!MONTH_RE.test(s)) fail(400, 'Choose a month.');
  if (s > currentMonth(tz)) fail(400, 'That month hasn’t started yet.');
  return s;
}

export const monthLabel = (month) => {
  const [, y, m] = month.match(MONTH_RE).map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// ---------- Facts ----------

const day = (t, tz) => { if (!t) return null; const p = parts(t, tz); return `${p.year}-${p.month}-${p.day}`; };
const usd = (c) => Math.round(c || 0) / 100;
const clip = (s, n) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Everything the portal knows about one client for one month. Each query is scoped to the client
// and the month here, so nothing from another business or another month can reach the report.
export async function gatherFacts(db, client, month, { meetingNotes = false } = {}) {
  const tz = client.timezone || 'America/Detroit';
  const { start, end } = monthRange(month, tz);
  const id = client.id;
  const q = (sql, ...binds) => db.prepare(sql).bind(...binds);
  const [created, finished, open, audits, before, services, issued, payments, overdue, signed, meetings, tasks, notes, files, posts] = (await db.batch([
    q(`SELECT subject, body, category, channel, status, proposal, created_at FROM goat_requests
      WHERE client_id=? AND status<>'unmatched' AND created_at>=? AND created_at<? ORDER BY created_at`, id, start, end),
    q(`SELECT subject, body, category, status, proposal, result_note, result_url, failure, completed_at FROM goat_requests
      WHERE client_id=? AND status IN ('done','failed') AND completed_at>=? AND completed_at<? ORDER BY completed_at`, id, start, end),
    q(`SELECT subject, body, category, status, proposal, created_at FROM goat_requests
      WHERE client_id=? AND status IN ('new','proposed','approved','in_progress') AND created_at<? ORDER BY created_at LIMIT 20`, id, end),
    q(`SELECT url, score, result, created_at FROM audits WHERE client_id=? AND status='done' AND created_at>=? AND created_at<? ORDER BY created_at`, id, start, end),
    q(`SELECT score, created_at FROM audits WHERE client_id=? AND status='done' AND created_at<? ORDER BY created_at DESC LIMIT 1`, id, start),
    q('SELECT cs.status, cs.monthly_cents, cs.updated_at, s.name FROM client_services cs JOIN services s ON s.id=cs.service_id WHERE cs.client_id=? ORDER BY s.position', id),
    q(`SELECT number, title, kind, status, total_cents, paid_cents, issued_at, due_at FROM invoices
      WHERE client_id=? AND status<>'draft' AND issued_at>=? AND issued_at<? ORDER BY issued_at`, id, start, end),
    q(`SELECT p.amount_cents, p.provider, p.received_at, i.number FROM payments p JOIN invoices i ON i.id=p.invoice_id
      WHERE p.client_id=? AND p.status='approved' AND p.received_at>=? AND p.received_at<? ORDER BY p.received_at`, id, start, end),
    q(`SELECT number, title, total_cents, paid_cents, due_at FROM invoices WHERE client_id=? AND status='open' AND due_at<? ORDER BY due_at`, id, end),
    q(`SELECT number, title, signed_at FROM contracts WHERE client_id=? AND status='signed' AND signed_at>=? AND signed_at<? ORDER BY signed_at`, id, start, end),
    q('SELECT title, analysis, created_at FROM meetings WHERE client_id=? AND created_at>=? AND created_at<? ORDER BY created_at', id, start, end),
    q('SELECT title, done_at FROM tasks WHERE client_id=? AND done_at>=? AND done_at<? ORDER BY done_at', id, start, end),
    q(`SELECT body, created_at FROM notes WHERE client_id=? AND visibility='shared' AND created_at>=? AND created_at<? ORDER BY created_at`, id, start, end),
    q(`SELECT filename, purpose, created_at FROM media WHERE client_id=? AND visibility='shared' AND deleted_at IS NULL AND created_at>=? AND created_at<? ORDER BY created_at`, id, start, end),
    q(`SELECT content, status, zernio_platforms, COALESCE(scheduled_for, published_at) AS at FROM social_posts
      WHERE client_id=? AND status IN ('published','partial') AND COALESCE(scheduled_for, published_at)>=? AND COALESCE(scheduled_for, published_at)<? ORDER BY at`, id, start, end),
  ])).map((r) => r.results);

  const request = (r) => ({
    request: clip(r.subject || json(r.proposal)?.summary || r.body, 200),
    type: GOAT_CATEGORIES[r.category] || 'Something else',
  });
  let previous = before[0]?.score ?? null;
  const checks = audits.map((a) => {
    const res = json(a.result) || {};
    const out = {
      date: day(a.created_at, tz), url: a.url, score: a.score, previous_score: previous, change: previous == null || a.score == null ? null : a.score - previous,
      area_scores: Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.label, res.scores?.[c.id] ?? null])),
      issues_found: res.counts || null,
    };
    previous = a.score ?? previous;
    return out;
  });
  const inMonth = (t) => t >= start && t < end;

  return {
    business: { name: client.name, industry: client.industry || null, city: client.city || null, state: client.state || null, website: client.website || null },
    month,
    month_label: monthLabel(month),
    period: { from: day(start, tz), to: day(end - 1, tz), partial: now() < end },
    requests: {
      received: created.map((r) => ({ ...request(r), date: day(r.created_at, tz), channel: { portal: 'portal', email: 'email', sms: 'text' }[r.channel], status_now: r.status })),
      completed: finished.filter((r) => r.status === 'done').map((r) => ({ ...request(r), date: day(r.completed_at, tz), result: clip(r.result_note, 500) || null, link: r.result_url || null })),
      could_not_complete: finished.filter((r) => r.status === 'failed').map((r) => ({ ...request(r), date: day(r.completed_at, tz), reason: clip(r.failure, 300) || null })),
      still_open_today: open.map((r) => ({ ...request(r), received: day(r.created_at, tz), status: r.status })),
    },
    website_checks: checks,
    services: {
      active: services.filter((s) => s.status === 'active' && s.updated_at < end).map((s) => s.name),
      started: services.filter((s) => s.status === 'active' && inMonth(s.updated_at)).map((s) => ({ name: s.name, date: day(s.updated_at, tz) })),
      ended: services.filter((s) => s.status === 'ended' && inMonth(s.updated_at)).map((s) => ({ name: s.name, date: day(s.updated_at, tz) })),
      note: 'Start and end dates are when the service status last changed in the portal.',
    },
    billing: {
      invoices_issued: issued.map((i) => ({ number: i.number, title: i.title, amount_usd: usd(i.total_cents), issued: day(i.issued_at, tz), due: day(i.due_at, tz), status_now: i.status })),
      payments_received: payments.map((p) => ({ invoice: p.number, amount_usd: usd(p.amount_cents), date: day(p.received_at, tz), method: p.provider === 'clover' ? 'online' : 'recorded by Detcord' })),
      total_issued_usd: usd(issued.filter((i) => i.status !== 'void').reduce((s, i) => s + i.total_cents, 0)),
      total_paid_usd: usd(payments.reduce((s, p) => s + p.amount_cents, 0)),
      past_due_at_month_end: overdue.map((i) => ({ number: i.number, title: i.title, balance_usd: usd(i.total_cents - i.paid_cents), due: day(i.due_at, tz) })),
    },
    agreements_signed: signed.map((s) => ({ number: s.number, title: s.title, date: day(s.signed_at, tz) })),
    meetings: meetings.map((m) => {
      const out = { title: m.title, date: day(m.created_at, tz) };
      if (meetingNotes) out.summary = clip(json(m.analysis)?.summary, 1200) || null;
      return out;
    }),
    tasks_completed: tasks.map((t) => ({ task: clip(t.title, 200), date: day(t.done_at, tz) })),
    updates_posted_to_client: notes.map((n) => ({ date: day(n.created_at, tz), text: clip(n.body, 500) })),
    social_posts_published: posts.map((p) => ({
      date: day(p.at, tz), text: clip(p.content, 300),
      posted_to: (json(p.zernio_platforms) || []).filter((x) => x.status === 'published').map((x) => x.platform),
      partly_failed: p.status === 'partial',
    })),
    files_shared: files.slice(0, 30).map((f) => ({ file: clip(f.filename, 120), kind: f.purpose, date: day(f.created_at, tz) })),
    google_ads_account: client.ads_customer_id ? { link_status: client.ads_link_status || 'unknown', results_available: false } : null,
    not_connected: NOT_CONNECTED,
  };
}

// ---------- Content ----------

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, n) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

// The report as staff edit it and the client reads it. staff_notes never reach the client.
export function cleanContent(c = {}) {
  return {
    headline: str(c.headline, 200),
    summary: str(c.summary, 3000),
    sections: (Array.isArray(c.sections) ? c.sections : []).map((s) => ({ title: str(s?.title, 120), bullets: list(s?.bullets, 600, 20) })).filter((s) => s.title || s.bullets.length).slice(0, 12),
    next_month: list(c.next_month, 400, 10),
    staff_notes: list(c.staff_notes, 600, 15),
  };
}

export const clientContent = (c) => ({ headline: c.headline, summary: c.summary, sections: c.sections, next_month: c.next_month });

const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const shortDate = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

// Without Claude, staff start from the facts written out as plain bullets and finish it by hand.
export function factsToContent(f) {
  const r = f.requests;
  const sections = [];
  sections.push({ title: 'Requests', bullets: [
    ...r.completed.map((x) => `Done: ${x.request}${x.result ? ` (${x.result})` : ''}`),
    ...r.could_not_complete.map((x) => `Could not be done: ${x.request}${x.reason ? ` (${x.reason})` : ''}`),
    ...(r.received.length ? [`${r.received.length} new request${r.received.length === 1 ? '' : 's'} received this month.`] : []),
  ].concat(!r.completed.length && !r.received.length && !r.could_not_complete.length ? ['No requests this month.'] : []) });
  sections.push({ title: 'Website', bullets: f.website_checks.length
    ? f.website_checks.map((w) => `Website check on ${shortDate(w.date)}: ${w.score}/100${w.change == null ? '' : w.change === 0 ? ' (no change)' : ` (${w.change > 0 ? 'up' : 'down'} ${Math.abs(w.change)} from ${w.previous_score})`}.`)
    : ['No website check was run this month.'] });
  sections.push({ title: 'Services', bullets: [
    ...(f.services.active.length ? [`Active: ${f.services.active.join(', ')}.`] : ['No active services.']),
    ...f.services.started.map((s) => `Started ${s.name} on ${shortDate(s.date)}.`),
    ...f.services.ended.map((s) => `Ended ${s.name} on ${shortDate(s.date)}.`),
  ] });
  const b = f.billing;
  sections.push({ title: 'Billing', bullets: [
    ...b.invoices_issued.map((i) => `Invoice ${i.number} (${i.title}): ${money(i.amount_usd)}${i.status_now === 'paid' ? ', paid' : i.status_now === 'void' ? ', voided' : ''}.`),
    ...b.payments_received.map((p) => `Payment received ${shortDate(p.date)}: ${money(p.amount_usd)} for ${p.invoice}.`),
  ].concat(!b.invoices_issued.length && !b.payments_received.length ? ['No invoices or payments this month.'] : []) });
  const other = [
    ...f.agreements_signed.map((a) => `Agreement signed: ${a.title} (${shortDate(a.date)}).`),
    ...f.meetings.map((m) => `Meeting: ${m.title} (${shortDate(m.date)}).`),
    ...f.social_posts_published.map((p) => `Social post${p.posted_to.length ? ` on ${p.posted_to.join(', ')}` : ''} (${shortDate(p.date)}): ${p.text.slice(0, 120)}`),
    ...f.tasks_completed.map((t) => `Completed: ${t.task}.`),
    ...(f.files_shared.length ? [`${f.files_shared.length} file${f.files_shared.length === 1 ? '' : 's'} shared.`] : []),
  ];
  if (other.length) sections.push({ title: 'Other work', bullets: other });
  return cleanContent({ headline: `Your ${f.month_label} report`, summary: '', sections, next_month: r.still_open_today.map((x) => `Finish: ${x.request}`).slice(0, 5), staff_notes: [] });
}

// ---------- Claude ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'sections', 'next_month', 'staff_notes'],
  properties: {
    headline: { type: 'string', description: 'One short line for the top of the report.' },
    summary: { type: 'string', description: 'One paragraph, three to five sentences, on what Detcord did and what changed this month.' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'bullets'], properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } } },
    next_month: { type: 'array', items: { type: 'string' }, description: 'What Detcord will focus on next month, from open requests and active services in the facts.' },
    staff_notes: { type: 'array', items: { type: 'string' }, description: 'For the Detcord team only. Anything that looked off, inconsistent or missing in the facts.' },
  },
};

const SYSTEM = `You write the monthly report that Detcord Digital, a marketing agency in Michigan, gives a small-business client.
You get FACTS: a JSON snapshot of what the client portal recorded for one business and one calendar month. Use only these facts.
Never invent numbers, dates, names, work or results. Every number you write must appear in the facts, or be a simple count or total of them.
Write for a busy owner: plain language, short sentences, no jargon or hype, no promises of results. Address the client as "you" and Detcord as "we".
Group the work into a few sections (for example requests, website, services, billing). When a section has nothing in the facts, say so plainly in one bullet, like "No website check this month." Do not pad.
These are NOT connected: Google Analytics, Google Search Console and Google Ads results. Never mention website traffic, visitors, search rankings, impressions, clicks, calls, leads or ad performance unless the facts include those numbers.
If period.partial is true the month is not over yet; say "so far this month".
Money is in US dollars. Never mention card details.
next_month: a few concrete items drawn only from open requests, active services and findings in the facts. If there is nothing to draw on, say the team will confirm priorities with the client.
staff_notes are read only by the Detcord team: list anything that looked off or missing (a request that could not be done, a past-due invoice, a score that dropped, no website check, an active client with no recorded work) and anything you left out on purpose. Keep staff notes out of the other fields.`;

export async function draftReport(env, facts) {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120000 });
  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `FACTS:\n${JSON.stringify(facts, null, 1)}` }],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to write this report.'), { status: 'refusal' });
  if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('The report was too long to write in one pass.'), { status: 'max_tokens' });
  return JSON.parse(response.content.find((b) => b.type === 'text')?.text || '{}');
}

// ---------- Generate ----------

// Builds (or rebuilds) the draft for one client and month. A shared report is never replaced, and
// a report staff edited is replaced only when they confirm (overwrite). Claude is used when set up;
// otherwise, or if Claude fails on a new report, the facts are written out for staff to finish.
export async function generateReport(env, { client, month, userId, meetingNotes = false, overwrite = false }) {
  const db = env.DB;
  const existing = await db.prepare('SELECT * FROM monthly_reports WHERE client_id=? AND month=?').bind(client.id, month).first();
  if (existing?.status === 'shared') fail(409, 'This report is shared with the client. Unshare it before generating it again.');
  if (existing?.edited && !overwrite) {
    throw Object.assign(new HttpError(409, 'Your team edited this report. Generating it again replaces those edits.'), { needsConfirm: true });
  }
  const facts = await gatherFacts(db, client, month, { meetingNotes });
  let draft = null;
  let error = null;
  if (aiReady(env)) {
    try {
      draft = await draftReport(env, facts);
    } catch (e) {
      error = e?.status === 401 ? 'Anthropic rejected the API key.' : e?.status === 'refusal' || e?.status === 'max_tokens' ? e.message : 'Claude could not write this report. Try again, or write it by hand.';
    }
  }
  if (error && existing) {
    await db.prepare('UPDATE monthly_reports SET error=?, updated_at=? WHERE id=?').bind(error, now(), existing.id).run();
    return { id: existing.id, error, replaced: false, kept: true };
  }
  const content = draft ? cleanContent(draft) : factsToContent(facts);
  const t = now();
  const id = existing?.id || newId();
  const res = await db.prepare(`INSERT INTO monthly_reports (id, client_id, month, status, facts, draft, draft_source, content, edited, meeting_notes, error, generated_by, generated_at, created_at, updated_at)
      VALUES (?,?,?,'draft',?,?,?,?,0,?,?,?,?,?,?)
      ON CONFLICT(client_id, month) DO UPDATE SET status='draft', facts=excluded.facts, draft=excluded.draft, draft_source=excluded.draft_source, content=excluded.content,
        edited=0, meeting_notes=excluded.meeting_notes, error=excluded.error, generated_by=excluded.generated_by, generated_at=excluded.generated_at,
        edited_by=NULL, edited_at=NULL, updated_at=excluded.updated_at
      WHERE monthly_reports.status<>'shared'`)
    .bind(id, client.id, month, JSON.stringify(facts), draft ? JSON.stringify(draft) : null, draft ? 'ai' : 'staff', JSON.stringify(content), meetingNotes ? 1 : 0, error, userId, t, t, t).run();
  if (!res.meta.changes) fail(409, 'This report was shared while it was being generated.');
  return { id, error, replaced: !!existing, source: draft ? 'ai' : 'staff' };
}
