import { useState, useRef, useEffect } from 'preact/hooks';
import { useLoad, api, toast, navigate, dateTime, ago } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, CopyButton, useAction } from '../ui.jsx';

const STATUS = {
  uploaded: ['Uploaded', 'info'], transcribing: ['Transcribing', 'info'], transcribed: ['Transcript ready', 'info'],
  analyzing: ['Claude is writing notes', 'info'], ready: ['Notes ready', 'accent'], failed: ['Needs attention', 'bad'],
};
const MAX_AUDIO = 95 * 1024 * 1024;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const length = (s) => s ? (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`) : '';
const Badge = ({ m }) => <span class={`badge ${m.saved_at ? 'good' : STATUS[m.status]?.[1] || ''}`}>{m.saved_at ? 'Saved to CRM' : STATUS[m.status]?.[0]}</span>;

// Raw upload with progress; the server streams it into storage.
function uploadAudio(clientId, blob, { title, filename }, onProgress) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ consent: 'yes', title: title || '', filename });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/clients/${clientId}/meetings?${q}`);
    xhr.setRequestHeader('Content-Type', (blob.type || 'application/octet-stream').split(';')[0]);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'The upload failed.'));
    };
    xhr.onerror = () => reject(new Error('Can’t reach the portal. Check your connection and try again.'));
    xhr.send(blob);
  });
}

const pickType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';

// Records in the browser. Recording can't start until the rep confirms the client agreed.
function Recorder({ client, onDone }) {
  const [consent, setConsent] = useState(false);
  const [title, setTitle] = useState('');
  const [state, setState] = useState('idle'); // idle | recording | paused | stopped | uploading
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const rec = useRef(null);
  const chunks = useRef([]);
  const lock = useRef(null);
  const fileInput = useRef();

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state !== 'recording' && state !== 'paused' && state !== 'uploading') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [state]);

  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); lock.current?.release?.(); }, []);

  const start = async () => {
    setError(null);
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { setError('This browser can’t record. Use Chrome or Safari, or upload a recording instead.'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError('The microphone is blocked. Allow microphone access for this site and try again.');
      return;
    }
    const type = pickType();
    const r = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      lock.current?.release?.();
      setBlob(new Blob(chunks.current, { type: r.mimeType || type || 'audio/webm' }));
      setState('stopped');
    };
    r.start(1000);
    rec.current = r;
    try { lock.current = await navigator.wakeLock?.request('screen'); } catch {}
    setSeconds(0);
    setState('recording');
  };
  const pause = () => { rec.current.pause(); setState('paused'); };
  const resume = () => { rec.current.resume(); setState('recording'); };
  const stop = () => rec.current.stop();
  const discard = () => { setBlob(null); setSeconds(0); setState('idle'); };

  const send = async (b, filename) => {
    if (b.size > MAX_AUDIO) { setError('Recordings can be up to 95 MB.'); return; }
    setError(null);
    setState('uploading');
    setProgress(0);
    try {
      const { meeting } = await uploadAudio(client.id, b, { title, filename }, setProgress);
      toast('Recording saved. Transcribing now.');
      onDone(meeting);
    } catch (e) {
      setError(`${e.message} The recording is still here, so you can try again.`);
      setState(b === blob ? 'stopped' : 'idle');
    }
  };
  const ext = (blob?.type || '').includes('mp4') ? 'm4a' : (blob?.type || '').includes('ogg') ? 'ogg' : 'webm';

  return (
    <section class="card">
      <h2>Record a meeting</h2>
      <p class="small muted" style="margin-top:0">For in-person sales meetings. The recording is turned into a transcript, then Claude drafts CRM notes and discovery answers for you to review. Nothing is saved to the client record until you choose.</p>
      <Field label="Meeting title (optional)"><input value={title} onInput={(e) => setTitle(e.target.value)} placeholder={`Meeting with ${client.name}`} maxLength={120} disabled={state === 'uploading'} /></Field>
      <label class="row nowrap mt" style="gap:10px;cursor:pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={state !== 'idle'} style="margin-top:3px" />
        <span><strong>Everyone in the meeting agreed to be recorded.</strong><span class="small muted" style="display:block">Ask out loud before you start, for example: “Is it OK if I record this so I don’t miss anything? It stays private to our team.” Your name and the time are saved with the recording.</span></span>
      </label>
      {error && <div class="alert bad mt" role="alert">{error}</div>}
      <div class="row mt">
        {state === 'idle' && <>
          <button class="btn" disabled={!consent} onClick={start}><Icon name="mic" />Start recording</button>
          <button class="btn secondary" disabled={!consent} onClick={() => fileInput.current.click()}><Icon name="upload" />Upload a recording</button>
          <input ref={fileInput} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) send(f, f.name); }} />
        </>}
        {(state === 'recording' || state === 'paused') && <>
          <span class={`badge ${state === 'recording' ? 'bad' : 'warn'}`} aria-live="polite">{state === 'recording' ? '● Recording' : 'Paused'} {clock(seconds)}</span>
          {state === 'recording' ? <button class="btn secondary" onClick={pause}>Pause</button> : <button class="btn secondary" onClick={resume}>Resume</button>}
          <button class="btn" onClick={stop}>Stop</button>
        </>}
        {state === 'stopped' && blob && <>
          <audio controls src={URL.createObjectURL(blob)} style="max-width:100%" />
          <button class="btn" onClick={() => send(blob, `meeting.${ext}`)}>Save and transcribe</button>
          <button class="btn ghost" onClick={discard}>Discard</button>
        </>}
        {state === 'uploading' && <span class="small muted">Uploading {Math.round(progress * 100)}%. Keep this page open.</span>}
      </div>
      {(state === 'recording' || state === 'paused') && <p class="small muted">Keep this page open and the phone unlocked until you press Stop.</p>}
    </section>
  );
}

