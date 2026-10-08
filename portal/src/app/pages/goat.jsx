import { useState, useRef } from 'preact/hooks';
import { useLoad, api, toast, navigate, ago, dateTime, session } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, Avatar, CopyButton, useAction } from '../ui.jsx';
import { uploadFile, FilePicker } from './files.jsx';

const TONE = { unmatched: 'warn', new: 'info', proposed: 'accent', approved: 'info', in_progress: 'info', done: 'good', failed: 'bad', cancelled: '' };
const CHANNEL = { portal: 'Portal', email: 'Email', sms: 'Text' };
const EXAMPLES = ['Change my hours for the holiday', 'Post this flyer on Facebook and Instagram', 'Add a 10% off promotion to my website', 'Update my Google business info', 'Write ad copy for our spring special'];
const isImage = (t) => /^image\/(png|jpeg|webp|gif)$/.test(t);
const newKey = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));

export const GoatBadge = ({ r }) => <span class={`badge ${TONE[r.status] || ''}`}>{r.status_label}</span>;

// "ASK THE GOAT": type a request, attach photos or files, send. Staff use it to log a request
// a client made by phone or in person.
export function GoatComposer({ clientId, user, onSent, compact = false }) {
  const staff = user.role !== 'client';
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]); // { id, filename, contentType } or { key, filename, progress, error }
  const [picking, setPicking] = useState(false);
  const submitKey = useRef(newKey());
  const input = useRef();
  const { busy, error, run } = useAction();
  const uploading = files.some((f) => f.key && !f.id && !f.error);

  const add = async (list) => {
    for (const file of [...list]) {
      const key = newKey();
      setFiles((fs) => [...fs, { key, filename: file.name, progress: 0 }]);
      try {
        const saved = await uploadFile(clientId, file, { visibility: staff ? 'shared' : null, purpose: file.type.startsWith('image/') ? 'photo' : 'other' }, (p) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, progress: p } : f))));
        setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, id: saved.id, contentType: saved.content_type } : f)));
      } catch (e) {
        setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, error: e.message } : f)));
      }
    }
  };

  const send = () => run(async () => {
    const res = await api('POST', `/clients/${clientId}/goat`, { body, mediaIds: files.filter((f) => f.id).map((f) => f.id), submitKey: submitKey.current });
    submitKey.current = newKey();
    setBody('');
    setFiles([]);
    toast(staff ? 'Request logged.' : 'Sent. GOAT is on it.');
    onSent?.(res.id);
  });

  return (
    <div class="stack">
      <Field label={staff ? 'What did the client ask for?' : 'What do you need?'}>
        <textarea rows={compact ? 3 : 4} value={body} onInput={(e) => setBody(e.target.value)} maxLength={4000}
          placeholder={staff ? 'Write the request in the client’s words.' : 'Change my hours, post this flyer, add a promotion…'} />
      </Field>
      {!body && !compact && (
        <div class="chips">{EXAMPLES.map((x) => <button type="button" class="chip" onClick={() => setBody(x)}>{x}</button>)}</div>
      )}
      {files.length > 0 && (
        <div class="stack tight">
          {files.map((f) => (
            <div class="row small" style="gap:8px">
              <Icon name={f.contentType && isImage(f.contentType) ? 'image' : 'doc'} size={16} />
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{f.filename}</span>
              {f.error ? <span class="badge bad">{f.error}</span> : f.id ? <span class="badge good">Attached</span> : <span class="faint">{Math.round((f.progress || 0) * 100)}%</span>}
              <button type="button" class="icon-btn" aria-label={`Remove ${f.filename}`} onClick={() => setFiles((fs) => fs.filter((x) => x !== f))}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {error && <div class="alert bad">{error}</div>}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <input ref={input} type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.ai,.eps,.psd,.mp4,.mov" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <button type="button" class="btn secondary" onClick={() => input.current.click()}><Icon name="image" />Add photos or files</button>
        <button type="button" class="btn ghost" onClick={() => setPicking(true)}><Icon name="folder" />From my files</button>
        <button type="button" class="btn" style="margin-left:auto" disabled={busy || uploading || !body.trim()} onClick={send}><Icon name="bolt" />{busy ? 'Sending…' : staff ? 'Log request' : 'Send to GOAT'}</button>
      </div>
      {picking && (
        <FilePicker clientId={clientId} user={user} note="Pick files to send with this request." picked={files.filter((f) => f.id)}
          onChange={(picked) => setFiles((fs) => [...fs.filter((f) => !f.id || picked.some((p) => p.id === f.id)), ...picked.filter((p) => !fs.some((f) => f.id === p.id))])}
          onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

function RequestRow({ r, showClient }) {
  return (
    <a class="list-item" href={`/goat/${r.id}`}>
      <Icon name={r.channel === 'sms' ? 'phone' : r.channel === 'email' ? 'mail' : 'bolt'} />
      <div style="flex:1;min-width:0">
        <div class="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.proposal?.summary || r.body}</div>
        <div class="meta">{showClient && r.client_name ? `${r.client_name} · ` : ''}{r.category_label} · {CHANNEL[r.channel]} · {ago(r.updated_at)}</div>
      </div>
      <GoatBadge r={r} />
    </a>
  );
}

export function GoatList({ clientId, showClient = false, emptyText }) {
  const [status, setStatus] = useState('open');
  const { loading, data, error, reload } = useLoad(`/goat?status=${status}${clientId ? `&client=${clientId}` : ''}`, [clientId, status]);
  return (
    <div class="stack">
      <div class="chips">{[['open', 'Open'], ['closed', 'Finished'], ['all', 'All']].map(([v, l]) => <button type="button" class="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>)}</div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <>
          {data.unmatched?.length > 0 && (
            <section class="card attention">
              <h2>Unknown senders</h2>
              <p class="small muted" style="margin-top:0">These came from numbers or addresses that don’t belong to a client yet. Confirm who sent each one before anything is done.</p>
              <div class="list">{data.unmatched.map((r) => (
                <a class="list-item" href={`/goat/${r.id}`}>
                  <Icon name={r.channel === 'sms' ? 'phone' : 'mail'} />
                  <div style="flex:1;min-width:0"><div class="title">{r.sender_address}</div><div class="meta">{r.claimed_business ? `Says: ${r.claimed_business} · ` : ''}{r.body.slice(0, 80)}</div></div>
                  <span class="faint small">{ago(r.created_at)}</span>
                </a>
              ))}</div>
            </section>
          )}
          {data.requests.length ? <div class="list">{data.requests.map((r) => <RequestRow r={r} showClient={showClient} />)}</div>
            : <Empty title={status === 'open' ? 'Nothing open' : 'No requests yet'}>{emptyText}</Empty>}
        </>
      )}
    </div>
  );
}

// Client: Ask the GOAT. Staff: the request queue across their clients.
export function GoatPage({ user }) {
  const staff = user.role !== 'client';
  const businesses = session.value?.clients || [];
  return (
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">GOAT Command</div>
          <h1>{staff ? 'Requests' : 'Ask the GOAT'}</h1>
          <p class="sub">{staff ? 'Client requests from the portal, email and text. Plan, get approval, do the work.' : 'Text it. Email it. Type it. You approve the plan before anything changes.'}</p>
        </div>
      </div>
      {!staff && businesses[0] && (
        <section class="card mb"><GoatComposer clientId={businesses[0].id} user={user} onSent={(id) => navigate(`/goat/${id}`)} /></section>
      )}
      <section class="card">
        {!staff && <h2>Your requests</h2>}
        <GoatList showClient={staff} emptyText={staff ? 'New requests from clients show up here.' : 'Send your first request above.'} />
      </section>
      {staff && <p class="small faint mt">Approved plans are carried out by the Detcord team. Nothing is changed on a client’s website, Google profile or social accounts automatically.</p>}
    </div>
  );
}

// Client record tab.
export function GoatTab({ client, user }) {
  const [tick, setTick] = useState(0);
  return (
    <div class="stack">
      <section class="card"><h2>Log a request</h2><GoatComposer clientId={client.id} user={user} compact onSent={() => setTick(tick + 1)} /></section>
      <section class="card"><GoatList key={tick} clientId={client.id} emptyText="Requests from this client’s portal, email and texts show up here." /></section>
    </div>
  );
}

// Client home card.
export function GoatCard({ clientId, user }) {
  const { data } = useLoad(`/goat?status=open&client=${clientId}`, [clientId]);
  const waiting = (data?.requests || []).filter((r) => r.status === 'proposed');
  return (
    <section class="card mb">
      <div class="row" style="gap:14px;align-items:center;margin-bottom:12px">
        <img src="/goat-96.webp" alt="" style="width:48px;height:48px;border-radius:50%" />
        <div style="flex:1"><h2 style="margin:0">ASK THE GOAT</h2><div class="small muted">Website changes, posts, promotions, Google updates. You approve before anything changes.</div></div>
        <a class="btn sm secondary" href="/goat">All requests</a>
      </div>
      {waiting.length > 0 && (
        <div class="list mb">{waiting.map((r) => <RequestRow r={r} />)}</div>
      )}
      <GoatComposer clientId={clientId} user={user} compact onSent={(id) => navigate(`/goat/${id}`)} />
    </section>
  );
}

// ---------- One request ----------

export function GoatRequestPage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/goat/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { request: r, events, files } = data;
  const staff = user.role !== 'client';
  const requestFiles = files.filter((f) => f.role === 'request');
  const resultFiles = files.filter((f) => f.role === 'result');
  return (
    <div class="page narrow">
      <a class="back" href={staff && r.client_id ? `/clients/${r.client_id}?tab=goat` : '/goat'}><Icon name="back" size={16} />{staff && r.client_id ? r.client_name : 'All requests'}</a>
      <div class="page-head">
        <div>
          <div class="eyebrow">{r.category_label} · {CHANNEL[r.channel]}{r.sender_name ? ` · ${r.sender_name}` : ''}</div>
          <h1>{r.proposal?.summary ? 'Your request' : 'Request received'}</h1>
          <p class="sub">Sent {dateTime(r.created_at)}{staff && r.sender_address ? ` from ${r.sender_address}` : ''}</p>
        </div>
        <GoatBadge r={r} />
      </div>

      {!r.client_id && staff && <MatchCard data={data} onDone={reload} />}

      <section class="card mb">
        {r.subject && <div class="small muted mb">Subject: {r.subject}</div>}
        <div style="white-space:pre-wrap">{r.body}</div>
        {requestFiles.length > 0 && <Attachments files={requestFiles} />}
      </section>

      <PlanCard data={data} user={user} onDone={reload} />

      {r.status === 'done' && (
        <section class="card mb" style="border-color:var(--good)">
          <h2>Done</h2>
          <div style="white-space:pre-wrap">{r.result_note}</div>
          {r.result_url && <p><a href={r.result_url} target="_blank" rel="noopener">See it live <Icon name="arrow" size={14} /></a></p>}
          {resultFiles.length > 0 && <Attachments files={resultFiles} />}
          <div class="small faint">Finished {dateTime(r.completed_at)}</div>
        </section>
      )}
      {r.status === 'failed' && (
        <section class="card mb" style="border-color:var(--bad)"><h2>We couldn’t do this one</h2><div style="white-space:pre-wrap">{r.failure}</div></section>
      )}

      {staff && r.client_id && <StaffActions r={r} user={user} onDone={reload} />}
      {!staff && ['new', 'proposed', 'approved'].includes(r.status) && (
        <p class="small"><button class="btn sm ghost" onClick={async () => { if (!confirm('Cancel this request?')) return; try { await api('POST', `/goat/${r.id}/cancel`, {}); toast('Request cancelled.'); reload(); } catch (e) { toast(e.message, 'bad'); } }}>Cancel this request</button></p>
      )}

      <Timeline r={r} events={events} staff={staff} onDone={reload} />
    </div>
  );
}

function Attachments({ files }) {
  return (
    <div class="file-grid mt">
      {files.map((f) => (
        <div class="file">
          <a class="thumb" href={`/api/media/${f.id}/file`} target="_blank" rel="noopener">{isImage(f.content_type) ? <img src={`/api/media/${f.id}/file`} alt="" loading="lazy" /> : <Icon name="doc" size={30} />}</a>
          <div class="name" title={f.filename}>{f.filename}</div>
        </div>
      ))}
    </div>
  );
}

function PlanCard({ data, user, onDone }) {
  const { request: r } = data;
  const staff = user.role !== 'client';
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const { busy, error, run } = useAction();
  const p = r.proposal;
  const canEdit = staff && r.client_id && ['new', 'proposed', 'approved', 'in_progress'].includes(r.status);

  if (editing) return <PlanEditor data={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onDone(); }} />;
  if (!p) {
    if (!r.client_id || ['cancelled', 'failed'].includes(r.status)) return null;
    return (
      <section class="card mb">
        <h2>The plan</h2>
        <p class="muted" style="margin-top:0">{staff ? 'No plan yet. Write one and send it to the client for approval.' : 'Your Detcord team is putting together a plan. You’ll approve it before anything changes.'}</p>
        {canEdit && <button class="btn" onClick={() => setEditing(true)}><Icon name="pen" />Write the plan</button>}
      </section>
    );
  }
  const approve = () => run(async () => { await api('POST', `/goat/${r.id}/approve`, { hash: r.proposal_hash }); toast('Approved. Your team is on it.'); onDone(); });
  return (
    <section class={`card mb ${r.status === 'proposed' && !staff ? 'attention' : ''}`}>
      <div class="row between"><h2 style="margin:0">The plan</h2>{staff && <span class="badge">{r.proposal_source === 'ai' ? 'Drafted by Claude' : 'Written by staff'}</span>}</div>
      <p style="font-size:17px">{p.summary}</p>
      {p.steps.length > 0 && <ol class="stack tight" style="padding-left:20px">{p.steps.map((s) => <li>{s}</li>)}</ol>}
      {p.content && (
        <div class="mt">
          <div class="row between"><strong class="small">Wording</strong><CopyButton text={p.content} label="Copy" /></div>
          <div class="card" style="white-space:pre-wrap;background:var(--surface-2);margin-top:6px">{p.content}</div>
        </div>
      )}
      {p.questions.length > 0 && (
        <div class="alert warn mt"><strong>We need to know:</strong><ul style="margin:6px 0 0;padding-left:20px">{p.questions.map((q) => <li>{q}</li>)}</ul></div>
      )}
      <p class="small faint">Done by your Detcord team after you approve. Nothing is changed automatically.</p>
      {error && <div class="alert bad">{error}</div>}
      {r.status === 'proposed' && !staff && (
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn" disabled={busy} onClick={approve}><Icon name="check" />{busy ? 'Approving…' : 'Approve this plan'}</button>
          <button class="btn secondary" onClick={() => setChanging(true)}><Icon name="pen" />Change it</button>
        </div>
      )}
      {r.status === 'proposed' && staff && <div class="small muted">Waiting for the client to approve{r.proposed_at ? ` (sent ${ago(r.proposed_at)})` : ''}.</div>}
      {['approved', 'in_progress', 'done'].includes(r.status) && r.approved_at && <div class="small muted"><Icon name="check" size={14} /> Approved {dateTime(r.approved_at)}{r.approved_via === 'sms' ? ' by text' : ''}</div>}
      {canEdit && <button class="btn sm ghost mt" onClick={() => setEditing(true)}><Icon name="pen" />Edit plan</button>}
      {changing && <ChangeDialog r={r} onClose={() => setChanging(false)} onDone={() => { setChanging(false); onDone(); }} />}
    </section>
  );
}

function ChangeDialog({ r, onClose, onDone }) {
  const [message, setMessage] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Dialog title="What should change?" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Back</button><button class="btn" disabled={busy || !message.trim()} onClick={() => run(async () => { await api('POST', `/goat/${r.id}/change`, { message }); toast('Got it. You’ll get an updated plan.'); onDone(); })}>Send</button></>}>
      <Field label="Tell us what to do differently"><textarea rows={4} value={message} onInput={(e) => setMessage(e.target.value)} /></Field>
      {error && <div class="alert bad">{error}</div>}
    </Dialog>
  );
}

function PlanEditor({ data, onClose, onSaved }) {
  const { request: r, categories, ai } = data;
  const p = r.proposal || { summary: '', steps: [], content: '', questions: [] };
  const [f, setF] = useState({ summary: p.summary, steps: p.steps.join('\n'), content: p.content, questions: p.questions.join('\n'), category: r.category });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const draft = useAction();
  const approvedChange = ['approved', 'in_progress'].includes(r.status);
  const fill = () => draft.run(async () => {
    const { draft: d } = await api('POST', `/goat/${r.id}/draft`, {});
    setF({ summary: d.summary, steps: d.steps.join('\n'), content: d.content, questions: d.questions.join('\n'), category: d.category || f.category });
  });
  const save = () => run(async () => {
    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    await api('PUT', `/goat/${r.id}/proposal`, { summary: f.summary, steps: lines(f.steps), content: f.content, questions: lines(f.questions), category: f.category });
    toast(approvedChange ? 'Plan changed. The client has to approve it again.' : 'Plan sent to the client for approval.');
    onSaved();
  });
  return (
    <section class="card mb">
      <div class="row between"><h2 style="margin:0">{r.proposal ? 'Edit the plan' : 'Write the plan'}</h2>{ai && <button class="btn sm secondary" disabled={draft.busy} onClick={fill}><Icon name="bolt" />{draft.busy ? 'Drafting…' : 'Draft with Claude'}</button>}</div>
      {draft.error && <div class="alert bad mt">{draft.error}</div>}
      <div class="stack mt">
        <Field label="Category"><select value={f.category} onChange={set('category')}>{Object.entries(categories).map(([k, l]) => <option value={k}>{l}</option>)}</select></Field>
        <Field label="Summary" help="what we will do, in one or two sentences"><textarea rows={2} value={f.summary} onInput={set('summary')} /></Field>
        <Field label="Steps" help="one per line"><textarea rows={4} value={f.steps} onInput={set('steps')} /></Field>
        <Field label="Wording to publish" help="optional"><textarea rows={5} value={f.content} onInput={set('content')} /></Field>
        <Field label="Questions for the client" help="optional, one per line"><textarea rows={2} value={f.questions} onInput={set('questions')} /></Field>
        {approvedChange && <div class="alert warn">The client already approved the current plan. Saving a change sends it back to them for approval.</div>}
        {error && <div class="alert bad">{error}</div>}
        <div class="row" style="gap:8px"><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy || !f.summary.trim()} onClick={save}>{busy ? 'Saving…' : 'Send for approval'}</button></div>
      </div>
    </section>
  );
}

function StaffActions({ r, user, onDone }) {
  const [dialog, setDialog] = useState(null);
  const act = async (path, body = {}, msg) => { try { await api('POST', `/goat/${r.id}/${path}`, body); toast(msg); onDone(); } catch (e) { toast(e.message, 'bad'); } };
  if (!['approved', 'in_progress', 'new', 'proposed'].includes(r.status)) return null;
  return (
    <section class="card mb">
      <h2>Work</h2>
      <div class="small muted mb">{r.assignee_name ? `Assigned to ${r.assignee_name}.` : 'Not assigned yet.'} {['new', 'proposed'].includes(r.status) ? 'Work starts after the client approves the plan.' : ''}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        {r.status === 'approved' && <button class="btn" onClick={() => act('start', {}, 'Marked in progress.')}>Start work</button>}
        {['approved', 'in_progress'].includes(r.status) && <button class="btn" onClick={() => setDialog('done')}><Icon name="check" />Mark done</button>}
        {r.assignee_id !== user.id && <button class="btn secondary" onClick={async () => { try { await api('PATCH', `/goat/${r.id}`, { assigneeId: user.id }); onDone(); } catch (e) { toast(e.message, 'bad'); } }}>Assign to me</button>}
        <button class="btn ghost" onClick={() => setDialog('fail')}>Can’t be done</button>
      </div>
      {dialog === 'done' && <DoneDialog r={r} user={user} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onDone(); }} />}
      {dialog === 'fail' && <FailDialog r={r} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onDone(); }} />}
    </section>
  );
}

