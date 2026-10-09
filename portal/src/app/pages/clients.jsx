import { useEffect, useState } from 'preact/hooks';
import { useLoad, api, navigate, toast, query, money, dollars, ago, date, dateTime, due, fromInputDate, STATUS_LABEL } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, StatusBadge, Avatar, CopyButton, useAction } from '../ui.jsx';
import { IndustrySelect, industryName } from '../industries.jsx';
import { SERVICE_CATEGORIES } from '../../shared/services.js';
import { TaskLine } from './dashboard.jsx';
import { ContractsTab } from './contracts.jsx';
import { BillingTab } from './billing.jsx';
import { FilesPanel } from './files.jsx';
import { AuditsTab } from './audits.jsx';
import { GoatTab } from './goat.jsx';
import { SocialTab } from './social.jsx';
import { MeetingsTab } from './meetings.jsx';
import { ReportsTab } from './reports.jsx';
import { GoogleAdsCard } from './google-ads.jsx';
import { ServiceRequestsCard } from './business.jsx';

// ---------- List ----------
export function ClientsList({ user }) {
  const qs = query();
  const [q, setQ] = useState(qs.q || '');
  const [status, setStatus] = useState(qs.status || '');
  const params = new URLSearchParams({ ...(q && { q }), ...(status && { status }) }).toString();
  const { loading, data, error, reload } = useLoad(`/clients${params ? `?${params}` : ''}`, [params]);
  const [mine, setMine] = useState(false);
  const rows = (data?.clients || []).filter((c) => (!qs.unassigned || !c.reps) && (!mine || c.mine));
  return (
    <div class="page">
      <div class="page-head">
        <div><div class="eyebrow">{user.role === 'admin' ? 'All clients' : 'Assigned to you'}</div><h1>Clients</h1></div>
        <a class="btn" href="/clients/new"><Icon name="plus" />New client</a>
      </div>
      <div class="row mb">
        <input class="input" style="max-width:320px" type="search" placeholder="Search name, city or phone" value={q} onInput={(e) => setQ(e.target.value)} aria-label="Search clients" />
        <select class="select" style="max-width:200px" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}
        </select>
        {user.role === 'admin' && <label class="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only my clients</label>}
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !rows.length ? (
        <div class="card"><Empty goat title={q || status ? 'No clients match' : 'No clients yet'} action={!q && !status && <a class="btn" href="/clients/new">Add your first client</a>}>
          {q || status ? 'Try a different search.' : 'Add a business to start a discovery call.'}
        </Empty></div>
      ) : (
        <div class="card table-wrap" style="padding:0">
          <table>
            <thead><tr><th>Business</th><th>Status</th><th>Stage</th>{user.role === 'admin' && <th>Rep</th>}<th>Next follow-up</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const d = c.next_due ? due(c.next_due) : null;
                return (
                  <tr class="click" onClick={() => navigate(`/clients/${c.id}`)}>
                    <td><a href={`/clients/${c.id}`} style="font-weight:600;text-decoration:none">{c.name}</a><div class="small muted">{[industryName(c.industry), c.city].filter(Boolean).join(' · ')}</div></td>
                    <td><StatusBadge status={c.status} /></td>
                    <td class="muted">{c.stage || '—'}</td>
                    {user.role === 'admin' && <td class={c.reps ? '' : 'faint'}>{c.reps || 'Unassigned'}</td>}
                    <td class={d?.tone || 'faint'}>{d ? d.text : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- New or existing ----------
export function NewClient({ user }) {
  const [f, setF] = useState({ name: '', industry: '', phone: '', website: '', city: '', email: '', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '', decisionMaker: true, repId: '', source: '', googleAdsId: '', runCheck: true });
  const [matches, setMatches] = useState({ matches: [], hidden: 0 });
  const team = useLoad(user.role === 'admin' ? '/team' : null);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  // Look for existing records as the rep types, so duplicates are caught before saving.
  useEffect(() => {
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ name: f.name, phone: f.phone, website: f.website });
      try { setMatches(await api('GET', `/clients/match?${p}`)); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [f.name, f.phone, f.website]);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const { id } = await api('POST', '/clients', {
        name: f.name, industry: f.industry || null, phone: f.phone, website: f.website, city: f.city, email: f.email, source: f.source,
        repId: f.repId || undefined,
        googleAdsId: f.googleAdsId || undefined,
        contact: f.contactName ? { name: f.contactName, title: f.contactTitle, email: f.contactEmail, phone: f.contactPhone, decisionMaker: f.decisionMaker } : undefined,
      });
      toast(`${f.name} added.`);
      navigate(f.website && f.runCheck ? `/clients/${id}?tab=audits&run=1` : `/clients/${id}`);
    });
  };

  return (
    <div class="page" style="max-width:860px">
      <div class="page-head"><div><a class="small muted" href="/clients">← Clients</a><h1>New client</h1><p class="sub">Add the business, then start discovery or send the pre-call questions.</p></div></div>
      {(matches.matches.length > 0 || matches.hidden > 0) && (
        <div class="alert warn mb">
          <strong>This business may already exist.</strong>
          {matches.matches.map((m) => <div class="row between mt"><span>{m.name}{m.city ? `, ${m.city}` : ''}</span><a class="btn sm secondary" href={`/clients/${m.id}`}>Open existing</a></div>)}
          {matches.hidden > 0 && <div class="mt small">A matching business is assigned to another rep. Ask an admin before creating a duplicate.</div>}
        </div>
      )}
      <form class="card stack" onSubmit={submit}>
        <h2>Business</h2>
        <div class="form-grid">
          <Field label="Business name"><input class="input" required value={f.name} onInput={set('name')} autofocus /></Field>
          <Field label="Industry"><IndustrySelect value={f.industry} onChange={(v) => setF({ ...f, industry: v })} /></Field>
          <Field label="Phone"><input class="input" type="tel" value={f.phone} onInput={set('phone')} /></Field>
          <Field label="Website"><input class="input" placeholder="example.com" value={f.website} onInput={set('website')} /></Field>
          <Field label="Business email"><input class="input" type="email" placeholder="owner@example.com" value={f.email} onInput={set('email')} /></Field>
          <Field label="City" help="used for the local search check"><input class="input" value={f.city} onInput={set('city')} /></Field>
          <Field label="Google Ads customer ID" help="optional; Detcord's manager account sends them a link request"><input class="input" inputMode="numeric" placeholder="123-456-7890" value={f.googleAdsId} onInput={set('googleAdsId')} /></Field>
          <Field label="Lead source" help="optional"><input class="input" placeholder="Referral, website, cold call…" value={f.source} onInput={set('source')} /></Field>
          {user.role === 'admin' && (
            <Field label="Assigned rep" help="optional">
              <select class="select" value={f.repId} onChange={set('repId')}>
                <option value="">No rep yet</option>
                {(team.data?.team || []).filter((t) => (t.role === 'rep' || t.role === 'admin') && t.status !== 'disabled').map((t) => <option value={t.id}>{t.id === user.id ? `${t.name} (me)` : t.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <hr />
        <h2>Main contact</h2>
        <div class="form-grid">
          <Field label="Name"><input class="input" value={f.contactName} onInput={set('contactName')} /></Field>
          <Field label="Title"><input class="input" placeholder="Owner" value={f.contactTitle} onInput={set('contactTitle')} /></Field>
          <Field label="Email"><input class="input" type="email" value={f.contactEmail} onInput={set('contactEmail')} /></Field>
          <Field label="Mobile"><input class="input" type="tel" value={f.contactPhone} onInput={set('contactPhone')} /></Field>
          <label class="check full"><input type="checkbox" checked={f.decisionMaker} onChange={set('decisionMaker')} />This person makes the buying decision</label>
        </div>
        {f.website && <label class="check"><input type="checkbox" checked={f.runCheck} onChange={set('runCheck')} />Run a website and Google check right after saving</label>}
        {error && <div class="alert bad">{error}</div>}
        <div class="row"><button class="btn" disabled={busy}>{busy ? 'Saving…' : f.website && f.runCheck ? 'Create client and run check' : 'Create client'}</button><a class="btn ghost" href="/clients">Cancel</a></div>
      </form>
    </div>
  );
}

// ---------- Client record ----------
const TABS = [['overview', 'Overview'], ['goat', 'Requests'], ['social', 'Social'], ['audits', 'Website check'], ['reports', 'Reports'], ['meetings', 'Meetings'], ['discovery', 'Discovery'], ['deals', 'Deals'], ['contracts', 'Agreements'], ['billing', 'Billing'], ['files', 'Files'], ['tasks', 'Tasks'], ['notes', 'Notes'], ['access', 'Portal access']];

export function ClientRecord({ id, user }) {
  if (user.role === 'client') return <ClientOwnRecord id={id} />;
  return <StaffClientRecord id={id} user={user} />;
}

function StaffClientRecord({ id, user }) {
  const [tab, setTab] = useState(query().tab || 'overview');
  const { loading, data, error, reload } = useLoad(`/clients/${id}`);
  // On phones the tab row scrolls sideways; keep the open tab in view (for example after a ?tab= link).
  useEffect(() => {
    const el = document.querySelector('.tabs [aria-selected="true"]');
    if (!el) return;
    const row = el.parentElement, r = el.getBoundingClientRect(), pr = row.getBoundingClientRect();
    if (r.left < pr.left || r.right > pr.right) row.scrollLeft += r.left - pr.left - 16;
  }, [tab, loading]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const c = data.client;
  const select = (t) => { setTab(t); history.replaceState({}, '', `?tab=${t}`); };
  return (
    <div class="page">
      <div class="page-head">
        <div>
          <a class="small muted" href="/clients">← Clients</a>
          <h1>{c.name}</h1>
          <div class="row mt" style="gap:8px">
            <StatusBadge status={c.status} />
            {c.industry && <span class="badge">{industryName(c.industry)}</span>}
            {c.city && <span class="faint small">{c.city}{c.state ? `, ${c.state}` : ''}</span>}
            {data.team.length > 0 && <span class="faint small">· {data.team.map((t) => t.name).join(', ')}</span>}
          </div>
        </div>
        <div class="row">
          {c.phone && <a class="btn secondary" href={`tel:${c.phone}`}><Icon name="phone" />Call</a>}
          <StartDiscovery client={c} onStarted={(id2) => navigate(`/discovery/${id2}`)} />
        </div>
      </div>
      <div class="tabs" role="tablist">
        {TABS.map(([k, l]) => <button role="tab" aria-selected={tab === k} onClick={() => select(k)}>{l}{k === 'tasks' && data.tasks.filter((t) => !t.done_at).length ? ` (${data.tasks.filter((t) => !t.done_at).length})` : ''}</button>)}
      </div>
      {tab === 'overview' && <Overview data={data} user={user} reload={reload} />}
      {tab === 'discovery' && <DiscoveryTab data={data} reload={reload} />}
      {tab === 'deals' && <DealsTab data={data} reload={reload} />}
      {tab === 'tasks' && <TasksTab data={data} user={user} reload={reload} />}
      {tab === 'notes' && <NotesTab data={data} user={user} reload={reload} />}
      {tab === 'access' && <AccessTab data={data} user={user} reload={reload} />}
      {tab === 'contracts' && <ContractsTab clientId={c.id} user={user} />}
      {tab === 'billing' && <BillingTab clientId={c.id} user={user} />}
      {tab === 'files' && <FilesPanel clientId={c.id} user={user} />}
      {tab === 'goat' && <GoatTab client={c} user={user} />}
      {tab === 'social' && <SocialTab client={c} user={user} />}
      {tab === 'meetings' && <MeetingsTab client={c} />}
      {tab === 'audits' && <AuditsTab client={c} user={user} onChanged={reload} />}
      {tab === 'reports' && <ReportsTab client={c} />}
    </div>
  );
}

function ClientOwnRecord() {
  navigate('/', { replace: true });
  return null;
}

function StartDiscovery({ client, onStarted, label = 'Start discovery' }) {
  const [open, setOpen] = useState(false);
  const [industry, setIndustry] = useState(client.industry || '');
  const { busy, error, run } = useAction();
  const start = () => run(async () => {
    const r = await api('POST', '/discoveries', { clientId: client.id, industry: industry || null });
    if (r.prefilled) toast(`Pre-filled ${r.prefilled} answers from the pre-call questions.`);
    onStarted(r.id);
  });
  return (
    <>
      <button class="btn" onClick={() => (client.industry ? start() : setOpen(true))} disabled={busy}><Icon name="discovery" />{busy ? 'Starting…' : label}</button>
      {open && (
        <Dialog title="Start discovery" onClose={() => setOpen(false)} footer={<><button class="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button class="btn" disabled={busy} onClick={start}>Start</button></>}>
          <Field label="Industry" help="adds industry-specific questions"><IndustrySelect value={industry} onChange={setIndustry} /></Field>
          {error && <div class="alert bad mt">{error}</div>}
        </Dialog>
      )}
      {!open && error && <div class="alert bad">{error}</div>}
    </>
  );
}

function Overview({ data, user, reload }) {
  const c = data.client;
  const [editing, setEditing] = useState(false);
  const latest = data.discoveries.find((d) => d.result);
  return (
    <div class="grid main-side">
      <div class="stack">
        <ServiceRequestsCard clientId={c.id} />
        {latest && <ResultCard result={latest.result} discoveryId={latest.id} />}
        <ServicesCard data={data} reload={reload} />
        <section class="card">
          <h2>Recent activity</h2>
          {data.activity.length ? (
            <div class="list">{data.activity.slice(0, 10).map((a) => <div class="list-item"><div style="flex:1"><div>{a.summary}</div><div class="meta">{a.actor || 'System'} · {ago(a.created_at)}</div></div></div>)}</div>
          ) : <p class="muted">Nothing yet.</p>}
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Business</h2><div class="row">{user.role === 'admin' && <button class="btn sm ghost" onClick={() => setEditing('delete')}><Icon name="trash" />Delete</button>}<button class="btn sm ghost" onClick={() => setEditing(true)}>Edit</button></div></div>
          <dl class="kv">
            <dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span class="faint">—</span>}</dd>
            <dt>Website</dt><dd>{c.website ? <a href={c.website} target="_blank" rel="noopener">{c.website.replace(/^https?:\/\//, '')}</a> : <span class="faint">—</span>}</dd>
            <dt>Email</dt><dd>{c.email || <span class="faint">—</span>}</dd>
            <dt>Address</dt><dd>{[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || <span class="faint">—</span>}</dd>
            <dt>Source</dt><dd>{c.source || <span class="faint">—</span>}</dd>
            <dt>Added</dt><dd>{date(c.created_at)}</dd>
          </dl>
        </section>
        <GoogleAdsCard clientId={c.id} />
        <ContactsCard data={data} reload={reload} />
        <TeamCard data={data} user={user} reload={reload} />
      </div>
      {editing && <EditClient client={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} isAdmin={user.role === 'admin'} startDelete={editing === 'delete'} />}
    </div>
  );
}

function EditClient({ client, onClose, onSaved, isAdmin, startDelete }) {
  const [f, setF] = useState({ ...client });
  const [confirmDelete, setConfirmDelete] = useState('');
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    await api('PATCH', `/clients/${client.id}`, { name: f.name, industry: f.industry || null, phone: f.phone, website: f.website, email: f.email, address: f.address, city: f.city, state: f.state, zip: f.zip, status: f.status, source: f.source });
    toast('Saved.');
    onSaved();
  });
  const del = () => run(async () => {
    await api('DELETE', `/clients/${client.id}`, { confirm: confirmDelete });
    toast(`${client.name} deleted.`);
    navigate('/clients');
  });
  return (
    <Dialog title="Edit business" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy} onClick={save}>Save</button></>}>
      <div class="form-grid">
        <Field label="Business name"><input class="input" value={f.name} onInput={set('name')} /></Field>
        <Field label="Status">
          <select class="select" value={f.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Industry"><IndustrySelect value={f.industry} onChange={(v) => setF({ ...f, industry: v })} /></Field>
        <Field label="Phone"><input class="input" value={f.phone || ''} onInput={set('phone')} /></Field>
        <Field label="Website"><input class="input" value={f.website || ''} onInput={set('website')} /></Field>
        <Field label="Email"><input class="input" value={f.email || ''} onInput={set('email')} /></Field>
        <Field label="Street address"><input class="input" value={f.address || ''} onInput={set('address')} /></Field>
        <Field label="City"><input class="input" value={f.city || ''} onInput={set('city')} /></Field>
        <Field label="State"><input class="input" value={f.state || ''} onInput={set('state')} /></Field>
        <Field label="ZIP"><input class="input" value={f.zip || ''} onInput={set('zip')} /></Field>
        <Field label="Lead source"><input class="input" value={f.source || ''} onInput={set('source')} /></Field>
      </div>
      {error && <div class="alert bad mt">{error}</div>}
      {isAdmin && (
        <details class="mt" open={startDelete}>
          <summary class="small muted" style="cursor:pointer">Delete this client</summary>
          <div class="alert bad mt">Deleting removes this business and everything linked to it: contacts, deals, discovery, notes, tasks, files, meetings, website checks, unsigned agreements and unpaid invoices. Portal logins that only belonged to this business are removed too. A client with a signed agreement or a payment can’t be deleted; set it to Former instead. This can’t be undone.</div>
          <Field label={`Type “${client.name}” to confirm`}><input class="input" value={confirmDelete} onInput={(e) => setConfirmDelete(e.target.value)} /></Field>
          <button class="btn danger mt" disabled={confirmDelete !== client.name || busy} onClick={del}><Icon name="trash" />Delete permanently</button>
        </details>
      )}
    </Dialog>
  );
}

function ContactsCard({ data, reload }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', title: '', email: '', phone: '', decisionMaker: false });
  const { busy, error, run } = useAction();
  const add = () => run(async () => {
    await api('POST', `/clients/${data.client.id}/contacts`, { ...f, isPrimary: !data.contacts.length });
    setAdding(false);
    setF({ name: '', title: '', email: '', phone: '', decisionMaker: false });
    reload();
  });
  const remove = (ct) => confirm(`Remove ${ct.name}?`) && run(async () => { await api('DELETE', `/clients/${data.client.id}/contacts/${ct.id}`); reload(); });
  return (
    <section class="card">
      <div class="card-head"><h2>Contacts</h2><button class="btn sm ghost" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add</button></div>
      {data.contacts.length ? data.contacts.map((ct) => (
        <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);align-items:flex-start">
          <Avatar name={ct.name} />
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">{ct.name} {ct.is_decision_maker ? <span class="badge accent">Decision maker</span> : null}</div>
            <div class="small muted">{[ct.title, ct.email, ct.phone].filter(Boolean).join(' · ')}</div>
          </div>
          <button class="icon-btn" aria-label={`Remove ${ct.name}`} onClick={() => remove(ct)}><Icon name="trash" size={14} /></button>
        </div>
      )) : <p class="muted small">No contacts yet.</p>}
      {adding && (
        <Dialog title="Add contact" onClose={() => setAdding(false)} footer={<><button class="btn ghost" onClick={() => setAdding(false)}>Cancel</button><button class="btn" disabled={busy || !f.name} onClick={add}>Add contact</button></>}>
          <div class="form-grid">
            <Field label="Name"><input class="input" value={f.name} onInput={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Title"><input class="input" value={f.title} onInput={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Email"><input class="input" type="email" value={f.email} onInput={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Phone"><input class="input" type="tel" value={f.phone} onInput={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <label class="check full"><input type="checkbox" checked={f.decisionMaker} onChange={(e) => setF({ ...f, decisionMaker: e.target.checked })} />Makes buying decisions</label>
          </div>
          {error && <div class="alert bad mt">{error}</div>}
        </Dialog>
      )}
    </section>
  );
}

function TeamCard({ data, user, reload }) {
  const team = useLoad(user.role === 'admin' ? '/team' : null);
  const [pick, setPick] = useState('');
  const { run } = useAction();
  const assigned = new Set(data.team.map((t) => t.id));
  const assign = () => pick && run(async () => { await api('PUT', `/users/${pick}/clients/${data.client.id}`, {}); setPick(''); toast('Rep assigned.'); reload(); });
  const unassign = (t) => confirm(`Remove ${t.name} from this client? They will lose access.`) && run(async () => { await api('DELETE', `/users/${t.id}/clients/${data.client.id}`); reload(); });
  return (
    <section class="card">
      <h2>Detcord team</h2>
      {data.team.length ? data.team.map((t) => (
        <div class="row" style="padding:6px 0">
          <Avatar name={t.name} /><div style="flex:1">{t.name}<div class="small muted">Sales rep</div></div>
          {user.role === 'admin' && <button class="btn sm ghost" onClick={() => unassign(t)}>Remove</button>}
        </div>
      )) : <p class="muted small">No rep assigned.</p>}
      {user.role === 'admin' && (
        <div class="row mt">
          <select class="select" style="flex:1" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Assign a rep">
            <option value="">Assign a rep…</option>
            {(team.data?.team || []).filter((t) => (t.role === 'rep' || t.role === 'admin') && t.status !== 'disabled' && !assigned.has(t.id)).map((t) => <option value={t.id}>{t.id === user.id ? `${t.name} (me)` : t.name}</option>)}
          </select>
          <button class="btn sm secondary" disabled={!pick} onClick={assign}>Assign</button>
        </div>
      )}
    </section>
  );
}

const SVC_STATUS = { recommended: ['Recommended', 'info'], proposed: ['Proposed', 'warn'], active: ['Active', 'good'], ended: ['Ended', ''] };

function ServicesCard({ data, reload }) {
  const catalog = useLoad('/services');
  const [editing, setEditing] = useState(null);
  const { busy, error, run } = useAction();
  const byId = Object.fromEntries((catalog.data?.services || []).map((s) => [s.id, s]));
  const save = () => run(async () => {
    await api('PUT', `/clients/${data.client.id}/services/${editing.service_id}`, { status: editing.status, setup: editing.setup, monthly: editing.monthly });
    setEditing(null);
    reload();
  });
  const remove = () => run(async () => { await api('DELETE', `/clients/${data.client.id}/services/${editing.service_id}`); setEditing(null); reload(); });
  const current = new Set(data.services.map((s) => s.service_id));
  return (
    <section class="card">
      <div class="card-head">
        <h2>Services</h2>
        <select class="select" style="max-width:220px;min-height:34px;padding:6px 10px" value="" onChange={(e) => e.target.value && setEditing({ service_id: e.target.value, status: 'recommended', setup: dollars(byId[e.target.value]?.setup_cents), monthly: dollars(byId[e.target.value]?.monthly_cents), isNew: true })} aria-label="Add a service">
          <option value="">+ Add service</option>
          {SERVICE_CATEGORIES.map((cat) => <optgroup label={cat.name}>{(catalog.data?.services || []).filter((s) => s.category === cat.id && s.active && !current.has(s.id)).map((s) => <option value={s.id}>{s.name}</option>)}</optgroup>)}
        </select>
      </div>
      {data.services.length ? (
        <div class="list">
          {data.services.map((s) => (
            <button class="list-item" style="background:none;border-left:0;border-right:0;border-top:0;width:100%;text-align:left;cursor:pointer" onClick={() => setEditing({ ...s, setup: dollars(s.setup_cents), monthly: dollars(s.monthly_cents) })}>
              <div style="flex:1"><div class="title">{s.name}</div><div class="meta">{s.setup_cents != null || s.monthly_cents != null ? `${money(s.setup_cents)} setup · ${money(s.monthly_cents)}/mo` : 'No price set'}</div></div>
              <span class={`badge ${SVC_STATUS[s.status][1]}`}>{SVC_STATUS[s.status][0]}</span>
            </button>
          ))}
        </div>
      ) : <p class="muted small">No services yet. Completing discovery recommends them automatically.</p>}
      {editing && (
        <Dialog title={byId[editing.service_id]?.name || 'Service'} onClose={() => setEditing(null)}
          footer={<>{!editing.isNew && <button class="btn danger" onClick={remove} disabled={busy}>Remove</button>}<span class="spacer" /><button class="btn ghost" onClick={() => setEditing(null)}>Cancel</button><button class="btn" onClick={save} disabled={busy}>Save</button></>}>
          <p class="muted small" style="margin-top:0">{byId[editing.service_id]?.description}</p>
          <div class="form-grid">
            <Field label="Status"><select class="select" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{Object.entries(SVC_STATUS).map(([k, [l]]) => <option value={k}>{l}</option>)}</select></Field>
            <div />
            <Field label="Setup price ($)"><input class="input" inputMode="decimal" value={editing.setup} onInput={(e) => setEditing({ ...editing, setup: e.target.value })} placeholder="Leave blank if not set" /></Field>
            <Field label="Monthly price ($)"><input class="input" inputMode="decimal" value={editing.monthly} onInput={(e) => setEditing({ ...editing, monthly: e.target.value })} placeholder="Leave blank if not set" /></Field>
          </div>
          {error && <div class="alert bad mt">{error}</div>}
        </Dialog>
      )}
    </section>
  );
}

export function ResultCard({ result, discoveryId, compact = false }) {
  const s = result.score;
  return (
    <section class="card">
      <div class="row" style="align-items:flex-start;gap:14px">
        <span class={`grade ${s.grade}`}>{s.grade}</span>
        <div style="flex:1;min-width:0">
          <h2 style="margin:0">{s.label}</h2>
          <div class="muted small">Score {s.total} of {s.max} · {s.action}</div>
        </div>
        {discoveryId && <a class="btn sm secondary" href={`/discovery/${discoveryId}`}>Open</a>}
      </div>
      <div class="grid four mt" style="gap:8px">
        {s.dimensions.map((d) => (
          <div title={d.help} style="background:var(--surface-2);border-radius:8px;padding:8px 10px">
            <div class="small muted">{d.name}</div>
            <div style="font-weight:700">{d.score}/4</div>
          </div>
        ))}
      </div>
      {result.headline && <p class="mt" style="margin-bottom:0"><span class="muted small">Biggest problem, in their words:</span><br />“{result.headline}”</p>}
      {!compact && result.redFlags.length > 0 && <div class="alert warn mt">{result.redFlags.map((f) => <div>• {f}</div>)}</div>}
      {!compact && (
        <div class="mt">
          <div class="small muted mb" style="margin-bottom:6px">Start with</div>
          {result.recommended.filter((r) => r.priority === 'start-with').map((r) => (
            <div style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>{r.name}</strong><div class="small muted">{r.reasons[0]}</div></div>
          ))}
        </div>
      )}
    </section>
  );
}

function DiscoveryTab({ data, reload }) {
  const [sending, setSending] = useState(false);
  const primary = data.contacts.find((c) => c.is_primary) || data.contacts[0];
  const [email, setEmail] = useState(primary?.email || '');
  const [link, setLink] = useState(null);
  const { busy, error, run } = useAction();
  const send = (withEmail) => run(async () => {
    const r = await api('POST', `/clients/${data.client.id}/intake`, withEmail ? { email, name: primary?.name?.split(' ')[0] } : {});
    setLink(r.url);
    if (withEmail) toast(r.delivery?.status === 'sent' ? `Sent to ${email}.` : `Email not sent: ${r.delivery?.error || 'unknown error'}. Copy the link instead.`, r.delivery?.status === 'sent' ? 'good' : 'bad');
    reload();
  });
  return (
    <div class="grid main-side">
      <div class="stack">
        {data.discoveries.length ? data.discoveries.map((d) => (
          d.result ? <ResultCard result={d.result} discoveryId={d.id} />
            : <a class="card row between" style="text-decoration:none" href={`/discovery/${d.id}`}><div><strong>Discovery in progress</strong><div class="small muted">Last edited {ago(d.updated_at)}</div></div><span class="btn sm">Continue</span></a>
        )) : (
          <div class="card"><Empty goat title="No discovery yet" action={<StartDiscovery client={data.client} onStarted={(id) => navigate(`/discovery/${id}`)} label="Start discovery call" />}>
            Run the call with the guided script. Answers save as you go, and the lead is scored at the end.
          </Empty></div>
        )}
      </div>
      <div class="stack">
        <section class="card">
          <h2>Pre-call questions</h2>
          <p class="muted small" style="margin-top:0">Send the prospect a 3-minute form before the call. Answers pre-fill the discovery.</p>
          {data.intakes.length > 0 && (
            <div class="mb">{data.intakes.slice(0, 3).map((i) => (
              <div class="row between small" style="padding:4px 0"><span>Sent {date(i.created_at)}</span>{i.submitted_at ? <span class="badge good">Answered {ago(i.submitted_at)}</span> : i.expires_at < Date.now() ? <span class="badge">Expired</span> : <span class="badge info">Waiting</span>}</div>
            ))}</div>
          )}
          {sending ? (
            <div class="stack">
              <Field label="Send to"><input class="input" type="email" value={email} onInput={(e) => setEmail(e.target.value)} /></Field>
              <div class="row"><button class="btn sm" disabled={busy || !email} onClick={() => send(true)}><Icon name="mail" size={14} />Email it</button><button class="btn sm secondary" disabled={busy} onClick={() => send(false)}><Icon name="link" size={14} />Just get a link</button></div>
            </div>
          ) : <button class="btn secondary block" onClick={() => setSending(true)}>Send pre-call questions</button>}
          {link && <div class="alert info mt"><div class="small" style="word-break:break-all">{link}</div><div class="mt"><CopyButton text={link} /></div></div>}
          {error && <div class="alert bad mt">{error}</div>}
        </section>
      </div>
    </div>
  );
}

export function DealsTab({ data, reload }) {
  const stages = useLoad('/sales/pipeline');
  const { run, error } = useAction();
  const [edit, setEdit] = useState(null);
  const update = (d, body) => run(async () => { await api('PATCH', `/sales/deals/${d.id}`, body); toast('Deal updated.'); setEdit(null); reload(); });
  const add = () => run(async () => { await api('POST', '/sales/deals', { clientId: data.client.id }); reload(); });
  return (
    <div class="stack">
      {error && <div class="alert bad">{error}</div>}
      {data.deals.map((d) => (
        <section class="card">
          <div class="row between" style="align-items:flex-start">
            <div>
              <h2 style="margin:0 0 4px">{d.title}</h2>
              <div class="small muted">{d.owner || 'No owner'} · opened {date(d.created_at)}{d.expected_close ? ` · expected ${d.expected_close}` : ''}</div>
            </div>
            <span class={`badge ${d.outcome === 'won' ? 'good' : d.outcome === 'lost' ? 'bad' : 'info'}`}>{d.stage_name}</span>
          </div>
          <div class="row mt" style="gap:24px">
            <div><div class="small muted">Setup</div><strong>{money(d.setup_cents)}</strong></div>
            <div><div class="small muted">Monthly</div><strong>{money(d.monthly_cents)}</strong></div>
            {d.lost_reason && <div><div class="small muted">Lost because</div>{d.lost_reason}</div>}
          </div>
          <div class="row mt">
            <select class="select" style="max-width:220px" value={d.stage_id} onChange={(e) => {
              const st = stages.data?.stages.find((s) => s.id === e.target.value);
              const lostReason = st?.outcome === 'lost' ? prompt('Why was it lost?') || '' : undefined;
              update(d, { stageId: e.target.value, lostReason });
            }} aria-label="Move to stage">
              {(stages.data?.stages || []).map((s) => <option value={s.id}>{s.name}</option>)}
            </select>
            <button class="btn sm secondary" onClick={() => setEdit({ ...d, setup: dollars(d.setup_cents), monthly: dollars(d.monthly_cents) })}>Edit values</button>
          </div>
        </section>
      ))}
      <button class="btn secondary" onClick={add}><Icon name="plus" />New deal</button>
      {edit && (
        <Dialog title="Deal" onClose={() => setEdit(null)} footer={<><button class="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button class="btn" onClick={() => update(edit, { title: edit.title, setup: edit.setup, monthly: edit.monthly, expectedClose: edit.expected_close })}>Save</button></>}>
          <div class="form-grid">
            <Field label="Deal name" ><input class="input" value={edit.title} onInput={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Expected close"><input class="input" type="date" value={edit.expected_close || ''} onInput={(e) => setEdit({ ...edit, expected_close: e.target.value })} /></Field>
            <Field label="Setup value ($)"><input class="input" inputMode="decimal" value={edit.setup} onInput={(e) => setEdit({ ...edit, setup: e.target.value })} /></Field>
            <Field label="Monthly value ($)"><input class="input" inputMode="decimal" value={edit.monthly} onInput={(e) => setEdit({ ...edit, monthly: e.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function NewTask({ clientId, onAdded, user }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDue] = useState('');
  const { busy, error, run } = useAction();
  const add = (e) => {
    e.preventDefault();
    run(async () => { await api('POST', '/sales/tasks', { clientId, title, dueAt: fromInputDate(dueDate) }); setTitle(''); setDue(''); onAdded(); });
  };
  return (
    <form class="row" onSubmit={add}>
      <input class="input" style="flex:1;min-width:200px" placeholder="Add a follow-up…" value={title} onInput={(e) => setTitle(e.target.value)} aria-label="New task" />
      <input class="input" style="width:170px" type="date" value={dueDate} onInput={(e) => setDue(e.target.value)} aria-label="Due date" />
      <button class="btn" disabled={busy || !title.trim()}>Add</button>
      {error && <div class="alert bad" style="width:100%">{error}</div>}
    </form>
  );
}

function TasksTab({ data, user, reload }) {
  const done = async (t, v) => { try { await api('PATCH', `/sales/tasks/${t.id}`, { done: v }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const open = data.tasks.filter((t) => !t.done_at);
  const closed = data.tasks.filter((t) => t.done_at);
  return (
    <section class="card">
      <NewTask clientId={data.client.id} onAdded={reload} user={user} />
      <div class="mt">
        {open.length ? open.map((t) => <TaskLine t={t} onDone={done} showClient={false} />) : <p class="muted">No open follow-ups.</p>}
        {closed.length > 0 && <details class="mt"><summary class="small muted" style="cursor:pointer">{closed.length} completed</summary>{closed.map((t) => <TaskLine t={t} onDone={done} showClient={false} />)}</details>}
      </div>
    </section>
  );
}

function NotesTab({ data, user, reload }) {
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);
  const { busy, error, run } = useAction();
  const add = () => run(async () => { await api('POST', `/clients/${data.client.id}/notes`, { body, visibility: shared ? 'shared' : 'internal' }); setBody(''); setShared(false); reload(); });
  const del = (n) => confirm('Delete this note?') && run(async () => { await api('DELETE', `/clients/${data.client.id}/notes/${n.id}`); reload(); });
  return (
    <div class="stack">
      <section class="card stack">
        <textarea class="textarea" placeholder="Add a note…" value={body} onInput={(e) => setBody(e.target.value)} aria-label="Note" />
        <div class="row between">
          <label class="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>Share with the client <span class="faint small">(otherwise internal only)</span></span></label>
          <button class="btn" disabled={busy || !body.trim()} onClick={add}>{shared ? 'Post to client' : 'Save internal note'}</button>
        </div>
        {error && <div class="alert bad">{error}</div>}
      </section>
      {data.notes.map((n) => (
        <section class="card">
          <div class="row between">
            <div class="row"><Avatar name={n.author || (n.id.startsWith('email-fail/') ? 'Portal alert' : '?')} /><div><strong>{n.author || (n.id.startsWith('email-fail/') ? 'Portal alert' : 'Former user')}</strong><div class="small muted">{dateTime(n.created_at)}</div></div></div>
            <div class="row"><span class={`badge ${n.visibility === 'shared' ? 'accent' : ''}`}><Icon name={n.visibility === 'shared' ? 'eye' : 'lock'} size={12} />{n.visibility === 'shared' ? 'Client can see' : 'Internal'}</span>
              {(user.role === 'admin' || n.author_id === user.id) && <button class="icon-btn" aria-label="Delete note" onClick={() => del(n)}><Icon name="trash" size={14} /></button>}</div>
          </div>
          <div class="mt" style="white-space:pre-wrap">{n.body}</div>
        </section>
      ))}
    </div>
  );
}

function AccessTab({ data, user, reload }) {
  const [f, setF] = useState(null);
  const [result, setResult] = useState(null);
  const { busy, error, run } = useAction();
  const invite = () => run(async () => {
    const r = await api('POST', '/users', { role: 'client', email: f.email, name: f.name, clientId: data.client.id });
    setResult(r);
    setF(null);
    reload();
  });
  const resend = (u) => run(async () => { setResult(await api('POST', `/users/${u.id}/invite`, {})); reload(); });
  const setOwner = (u, owner) => run(async () => { await api('PATCH', `/clients/${data.client.id}/members/${u.id}`, { owner }); reload(); });
  const state = (u) => u.status === 'active' ? ['Active', 'good'] : u.status === 'disabled' ? ['Disabled', ''] : u.invite_expires < Date.now() ? ['Invite expired', 'warn'] : u.invite_delivery === 'sent' ? ['Invite sent', 'info'] : ['Not delivered', 'warn'];
  return (
    <section class="card">
      <div class="card-head"><h2>Client portal logins</h2><button class="btn sm" onClick={() => setF({ name: '', email: '' })}><Icon name="plus" size={14} />Invite</button></div>
      <p class="muted small" style="margin-top:0">People at {data.client.name} who can sign in. They see only this business, shared notes and active services. Owners can invite and remove their own teammates from the Business page.</p>
      {data.logins.length ? data.logins.map((u) => {
        const [l, tone] = state(u);
        return (
          <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <Avatar name={u.name} />
            <div style="flex:1;min-width:0"><div style="font-weight:600">{u.name}</div><div class="small muted">{u.email}{u.last_login_at ? ` · last sign-in ${ago(u.last_login_at)}` : ''}</div></div>
            {u.is_owner ? <span class="badge accent">Owner</span> : null}
            <span class={`badge ${tone}`}>{l}</span>
            <button class="btn sm ghost" disabled={busy} onClick={() => setOwner(u, !u.is_owner)}>{u.is_owner ? 'Remove owner' : 'Make owner'}</button>
            {u.status === 'invited' && <button class="btn sm secondary" disabled={busy} onClick={() => resend(u)}>Resend</button>}
          </div>
        );
      }) : <p class="muted">No one from this business has portal access yet.</p>}
      {result && <InviteResult result={result} />}
      {error && <div class="alert bad mt">{error}</div>}
      {f && (
        <Dialog title="Invite to the client portal" onClose={() => setF(null)} footer={<><button class="btn ghost" onClick={() => setF(null)}>Cancel</button><button class="btn" disabled={busy || !f.email || !f.name} onClick={invite}>Send invitation</button></>}>
          <div class="stack">
            <Field label="Name"><input class="input" value={f.name} onInput={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email"><input class="input" type="email" value={f.email} onInput={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <p class="small muted">They’ll get an email with a one-time link (valid 24 hours) to create a password.</p>
          </div>
          {error && <div class="alert bad mt">{error}</div>}
        </Dialog>
      )}
    </section>
  );
}

export function InviteResult({ result }) {
  if (result.existing && !result.delivery) return <div class="alert good mt">They already had a portal login, so it now opens this business too. They sign in with their usual password.</div>;
  if (result.delivery === 'sent') return <div class="alert good mt">{result.resent ? 'They already had a login that was never set up, so a new setup link was emailed. ' : 'Invitation emailed. '}The link works once and expires in 24 hours. Ask them to check spam if it doesn’t arrive.</div>;
  return (
    <div class="alert warn mt">
      <strong>The email didn’t go out.</strong> {result.error}
      {result.manualLink && <><div class="small mt">Share this one-time link directly (expires in 24 hours):</div><div class="small" style="word-break:break-all">{result.manualLink}</div><div class="mt"><CopyButton text={result.manualLink} /></div></>}
    </div>
  );
}