// Client record tab (staff only).
export function MeetingsTab({ client }) {
  const { data, error, reload } = useLoad(`/clients/${client.id}/meetings`, [client.id]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div class="stack">
      {!data.ready.transcription && <div class="alert warn">Transcription is not set up yet, so recordings are kept but not transcribed. Bob adds DEEPGRAM_API_KEY in Task 6.</div>}
      <Recorder client={client} onDone={(m) => navigate(`/meetings/${m.id}`)} />
      <section class="card">
        <h2>Meetings</h2>
        {data.meetings.length === 0 ? <Empty title="No recorded meetings yet">Recordings and their notes show up here.</Empty> : (
          <div class="list">{data.meetings.map((m) => (
            <a class="list-item" href={`/meetings/${m.id}`}>
              <Icon name="mic" />
              <div style="flex:1;min-width:0"><div class="title">{m.title}</div><div class="meta">{dateTime(m.created_at)}{m.duration_sec ? ` · ${length(m.duration_sec)}` : ''}{m.rep_name ? ` · ${m.rep_name}` : ''}</div></div>
              <Badge m={m} />
            </a>
          ))}</div>
        )}
      </section>
    </div>
  );
}

// ---------- One meeting ----------

export function MeetingPage({ id }) {
  const { data, error, reload } = useLoad(`/meetings/${id}`, [id]);
  const asked = useRef(false);
  const analyze = useAction();
  const m = data?.meeting;

  // Poll while Deepgram works; then ask Claude for notes once.
  useEffect(() => {
    if (!m) return undefined;
    if (['uploaded', 'transcribing', 'analyzing'].includes(m.status)) {
      const t = setTimeout(reload, 4000);
      return () => clearTimeout(t);
    }
    if (m.status === 'transcribed' && !m.error && data.ready.ai && !asked.current) {
      asked.current = true;
      analyze.run(async () => { await api('POST', `/meetings/${id}/analyze`); reload(); });
    }
    return undefined;
  }, [m?.status, m?.updated_at]);

  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (!data) return <div class="page"><Loading /></div>;
  const working = analyze.busy || ['uploaded', 'transcribing', 'analyzing'].includes(m.status);

  return (
    <div class="page narrow">
      <a class="small muted" href={`/clients/${m.client_id}?tab=meetings`}>← {m.client_name}</a>
      <div class="page-head">
        <div>
          <h1>{m.title}</h1>
          <div class="row mt" style="gap:8px"><Badge m={m} /><span class="faint small">{dateTime(m.created_at)}{m.duration_sec ? ` · ${length(m.duration_sec)}` : ''}</span></div>
        </div>
        <MeetingMenu m={m} reload={reload} />
      </div>
      <p class="small muted">Recording consent confirmed by {m.consent_name || 'a team member'} on {dateTime(m.consent_at)}.</p>
      {m.has_audio && <audio controls preload="none" src={`/api/meetings/${m.id}/audio`} style="width:100%" class="mb" />}

      {working && (
        <section class="card row" style="gap:12px"><div class="spinner" />
          <div>{m.status === 'transcribing' || m.status === 'uploaded' ? 'Transcribing the recording. Long meetings can take a few minutes; you can leave this page and come back.' : 'Claude is writing the meeting notes. This usually takes under a minute.'}</div>
        </section>
      )}
      {(m.error || analyze.error) && !working && <Problem m={m} message={analyze.error || m.error} ai={data.ready.ai} reload={() => { asked.current = true; reload(); }} onAnalyze={() => analyze.run(async () => { await api('POST', `/meetings/${id}/analyze`); reload(); })} />}
      {m.status === 'transcribed' && !m.error && !data.ready.ai && <div class="alert warn">The transcript is ready. Claude is not set up yet, so there are no drafted notes. Bob adds ANTHROPIC_API_KEY in Task 6.</div>}

      {m.analysis && <Review m={m} questions={data.questions} services={data.services} reload={reload} />}
      {m.transcript.length > 0 && <Transcript lines={m.transcript} prospect={m.analysis?.prospect_speaker} />}
    </div>
  );
}

