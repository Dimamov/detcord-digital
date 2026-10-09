import { useState } from 'preact/hooks';
import { useLoad, api, toast, ago, date } from '../lib.js';
import { Loading, ErrorBox, Icon, Dialog, Field, CopyButton, useAction } from '../ui.jsx';
import { visible } from '../../shared/discovery/schema.js';
import { answered } from '../../shared/discovery/recap.js';
import { Question, useAutosave, SaveStatus } from './discovery.jsx';

// ---------- The client's questionnaire (their portal; staff see a read-only preview) ----------
export function QuestionnairePage({ id }) {
  const { loading, data, error, reload } = useLoad(`/questionnaire/${id}`);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  return <Questionnaire data={data} />;
}

function Questionnaire({ data }) {
  const [answers, setAnswers] = useState(data.answers);
  const [submittedAt, setSubmittedAt] = useState(data.submittedAt);
  const [editing, setEditing] = useState(data.preview || !data.submittedAt);
  const { busy, error, run } = useAction();
  const { status: save, queue, flush } = useAutosave((body) => api('PATCH', `/questionnaire/${data.clientId}`, body), Date.now());
  const preview = data.preview;

  const shown = data.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => visible(q, answers)) }));
  const total = shown.reduce((n, s) => n + s.questions.length, 0);
  const done = shown.reduce((n, s) => n + s.questions.filter((q) => answered(answers[q.id])).length, 0);
  const setAnswer = (qid, v) => { if (preview) return; setAnswers((a) => ({ ...a, [qid]: v })); queue({ [qid]: v }); };
  const submit = () => run(async () => {
    if ((await flush()) === false) throw new Error('Some answers didn\'t save. Check your connection and try again.');
    const r = await api('POST', `/questionnaire/${data.clientId}/submit`, {});
    setSubmittedAt(r.submittedAt);
    setEditing(false);
    scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (!editing) {
    return (
      <div class="page" style="max-width:760px">
        <div class="page-head"><div><div class="eyebrow">Business questionnaire</div><h1>Thank you</h1><p class="sub">{data.business} · sent {date(submittedAt)}</p></div></div>
        <section class="card">
          <h2>What happens next</h2>
          <div class="stack" style="gap:10px">
            <div class="row nowrap" style="align-items:flex-start"><Icon name="check" /><span>Your Detcord strategist has your answers and will review them within one business day.</span></div>
            <div class="row nowrap" style="align-items:flex-start"><Icon name="check" /><span>We'll use them, with your website report, to put together recommendations specific to {data.business}.</span></div>
            <div class="row nowrap" style="align-items:flex-start"><Icon name="check" /><span>On our next call we'll walk through them together and answer your questions. Nothing starts without your OK.</span></div>
          </div>
          <div class="row wrap mt">
            <button class="btn secondary" onClick={() => setEditing(true)}><Icon name="pen" />Change my answers</button>
            {data.report && <a class="btn ghost" href={`/reports/${data.report.id}`}><Icon name="doc" />Your website report</a>}
            <a class="btn ghost" href="/">Back to home</a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div class="page" style="max-width:760px">
      {preview && <div class="alert info mb">Preview: this is the questionnaire {data.business} sees. Answers can only be entered by the client.</div>}
      <div class="page-head">
        <div>
          <div class="eyebrow">Business questionnaire</div>
          <h1>{data.business}</h1>
          <div class="row wrap mt small muted">
            <span>{done} of {total} answered</span>
            {!preview && <><span>·</span><span role="status"><SaveStatus save={save} retry={() => flush()} /></span></>}
          </div>
        </div>
      </div>
      <div class="progress mb" aria-hidden="true"><div style={`width:${total ? Math.round((done / total) * 100) : 0}%`} /></div>
      <div class="report-note mb"><strong>Be as thorough and honest as you can.</strong> {data.intro.replace(/^Please be as thorough and honest as you can\. /, '')}</div>
      {data.report && (
        <a class="card row between mb" style="text-decoration:none" href={`/reports/${data.report.id}`}>
          <div><strong>Your website and Google check: {data.report.score}/100</strong><div class="small muted">Review it before or after the questions. It helps to have it open.</div></div>
          <span class="btn sm secondary">Open report</span>
        </a>
      )}
      {shown.map((s) => s.questions.length > 0 && (
        <section class="card mb">
          <h2>{s.title}</h2>
          {s.questions.map((q) => <Question q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} hideOptional />)}
        </section>
      ))}
      {error && <div class="alert bad mb">{error}</div>}
      {!preview && (
        <div class="card row between wrap">
          <span class="small muted">{submittedAt ? `Sent ${ago(submittedAt)}. Changes save automatically.` : 'Skip anything you\'re not sure about. You can come back and change answers later.'}</span>
          <button class="btn" onClick={submit} disabled={busy}>{busy ? 'Sending…' : submittedAt ? 'Done' : 'Send my answers'}</button>
        </div>
      )}
    </div>
  );
}

// ---------- Staff: invite the client into their portal to review the report and answer the questionnaire ----------
export function QuestionnaireInvite({ clientId, compact = false }) {
  const { data, reload } = useLoad(`/clients/${clientId}/questionnaire`, [clientId]);
  const [channel, setChannel] = useState(null);
  const [manual, setManual] = useState(null);
  const d = data?.discovery;
  const button = <button class={`btn ${compact ? 'secondary' : 'secondary block'}`} disabled={!data} onClick={() => setChannel('email')}><Icon name="mail" />Invite client: report + questionnaire</button>;
  return (
    <>
      {compact ? button : (
        <section class="card">
          <h2>Client questionnaire</h2>
          <p class="muted small" style="margin-top:0">Invite the client into their portal to review {data?.report ? 'their website report' : 'any website report you share'} and answer the business questions themselves. Their answers fill this discovery, marked as client-entered until you confirm them.</p>
          {d?.invitedAt && (
            <div class="row between small mb" style="padding:4px 0">
              <span>Invited {ago(d.invitedAt)}{d.clientAnswered ? ` · ${d.clientAnswered} answered` : ''}</span>
              {d.submittedAt ? <span class="badge good">Sent {ago(d.submittedAt)}</span> : <span class="badge info">Waiting</span>}
            </div>
          )}
          <div class="stack" style="gap:8px">
            {button}
            <a class="btn ghost sm" href={`/questionnaire/${clientId}`}><Icon name="eye" size={14} />Preview what they see</a>
          </div>
        </section>
      )}
      {manual && (
        <Dialog title="Send this link yourself" onClose={() => setManual(null)} footer={<button class="btn" onClick={() => setManual(null)}>Done</button>}>
          <div class="alert warn small"><strong>{manual.channel === 'sms' ? 'Texting' : 'Email'} isn't connected yet, so nothing was sent.</strong> The questionnaire{data?.report ? ' and report are' : ' is'} in {manual.name}'s portal. Send them this {manual.kind === 'invite' ? 'one-time setup link (valid 7 days)' : 'link'} yourself:</div>
          <div class="row mt"><code class="small" style="word-break:break-all">{manual.link}</code><CopyButton text={manual.link} /></div>
        </Dialog>
      )}
      {channel && data && <InviteDialog clientId={clientId} info={data} channel={channel} setChannel={setChannel} onClose={() => setChannel(null)} onDone={(m) => { setChannel(null); setManual(m); reload(); }} />}
    </>
  );
}

function InviteDialog({ clientId, info, channel, setChannel, onClose, onDone }) {
  const people = info.people;
  const [pick, setPick] = useState(0);
  const [p, setP] = useState(people[0]);
  const [consent, setConsent] = useState(false);
  const { busy, error, run } = useAction();
  const sms = channel === 'sms';
  const first = (p.name || '').split(' ')[0];
  const choose = (i) => { setPick(i); setP(people[i]); };
  const send = () => run(async () => {
    try {
      await api('POST', `/clients/${clientId}/questionnaire/invite`, { channel, name: p.name, email: p.email, phone: p.phone, consent });
      toast(`${sms ? 'Texted' : 'Emailed'} ${first} a link to ${info.report ? 'their report and ' : ''}the questionnaire.`);
      onDone(null);
    } catch (e) {
      if (e.data?.manualLink) { onDone({ channel, name: p.name, kind: e.data.linkKind, link: e.data.manualLink }); return; }
      throw e;
    }
  });
  const ready = p.name && p.email && (!sms || (p.phone && consent));
  return (
    <Dialog title="Invite client: report + questionnaire" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy || !ready} onClick={send}>{busy ? 'Sending…' : sms ? 'Send text' : 'Send email'}</button></>}>
      <div class="stack">
        <div class="chips" role="radiogroup" aria-label="Send by">
          <button type="button" class="chip" aria-pressed={!sms} onClick={() => setChannel('email')}><Icon name="mail" size={14} />Email</button>
          <button type="button" class="chip" aria-pressed={sms} onClick={() => setChannel('sms')}><Icon name="phone" size={14} />Text</button>
        </div>
        {!info.channels[channel] && <div class="alert warn small">{sms ? 'Texting (Twilio) isn\'t connected yet.' : 'Email sending isn\'t connected yet.'} The questionnaire still goes into their portal, and you'll get the link to send yourself.</div>}
        {people.length > 1 && <div class="chips">{people.map((x, i) => <button type="button" class="chip" aria-pressed={pick === i} onClick={() => choose(i)}>{x.name || x.email}</button>)}</div>}
        <Field label="Name"><input class="input" value={p.name} onInput={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Email" help={sms ? 'for their portal login' : undefined}><input class="input" type="email" value={p.email} onInput={(e) => setP({ ...p, email: e.target.value, login: null })} /></Field>
        {sms && <Field label="Mobile number"><input class="input" type="tel" value={p.phone} onInput={(e) => setP({ ...p, phone: e.target.value })} /></Field>}
        {sms && <label class="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{first || 'The customer'} agreed to get this by text.</label>}
        <div class="script" style="margin:0"><strong>They'll read</strong>
          {info.report ? `Their website and Google check (${info.report.score}/100) is ready to review, ` : 'A short questionnaire about the business is ready, '}
          {info.report ? 'plus a short questionnaire about the business. ' : ''}
          "Please be as thorough and honest as you can: there are no wrong answers, and the better we understand how things really are today, the better our recommendations will be."
        </div>
        <div class="faint small">{p.login === 'active'
          ? `${first} already has a portal login, so the link opens the questionnaire after they sign in.`
          : 'This creates their portal login. The link lets them set a password and opens the questionnaire. It works once and lasts 7 days.'}
          {info.report && !info.report.shared ? ' Sending also shares the latest website check with them.' : ''}</div>
        {error && <div class="alert bad">{error}</div>}
      </div>
    </Dialog>
  );
}
