import { useState, useEffect } from 'preact/hooks';
import { useLoad, api, toast, navigate, query, ago, dateTime, session } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, Avatar, CopyButton, useAction } from '../ui.jsx';
import { FilePicker } from './files.jsx';

// Social posts through Zernio. Staff write, the client approves exactly what will go out, and only
// then does Publish hand it to Zernio. Status shown is what Zernio reports.
const TONE = { draft: '', pending_approval: 'accent', changes_requested: 'warn', approved: 'info', publishing: 'info', scheduled: 'info', published: 'good', partial: 'warn', failed: 'bad', cancelled: '' };
const PLATFORM_TONE = { published: 'good', failed: 'bad', pending: 'info', publishing: 'info', scheduled: 'info' };
const isImage = (t) => /^image\/(png|jpeg|webp|gif)$/.test(t);
const isVideo = (t) => /^video\/(mp4|quicktime)$/.test(t);
const PRE_PUBLISH = ['draft', 'pending_approval', 'changes_requested', 'approved'];

export const PostBadge = ({ p }) => <span class={`badge ${TONE[p.status] || ''}`}>{p.status_label}</span>;

// datetime-local values are Detroit time, whatever the browser's time zone.
const detroitInput = (ms) => {
  const f = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${f.year}-${f.month}-${f.day}T${f.hour}:${f.minute}`;
};
const fromDetroitInput = (s) => {
  if (!s) return null;
  const guess = Date.parse(`${s}:00Z`);
  return guess + (guess - Date.parse(`${detroitInput(guess)}:00Z`));
};

const accountName = (a, platforms) => `${platforms[a.platform] || a.platform}${a.username ? ` · ${a.username}` : ''}`;

// ---------- Connected accounts ----------

function ConnectButtons({ clientId, platforms, staff }) {
  const [links, setLinks] = useState({});
  const act = useAction();
  const go = (platform) => act.run(async () => {
    const { url } = await api('POST', `/clients/${clientId}/social/connect`, { platform });
    location.href = url;
  });
  const link = (platform) => act.run(async () => {
    const { url } = await api('POST', `/clients/${clientId}/social/connect`, { platform, for: 'client' });
    setLinks({ ...links, [platform]: url });
  });
  return (
    <div class="stack tight">
      {Object.entries(platforms).map(([k, l]) => (
        <div class="row" style="gap:8px">
          <button class="btn sm secondary" disabled={act.busy} onClick={() => go(k)}><Icon name="link" size={14} />Connect {l}</button>
          {staff && (links[k] ? <CopyButton text={links[k]} label="Copy link for the client" /> : <button class="btn sm ghost" disabled={act.busy} onClick={() => link(k)}>Make a link to send</button>)}
        </div>
      ))}
      {staff && Object.keys(links).length > 0 && <p class="small muted" style="margin:0">The client opens the link, signs in to that platform, and lands on their Social page. Make a fresh link if it stops working.</p>}
      {act.error && <div class="alert bad">{act.error}</div>}
    </div>
  );
}

function AccountsCard({ clientId, data, staff }) {
  if (!data.ready) {
    return (
      <section class="card">
        <h2>Connected accounts</h2>
        <p class="muted" style="margin:0">{staff ? 'Social posting isn’t set up yet (Bob adds ZERNIO_API_KEY). Posts can still be written and approved, but not published.' : 'Social posting isn’t set up yet. Your Detcord team will let you know when you can connect your accounts.'}</p>
      </section>
    );
  }
  return (
    <section class="card">
      <h2>Connected accounts</h2>
      {data.accountsError && <div class="alert bad mb">Couldn’t read the accounts from Zernio: {data.accountsError}</div>}
      {data.accounts.length ? (
        <div class="list mb">{data.accounts.map((a) => (
          <div class="list-item">
            <Icon name="globe" />
            <div style="flex:1;min-width:0"><div class="title">{data.platforms[a.platform] || a.platform}</div><div class="meta">{a.username || a.display_name || 'Account'}</div></div>
            <span class={`badge ${a.is_active ? 'good' : 'warn'}`}>{a.is_active ? 'Connected' : 'Needs reconnecting'}</span>
          </div>
        ))}</div>
      ) : !data.accountsError && <p class="small muted" style="margin-top:0">No accounts connected yet.</p>}
      <ConnectButtons clientId={clientId} platforms={data.platforms} staff={staff} />
    </section>
  );
}

// Zernio sends the browser back with ?connected=<platform>. The accounts are read from Zernio again, not from the URL.
function useConnectedNotice(platforms, reload) {
  useEffect(() => {
    const q = query();
    if (!q.connected) return;
    toast(`${platforms?.[q.connected] || 'Account'} connected.`);
    const params = new URLSearchParams(location.search);
    ['connected', 'profileId', 'accountId', 'username'].forEach((k) => params.delete(k));
    history.replaceState({}, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    reload();
  }, []);
}

// ---------- Composer ----------

export function PostComposer({ clientId, user, data, post, media = [], onSaved, onCancel }) {
  const goats = useLoad(`/goat?status=open&client=${clientId}`, [clientId]);
  const [f, setF] = useState({
    content: post?.content || '', accountIds: post?.accounts.map((a) => a.id) || [], when: post?.scheduled_for ? 'later' : 'now',
    at: post?.scheduled_for ? detroitInput(post.scheduled_for) : '', goatRequestId: post?.goat_request_id || query().goat || '', draftSource: post?.draft_source || null,
  });
  const [files, setFiles] = useState(media.map((m) => ({ id: m.id, filename: m.filename, contentType: m.content_type })));
  const [picking, setPicking] = useState(false);
  const [brief, setBrief] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useAction();
  const draft = useAction();
  const accounts = data.accounts.filter((a) => a.is_active || f.accountIds.includes(a.id));
  // Accounts already on the post stay listed even if they can't be read from Zernio right now.
  const extra = (post?.accounts || []).filter((a) => !accounts.some((x) => x.id === a.id));
  const toggle = (id) => setF({ ...f, accountIds: f.accountIds.includes(id) ? f.accountIds.filter((x) => x !== id) : [...f.accountIds, id] });
  const wasApproved = post?.approved;
  const long = f.content.length > 280 && f.accountIds.some((id) => [...accounts, ...extra].find((a) => a.id === id)?.platform === 'twitter');

  const fill = () => draft.run(async () => {
    const platforms = [...new Set(f.accountIds.map((id) => accounts.find((a) => a.id === id)?.platform).filter(Boolean))];
    const r = await api('POST', `/clients/${clientId}/social/draft`, { brief, platforms });
    setF({ ...f, content: r.content, draftSource: 'claude' });
  });
  const save = () => run(async () => {
    const body = { content: f.content, mediaIds: files.map((x) => x.id), accountIds: f.accountIds, scheduledFor: f.when === 'later' ? fromDetroitInput(f.at) : null, goatRequestId: f.goatRequestId || null, draftSource: f.draftSource };
    if (post) {
      const r = await api('PUT', `/social/posts/${post.id}`, body);
      toast(r.reapproval ? 'Saved. The client has to approve it again.' : 'Saved.');
      onSaved(post.id);
    } else {
      const r = await api('POST', `/clients/${clientId}/social/posts`, body);
      toast('Draft saved. Send it to the client when it’s ready.');
      onSaved(r.id);
    }
  });

  return (
    <div class="stack">
      {data.ai && (
        <div class="stack tight">
          <Field label="Brief for Claude" help="optional"><input class="input" value={brief} onInput={(e) => setBrief(e.target.value)} placeholder="Pumpkin lattes are back Friday, 20% off the first week" /></Field>
          <div><button type="button" class="btn sm secondary" disabled={draft.busy || !brief.trim()} onClick={fill}><Icon name="bolt" size={14} />{draft.busy ? 'Drafting…' : 'Draft with Claude'}</button></div>
          {draft.error && <div class="alert bad">{draft.error}</div>}
        </div>
      )}
      <Field label="Post text">
        <textarea class="textarea" rows={5} value={f.content} maxLength={5000} onInput={set('content')} placeholder="What the post says, exactly as it will appear." />
      </Field>
      {f.draftSource === 'claude' && <div class="small"><span class="badge accent">Claude draft</span> <span class="muted">Read it and edit before sending. Claude doesn’t know anything you didn’t tell it.</span></div>}
      {long && <div class="alert warn">X allows 280 characters; this is {f.content.length}.</div>}

      <div>
        <div class="small muted mb" style="margin-bottom:6px">Photos and videos</div>
        {files.length > 0 && (
          <div class="stack tight mb">{files.map((x) => (
            <div class="row small" style="gap:8px">
              <Icon name={x.contentType && isVideo(x.contentType) ? 'doc' : 'image'} size={16} />
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{x.filename}</span>
              <button type="button" class="icon-btn" aria-label={`Remove ${x.filename}`} onClick={() => setFiles(files.filter((y) => y !== x))}><Icon name="x" size={14} /></button>
            </div>
          ))}</div>
        )}
        <button type="button" class="btn sm secondary" onClick={() => setPicking(true)}><Icon name="image" size={14} />{files.length ? 'Change photos or videos' : 'Add from client files'}</button>
      </div>

      <div>
        <div class="small muted" style="margin-bottom:6px">Post to</div>
        {accounts.length + extra.length ? (
          <div class="chips">{[...accounts, ...extra].map((a) => <button type="button" class="chip" aria-pressed={f.accountIds.includes(a.id)} onClick={() => toggle(a.id)}>{accountName(a, data.platforms)}</button>)}</div>
        ) : <p class="small muted" style="margin:0">{data.ready ? 'No accounts connected yet. Connect them on the right, or send the client a link.' : 'Accounts can be chosen once social posting is set up. Adding them later needs the client’s approval again.'}</p>}
      </div>

      <div class="row" style="gap:16px">
        <label class="check"><input type="radio" name="when" checked={f.when === 'now'} onChange={() => setF({ ...f, when: 'now' })} /> Publish when approved and we press Publish</label>
        <label class="check"><input type="radio" name="when" checked={f.when === 'later'} onChange={() => setF({ ...f, when: 'later' })} /> Schedule</label>
      </div>
      {f.when === 'later' && <Field label="Date and time" help="Detroit time"><input class="input" type="datetime-local" value={f.at} onInput={set('at')} /></Field>}

      {goats.data?.requests?.length > 0 && (
        <Field label="GOAT request" help="optional"><select class="select" value={f.goatRequestId} onChange={set('goatRequestId')}><option value="">None</option>{goats.data.requests.map((r) => <option value={r.id}>{(r.proposal?.summary || r.body).slice(0, 80)}</option>)}</select></Field>
      )}

      {wasApproved && <div class="alert warn">The client approved this post. Changing the text, media, accounts or time sends it back to them for approval.</div>}
      {error && <div class="alert bad">{error}</div>}
      <div class="row" style="gap:8px">
        {onCancel && <button type="button" class="btn ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" class="btn" disabled={busy || (f.when === 'later' && !f.at)} onClick={save}>{busy ? 'Saving…' : post ? 'Save changes' : 'Save draft'}</button>
      </div>
      {picking && (
        <FilePicker clientId={clientId} user={user} note="Only photos and videos shared with the client can be posted, so they see exactly what goes out." picked={files} onChange={setFiles} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

// ---------- Lists ----------

function PostRow({ p }) {
  return (
    <a class="list-item" href={`/social/${p.id}`}>
      <Icon name="globe" />
      <div style="flex:1;min-width:0">
        <div class="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.content || 'No text yet'}</div>
        <div class="meta">{p.accounts.length ? `${p.accounts.length} account${p.accounts.length === 1 ? '' : 's'}` : 'No accounts yet'} · {p.scheduled_for ? `for ${dateTime(p.scheduled_for)}` : 'post now'} · {ago(p.updated_at)}</div>
      </div>
      <PostBadge p={p} />
    </a>
  );
}

// Client record tab.
export function SocialTab({ client, user }) {
  const { data, error, reload } = useLoad(`/clients/${client.id}/social`, [client.id]);
  const [writing, setWriting] = useState(!!query().goat);
  useConnectedNotice(data?.platforms, reload);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div class="grid main-side">
      <div class="stack">
        {!data.ready && <div class="alert warn">Social posting isn’t set up yet, so nothing can be published. Posts can still be written and approved.</div>}
        <section class="card">
          <div class="card-head"><h2>Social posts</h2>{!writing && <button class="btn sm" onClick={() => setWriting(true)}><Icon name="plus" size={14} />New post</button>}</div>
          {writing && <div class="mb"><PostComposer clientId={client.id} user={user} data={data} onSaved={(id) => navigate(`/social/${id}`)} onCancel={() => setWriting(false)} /></div>}
          {data.posts.length ? <div class="list">{data.posts.map((p) => <PostRow p={p} />)}</div>
            : !writing && <Empty title="No posts yet">Write a post, send it for approval, then publish it here.</Empty>}
        </section>
      </div>
      <AccountsCard clientId={client.id} data={data} staff />
    </div>
  );
}

// Client: posts waiting for them, everything sent so far, and their connected accounts.
export function SocialPage() {
  const business = session.value?.clients?.[0];
  const { data, error, reload } = useLoad(business ? `/clients/${business.id}/social` : null, [business?.id]);
  useConnectedNotice(data?.platforms, reload);
  if (!business) return <div class="page"><Empty title="Your workspace is being set up">Your Detcord team will connect your business shortly.</Empty></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (!data) return <div class="page"><Loading /></div>;
  const waiting = data.posts.filter((p) => p.status === 'pending_approval');
  const rest = data.posts.filter((p) => p.status !== 'pending_approval');
  return (
    <div class="page">
      <div class="page-head"><div><div class="eyebrow">{business.name}</div><h1>Social</h1><p class="sub">Posts your Detcord team wrote for you. Nothing is posted until you approve it.</p></div></div>
      <div class="grid main-side">
        <div class="stack">
          {waiting.length > 0 && <section class="card attention"><h2>Waiting for your approval</h2><div class="list">{waiting.map((p) => <PostRow p={p} />)}</div></section>}
          <section class="card">
            <h2>Your posts</h2>
            {rest.length ? <div class="list">{rest.map((p) => <PostRow p={p} />)}</div> : <Empty title="No posts yet">When your team writes a post, it shows up here for you to approve.</Empty>}
          </section>
        </div>
        <AccountsCard clientId={business.id} data={data} staff={false} />
      </div>
    </div>
  );
}

// ---------- One post ----------

function Preview({ post, media, platforms, clientName }) {
  return (
    <section class="card mb">
      <div class="row" style="gap:10px;margin-bottom:10px">
        <Avatar name={clientName} />
        <div><div style="font-weight:700">{clientName}</div><div class="small muted">{post.scheduled_for ? `Scheduled for ${dateTime(post.scheduled_for)} (Detroit time)` : 'Posts right after approval, when your team presses Publish'}</div></div>
      </div>
      <div style="white-space:pre-wrap;font-size:16px">{post.content || <span class="faint">No text yet</span>}</div>
      {media.length > 0 && (
        <div class="file-grid mt">{media.map((m) => (
          <div class="file">
            <a class="thumb" href={`/api/media/${m.id}/file`} target="_blank" rel="noopener">
              {isImage(m.content_type) ? <img src={`/api/media/${m.id}/file`} alt="" loading="lazy" /> : isVideo(m.content_type) ? <video src={`/api/media/${m.id}/file`} controls preload="metadata" style="width:100%;height:100%" /> : <Icon name="doc" size={30} />}
            </a>
            <div class="name" title={m.filename}>{m.filename}</div>
          </div>
        ))}</div>
      )}
      <div class="mt">
        <div class="small muted" style="margin-bottom:6px">Posts to</div>
        {post.accounts.length ? <div class="chips">{post.accounts.map((a) => <span class="chip" style="cursor:default">{accountName(a, platforms)}</span>)}</div> : <span class="small faint">No accounts chosen yet</span>}
      </div>
    </section>
  );
}

export function SocialPostPage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/social/posts/${id}`, [id]);
  const [editing, setEditing] = useState(false);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { post: p, media, events, goat, platforms } = data;
  const staff = user.role !== 'client';
  return (
    <div class="page narrow">
      <a class="back" href={staff ? `/clients/${p.client_id}?tab=social` : '/social'}><Icon name="back" size={16} />{staff ? p.client_name : 'Social'}</a>
      <div class="page-head">
        <div>
          <div class="eyebrow">Social post{staff && p.draft_source === 'claude' ? ' · started as a Claude draft' : ''}</div>
          <h1>{p.status === 'pending_approval' && !staff ? 'Approve this post' : 'Social post'}</h1>
          <p class="sub">{p.sent_at ? `Sent for approval ${dateTime(p.sent_at)}` : 'Draft, not sent to the client yet'}</p>
        </div>
        <PostBadge p={p} />
      </div>

      {editing ? (
        <section class="card mb">
          <h2>Edit the post</h2>
          <EditLoader post={p} media={media} user={user} onDone={() => { setEditing(false); reload(); }} />
        </section>
      ) : <Preview post={p} media={media} platforms={platforms} clientName={p.client_name} />}

      <ApprovalCard data={data} user={user} onDone={reload} onEdit={() => setEditing(true)} editing={editing} />
      {(!PRE_PUBLISH.includes(p.status) || p.error) && <ResultCard data={data} onDone={reload} />}
      {goat && staff && <p class="small muted">Linked GOAT request: <a href={`/goat/${goat.id}`}>{goat.body}</a></p>}
      <History events={events} />
    </div>
  );
}