function Problem({ m, message, ai, reload, onAnalyze }) {
  const act = useAction();
  const retry = () => act.run(async () => { await api('POST', `/meetings/${m.id}/retry`); reload(); });
  return (
    <div class="alert bad mb">
      <div>{message}</div>
      <div class="row mt">
        {m.status === 'failed' && m.has_audio && <button class="btn sm secondary" disabled={act.busy} onClick={retry}>Transcribe again</button>}
        {m.status === 'transcribed' && ai && <button class="btn sm secondary" onClick={onAnalyze}>Write notes again</button>}
      </div>
      {act.error && <div class="small mt">{act.error}</div>}
    </div>
  );
}

function MeetingMenu({ m, reload }) {
  const [confirm, setConfirm] = useState(null);
  const act = useAction();
  const go = () => act.run(async () => {
    if (confirm === 'audio') { await api('DELETE', `/meetings/${m.id}/audio`); toast('Recording deleted. The transcript and notes are kept.'); setConfirm(null); reload(); }
    else { await api('DELETE', `/meetings/${m.id}`); toast('Meeting deleted.'); navigate(`/clients/${m.client_id}?tab=meetings`); }
  });
  return (
    <div class="row">
      {m.has_audio && m.status !== 'transcribing' && <button class="btn sm ghost" onClick={() => setConfirm('audio')}>Delete recording</button>}
      <button class="btn sm ghost" onClick={() => setConfirm('all')}>Delete meeting</button>
      {confirm && (
        <Dialog title={confirm === 'audio' ? 'Delete the recording?' : 'Delete this meeting?'} onClose={() => setConfirm(null)}
          footer={<><button class="btn secondary" onClick={() => setConfirm(null)}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>Delete</button></>}>
          <p>{confirm === 'audio' ? 'The audio file is removed for good. The transcript and notes stay.' : 'The recording, transcript and drafted notes are removed for good. Anything already saved to the client record stays.'}</p>
          {act.error && <div class="alert bad">{act.error}</div>}
        </Dialog>
      )}
    </div>
  );
}

const List = ({ title, items }) => items?.length ? <><h3 class="mt">{title}</h3><ul style="margin:0;padding-left:20px">{items.map((x) => <li>{x}</li>)}</ul></> : null;

function Check({ checked, onChange, children }) {
  return (
    <label class="row nowrap" style="gap:10px;cursor:pointer;padding:6px 0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style="margin-top:3px" />
      <span style="flex:1">{children}</span>
    </label>
  );
}

