// Turns discovery answers into a result: score, grade, red flags, recommended services
// (with reasons), objections to prepare for, and next steps. Pure function, used on server and client.
import { MASTER } from './master.js';
import { SERVICE_MODULES } from './services.js';
import { industryById } from './industries.js';
import { SCORECARD, grade, RED_FLAGS, RECOMMENDATIONS, OBJECTIONS, INTAKE } from './playbook.js';
import { matches, visible } from './schema.js';
import { serviceById } from '../services.js';

export { MASTER, SERVICE_MODULES, INTAKE };

// Ordered sections for a discovery: master sections with the industry add-on after "business",
// then any service follow-ups the rep added.
export function buildSections(industryId, moduleIds = []) {
  const industry = industryById[industryId];
  const out = [];
  for (const s of MASTER.sections) {
    out.push({ ...s, kind: 'master' });
    if (s.id === 'business' && industry) {
      out.push({
        id: `industry:${industry.id}`, kind: 'industry', title: `${industry.name}: industry questions`,
        listenFor: industry.listenFor, michigan: industry.michigan, questions: industry.questions,
      });
    }
  }
  for (const id of moduleIds) {
    const m = SERVICE_MODULES[id];
    if (m) out.push({ id: `service:${id}`, kind: 'service', title: `${serviceById[id]?.name || id}: scoping`, script: [m.intro], questions: m.questions });
  }
  return out;
}

export function progress(sections, answers) {
  let total = 0;
  let done = 0;
  for (const s of sections) for (const qu of s.questions) {
    if (qu.optional || !visible(qu, answers)) continue;
    total++;
    const a = answers[qu.id];
    if (a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length)) done++;
  }
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function computeResult(answers, industryId) {
  const industry = industryById[industryId];
  const ctx = { targetIndustry: !!industry };
  const dims = SCORECARD.map((d) => ({ id: d.id, name: d.name, help: d.help, score: d.score(answers, ctx) }));
  const total = dims.reduce((s, d) => s + d.score, 0);
  const g = grade(total);

  const weights = {};
  const reasons = {};
  for (const rule of RECOMMENDATIONS) {
    if (!matches(rule.when, answers)) continue;
    for (const sid of rule.services) {
      weights[sid] = (weights[sid] || 0) + rule.weight;
      (reasons[sid] ||= []).push(rule.because);
    }
  }
  // Industry staples get a nudge so the list reflects what usually works in that vertical.
  if (industry) industry.keyServices.forEach((sid, i) => {
    weights[sid] = (weights[sid] || 0) + Math.max(0, 2 - i * 0.3);
    (reasons[sid] ||= []).push(`Usually a top performer for ${industry.name.toLowerCase()}.`);
  });
  const recommended = Object.entries(weights)
    .filter(([sid]) => serviceById[sid])
    .sort((a, b) => b[1] - a[1])
    .map(([sid, w], i) => ({ serviceId: sid, name: serviceById[sid].name, weight: Math.round(w * 10) / 10, priority: i < 3 ? 'start-with' : i < 6 ? 'next' : 'later', reasons: [...new Set(reasons[sid])] }));

  const flags = RED_FLAGS.filter((f) => matches(f.when, answers)).map((f) => f.text);
  const objections = OBJECTIONS.filter((o) => !o.when || matches(o.when, answers)).map(({ id, objection, response, next }) => ({ id, objection, response, next }));

  const nextSteps = [g.action];
  if (answers.next_step === 'proposal-meeting' && answers.next_step_date) nextSteps.push(`Proposal meeting: ${answers.next_step_date}.`);
  if (Array.isArray(answers.access_requested) && answers.access_requested.length) nextSteps.push('Send the Google access request from the client record.');
  if (recommended[0]) nextSteps.push(`Scope ${recommended.slice(0, 3).map((r) => r.name).join(', ')} using the service follow-up questions.`);

  return {
    score: { total, max: SCORECARD.length * 4, dimensions: dims, ...g },
    redFlags: flags,
    recommended,
    objections,
    nextSteps,
    headline: answers.biggest_problem || null,
    computedAt: Date.now(),
  };
}

// Maps intake-form answers onto discovery answer ids.
export function intakeToAnswers(intakeAnswers) {
  const out = {};
  for (const qu of INTAKE.questions) {
    if (qu.mapTo && intakeAnswers[qu.id] !== undefined && intakeAnswers[qu.id] !== '') out[qu.mapTo] = intakeAnswers[qu.id];
  }
  return out;
}

// Ids of every question a discovery may contain (for input validation).
export function allQuestionIds(industryId, moduleIds) {
  return new Set(buildSections(industryId, moduleIds).flatMap((s) => s.questions.map((x) => x.id)));
}