function DoneDialog({ r, user, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState([]);
  const [picking, setPicking] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Dialog title="Mark done" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Back</button><button class="btn" disabled={busy || !note.trim()} onClick={() => run(async () => { await api('POST', `/goat/${r.id}/done`, { note, url, mediaIds: picked.map((p) => p.id) }); toast('Done. The client has been told.'); onDone(); })}>Mark done</button></>}>
      <p class="small muted" style="margin-top:0">The client sees this note as proof the work is finished.</p>
      <Field label="What was done"><textarea rows={3} value={note} onInput={(e) => setNote(e.target.value)} placeholder="Updated holiday hours on the website and Google profile." /></Field>
      <Field label="Link" help="optional, where they can see it"><input value={url} onInput={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
      <button type="button" class="btn sm secondary" onClick={() => setPicking(true)}><Icon name="image" />{picked.length ? `${picked.length} screenshot(s) attached` : 'Attach screenshots'}</button>
      {picking && <FilePicker clientId={r.client_id} user={user} note="Only files shared with the client can be shown as proof." picked={picked} onChange={setPicked} onClose={() => setPicking(false)} />}
      {error && <div class="alert bad mt">{error}</div>}
    </Dialog>
  );
}

function FailDialog({ r, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Dialog title="Can’t be done" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Back</button><button class="btn danger" disabled={busy || !reason.trim()} onClick={() => run(async () => { await api('POST', `/goat/${r.id}/fail`, { reason }); toast('The client has been told.'); onDone(); })}>Close request</button></>}>
      <Field label="Explain why, for the client"><textarea rows={3} value={reason} onInput={(e) => setReason(e.target.value)} placeholder="We don’t have access to your Instagram account yet. Connect it and send this again." /></Field>
      {error && <div class="alert bad">{error}</div>}
    </Dialog>
  );
}