// The composer needs the client's accounts; it loads them here so the page itself stays quick.
function EditLoader({ post, media, user, onDone }) {
  const { data } = useLoad(`/clients/${post.client_id}/social`, [post.client_id]);
  if (!data) return <Loading />;
  return <PostComposer clientId={post.client_id} user={user} data={data} post={post} media={media} onSaved={onDone} onCancel={onDone} />;
}

function ApprovalCard({ data, user, onDone, onEdit, editing }) {
  const { post: p, ready } = data;
  const staff = user.role !== 'client';
  const [dialog, setDialog] = useState(null);
  const { busy, error, run } = useAction();
  const go = (path, body, msg) => run(async () => { await api('POST', `/social/posts/${p.id}/${path}`, body); toast(msg); onDone(); });
  if (!PRE_PUBLISH.includes(p.status)) return null;
  return (
    <section class={`card mb ${p.status === 'pending_approval' && !staff ? 'attention' : ''}`}>
      <h2>Approval</h2>
      {p.status === 'draft' && <p class="muted" style="margin-top:0">Not sent yet. The client sees it only after you send it for approval.</p>}
      {p.status === 'pending_approval' && <p class="muted" style="margin-top:0">{staff ? 'Waiting for the client to approve exactly what is shown above.' : 'This is exactly what will be posted, where and when. Nothing is posted until you approve.'}</p>}
      {p.status === 'changes_requested' && <p class="muted" style="margin-top:0">{staff ? 'The client asked for changes (see History). Edit the post and send it again.' : 'You asked for changes. Your team will send an updated post.'}</p>}
      {p.status === 'approved' && (
        <p style="margin-top:0"><Icon name="check" size={14} /> Approved {dateTime(p.approved_at)}{p.approved_by_name ? ` by ${p.approved_by_name}` : ''}{p.approved_via === 'admin' ? ' on the client’s behalf' : ''}.
          {p.approval_note && <span class="muted"> Note: “{p.approval_note}”</span>}</p>
      )}
      {error && <div class="alert bad">{error}</div>}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        {!staff && p.status === 'pending_approval' && <>
          <button class="btn" disabled={busy} onClick={() => go('approve', { hash: p.hash }, 'Approved. Your team will post it.')}><Icon name="check" />{busy ? 'Approving…' : 'Approve this post'}</button>
          <button class="btn secondary" onClick={() => setDialog('changes')}><Icon name="pen" />Ask for changes</button>
        </>}
        {!staff && p.status === 'approved' && <button class="btn ghost" onClick={() => setDialog('changes')}>Ask for changes</button>}
        {staff && ['draft', 'changes_requested'].includes(p.status) && <button class="btn" disabled={busy || !p.content.trim()} onClick={() => go('send', {}, 'Sent to the client for approval.')}>Send for approval</button>}
        {staff && p.status === 'approved' && (
          <button class="btn" disabled={busy || !ready || !p.accounts.length} onClick={() => confirm(p.scheduled_for ? `Schedule this post for ${dateTime(p.scheduled_for)}?` : 'Publish this post now?') && go('publish', {}, p.scheduled_for ? 'Handed to Zernio.' : 'Handed to Zernio. Check the status below.')}>
            <Icon name="arrow" />{busy ? 'Sending to Zernio…' : p.scheduled_for ? 'Schedule' : 'Publish'}
          </button>
        )}
        {staff && user.role === 'admin' && p.status === 'pending_approval' && <button class="btn secondary" onClick={() => setDialog('record')}>Record client approval</button>}
        {staff && !editing && <button class="btn ghost" onClick={onEdit}><Icon name="pen" />Edit</button>}
        {staff && <button class="btn ghost" disabled={busy} onClick={() => confirm('Cancel this post?') && go('cancel', {}, 'Post cancelled.')}>Cancel post</button>}
      </div>
      {staff && p.status === 'approved' && !ready && <p class="small muted">Social posting isn’t set up yet, so this can’t be published.</p>}
      {staff && p.status === 'approved' && ready && !p.accounts.length && <p class="small muted">Choose at least one account. That change goes back to the client for approval.</p>}
      {dialog === 'changes' && <NoteDialog title="What should change?" label="Tell your team what to do differently" action="Send" onClose={() => setDialog(null)} onSend={(note) => go('changes', { note }, 'Got it. You’ll get an updated post.')} />}
      {dialog === 'record' && <NoteDialog title="Record the client’s approval" label="How did the client approve?" placeholder="Approved by phone on Oct 8 with Maria" action="Record approval" onClose={() => setDialog(null)} onSend={(note) => go('approve-for-client', { hash: p.hash, note }, 'Approval recorded.')} />}
    </section>
  );
}

