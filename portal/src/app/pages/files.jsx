import { useState, useRef } from 'preact/hooks';
import { useLoad, api, toast, date, session } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Chips, Dialog } from '../ui.jsx';

const PURPOSES = [['logo', 'Logo'], ['photo', 'Photo'], ['flyer', 'Flyer'], ['document', 'Document'], ['website', 'Website'], ['social', 'Social'], ['report', 'Report data'], ['contract', 'Contract'], ['other', 'Other']];
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (t) => /^image\/(png|jpeg|webp|gif)$/.test(t);

// Streams one file with progress. Resolves with the saved file or rejects with a readable error.
export function uploadFile(clientId, file, { visibility, purpose }, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ filename: file.name, purpose, ...(visibility ? { visibility } : {}) });
    xhr.open('PUT', `/api/clients/${clientId}/media?${q}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Network error. Check your connection and try again.'));
    xhr.send(file);
  });
}

function Uploader({ clientId, staff, maxBytes, onDone }) {
  const input = useRef();
  const [visibility, setVisibility] = useState(null);
  const [purpose, setPurpose] = useState('photo');
  const [queue, setQueue] = useState([]);
  const [drag, setDrag] = useState(false);
  const busy = queue.some((q) => q.state === 'uploading');

  const start = async (files) => {
    if (staff && !visibility) { toast('Choose who can see these files first.', 'bad'); return; }
    const items = [...files].map((f) => ({ key: Math.random().toString(36).slice(2), file: f, name: f.name, progress: 0, state: f.size > maxBytes ? 'error' : 'waiting', error: f.size > maxBytes ? 'Larger than 25 MB.' : null }));
    setQueue((q) => [...items, ...q]);
    for (const item of items.filter((i) => i.state === 'waiting')) {
      const update = (patch) => setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, ...patch } : x)));
      update({ state: 'uploading' });
      try {
        await uploadFile(clientId, item.file, { visibility: staff ? visibility : null, purpose }, (p) => update({ progress: p }));
        update({ state: 'done', progress: 1 });
      } catch (e) {
        update({ state: 'error', error: e.message });
      }
    }
    onDone();
  };

  return (
    <div class="stack">
      {staff && (
        <div>
          <div class="small muted" style="margin-bottom:6px">Who can see these files?</div>
          <Chips options={[{ v: 'shared', l: 'Shared with the client' }, { v: 'internal', l: 'Detcord only (internal)' }]} value={visibility} onChange={setVisibility} />
        </div>
      )}
      <div>
        <div class="small muted" style="margin-bottom:6px">What are they?</div>
        <Chips options={PURPOSES.map(([v, l]) => ({ v, l }))} value={purpose} onChange={(v) => setPurpose(v || 'other')} />
      </div>
      <div class={`dropzone ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); start(e.dataTransfer.files); }}>
        <Icon name="upload" size={22} />
        <div><strong>Drop files here</strong> or <button type="button" class="linkish" onClick={() => input.current.click()} disabled={busy}>choose files</button></div>
        <div class="small faint">Images, PDFs, Office documents, CSV, ZIP and design files up to 25 MB. Originals are kept as uploaded.</div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { start(e.target.files); e.target.value = ''; }} />
      </div>
      {queue.length > 0 && (
        <div class="list">
          {queue.map((q) => (
            <div class="list-item">
              <Icon name={q.state === 'done' ? 'check' : q.state === 'error' ? 'x' : 'upload'} />
              <div style="flex:1;min-width:0">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{q.name}</div>
                {q.state === 'error' ? <div class="small" style="color:var(--bad)">{q.error}</div>
                  : <div class="progress"><div style={`width:${Math.round(q.progress * 100)}%`} /></div>}
              </div>
              <span class="small faint">{q.state === 'uploading' ? `${Math.round(q.progress * 100)}%` : q.state === 'done' ? 'Saved' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Grid of a client's files. With `onPick`, it becomes a picker (used by contracts, GOAT and social later).
export function FilesPanel({ clientId, user, onPick, pickedIds = [], onlyShared = false }) {
  const staff = user.role !== 'client';
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/media`, [clientId]);
  const [filter, setFilter] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  let files = data.media;
  if (onlyShared) files = files.filter((f) => f.visibility === 'shared');
  if (filter === 'internal') files = files.filter((f) => f.visibility === 'internal');
  else if (filter === 'shared') files = files.filter((f) => f.visibility === 'shared');
  else if (filter !== 'all') files = files.filter((f) => f.purpose === filter);

  const remove = async (f) => {
    if (!confirm(`Delete ${f.filename}? This cannot be undone.`)) return;
    try { await api('DELETE', `/media/${f.id}`); toast('File deleted.'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const flip = async (f) => {
    const to = f.visibility === 'shared' ? 'internal' : 'shared';
    if (to === 'shared' && !confirm(`Share ${f.filename} with the client? They will be able to see and download it.`)) return;
    try { await api('PATCH', `/media/${f.id}`, { visibility: to }); toast(to === 'shared' ? 'Now shared with the client.' : 'Now internal only.'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <div class="stack">
      <div class="row between">
        <div class="chips">
          {[['all', 'All'], ...(staff && !onlyShared ? [['shared', 'Shared'], ['internal', 'Internal']] : []), ['logo', 'Logos'], ['photo', 'Photos'], ['flyer', 'Flyers'], ['document', 'Documents']].map(([v, l]) => (
            <button type="button" class="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        {!onPick && <button class="btn" onClick={() => setShowUpload(!showUpload)}><Icon name="upload" />Upload</button>}
      </div>
      {(showUpload || (onPick && !data.media.length)) && (
        <section class="card"><Uploader clientId={clientId} staff={staff} maxBytes={data.maxBytes} onDone={reload} /></section>
      )}
      {!files.length ? <Empty title="No files yet">{staff ? 'Upload logos, photos, flyers and materials for this client.' : 'Share logos, photos and flyers with your Detcord team.'}</Empty> : (
        <div class="file-grid">
          {files.map((f) => {
            const picked = pickedIds.includes(f.id);
            return (
              <div class={`file ${picked ? 'picked' : ''}`}>
                <a class="thumb" href={`/api/media/${f.id}/file`} target="_blank" rel="noopener" onClick={onPick ? (e) => { e.preventDefault(); onPick(f); } : undefined}>
                  {isImage(f.content_type) ? <img src={`/api/media/${f.id}/file`} alt="" loading="lazy" /> : <Icon name="doc" size={34} />}
                  {picked && <span class="pick-mark"><Icon name="check" size={16} /></span>}
                </a>
                <div class="name" title={f.filename}>{f.filename}</div>
                <div class="small faint">{size(f.size)} · {date(f.created_at)}</div>
                <div class="row" style="gap:6px;margin-top:6px">
                  {staff && <span class={`badge ${f.visibility === 'internal' ? 'warn' : 'good'}`}>{f.visibility === 'internal' ? 'Internal' : 'Shared'}</span>}
                  {!onPick && (
                    <span class="row" style="gap:2px;margin-left:auto">
                      <a class="icon-btn" href={`/api/media/${f.id}/file?download=1`} aria-label={`Download ${f.filename}`}><Icon name="download" size={16} /></a>
                      {staff && <button class="icon-btn" onClick={() => flip(f)} aria-label={f.visibility === 'shared' ? 'Make internal' : 'Share with client'} title={f.visibility === 'shared' ? 'Make internal' : 'Share with client'}><Icon name={f.visibility === 'shared' ? 'lock' : 'eye'} size={16} /></button>}
                      {(staff || f.uploader_role === 'client') && <button class="icon-btn" onClick={() => remove(f)} aria-label={`Delete ${f.filename}`}><Icon name="trash" size={16} /></button>}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FilePicker({ clientId, user, picked, onChange, onClose, note = 'Only files shared with the client can go on an agreement.' }) {
  const ids = picked.map((p) => p.id);
  return (
    <Dialog title="Attach files" onClose={onClose} footer={<button class="btn" onClick={onClose}>Done</button>}>
      <p class="small muted" style="margin-top:0">{note}</p>
      <FilesPanel clientId={clientId} user={user} onlyShared pickedIds={ids}
        onPick={(f) => onChange(ids.includes(f.id) ? picked.filter((p) => p.id !== f.id) : [...picked, { id: f.id, filename: f.filename, contentType: f.content_type }])} />
    </Dialog>
  );
}

// Client-facing Files page.
export function FilesPage({ user }) {
  const business = session.value?.clients?.[0];
  if (!business) return <div class="page"><Empty title="Your workspace is being set up">Your Detcord team will connect your business shortly.</Empty></div>;
  return (
    <div class="page">
      <div class="page-head"><div><div class="eyebrow">{business.name}</div><h1>Files and photos</h1><p class="sub">Logos, photos and flyers you share here are ready for your website, social posts and GOAT requests.</p></div></div>
      <FilesPanel clientId={business.id} user={user} />
    </div>
  );
}
