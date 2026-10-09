// What the portal already knows before the call: the client record, the pre-call intake form and the latest website
// check, mapped onto discovery questions. Prefilled answers are marked until the rep confirms or edits them, and a
// prefill never replaces anything the rep or the client entered.
import { intakeToAnswers } from './engine.js';
import { answered } from './recap.js';

// Sources the portal fills itself. A newer value from one of these may replace an older unconfirmed one.
const SYSTEM = new Set(['client-record', 'intake', 'audit']);

// Facts a finished website check measured, as discovery answers. Nothing is guessed: a fact the check skipped
// (no Google lookup, site unreachable, no PageSpeed) is left for the rep to ask.
export function auditToAnswers(result) {
  if (!result) return {};
  const out = {};
  const perf = (r) => r?.scores?.performance;
  if (Number.isFinite(perf(result.speed?.mobile))) out.speed_mobile = perf(result.speed.mobile);
  if (Number.isFinite(perf(result.speed?.desktop))) out.speed_desktop = perf(result.speed.desktop);
  // The mobile viewport finding is the check's test for "set up for phones"; it only runs when the homepage loaded.
  if (result.facts) out.mobile_friendly = !(result.findings || []).some((f) => f.id === 'viewport');
  if (result.coverage?.google === 'checked') {
    const p = result.google?.profile;
    out.gbp_exists = !!p;
    if (!p) out.gbp_claimed = 'no';
    else if (p.reviews != null) out.reviews_count = `${p.reviews} Google review${p.reviews === 1 ? '' : 's'}${p.rating ? `, ${p.rating} average rating` : ''}`;
  }
  return out;
}

// Every candidate answer with its source, later sources winning: client record, then intake, then website check.
export function prefillCandidates({ client, intake, audit } = {}) {
  const out = {};
  const put = (answers, source, at) => {
    for (const [id, value] of Object.entries(answers)) if (answered(value)) out[id] = { value, source, at };
  };
  if (client) {
    put({
      business_name: client.name,
      website: client.website ? client.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
      city: client.city ? `${client.city}${client.state ? `, ${client.state}` : ''}` : null,
    }, 'client-record', client.updated_at || null);
  }
  if (intake?.answers) {
    const mapped = intakeToAnswers(intake.answers);
    // The client record is the reviewed copy of the website; the form only fills it when the record has none.
    if (out.website) delete mapped.website;
    put(mapped, 'intake', intake.submitted_at || null);
  }
  if (audit?.result) put(auditToAnswers(audit.result), 'audit', audit.finished_at || null);
  return out;
}

// Applies candidates to a discovery's answers and marks. Only fills questions nobody has answered (a key the rep
// cleared stays cleared), or refreshes an answer the portal itself filled that nobody has confirmed yet.
// `allowed` limits it to the discovery's question ids. Returns the ids it changed.
export function applyPrefill(state, candidates, allowed) {
  const changed = [];
  for (const [id, c] of Object.entries(candidates)) {
    if (allowed && !allowed.has(id)) continue;
    const mark = state.marks[id];
    const empty = !(id in state.answers);
    const refreshable = mark && SYSTEM.has(mark.source);
    if (!empty && !refreshable) continue;
    if (!empty && JSON.stringify(state.answers[id]) === JSON.stringify(c.value)) continue;
    state.answers[id] = c.value;
    state.marks[id] = { source: c.source, at: c.at };
    changed.push(id);
  }
  return changed;
}

// Client questionnaire answers. They fill questions nobody has answered and replace earlier unconfirmed answers
// (prefills or the client's own). Once the rep owns an answer (typed or confirmed it), a different client answer
// is kept only as a suggestion for the rep. Returns { applied, suggested }.
export function applyClientAnswers(state, answers, at) {
  const applied = [];
  const suggested = [];
  for (const [id, v] of Object.entries(answers)) {
    state.clientAnswers[id] = v;
    const repOwned = id in state.answers && !state.marks[id];
    if (repOwned) {
      if (answered(v) && JSON.stringify(state.answers[id]) !== JSON.stringify(v)) { state.suggestions[id] = { value: v, at }; suggested.push(id); }
      else delete state.suggestions[id];
      continue;
    }
    if (!answered(v)) {
      // Clearing their own answer removes it; a prefill they left alone stays.
      if (state.marks[id]?.source === 'client') { delete state.answers[id]; delete state.marks[id]; }
      continue;
    }
    state.answers[id] = v;
    state.marks[id] = { source: 'client', at };
    applied.push(id);
  }
  return { applied, suggested };
}

// The rep's own edits: they always win, and clear the mark and any client suggestion on those questions.
export function applyRepAnswers(state, answers) {
  for (const [id, v] of Object.entries(answers)) {
    state.answers[id] = v;
    delete state.marks[id];
    delete state.suggestions[id];
  }
}