function NoteDialog({ title, label, placeholder, action, onClose, onSend }) {
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Dialog title={title} onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Back</button><button class="btn" disabled={busy || !note.trim()} onClick={() => run(async () => { await onSend(note); onClose(); })}>{action}</button></>}>
      <Field label={label}><textarea class="textarea" rows={3} value={note} placeholder={placeholder} onInput={(e) => setNote(e.target.value)} /></Field>
      {error && <div class="alert bad">{error}</div>}
    </Dialog>
  );
}

// What Zernio reports, per platform, with links and errors. Never assumed from a button.
function ResultCard({ data, onDone }) {
  const { post: p, platforms } = data;
  const { busy, error, run } = useAction();
  const check = () => run(async () => {
    const r = await api('POST', `/social/posts/${p.id}/check`, {});
    if (r.throttled) toast('Checked less than 30 seconds ago. Showing the latest status.');
    onDone();
  });
  return (
    <section class={`card mb ${p.status === 'failed' ? 'attention' : ''}`}>
      <div class="card-head"><h2>Status from Zernio</h2>{p.published_at && <button class="btn sm ghost" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check status'}</button>}</div>
      {p.error && <div class="alert bad mb">{p.error}</div>}
      {p.platforms.length > 0 && (
        <div class="list">{p.platforms.map((x) => (
          <div class="list-item" style="align-items:flex-start">
            <Icon name="globe" />
            <div style="flex:1;min-width:0">
              <div class="title">{platforms[x.platform] || x.platform}</div>
              {x.url && <a class="small" href={x.url} target="_blank" rel="noopener">See the post <Icon name="arrow" size={12} /></a>}
              {x.error && <div class="small" style="color:var(--bad)">{x.error}</div>}
            </div>
            <span class={`badge ${PLATFORM_TONE[x.status] || ''}`}>{x.status || 'Unknown'}</span>
          </div>
        ))}</div>
      )}
      {p.checked_at && <div class="small faint mt">Last checked {ago(p.checked_at)}</div>}
      {error && <div class="alert bad mt">{error}</div>}
    </section>
  );
}

const EVENT_LABEL = { created: 'Created', edited: 'Edited', sent: 'Sent for approval', approved: 'Approved', changes: 'Asked for changes', published: 'Published', status: 'Status', error: 'Problem', cancelled: 'Cancelled' };

function History({ events }) {
  return (
    <section class="card">
      <h2>History</h2>
      <div class="list">
        {events.map((e) => (
          <div class="list-item" style="align-items:flex-start">
            <Avatar name={e.by} />
            <div style="flex:1;min-width:0">
              <div class="small"><strong>{e.by}</strong>{EVENT_LABEL[e.kind] ? ` · ${EVENT_LABEL[e.kind]}` : ''}</div>
              {e.body && <div style="white-space:pre-wrap;overflow-wrap:anywhere">{e.body}</div>}
              <div class="meta">{dateTime(e.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