// The rep reviews Claude's draft and ticks what goes into the CRM.
function Review({ m, questions, services, reload }) {
  const a = m.analysis;
  const all = (list) => (list || []).map((_, i) => i);
  const [note, setNote] = useState(true);
  const [steps, setSteps] = useState(all(a.next_steps));
  const [svc, setSvc] = useState(all(a.service_interest));
  const [answers, setAnswers] = useState((a.answers || []).filter((x) => questions[x.id]).map((x) => x.id));
  const act = useAction();
  const toggle = (list, set, v) => (on) => set(on ? [...list, v] : list.filter((x) => x !== v));
  const save = () => act.run(async () => {
    const r = await api('POST', `/meetings/${m.id}/save`, { note, next_steps: steps, services: svc, answers });
    toast(`Saved${r.note ? ' notes' : ''}${r.tasks ? `, ${r.tasks} task${r.tasks > 1 ? 's' : ''}` : ''}${r.answers ? `, ${r.answers} discovery answer${r.answers > 1 ? 's' : ''}` : ''}.`);
    reload();
  });
  const shown = (a.answers || []).filter((x) => questions[x.id]);

  return (
    <>
      <section class="card">
        <div class="card-head"><h2>Meeting notes</h2><span class="small faint">Drafted by Claude. Check before saving.</span></div>
        <Check checked={note} onChange={setNote}><strong>Save these notes to the client record</strong> (internal)</Check>
        <p>{a.summary}</p>
        <List title="Pain points" items={a.pain_points} />
        <List title="Goals" items={a.goals} />
        <List title="Objections" items={a.objections} />
        <dl class="kv mt">
          <dt>Budget</dt><dd>{a.budget || 'Not discussed'}</dd>
          <dt>Timeline</dt><dd>{a.timeline || 'Not discussed'}</dd>
          <dt>Decision makers</dt><dd>{a.decision_makers || 'Not discussed'}</dd>
        </dl>
      </section>

      {a.service_interest?.length > 0 && (
        <section class="card">
          <h2>Recommended services</h2>
          <p class="small muted" style="margin-top:0">Ticked services are listed in the saved notes.</p>
          {a.service_interest.map((s, i) => <Check checked={svc.includes(i)} onChange={toggle(svc, setSvc, i)}><strong>{services[s.service_id] || s.service_id}</strong><div class="small muted">{s.reason}</div></Check>)}
        </section>
      )}

      {a.next_steps?.length > 0 && (
        <section class="card">
          <h2>Next steps</h2>
          <p class="small muted" style="margin-top:0">Ticked steps become your tasks.</p>
          {a.next_steps.map((s, i) => <Check checked={steps.includes(i)} onChange={toggle(steps, setSteps, i)}>{s.owner === 'prospect' ? 'Client: ' : ''}{s.title}<span class="small faint"> · due in {s.due_in_days} day{s.due_in_days === 1 ? '' : 's'}</span></Check>)}
        </section>
      )}

      {shown.length > 0 && (
        <section class="card">
          <h2>Discovery answers</h2>
          <p class="small muted" style="margin-top:0">Ticked answers fill in a discovery for this client, where you can finish the rest and score the lead.</p>
          {shown.map((x) => (
            <Check checked={answers.includes(x.id)} onChange={toggle(answers, setAnswers, x.id)}>
              <div class="small faint">{questions[x.id].section}</div>
              <strong>{questions[x.id].q}</strong>
              <div>{display(x.value, questions[x.id])}</div>
              {x.quote && <div class="small muted" style="font-style:italic">“{x.quote}”</div>}
            </Check>
          ))}
        </section>
      )}

      {a.follow_up_email && (
        <section class="card">
          <div class="card-head"><h2>Follow-up email draft</h2><CopyButton text={a.follow_up_email} label="Copy" /></div>
          <p class="small muted" style="margin-top:0">Not sent. Copy it into your email and edit before sending.</p>
          <div style="white-space:pre-wrap">{a.follow_up_email}</div>
        </section>
      )}

      <section class="card row between">
        <div class="small muted">{m.saved_at ? `Saved to the client record ${ago(m.saved_at)}. Saving again adds the ticked items again.` : 'Nothing is saved to the client record until you press Save.'}</div>
        <div class="row">
          {m.discovery_id && <a class="btn secondary" href={`/discovery/${m.discovery_id}`}>Open discovery</a>}
          <button class="btn" disabled={act.busy || (!note && !steps.length && !answers.length)} onClick={save}>Save to CRM</button>
        </div>
        {act.error && <div class="alert bad" style="width:100%">{act.error}</div>}
      </section>
    </>
  );
}

function display(value, q) {
  if (!q.options) return value;
  const label = (v) => q.options.find((o) => o.v === v.trim())?.l || v;
  return String(value).split('|').map(label).join(', ');
}

function Transcript({ lines, prospect }) {
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(0, 8);
  const who = (s) => (prospect === undefined || prospect === null ? `Speaker ${s + 1}` : s === prospect ? 'Client' : `Speaker ${s + 1}`);
  return (
    <section class="card">
      <h2>Transcript</h2>
      <div class="stack" style="gap:10px">
        {shown.map((l) => <div><div class="small faint">{who(l.speaker)} · {clock(l.start)}</div><div>{l.text}</div></div>)}
      </div>
      {lines.length > 8 && <button class="btn sm ghost mt" onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show all ${lines.length} lines`}</button>}
    </section>
  );
}
