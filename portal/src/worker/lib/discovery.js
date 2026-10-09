// Discovery records: creating one with everything the portal already knows prefilled, and changing answers safely
// when the rep's autosave, the client's questionnaire and prefill refreshes write at the same time.
import { fail, now, newId, logActivity } from './util.js';
import { allQuestionIds } from '../../shared/discovery/engine.js';
import { prefillCandidates, applyPrefill } from '../../shared/discovery/prefill.js';

const json = (v, d) => (v ? JSON.parse(v) : d);

export const parseDiscovery = (d) => ({
  ...d,
  modules: json(d.modules, []),
  answers: json(d.answers, {}),
  result: json(d.result, null),
  marks: json(d.marks, {}),
  suggestions: json(d.suggestions, {}),
  client_answers: json(d.client_answers, {}),
});

// What the portal knows about a client before the call: the record, the latest submitted intake form, the latest
// finished website check.
export async function prefillSources(db, client) {
  const [intake, audit] = await Promise.all([
    db.prepare('SELECT answers, submitted_at FROM intake_links WHERE client_id=? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1').bind(client.id).first(),
    db.prepare("SELECT result, finished_at FROM audits WHERE client_id=? AND status='done' ORDER BY finished_at DESC LIMIT 1").bind(client.id).first(),
  ]);
  return {
    client,
    intake: intake && { answers: JSON.parse(intake.answers), submitted_at: intake.submitted_at },
    audit: audit && { result: JSON.parse(audit.result), finished_at: audit.finished_at },
  };
}

// Reads a discovery, lets `change` edit { industry, modules, answers, marks, suggestions, clientAnswers } in place,
// and writes it back only if nobody else wrote in between (compare-and-swap on updated_at), retrying on a clash.
// Every writer merges onto the latest saved state, so two overlapping autosaves can't drop each other's answers.
// `change` returns false to skip the write.
export async function mutateDiscovery(db, id, change, extraSets = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare('SELECT * FROM discoveries WHERE id=?').bind(id).first();
    if (!row) fail(404, 'Discovery not found.');
    const d = parseDiscovery(row);
    const state = { industry: d.industry, modules: d.modules, answers: d.answers, marks: d.marks, suggestions: d.suggestions, clientAnswers: d.client_answers };
    const out = await change(state, d);
    if (out === false) return { d, state, changed: false };
    const t = Math.max(now(), row.updated_at + 1);
    const sets = { industry: state.industry, modules: JSON.stringify(state.modules), answers: JSON.stringify(state.answers), marks: JSON.stringify(state.marks), suggestions: JSON.stringify(state.suggestions), client_answers: JSON.stringify(state.clientAnswers), ...extraSets, updated_at: t };
    const keys = Object.keys(sets);
    const res = await db.prepare(`UPDATE discoveries SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=? AND updated_at=?`)
      .bind(...keys.map((k) => sets[k]), id, row.updated_at).run();
    if (res.meta.changes) return { d: { ...d, ...state, client_answers: state.clientAnswers, updated_at: t }, state, changed: true, savedAt: t };
  }
  fail(409, 'Someone else is saving this discovery. Try again.');
}

// Fills questions nobody has answered from the client record, intake form and website check. Runs when a
// discovery is created and again whenever it is opened, so an intake form or check finished later still lands.
export async function refreshPrefill(db, d, client) {
  if (d.status !== 'in_progress') return d;
  const candidates = prefillCandidates(await prefillSources(db, client));
  const r = await mutateDiscovery(db, d.id, (s) => applyPrefill(s, candidates, allQuestionIds(s.industry, s.modules)).length > 0);
  return r.changed ? { ...r.d } : d;
}

// The newest discovery still in progress for a client, if any.
export async function openDiscovery(db, clientId) {
  const row = await db.prepare("SELECT * FROM discoveries WHERE client_id=? AND status='in_progress' ORDER BY updated_at DESC LIMIT 1").bind(clientId).first();
  return row ? parseDiscovery(row) : null;
}

// Starts a discovery for a client, prefilled and linked to their open deal. `repId` is who runs the call.
export async function createDiscovery(db, { client, repId, actorId, industry, modules = [], summary = 'Started a discovery call' }) {
  const deal = await db.prepare("SELECT d.id FROM deals d JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.client_id=? AND ps.outcome='open' ORDER BY d.updated_at DESC LIMIT 1").bind(client.id).first();
  const id = newId();
  const t = now();
  const state = { answers: {}, marks: {} };
  // Industry chosen from the client record is shown as prefilled too, until the rep confirms or changes it.
  if (industry && industry === client.industry) state.marks.industry = { source: 'client-record', at: t };
  const prefilled = applyPrefill(state, prefillCandidates(await prefillSources(db, client)), allQuestionIds(industry, modules));
  await db.prepare('INSERT INTO discoveries (id, client_id, deal_id, rep_id, industry, modules, answers, marks, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, client.id, deal?.id || null, repId || null, industry || null, JSON.stringify(modules), JSON.stringify(state.answers), JSON.stringify(state.marks), t, t).run();
  if (industry && !client.industry) await db.prepare('UPDATE clients SET industry=?, updated_at=? WHERE id=?').bind(industry, t, client.id).run();
  await logActivity(db, { clientId: client.id, actorId: actorId || null, kind: 'discovery', summary });
  return { id, prefilled: prefilled.length };
}