// Admin check of an unknown sender.
function MatchCard({ data, onDone }) {
  const { request: r, sender, clients = [] } = data;
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState(sender?.claimed_name || r.sender_name || '');
  const [addContact, setAddContact] = useState(true);
  const { busy, error, run } = useAction();
  if (r.status !== 'unmatched') return null;
  return (
    <section class="card mb attention">
      <h2>Who sent this?</h2>
      <p class="small muted" style="margin-top:0">{r.channel === 'sms' ? 'This number' : 'This address'} ({r.sender_address}) doesn’t belong to any client. Confirm it with the client before matching; a business name in the message isn’t proof.</p>
      {sender?.claimed_business && <div class="alert mb">They said: “{sender.claimed_business}”</div>}
      <div class="stack">
        <Field label="Client"><select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Choose a client…</option>{clients.map((c) => <option value={c.id}>{c.name}{c.city ? ` (${c.city})` : ''}</option>)}</select></Field>
        <Field label="Sender’s name"><input value={name} onInput={(e) => setName(e.target.value)} /></Field>
        <label class="check"><input type="checkbox" checked={addContact} onChange={(e) => setAddContact(e.target.checked)} /> Save as a contact so their next {r.channel === 'sms' ? 'text' : 'email'} is recognized</label>
        {error && <div class="alert bad">{error}</div>}
        <div class="row" style="gap:8px">
          <button class="btn" disabled={busy || !clientId} onClick={() => run(async () => { await api('POST', `/goat/${r.id}/match`, { clientId, name, addContact }); toast('Matched.'); onDone(); })}>Confirm and match</button>
          <button class="btn ghost" disabled={busy} onClick={() => confirm('Ignore this sender? Their future messages will be dropped.') && run(async () => { await api('POST', `/goat/${r.id}/reject`, {}); toast('Sender ignored.'); navigate('/goat'); })}>Not a client</button>
        </div>
      </div>
    </section>
  );
}

