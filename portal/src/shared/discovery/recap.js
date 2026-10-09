// The call recap: every answer so far, grouped by section in the rep's words, what is still to ask, and where
// each answer came from. Pure functions, used live in the runner (from local state) and by the API.
import { buildSections, progress } from './engine.js';
import { visible } from './schema.js';

export const answered = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

// Where an unconfirmed answer came from, as shown next to it until the rep confirms or edits it.
export const SOURCE_LABEL = {
  'client-record': 'Prefilled from client record',
  intake: 'Prefilled from intake form',
  audit: 'Prefilled from website check',
  client: 'Entered by the client',
};

// One answer as readable text: option labels instead of values, money and scales spelled out.
export function formatAnswer(question, v) {
  if (!answered(v)) return '';
  const label = (x) => question.options?.find((o) => o.v === x)?.l ?? String(x);
  switch (question.type) {
    case 'single': return label(v);
    case 'multi': return (Array.isArray(v) ? v : [v]).map(label).join(', ');
    case 'yesno': return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'scale': return `${v} of 5`;
    case 'money': return Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString('en-US')}` : String(v);
    default: return String(v);
  }
}

const shortTitle = (t) => t.replace(/: (industry questions|scoping)$/, '');

// { sections: [{ id, title, step, items: [{ id, q, value, text, mark, suggestion }] }], missing: [...], progress }
// `step` is the section's index in the runner so the recap can jump back to it.
export function buildRecap({ industry, modules = [], answers = {}, marks = {}, suggestions = {} }) {
  const sections = buildSections(industry, modules);
  const out = [];
  const missing = [];
  sections.forEach((s, step) => {
    const items = [];
    for (const qu of s.questions) {
      if (!visible(qu, answers)) continue;
      const v = answers[qu.id];
      if (answered(v)) items.push({ id: qu.id, q: qu.q, value: v, text: formatAnswer(qu, v), mark: marks[qu.id] || null, suggestion: suggestions[qu.id] ? { ...suggestions[qu.id], text: formatAnswer(qu, suggestions[qu.id].value) } : null });
      else if (!qu.optional) missing.push({ id: qu.id, q: qu.q, sectionId: s.id, section: shortTitle(s.title), step });
    }
    if (items.length) out.push({ id: s.id, title: shortTitle(s.title), step, items });
  });
  const unconfirmed = out.reduce((n, s) => n + s.items.filter((i) => i.mark).length, 0);
  return { sections: out, missing, unconfirmed, progress: progress(sections, answers) };
}

// Plain text for pasting into notes or the CRM.
export function recapText(recap, { business, result } = {}) {
  const lines = [`Discovery call recap${business ? `: ${business}` : ''}`, ''];
  if (result) {
    lines.push(`Lead score: ${result.score.grade} (${result.score.total}/${result.score.max}), ${result.score.label}`);
    const top = result.recommended.filter((r) => r.priority === 'start-with');
    if (top.length) lines.push(`Recommended to start: ${top.map((r) => r.name).join(', ')}`);
    lines.push('');
  }
  for (const s of recap.sections) {
    lines.push(s.title.toUpperCase());
    for (const i of s.items) lines.push(`- ${i.q} ${i.text}${i.mark ? ` (${(SOURCE_LABEL[i.mark.source] || 'prefilled').toLowerCase()}, not yet confirmed)` : ''}`);
    lines.push('');
  }
  if (recap.missing.length) {
    lines.push('STILL TO ASK');
    for (const m of recap.missing) lines.push(`- ${m.q}`);
  }
  return lines.join('\n').trim();
}

// A follow-up email draft for the rep to copy. Only uses what the prospect said; nothing is sent automatically.
export function recapEmail(answers, { business, contactName, repName, result } = {}) {
  const first = (contactName || '').split(/\s+/)[0];
  const said = (v) => (answered(v) ? String(v).trim().replace(/[.\s]+$/, '') : null);
  const problem = said(answers.biggest_problem);
  const goal = said(answers.goal_12mo);
  const success = said(answers.success_measure);
  const lines = [`Hi${first ? ` ${first}` : ''},`, '', `Thanks for taking the time to talk about ${business || 'your business'} today. Here's what I heard, so you can tell me if I missed anything:`, ''];
  if (problem) lines.push(`- The biggest thing to fix: ${problem}.`);
  if (goal) lines.push(`- A great next 12 months: ${goal}.`);
  if (success) lines.push(`- What would make it worth it: ${success}.`);
  const top = (result?.recommended || []).filter((r) => r.priority === 'start-with').map((r) => r.name.replace(/ \(.*\)$/, ''));
  if (top.length) lines.push('', `Based on that, I'd start with ${top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top.at(-1)}` : top[0]}.`);
  const when = said(answers.next_step_date);
  const step = {
    'proposal-meeting': `I'll have the plan ready for our meeting${when ? ` on ${when}` : ''}.`,
    'send-proposal': `I'll send the plan over${when ? ` by ${when}` : ' shortly'}.`,
    'follow-up': `I'll follow up${when ? ` on ${when}` : ' soon'}.`,
  }[answers.next_step];
  if (step) lines.push('', step);
  lines.push('', 'Reply with anything I got wrong or left out.', '', `Thanks,${repName ? `\n${repName}` : ''}`, 'Detcord Digital');
  return { subject: `Recap of our call${business ? `: ${business}` : ''}`, body: lines.join('\n') };
}
