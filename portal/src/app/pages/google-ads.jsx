import { useState } from 'preact/hooks';
import { useLoad, api, ago } from '../lib.js';
import { Field, useAction } from '../ui.jsx';

// A client's Google Ads account and the link request from Detcord's manager account.
const TONE = { active: 'good', pending: 'info', waiting_setup: 'warn', refused: 'bad', failed: 'bad', cancelled: '', inactive: '' };

export function GoogleAdsCard({ clientId }) {
  const { data, reload } = useLoad(`/clients/${clientId}/google-ads`, [clientId]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const act = useAction();
  if (!data) return null;
  const a = data.ads;
  const go = (method, path, body) => act.run(async () => { await api(method, `/clients/${clientId}/google-ads${path}`, body); setEditing(false); reload(); });
  return (
    <section class="card">
      <div class="card-head"><h2>Google Ads</h2>{a.customer_id && !editing && <button class="btn sm ghost" onClick={() => { setValue(a.customer_id); setEditing(true); }}>Change</button>}</div>
      {a.customer_id && !editing ? (
        <>
          <dl class="kv">
            <dt>Customer ID</dt><dd style="font-family:monospace">{a.customer_id}</dd>
            <dt>Link</dt><dd><span class={`badge ${TONE[a.status] || ''}`}>{a.status_label || 'Not requested'}</span>{a.checked_at && <div class="small muted">Checked {ago(a.checked_at)}</div>}</dd>
          </dl>
          {a.status === 'pending' && <p class="small muted">The client accepts it in Google Ads: Admin, then Access and security, then Managers.</p>}
          {a.status === 'waiting_setup' && <p class="small muted">Saved. The request goes out once Google Ads API access is set up (Settings, Integrations).</p>}
          {a.error && <div class="alert bad mt">{a.error}</div>}
          <div class="row mt">
            {data.ready && ['refused', 'failed', 'cancelled', 'inactive', 'waiting_setup'].includes(a.status) && <button class="btn sm secondary" disabled={act.busy} onClick={() => go('POST', '/request')}>Send request</button>}
            {data.ready && ['pending', 'active', 'failed'].includes(a.status) && <button class="btn sm ghost" disabled={act.busy} onClick={() => go('POST', '/check')}>Check status</button>}
          </div>
        </>
      ) : (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); go('PUT', '', { customerId: value }); }}>
          <Field label="Customer ID" help="10 digits, shown top right in their Google Ads account"><input class="input" inputMode="numeric" placeholder="123-456-7890" value={value} onInput={(e) => setValue(e.target.value)} /></Field>
          <div class="row">
            <button class="btn sm" disabled={act.busy || !value.trim()}>{data.ready ? 'Save and send link request' : 'Save'}</button>
            {editing && <button type="button" class="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>}
            {editing && <button type="button" class="btn sm ghost" onClick={() => go('PUT', '', { customerId: null })}>Remove</button>}
          </div>
        </form>
      )}
      {act.error && <div class="alert bad mt">{act.error}</div>}
    </section>
  );
}