const EVENT_LABEL = { created: 'Request received', proposal: 'Plan', approved: 'Approved', change: 'Asked for changes', started: 'Work started', done: 'Done', failed: 'Closed', cancelled: 'Cancelled', matched: 'Sender confirmed', comment: '', note: 'Note' };

function Timeline({ r, events, staff, onDone }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const { busy, error, run } = useAction();
  const closed = ['done', 'failed', 'cancelled'].includes(r.status);
  return (
    <section class="card">
      <h2>Activity</h2>
      <div class="list">
        {events.map((e) => (
          <div class="list-item" style="align-items:flex-start">
            <Avatar name={e.by} />
            <div style="flex:1;min-width:0">
              <div class="small"><strong>{e.by}</strong>{EVENT_LABEL[e.kind] ? ` · ${EVENT_LABEL[e.kind]}` : ''}{e.internal && <span class="badge warn" style="margin-left:6px">Internal</span>}</div>
              {e.body && <div style="white-space:pre-wrap">{e.body}</div>}
              <div class="meta">{dateTime(e.at)}</div>
            </div>
          </div>
        ))}
      </div>
      {!closed && (r.client_id || staff) && (
        <div class="stack mt">
          <Field label={staff ? 'Message' : 'Message your Detcord team'}><textarea rows={2} value={body} onInput={(e) => setBody(e.target.value)} /></Field>
          {staff && <label class="check"><input type="checkbox" checked={internal || !r.client_id} disabled={!r.client_id} onChange={(e) => setInternal(e.target.checked)} /> Internal note (the client won’t see it)</label>}
          {error && <div class="alert bad">{error}</div>}
          <div><button class="btn secondary" disabled={busy || !body.trim()} onClick={() => run(async () => { await api('POST', `/goat/${r.id}/comment`, { body, internal: internal || !r.client_id }); setBody(''); onDone(); })}>Send</button></div>
        </div>
      )}
    </section>
  );
}
