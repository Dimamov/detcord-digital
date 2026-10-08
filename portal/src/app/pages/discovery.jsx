import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLoad, api, toast, navigate, ago } from '../lib.js';
import { Loading, ErrorBox, Icon, Chips, Dialog, useAction } from '../ui.jsx';
import { buildSections, progress, computeResult } from '../../shared/discovery/engine.js';
import { visible } from '../../shared/discovery/schema.js';
import { industryById } from '../../shared/discovery/industries.js';
import { SERVICES, serviceById } from '../../shared/services.js';
import { ResultCard, IndustrySelect } from './clients.jsx';

const answered = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

export function DiscoveryRunner({ id }) {
  const { loading, data, error, reload } = useLoad(`/discoveries/${id}`);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  return <Runner initial={data.discovery} client={data.client} />;
}

function Runner({ initial, client }) {
  const [answers, setAnswers] = useState(initial.answers);
  const [industry, setIndustry] = useState(initial.industry);
  const [modules, setModules] = useState(initial.modules);
  const [status, setStatus] = useState(initial.status);
  const [finalResult, setFinalResult] = useState(initial.result);
  const [step, setStep] = useState(0);
  const [save, setSave] = useState({ state: 'saved', at: initial.updated_at });
  const [picker, setPicker] = useState(false);
  const pending = useRef({});
  const timer = useRef();
  const { busy, error, run } = useAction();

  const sections = useMemo(() => buildSections(industry, modules), [industry, modules]);
  const preview = useMemo(() => computeResult(answers, industry), [answers, industry]);
  const prog = progress(sections, answers);
  const section = sections[Math.min(step, sections.length - 1)];

  const flush = async (extra = {}) => {
    clearTimeout(timer.current);
    const body = { answers: pending.current, ...extra };
    pending.current = {};
    setSave({ state: 'saving' });
    try {
      await api('PATCH', `/discoveries/${initial.id}`, body);
      setSave({ state: 'saved', at: Date.now() });
    } catch (e) {
      Object.assign(pending.current, body.answers);
      setSave({ state: 'error', message: e.message });
    }
  };
  const setAnswer = (qid, v) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    pending.current[qid] = v;
    setSave({ state: 'pending' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };
  // Save before leaving the page.
  useEffect(() => {
    const warn = (e) => { if (Object.keys(pending.current).length) { flush(); e.preventDefault(); } };
    addEventListener('beforeunload', warn);
    return () => { removeEventListener('beforeunload', warn); if (Object.keys(pending.current).length) flush(); };
  }, []);

  const go = (i) => { setStep(i); scrollTo({ top: 0, behavior: 'smooth' }); };
  const changeIndustry = (v) => { setIndustry(v || null); flush({ industry: v || null }); };
  const toggleModule = (sid) => {
    const next = modules.includes(sid) ? modules.filter((m) => m !== sid) : [...modules, sid];
    setModules(next);
    flush({ modules: next });
  };
  const complete = () => run(async () => {
    await flush();
    const r = await api('POST', `/discoveries/${initial.id}/complete`, {});
    setFinalResult(r.result);
    setStatus('complete');
    toast(r.followUp ? 'Discovery saved. Follow-up task created.' : 'Discovery saved.');
    scrollTo({ top: 0 });
  });

  if (status === 'complete' && finalResult) {
    return <Summary result={finalResult} client={client} onEdit={() => setStatus('in_progress')} />;
  }

  const sectionDone = (s) => s.questions.filter((q) => !q.optional && visible(q, answers)).every((q) => answered(answers[q.id]));
  const ind = industryById[industry];

  return (
    <div class="page" style="max-width:1320px">
      <div class="page-head">
        <div>
          <a class="small muted" href={`/clients/${client.id}?tab=discovery`}>← {client.name}</a>
          <h1>Discovery call</h1>
          <div class="row mt small muted">
            <span>{prog.done} of {prog.total} answered</span>
            <span>·</span>
            <span role="status">{save.state === 'saving' ? 'Saving…' : save.state === 'pending' ? 'Unsaved changes' : save.state === 'error' ? <span class="overdue">Not saved: {save.message} <button class="btn sm ghost" onClick={() => flush()}>Retry</button></span> : `Saved ${ago(save.at)}`}</span>
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
              <span style="flex:1">{s.title.replace(/: (industry questions|scoping)$/, '')}</span>
              {s.minutes && <span class="faint small">{s.minutes}m</span>}
            </button>
          ))}
          <button onClick={() => setPicker(true)} style="color:var(--accent-2)"><Icon name="plus" size={14} />Add service questions</button>
        </nav>

        <main class="card" style="min-width:0">
          <div class="row between">
            <div class="eyebrow" style="margin:0">{section.kind === 'industry' ? 'Industry' : section.kind === 'service' ? 'Service scoping' : `Step ${step + 1} of ${sections.length}`}</div>
            {section.kind === 'service' && <button class="btn sm ghost" onClick={() => { toggleModule(section.id.split(':')[1]); go(Math.max(0, step - 1)); }}>Remove</button>}
          </div>
          <h2 style="font-size:22px;margin:4px 0 14px">{section.title}</h2>

          {section.id === 'open' && (
            <div class="field mb"><span>Industry</span><IndustrySelect value={industry} onChange={changeIndustry} /></div>
          )}
          {(section.script || []).map((s) => <div class="script"><strong>Say</strong>{s}</div>)}
          {section.listenFor && <div class="script"><strong>Listen for</strong>{section.listenFor.map((l) => <div>• {l}</div>)}</div>}
          {section.michigan && <div class="script"><strong>Michigan angle</strong>{section.michigan}</div>}

          {section.questions.filter((q) => visible(q, answers)).map((q) => (
            <Question q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          ))}

          <div class="row between mt">
            <button class="btn secondary" disabled={step === 0} onClick={() => go(step - 1)}><Icon name="back" />Back</button>
            {step < sections.length - 1
              ? <button class="btn" onClick={() => go(step + 1)}>Next: {sections[step + 1].title.replace(/: (industry questions|scoping)$/, '')}<Icon name="arrow" /></button>
              : <button class="btn" onClick={complete} disabled={busy}>Finish and score</button>}
          </div>
        </main>

        <aside class="side stack">
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

function Question({ q, value, onChange }) {
  return (
    <div class="question">
      <div class="qtext">{q.q}{q.optional && <span class="faint small"> · optional</span>}</div>
      {q.hint && <div class="hint">{q.hint}</div>}
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
    </div>
  );
}

function Summary({ result, client, onEdit }) {
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
