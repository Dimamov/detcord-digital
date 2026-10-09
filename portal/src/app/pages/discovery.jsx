import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLoad, api, toast, navigate, ago } from '../lib.js';
import { Loading, ErrorBox, Icon, Chips, Dialog, CopyButton, useAction } from '../ui.jsx';
import { buildSections, computeResult } from '../../shared/discovery/engine.js';
import { visible } from '../../shared/discovery/schema.js';
import { buildRecap, recapText, recapEmail, answered, SOURCE_LABEL } from '../../shared/discovery/recap.js';
import { industryById } from '../../shared/discovery/industries.js';
import { SERVICES, serviceById } from '../../shared/services.js';
import { ResultCard } from './clients.jsx';
import { IndustrySelect, industryName } from '../industries.jsx';

const shortTitle = (t) => t.replace(/: (industry questions|scoping)$/, '');

// Merges body fields that weren't saved yet: lists add up, single values take the newer one.
function mergeExtra(older, newer) {
  const out = { ...older, ...newer };
  for (const k of ['confirm', 'dismiss']) if (older[k] || newer[k]) out[k] = [...(older[k] || []), ...(newer[k] || [])];
  return out;
}

// Autosave queue: one request at a time, each sending whatever changed since the last, so saves never overlap
// or land out of order. Anything that fails goes back in the queue underneath what was typed since.
export function useAutosave(save, initialAt) {
  const pending = useRef({});
  const extra = useRef({});
  const chain = useRef(Promise.resolve());
  const timer = useRef();
  const [status, setStatus] = useState({ state: 'saved', at: initialAt });
  const dirty = () => Object.keys(pending.current).length > 0 || Object.keys(extra.current).length > 0;
  const send = async () => {
    if (!dirty()) return;
    const body = { answers: pending.current, ...extra.current };
    const sentExtra = extra.current;
    pending.current = {};
    extra.current = {};
    setStatus({ state: 'saving' });
    try {
      const r = await save(body);
      setStatus(dirty() ? { state: 'pending' } : { state: 'saved', at: Date.now() });
      return r;
    } catch (e) {
      pending.current = { ...body.answers, ...pending.current };
      extra.current = mergeExtra(sentExtra, extra.current);
      setStatus({ state: 'error', message: e.message });
      return false;
    }
  };
  const flush = () => { clearTimeout(timer.current); return (chain.current = chain.current.then(send)); };
  const queue = (answers = {}, more = null) => {
    Object.assign(pending.current, answers);
    if (more) { extra.current = mergeExtra(extra.current, more); return flush(); }
    setStatus({ state: 'pending' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };
  // Save before leaving the page.
  useEffect(() => {
    const warn = (e) => { if (dirty()) { flush(); e.preventDefault(); } };
    addEventListener('beforeunload', warn);
    return () => { removeEventListener('beforeunload', warn); if (dirty()) flush(); };
  }, []);
  return { status, queue, flush };
}

export function SaveStatus({ save, retry }) {
  if (save.state === 'saving') return 'Saving…';
  if (save.state === 'pending') return 'Unsaved changes';
  if (save.state === 'error') return <span class="overdue">Not saved: {save.message} <button class="btn sm ghost" onClick={retry}>Retry</button></span>;
  return `Saved ${ago(save.at)}`;
}

export function DiscoveryRunner({ id }) {
  const { loading, data, error, reload } = useLoad(`/discoveries/${id}`);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  return <Runner initial={data.discovery} client={data.client} names={data.names} />;
}

function Runner({ initial, client, names }) {
  const [answers, setAnswers] = useState(initial.answers);
  const [marks, setMarks] = useState(initial.marks || {});
  const [suggestions, setSuggestions] = useState(initial.suggestions || {});
  const [industry, setIndustry] = useState(initial.industry);
  const [modules, setModules] = useState(initial.modules);
  const [status, setStatus] = useState(initial.status);
  const [finalResult, setFinalResult] = useState(initial.result);
  const [step, setStep] = useState(0);
  const [picker, setPicker] = useState(false);
  const [livePanel, setLivePanel] = useState(() => { try { return localStorage.getItem('dp-live-recap') !== 'closed'; } catch { return true; } });
  const focusId = useRef(null);
  const [jumped, setJumped] = useState(0);
  const { busy, error, run } = useAction();
  const { status: save, queue, flush } = useAutosave((body) => api('PATCH', `/discoveries/${initial.id}`, body), initial.updated_at);

  const sections = useMemo(() => buildSections(industry, modules), [industry, modules]);
  const preview = useMemo(() => computeResult(answers, industry), [answers, industry]);
  // The recap is built from what is on screen, not from the last save, so it updates as the rep types.
  const recap = useMemo(() => buildRecap({ industry, modules, answers, marks, suggestions }), [industry, modules, answers, marks, suggestions]);
  const prog = recap.progress;
  const recapStep = sections.length; // the last step, after every section
  const onRecap = step >= recapStep;
  const section = sections[Math.min(step, sections.length - 1)];

  const unmark = (ids) => {
    setMarks((m) => { const n = { ...m }; for (const i of ids) delete n[i]; return n; });
    setSuggestions((m) => { const n = { ...m }; for (const i of ids) delete n[i]; return n; });
  };
  // The rep's edits always win: they clear the prefill or client marker on that question.
  const setAnswer = (qid, v) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    unmark([qid]);
    queue({ [qid]: v });
  };
  const confirm = (qid) => { unmark([qid]); queue({}, { confirm: [qid] }); };
  const confirmAll = () => { const ids = Object.keys(marks); unmark(ids); queue({}, { confirm: ids }); toast(`Confirmed ${ids.length} answer${ids.length === 1 ? '' : 's'}.`); };
  const useSuggestion = (qid) => setAnswer(qid, suggestions[qid].value);
  const dismiss = (qid) => { setSuggestions((m) => { const n = { ...m }; delete n[qid]; return n; }); queue({}, { dismiss: [qid] }); };

  const go = (i) => { setStep(i); scrollTo({ top: 0, behavior: 'smooth' }); };
  // Jump from the recap back to one question, scrolled into view and focused.
  const jump = (i, qid) => { focusId.current = qid; setStep(i); setStatus((s) => (s === 'complete' ? 'in_progress' : s)); setJumped((n) => n + 1); };
  useEffect(() => {
    const qid = focusId.current;
    if (!qid) return;
    focusId.current = null;
    const el = document.getElementById(`q-${qid}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
    el.querySelector('input,textarea,button')?.focus({ preventScroll: true });
  }, [jumped]);
  const toggleLive = () => { const v = !livePanel; setLivePanel(v); try { localStorage.setItem('dp-live-recap', v ? 'open' : 'closed'); } catch {} };

  const changeIndustry = (v) => { setIndustry(v || null); unmark(['industry']); queue({}, { industry: v || null }); };
  const toggleModule = (sid) => {
    const next = modules.includes(sid) ? modules.filter((m) => m !== sid) : [...modules, sid];
    setModules(next);
    queue({}, { modules: next });
  };
  const complete = () => run(async () => {
    if ((await flush()) === false) throw new Error('Some answers didn\'t save. Retry the save, then finish.');
    const r = await api('POST', `/discoveries/${initial.id}/complete`, {});
    setFinalResult(r.result);
    setStatus('complete');
    toast(r.followUp ? 'Discovery saved. Follow-up task created.' : 'Discovery saved.');
    scrollTo({ top: 0 });
  });

  const recapProps = { recap, result: finalResult && status === 'complete' ? finalResult : preview, business: client.name, answers, names };
  if (status === 'complete' && finalResult) {
    return <Summary result={finalResult} client={client} recapProps={recapProps} onJump={jump} onEdit={() => setStatus('in_progress')} />;
  }

  const sectionDone = (s) => s.questions.filter((q) => !q.optional && visible(q, answers)).every((q) => answered(answers[q.id]));
  const ind = industryById[industry];
  const unconfirmed = Object.keys(marks).length;

  return (
    <div class="page" style="max-width:1320px">
      <div class="page-head">
        <div>
          <a class="small muted" href={`/clients/${client.id}?tab=discovery`}>← {client.name}</a>
          <h1>Discovery call</h1>
          <div class="row wrap mt small muted">
            <span>{prog.done} of {prog.total} answered</span>
            {unconfirmed > 0 && <><span>·</span><button class="linkish" onClick={() => go(recapStep)}>{unconfirmed} prefilled to confirm</button></>}
            <span>·</span>
            <span role="status"><SaveStatus save={save} retry={() => flush()} /></span>
          </div>
        </div>
        <div class="row">
          {client.website && <a class="btn secondary" href={client.website} target="_blank" rel="noopener"><Icon name="globe" />Website</a>}
          <button class="btn" onClick={complete} disabled={busy}>{busy ? 'Scoring…' : 'Finish and score'}</button>
        </div>
      </div>
      <div class="progress mb" aria-hidden="true"><div style={`width:${prog.percent}%`} /></div>
      {error && <div class="alert bad mb">{error}</div>}

      <div class="runner">
        <nav class="outline card" style="padding:8px" aria-label="Call sections">
          {sections.map((s, i) => (
            <button aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
              <span class={`dot ${sectionDone(s) ? 'done' : ''}`} />
              <span style="flex:1">{shortTitle(s.title)}</span>
              {s.minutes && <span class="faint small">{s.minutes}m</span>}
            </button>
          ))}
          <button aria-current={onRecap ? 'step' : undefined} onClick={() => go(recapStep)}>
            <Icon name="doc" size={14} /><span style="flex:1">Recap</span>
            {recap.missing.length > 0 && <span class="faint small">{recap.missing.length} to ask</span>}
          </button>
          <button onClick={() => setPicker(true)} style="color:var(--accent-2)"><Icon name="plus" size={14} />Add service questions</button>
        </nav>

        {onRecap ? (
          <main class="card" style="min-width:0">
            <div class="eyebrow" style="margin:0">End of call</div>
            <h2 style="font-size:22px;margin:4px 0 6px">Recap</h2>
            <div class="script"><strong>Say</strong>"Let me read back what I heard so I get it right." Then confirm anything marked prefilled or entered by the client, and ask what's still open.</div>
            <RecapActions {...recapProps} />
            <ScorePreview result={preview} />
            <Recap recap={recap} onJump={jump} onConfirm={confirm} onConfirmAll={confirmAll} onUse={useSuggestion} onDismiss={dismiss} />
            <div class="row between mt">
              <button class="btn secondary" onClick={() => go(recapStep - 1)}><Icon name="back" />Back</button>
              <button class="btn" onClick={complete} disabled={busy}>{busy ? 'Scoring…' : 'Finish and score'}</button>
            </div>
          </main>
        ) : (
          <main class="card" style="min-width:0">
            <div class="row between">
              <div class="eyebrow" style="margin:0">{section.kind === 'industry' ? 'Industry' : section.kind === 'service' ? 'Service scoping' : `Step ${step + 1} of ${sections.length}`}</div>
              {section.kind === 'service' && <button class="btn sm ghost" onClick={() => { toggleModule(section.id.split(':')[1]); go(Math.max(0, step - 1)); }}>Remove</button>}
            </div>
            <h2 style="font-size:22px;margin:4px 0 14px">{section.title}</h2>

            {section.id === 'open' && (
              <div class="field mb">
                <span>Industry</span>
                <IndustrySelect value={industry} onChange={changeIndustry} />
                {marks.industry && <MarkLine mark={marks.industry} onConfirm={() => confirm('industry')} />}
              </div>
            )}
            {(section.script || []).map((s) => <div class="script"><strong>Say</strong>{s}</div>)}
            {section.listenFor && <div class="script"><strong>Listen for</strong>{section.listenFor.map((l) => <div>• {l}</div>)}</div>}
            {section.michigan && <div class="script"><strong>Michigan angle</strong>{section.michigan}</div>}

            {section.questions.filter((q) => visible(q, answers)).map((q) => (
              <Question q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)}
                mark={marks[q.id]} onConfirm={() => confirm(q.id)}
                suggestion={suggestions[q.id]} onUse={() => useSuggestion(q.id)} onDismiss={() => dismiss(q.id)} />
            ))}

            <div class="row between mt">
              <button class="btn secondary" disabled={step === 0} onClick={() => go(step - 1)}><Icon name="back" />Back</button>
              {step < sections.length - 1
                ? <button class="btn" onClick={() => go(step + 1)}>Next: {shortTitle(sections[step + 1].title)}<Icon name="arrow" /></button>
                : <button class="btn" onClick={() => go(recapStep)}>Next: Recap<Icon name="arrow" /></button>}
            </div>
          </main>
        )}

        <aside class="side stack">
          {!onRecap && (
            <section class="card live-recap">
              <button class="panel-toggle" aria-expanded={livePanel} onClick={toggleLive}>
                <h3 style="margin:0">Live recap</h3>
                <span class="faint small">{livePanel ? 'Hide' : `Show · ${prog.done} answered`}</span>
              </button>
              {livePanel && <LiveRecap recap={recap} onJump={jump} onOpen={() => go(recapStep)} />}
            </section>
          )}
          <section class="card">
            <div class="row" style="gap:12px">
              <span class={`grade ${preview.score.grade}`}>{preview.score.grade}</span>
              <div><strong>Live score</strong><div class="small muted">{preview.score.total} of {preview.score.max} · updates as you go</div></div>
            </div>
            <div class="stack tight mt">
              {preview.score.dimensions.map((d) => (
                <div class="row between small" title={d.help}><span>{d.name}</span><span class="row" style="gap:2px">{[0, 1, 2, 3].map((i) => <span style={`width:14px;height:6px;border-radius:3px;background:${i < d.score ? 'var(--accent)' : 'var(--surface-3)'}`} />)}</span></div>
              ))}
            </div>
          </section>
          <section class="card">
            <h3>Likely fits so far</h3>
            {preview.recommended.slice(0, 4).map((r) => (
              <div style="padding:6px 0;border-bottom:1px solid var(--line)">
                <div class="row between nowrap"><strong class="small">{r.name.replace(/ \(.*\)$/, '')}</strong>
                  <button class="btn sm ghost" style="padding:2px 6px;min-height:0" onClick={() => toggleModule(r.serviceId)} title="Add scoping questions">{modules.includes(r.serviceId) ? '✓' : '+'}</button></div>
                <div class="small muted">{r.reasons[0]}</div>
              </div>
            ))}
          </section>
          {preview.redFlags.length > 0 && <section class="card"><h3>Watch out</h3>{preview.redFlags.map((f) => <div class="small" style="padding:4px 0">• {f}</div>)}</section>}
          {!ind && industry && industry !== 'other' && <section class="card"><h3>{industryName(industry)}</h3><div class="small muted">No questions written for this industry yet, so the call uses the general questions.</div></section>}
          {ind && <section class="card"><h3>{ind.name}</h3><div class="small muted">Usually starts with: {ind.keyServices.slice(0, 4).map((s) => serviceById[s]?.name.replace(/ \(.*\)$/, '')).join(', ')}</div></section>}
        </aside>
      </div>

      {picker && (
        <Dialog title="Add service scoping questions" onClose={() => setPicker(false)} footer={<button class="btn" onClick={() => setPicker(false)}>Done</button>}>
          <p class="muted small" style="margin-top:0">Add follow-up questions for any service that came up. They appear at the end of the call.</p>
          <div class="chips">
            {SERVICES.map((s) => <button type="button" class="chip" aria-pressed={modules.includes(s.id)} onClick={() => toggleModule(s.id)}>{s.name.replace(/ \(.*\)$/, '')}</button>)}
          </div>
        </Dialog>
      )}
    </div>
  );
}

// "Prefilled from website check · 2h ago  [Confirm]": shown until the rep confirms or edits the answer.
function MarkLine({ mark, onConfirm }) {
  return (
    <div class="mark-line">
      <span class={`badge ${mark.source === 'client' ? 'accent' : 'info'}`}>{SOURCE_LABEL[mark.source] || 'Prefilled'}</span>
      {mark.at && <span class="faint small">{ago(mark.at)}</span>}
      {onConfirm && <button class="btn sm ghost" onClick={onConfirm}><Icon name="check" size={14} />Confirm</button>}
    </div>
  );
}

function SuggestionLine({ text, at, onUse, onDismiss }) {
  return (
    <div class="alert info small mark-line" style="margin:8px 0 0">
      <span style="flex:1;min-width:0"><strong>The client answered differently{at ? ` ${ago(at)}` : ''}:</strong> {text}</span>
      {onUse && <button class="btn sm secondary" onClick={onUse}>Use theirs</button>}
      {onDismiss && <button class="btn sm ghost" onClick={onDismiss}>Keep mine</button>}
    </div>
  );
}

export function Question({ q, value, onChange, mark, onConfirm, suggestion, onUse, onDismiss, hideOptional = false }) {
  return (
    <div class={`question${mark ? ' marked' : ''}`} id={`q-${q.id}`}>
      <div class="qtext">{q.q}{q.optional && !hideOptional && <span class="faint small"> · optional</span>}</div>
      {q.hint && <div class="hint">{q.hint}</div>}
      {mark && <MarkLine mark={mark} onConfirm={onConfirm} />}
      {q.type === 'single' && <Chips options={q.options} value={value} onChange={onChange} />}
      {q.type === 'multi' && <Chips options={q.options} multi value={value} onChange={onChange} />}
      {q.type === 'yesno' && <Chips options={[{ v: true, l: 'Yes' }, { v: false, l: 'No' }]} value={value} onChange={onChange} />}
      {q.type === 'scale' && (
        <div class="scale" role="radiogroup">{[1, 2, 3, 4, 5].map((n) => <button type="button" class="chip" aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}>{n}</button>)}</div>
      )}
      {q.type === 'long' && <textarea class="textarea" value={value || ''} placeholder={q.placeholder || 'Write their answer in their words…'} onInput={(e) => onChange(e.target.value)} />}
      {q.type === 'text' && <input class="input" value={value || ''} placeholder={q.placeholder || ''} onInput={(e) => onChange(e.target.value)} />}
      {(q.type === 'number' || q.type === 'money') && (
        <div class="row" style="max-width:240px">
          {q.type === 'money' && <span class="muted">$</span>}
          <input class="input" inputMode="decimal" value={value ?? ''} placeholder={q.placeholder || ''} onInput={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); onChange(v === '' ? null : Number(v)); }} />
        </div>
      )}
      {suggestion && <SuggestionLine text={suggestion.text ?? String(suggestion.value)} at={suggestion.at} onUse={onUse} onDismiss={onDismiss} />}
    </div>
  );
}

// Compact recap for the side panel: every answer so far, click to jump back to it.
function LiveRecap({ recap, onJump, onOpen }) {
  if (!recap.sections.length) return <p class="small muted" style="margin:8px 0 0">Answers appear here as you type them.</p>;
  return (
    <div class="live-list">
      {recap.sections.map((s) => (
        <div>
          <div class="eyebrow" style="margin:10px 0 2px">{s.title}</div>
          {s.items.map((i) => (
            <button class="recap-item" onClick={() => onJump(s.step, i.id)} title="Edit this answer">
              <span class="faint small">{i.q}</span>
              <span class="small">{i.text}{i.mark && <span class="badge info" style="margin-left:6px">{i.mark.source === 'client' ? 'client' : 'prefilled'}</span>}</span>
            </button>
          ))}
        </div>
      ))}
      <button class="btn sm secondary block mt" onClick={onOpen}>Open full recap{recap.missing.length ? ` · ${recap.missing.length} still to ask` : ''}</button>
    </div>
  );
}

// The full recap: answers grouped by section, what's still to ask, and markers to confirm.
export function Recap({ recap, onJump, onConfirm, onConfirmAll, onUse, onDismiss }) {
  return (
    <div class="recap">
      {recap.unconfirmed > 0 && onConfirmAll && (
        <div class="alert info row between wrap mb">
          <span>{recap.unconfirmed} answer{recap.unconfirmed === 1 ? ' was' : 's were'} prefilled or entered by the client. Read them back, then confirm.</span>
          <button class="btn sm secondary" onClick={onConfirmAll}><Icon name="check" size={14} />Confirm all</button>
        </div>
      )}
      {recap.sections.map((s) => (
        <section class="recap-section">
          <h3>{s.title}</h3>
          {s.items.map((i) => (
            <div class="recap-row">
              <button class="recap-item" onClick={() => onJump(s.step, i.id)} title="Edit this answer">
                <span class="faint small">{i.q}</span>
                <span class="recap-answer">{i.text}</span>
              </button>
              {i.mark && <MarkLine mark={i.mark} onConfirm={onConfirm ? () => onConfirm(i.id) : null} />}
              {i.suggestion && <SuggestionLine text={i.suggestion.text} at={i.suggestion.at} onUse={onUse ? () => onUse(i.id) : null} onDismiss={onDismiss ? () => onDismiss(i.id) : null} />}
            </div>
          ))}
        </section>
      ))}
      {!recap.sections.length && <p class="muted">Nothing answered yet.</p>}
      {recap.missing.length > 0 && <StillToAsk missing={recap.missing} onJump={onJump} />}

    </div>
  );
}

// Required questions not answered yet, grouped by section. A long list starts collapsed so the answers come first.
function StillToAsk({ missing, onJump }) {
  const groups = [];
  for (const m of missing) {
    const g = groups.at(-1);
    if (g && g.step === m.step) g.items.push(m);
    else groups.push({ step: m.step, section: m.section, items: [m] });
  }
  return (
    <details class="recap-section" open={missing.length <= 12}>
      <summary><h3 style="display:inline-flex">Still to ask <span class="badge warn">{missing.length}</span></h3></summary>
      {groups.map((g) => (
        <div>
          <div class="eyebrow" style="margin:10px 0 2px">{g.section}</div>
          {g.items.map((m) => <button class="recap-item" onClick={() => onJump(m.step, m.id)}><span class="small">{m.q}</span></button>)}
        </div>
      ))}
    </details>
  );
}

function ScorePreview({ result }) {
  const top = result.recommended.slice(0, 3);
  return (
    <div class="recap-score">
      <span class={`grade ${result.score.grade}`}>{result.score.grade}</span>
      <div style="flex:1;min-width:0">
        <strong>{result.score.label}</strong>
        <div class="small muted">Score {result.score.total} of {result.score.max}{top.length ? ` · Likely fits: ${top.map((r) => r.name.replace(/ \(.*\)$/, '')).join(', ')}` : ''}</div>
      </div>
    </div>
  );
}

// Copy the recap as plain text, or draft a recap email for the client. Nothing is sent from here.
function RecapActions({ recap, result, business, answers, names }) {
  const [draft, setDraft] = useState(null);
  const text = recapText(recap, { business, result });
  const openDraft = () => setDraft(recapEmail(answers, { business, contactName: names?.contact, repName: names?.rep, result }));
  return (
    <div class="row wrap mb">
      <CopyButton text={text} label="Copy recap" />
      <button class="btn sm secondary" onClick={openDraft}><Icon name="mail" size={14} />Send recap to client</button>
      {draft && (
        <Dialog title="Recap email draft" onClose={() => setDraft(null)} footer={<><button class="btn ghost" onClick={() => setDraft(null)}>Close</button><a class="btn secondary" href={`mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}>Open in email app</a><CopyButton text={`Subject: ${draft.subject}\n\n${draft.body}`} label="Copy email" /></>}>
          <p class="small muted" style="margin-top:0">A draft from the call, in the client's words. Nothing is sent automatically: edit it, then copy it into your email.</p>
          <label class="field"><span>Subject</span><input class="input" value={draft.subject} onInput={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label class="field"><span>Email</span><textarea class="textarea" rows="14" value={draft.body} onInput={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
        </Dialog>
      )}
    </div>
  );
}

function Summary({ result, client, recapProps, onJump, onEdit }) {
  return (
    <div class="page" style="max-width:980px">
      <div class="page-head">
        <div><a class="small muted" href={`/clients/${client.id}?tab=discovery`}>← {client.name}</a><h1>Discovery results</h1><p class="sub">Recommended services were added to the client record, and the follow-up is on your task list.</p></div>
        <div class="row"><button class="btn secondary" onClick={onEdit}>Edit answers</button><a class="btn" href={`/clients/${client.id}`}>Back to client</a></div>
      </div>
      <div class="grid main-side">
        <div class="stack">
          <ResultCard result={result} compact />
          <section class="card">
            <h2>Recommended plan</h2>
            {['start-with', 'next', 'later'].map((p) => {
              const list = result.recommended.filter((r) => r.priority === p);
              if (!list.length) return null;
              return (
                <div class="mb">
                  <div class="eyebrow" style="margin-top:8px">{{ 'start-with': 'Start with', next: 'Next', later: 'Later' }[p]}</div>
                  {list.map((r) => (
                    <div style="padding:8px 0;border-bottom:1px solid var(--line)">
                      <strong>{r.name}</strong>
                      <ul class="small muted" style="margin:4px 0 0;padding-left:18px">{r.reasons.map((x) => <li>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
          <section class="card">
            <div class="row between wrap"><h2 style="margin:0">Call recap</h2></div>
            <p class="small muted">Everything answered on the call. Select an answer to change it.</p>
            <RecapActions {...recapProps} />
            <Recap recap={recapProps.recap} onJump={onJump} />
          </section>
          <section class="card">
            <h2>Objections to prepare for</h2>
            {result.objections.map((o) => (
              <details style="padding:8px 0;border-bottom:1px solid var(--line)">
                <summary style="cursor:pointer;font-weight:600">{o.objection}</summary>
                <p style="margin:8px 0 4px">{o.response}</p>
                <p class="small muted" style="margin:0">Next: {o.next}</p>
              </details>
            ))}
          </section>
        </div>
        <div class="stack">
          <section class="card"><h2>Next steps</h2>{result.nextSteps.map((s) => <div class="row nowrap" style="padding:4px 0"><Icon name="check" size={16} /><span>{s}</span></div>)}</section>
          {result.redFlags.length > 0 && <section class="card"><h2>Red flags</h2>{result.redFlags.map((f) => <div class="small" style="padding:4px 0">• {f}</div>)}</section>}
        </div>
      </div>
    </div>
  );
}
