import { useState } from 'preact/hooks';
import { useLoad, api, toast, date, ago, query, navigate, session } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, Avatar, useAction } from '../ui.jsx';
import { SERVICE_CATEGORIES } from '../../shared/services.js';

const REQUEST_STATUS = { new: ['Sent to your team', 'info'], quoted: ['Quote sent', 'warn'], added: ['Added', 'good'], declined: ['Not going ahead', ''] };
const STAFF_REQUEST_STATUS = { new: ['New', 'info'], quoted: ['Quoted', 'warn'], added: ['Added', 'good'], declined: ['Declined', ''] };
const TEAM_STATE = { active: ['Active', 'good'], sent: ['Invite sent', 'info'], expired: ['Invite expired', 'warn'], not_delivered: ['Invite not delivered', 'warn'], disabled: ['Turned off', ''] };
const CONTRACT_STATUS = { sent: ['Waiting for your signature', 'warn'], signed: ['Signed', 'good'], void: ['Voided', ''] };

// Client Business page: their details, team logins, services and agreements, for the business they're viewing.
export function BusinessPage({ user }) {
  const businesses = session.value?.clients || [];
  const picked = query().b;
  const business = businesses.find((b) => b.id === picked) || businesses[0];
  if (!business) {
    return <div class="page"><Empty goat title="Your workspace is being set up">Your Detcord team will connect your business shortly. Questions? Email info@detcorddigital.com.</Empty></div>;
  }
  return <BusinessView key={business.id} id={business.id} user={user} businesses={businesses} />;
}

function BusinessView({ id, user, businesses }) {
  const { loading, data, error, reload } = useLoad(`/clients/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { client, services } = data;
  return (
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Your business</div>
          <h1>{client.name}</h1>
          <p class="sub">Your details, who can sign in, your services and agreements.</p>
        </div>
        {businesses.length > 1 && (
          <select class="select" style="max-width:260px" value={id} onChange={(e) => navigate(`/business?b=${e.target.value}`)} aria-label="Choose a business">
            {businesses.map((b) => <option value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>
      <div class="grid main-side">
        <div class="stack">
          <AgreementsCard clientId={client.id} />
          <ServicesCard clientId={client.id} services={services} />
          <TeamCard clientId={client.id} user={user} />
        </div>
        <div class="stack">
          <DetailsCard client={client} onSaved={reload} />
        </div>
      </div>
    </div>
  );
}

// ---------- Business details ----------

function DetailsCard({ client, onSaved }) {
  const [f, setF] = useState(null);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    await api('PATCH', `/clients/${client.id}/details`, { phone: f.phone, email: f.email, website: f.website, address: f.address, city: f.city, state: f.state, zip: f.zip });
    toast('Business details saved.');
    setF(null);
    onSaved();
  });
  const open = () => setF({ phone: client.phone || '', email: client.email || '', website: client.website || '', address: client.address || '', city: client.city || '', state: client.state || '', zip: client.zip || '' });
  const dash = <span class="faint">—</span>;
  return (
    <section class="card">
      <div class="card-head"><h2>Business details</h2><button class="btn sm ghost" onClick={open}><Icon name="pen" size={14} />Edit</button></div>
      <dl class="kv">
        <dt>Name</dt><dd>{client.name}</dd>
        <dt>Phone</dt><dd>{client.phone || dash}</dd>
        <dt>Email</dt><dd>{client.email || dash}</dd>
        <dt>Website</dt><dd>{client.website ? <a href={client.website} target="_blank" rel="noopener">{client.website.replace(/^https?:\/\//, '')}</a> : dash}</dd>
        <dt>Address</dt><dd>{[client.address, client.city, client.state, client.zip].filter(Boolean).join(', ') || dash}</dd>
      </dl>
      <p class="small faint mt" style="margin-bottom:0">To change the business name, ask your Detcord team.</p>
      {f && (
        <Dialog title="Edit business details" onClose={() => setF(null)} footer={<><button class="btn ghost" onClick={() => setF(null)}>Cancel</button><button class="btn" disabled={busy} onClick={save}>Save</button></>}>
          <div class="form-grid">
            <Field label="Phone"><input class="input" type="tel" value={f.phone} onInput={set('phone')} /></Field>
            <Field label="Public email"><input class="input" type="email" value={f.email} onInput={set('email')} /></Field>
            <div class="full"><Field label="Website"><input class="input" value={f.website} onInput={set('website')} placeholder="yourbusiness.com" /></Field></div>
            <div class="full"><Field label="Street address"><input class="input" value={f.address} onInput={set('address')} /></Field></div>
            <Field label="City"><input class="input" value={f.city} onInput={set('city')} /></Field>
            <Field label="State"><input class="input" value={f.state} onInput={set('state')} /></Field>
            <Field label="ZIP"><input class="input" inputMode="numeric" value={f.zip} onInput={set('zip')} /></Field>
          </div>
          <p class="small muted">Business name: <strong>{client.name}</strong>. Ask your Detcord team to change it.</p>
          {error && <div class="alert bad mt">{error}</div>}
        </Dialog>
      )}
    </section>
  );
}

// ---------- Team logins ----------

function TeamCard({ clientId, user }) {
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/members`, [clientId]);
  const [f, setF] = useState(null);
  const [result, setResult] = useState(null);
  const act = useAction();
  if (loading) return <section class="card"><Loading /></section>;
  if (error) return <section class="card"><ErrorBox error={error} retry={reload} /></section>;
  const { members, canManage } = data;
  const invite = () => act.run(async () => {
    const r = await api('POST', `/clients/${clientId}/members`, f);
    setResult(r.existing ? null : r);
    if (r.existing) toast(`${f.name} can now see this business.`);
    setF(null);
    reload();
  });
  const resend = (m) => act.run(async () => { setResult(await api('POST', `/clients/${clientId}/members/${m.id}/invite`, {})); reload(); });
  const makeOwner = (m) => act.run(async () => { await api('PATCH', `/clients/${clientId}/members/${m.id}`, { owner: true }); toast(`${m.name} is now an owner.`); reload(); });
  const remove = (m) => {
    if (!confirm(m.id === user.id ? 'Remove yourself from this business? You’ll lose access to it.' : `Remove ${m.name} from this business?`)) return;
    act.run(async () => {
      await api('DELETE', `/clients/${clientId}/members/${m.id}`);
      toast(`${m.name} removed.`);
      if (m.id === user.id) { location.href = '/'; return; }
      reload();
    });
  };
  return (
    <section class="card">
      <div class="card-head"><h2>Team logins</h2>{canManage && <button class="btn sm" onClick={() => { setResult(null); setF({ name: '', email: '' }); }}><Icon name="plus" size={14} />Invite</button>}</div>
      <p class="muted small" style="margin-top:0">{canManage ? 'People who can sign in for this business. Owners can invite and remove teammates.' : 'People who can sign in for this business. Ask an owner to add or remove someone.'}</p>
      {members.map((m) => {
        const [label, tone] = TEAM_STATE[m.state] || ['', ''];
        return (
          <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
            <Avatar name={m.name} />
            <div style="flex:1;min-width:160px">
              <div style="font-weight:600">{m.name}{m.id === user.id && <span class="faint small"> (you)</span>}</div>
              <div class="small muted" style="word-break:break-all">{m.email}{m.lastLoginAt ? ` · signed in ${ago(m.lastLoginAt)}` : ''}</div>
            </div>
            {m.owner && <span class="badge accent">Owner</span>}
            <span class={`badge ${tone}`}>{label}</span>
            {canManage && (
              <div class="row" style="gap:6px">
                {m.state !== 'active' && m.state !== 'disabled' && <button class="btn sm secondary" disabled={act.busy} onClick={() => resend(m)}>Resend</button>}
                {!m.owner && <button class="btn sm ghost" disabled={act.busy} onClick={() => makeOwner(m)}>Make owner</button>}
                <button class="btn sm ghost" disabled={act.busy} onClick={() => remove(m)} aria-label={`Remove ${m.name}`}><Icon name="trash" size={14} /></button>
              </div>
            )}
          </div>
        );
      })}
      {result && (result.delivery === 'sent'
        ? <div class="alert good mt">Invitation emailed. The link works once and expires in 24 hours.</div>
        : <div class="alert warn mt"><strong>The invitation email didn’t go out.</strong> Your Detcord team can resend it or share the link with them.</div>)}
      {act.error && !f && <div class="alert bad mt">{act.error}</div>}
      {f && (
        <Dialog title="Invite a teammate" onClose={() => setF(null)} footer={<><button class="btn ghost" onClick={() => setF(null)}>Cancel</button><button class="btn" disabled={act.busy || !f.name || !f.email} onClick={invite}>Send invitation</button></>}>
          <div class="stack">
            <Field label="Name"><input class="input" value={f.name} onInput={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email"><input class="input" type="email" value={f.email} onInput={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <p class="small muted" style="margin:0">They’ll get an email with a one-time link (valid 24 hours) to create a password. They’ll see this business, its invoices, reports and requests.</p>
          </div>
          {act.error && <div class="alert bad mt">{act.error}</div>}
        </Dialog>
      )}
    </section>
  );
}

// ---------- Services ----------

function ServicesCard({ clientId, services }) {
  const requests = useLoad(`/clients/${clientId}/service-requests`, [clientId]);
  const [open, setOpen] = useState(false);
  return (
    <section class="card">
      <div class="card-head"><h2>Your services</h2><button class="btn sm" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Request a service</button></div>
      {services.length ? services.map((s) => <div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>{s.name}</span><span class="badge good">Active</span></div>)
        : <p class="muted">Services appear here once they start.</p>}
      {(requests.data?.requests || []).length > 0 && (
        <>
          <h3 class="mt">Your requests</h3>
          <div class="list">
            {requests.data.requests.map((r) => {
              const [label, tone] = REQUEST_STATUS[r.status];
              return (
                <div class="list-item" style="align-items:flex-start">
                  <div style="flex:1;min-width:0">
                    <div class="title">{r.services.map((s) => s.name).join(', ')}</div>
                    <div class="meta">Asked {date(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}{r.note ? ` · “${r.note}”` : ''}</div>
                    {r.reply && <div class="small mt" style="margin-top:6px;white-space:pre-wrap"><strong>Detcord:</strong> {r.reply}</div>}
                  </div>
                  <span class={`badge ${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {requests.error && <ErrorBox error={requests.error} retry={requests.reload} />}
      {open && <RequestService clientId={clientId} onClose={() => setOpen(false)} onSent={() => { setOpen(false); requests.reload(); }} />}
    </section>
  );
}

function RequestService({ clientId, onClose, onSent }) {
  const catalog = useLoad(`/clients/${clientId}/service-catalog`, [clientId]);
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const send = () => run(async () => {
    await api('POST', `/clients/${clientId}/service-requests`, { services: picked, note });
    toast('Request sent. Your Detcord team will send you a quote.');
    onSent();
  });
  const all = (catalog.data?.services || []).filter((s) => !s.active);
  return (
    <Dialog title="Request a service" onClose={onClose}
      footer={<><span class="small muted" style="margin-right:auto">{picked.length ? `${picked.length} selected` : ''}</span><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy || !picked.length} onClick={send}>Send request</button></>}>
      <p class="muted small" style="margin-top:0">Pick what you’re interested in. Your Detcord team will send you a quote; nothing is added or billed until you agree.</p>
      {catalog.loading ? <Loading /> : catalog.error ? <ErrorBox error={catalog.error} retry={catalog.reload} /> : (
        <div class="stack">
          {SERVICE_CATEGORIES.map((cat) => {
            const items = all.filter((s) => s.category === cat.id);
            if (!items.length) return null;
            return (
              <div>
                <div class="eyebrow" style="margin-bottom:6px">{cat.name}</div>
                {items.map((s) => (
                  <label class="check" style="padding:6px 0">
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span><span style="font-weight:600">{s.name}</span>{s.description && <div class="small muted">{s.description}</div>}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {/* Services added by Detcord under a category the app doesn't know yet. */}
          {all.some((s) => !SERVICE_CATEGORIES.find((c) => c.id === s.category)) && (
            <div>
              <div class="eyebrow" style="margin-bottom:6px">More</div>
              {all.filter((s) => !SERVICE_CATEGORIES.find((c) => c.id === s.category)).map((s) => (
                <label class="check" style="padding:6px 0">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span><span style="font-weight:600">{s.name}</span>{s.description && <div class="small muted">{s.description}</div>}</span>
                </label>
              ))}
            </div>
          )}
          <Field label="Note" help="optional"><textarea class="textarea" rows={3} value={note} onInput={(e) => setNote(e.target.value)} placeholder="What you’d like to get out of it, timing, anything we should know" /></Field>
        </div>
      )}
      {error && <div class="alert bad mt">{error}</div>}
    </Dialog>
  );
}

// ---------- Agreements ----------

function AgreementsCard({ clientId }) {
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/contracts`, [clientId]);
  if (loading) return <section class="card"><Loading /></section>;
  if (error) return <section class="card"><ErrorBox error={error} retry={reload} /></section>;
  const contracts = data.contracts;
  const waiting = contracts.some((c) => c.status === 'sent');
  return (
    <section class={`card${waiting ? ' attention' : ''}`}>
      <h2>Agreements</h2>
      {!contracts.length ? <p class="muted" style="margin-bottom:0">Agreements from Detcord appear here when they’re ready to sign.</p> : (
        <div class="list">
          {contracts.map((ct) => {
            const [label, tone] = CONTRACT_STATUS[ct.status] || [ct.status, ''];
            return (
              <a class="list-item" href={`/contracts/${ct.id}`}>
                <Icon name={ct.status === 'sent' ? 'pen' : 'doc'} />
                <div style="flex:1;min-width:0">
                  <div class="title">{ct.title}</div>
                  <div class="meta">{ct.number} · {ct.signed_at ? `signed ${date(ct.signed_at)}${ct.signer_name ? ` by ${ct.signer_name}` : ''}` : `sent ${date(ct.issued_at)}`}</div>
                </div>
                {ct.status === 'sent' ? <span class="btn sm">Review and sign</span> : <span class={`badge ${tone}`}>{label}</span>}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- Staff: client record ----------

// Overview card on the client record: what the client asked for, and where it stands.
export function ServiceRequestsCard({ clientId }) {
  const { data, error, reload } = useLoad(`/clients/${clientId}/service-requests`, [clientId]);
  const [editing, setEditing] = useState(null);
  const { busy, error: saveError, run } = useAction();
  const requests = data?.requests || [];
  if (error) return <section class="card"><ErrorBox error={error} retry={reload} /></section>;
  if (!requests.length) return null;
  const save = () => run(async () => {
    await api('PATCH', `/clients/${clientId}/service-requests/${editing.id}`, { status: editing.status, reply: editing.reply });
    setEditing(null);
    reload();
  });
  const open = requests.filter((r) => r.status === 'new').length;
  return (
    <section class={`card${open ? ' attention' : ''}`}>
      <h2>Service requests{open ? ` (${open} new)` : ''}</h2>
      <div class="list">
        {requests.slice(0, 5).map((r) => {
          const [label, tone] = STAFF_REQUEST_STATUS[r.status];
          return (
            <button class="list-item" style="background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;cursor:pointer;align-items:flex-start" onClick={() => setEditing({ ...r, reply: r.reply || '' })}>
              <div style="flex:1;min-width:0">
                <div class="title">{r.services.map((s) => s.name).join(', ')}</div>
                <div class="meta">{r.requestedBy || 'Client'} · {ago(r.createdAt)}{r.note ? ` · “${r.note}”` : ''}</div>
              </div>
              <span class={`badge ${tone}`}>{label}</span>
            </button>
          );
        })}
      </div>
      {editing && (
        <Dialog title="Service request" onClose={() => setEditing(null)} footer={<><button class="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button class="btn" disabled={busy} onClick={save}>Save</button></>}>
          <div class="stack">
            <div><strong>{editing.services.map((s) => s.name).join(', ')}</strong><div class="small muted">{editing.requestedBy || 'Client'} · {date(editing.createdAt)}</div></div>
            {editing.note && <div style="white-space:pre-wrap">“{editing.note}”</div>}
            <Field label="Status"><select class="select" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{Object.entries(STAFF_REQUEST_STATUS).map(([k, [l]]) => <option value={k}>{l}</option>)}</select></Field>
            <Field label="Note to the client" help="optional, shown on their Business page"><textarea class="textarea" rows={3} value={editing.reply} onInput={(e) => setEditing({ ...editing, reply: e.target.value })} /></Field>
            <p class="small muted" style="margin:0">Marking it added doesn’t add the service or bill anything. Add it under Services or in an agreement.</p>
          </div>
          {saveError && <div class="alert bad mt">{saveError}</div>}
        </Dialog>
      )}
    </section>
  );
}
