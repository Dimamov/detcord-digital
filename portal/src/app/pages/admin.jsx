import { useState } from 'preact/hooks';
import { useLoad, api, toast, money, dollars, ago, date, dateTime, query } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, Avatar, useAction } from '../ui.jsx';
import { InviteResult } from './clients.jsx';
import { SERVICE_CATEGORIES } from '../../shared/services.js';

const ROLE = { admin: 'Admin', rep: 'Sales rep', client: 'Client' };

function inviteBadge(u) {
  if (u.status === 'active') return <span class="badge good">Active</span>;
  if (u.status === 'disabled') return <span class="badge">Disabled</span>;
  const s = u.invite?.state;
  return <span class={`badge ${s === 'sent' ? 'info' : 'warn'}`}>{s === 'sent' ? 'Invite sent' : s === 'expired' ? 'Invite expired' : 'Invite not delivered'}</span>;
}

export function Team({ user }) {
  const { loading, data, error, reload } = useLoad('/users');
  const [filter, setFilter] = useState('staff');
  const [adding, setAdding] = useState(null);
  const [result, setResult] = useState(null);
  const [del, setDel] = useState(null);
  const act = useAction();
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const users = data.users.filter((u) => filter === 'staff' ? u.role !== 'client' : u.role === 'client');
  const invite = () => act.run(async () => { setResult(await api('POST', '/users', adding)); setAdding(null); reload(); });
  const resend = (u) => act.run(async () => { setResult({ ...(await api('POST', `/users/${u.id}/invite`, {})), name: u.name }); reload(); });
  const setStatus = (u, status) => act.run(async () => { await api('PATCH', `/users/${u.id}`, { status }); toast(status === 'disabled' ? `${u.name} disabled and signed out.` : `${u.name} re-enabled.`); reload(); });
  const remove = () => act.run(async () => { await api('DELETE', `/users/${del.id}`); toast(`${del.name}’s login was deleted.`); setDel(null); reload(); });
  return (
    <div class="page">
      <div class="page-head">
        <div><div class="eyebrow">Agency</div><h1>Team and logins</h1><p class="sub">Invite admins and sales reps. Client logins are invited from each client’s record.</p></div>
        <button class="btn" onClick={() => setAdding({ role: 'rep', name: '', email: '' })}><Icon name="plus" />Invite team member</button>
      </div>
      <div class="tabs"><button aria-selected={filter === 'staff'} onClick={() => setFilter('staff')}>Detcord team</button><button aria-selected={filter === 'client'} onClick={() => setFilter('client')}>Client logins</button></div>
      {result && <div class="mb"><InviteResult result={result} /></div>}
      {act.error && <div class="alert bad mb">{act.error}</div>}
      <div class="card table-wrap" style="padding:0">
        {users.length ? (
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>{filter === 'staff' ? 'Assigned clients' : 'Business'}</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr>
                  <td><div class="row" style="gap:10px"><Avatar name={u.name} /><div><strong>{u.name}</strong>{u.id === user.id && <span class="faint small"> (you)</span>}<div class="small muted">{u.email}</div></div></div></td>
                  <td>{ROLE[u.role]}</td>
                  <td>{inviteBadge(u)}<div class="faint small">{u.last_login_at ? `Signed in ${ago(u.last_login_at)}` : u.invite ? `Invited ${date(u.invite.sentAt)}` : ''}</div></td>
                  <td class="small">{u.role === 'admin' ? <span class="faint">All clients</span> : u.clients.length ? u.clients.map((c) => <div><a href={`/clients/${c.id}`}>{c.name}</a></div>) : <span class="faint">None</span>}</td>
                  <td style="text-align:right;white-space:nowrap">
                    {u.status === 'invited' && <button class="btn sm secondary" onClick={() => resend(u)} disabled={act.busy}>Resend invite</button>}
                    {u.id !== user.id && u.status === 'active' && <button class="btn sm ghost" onClick={() => setStatus(u, 'disabled')}>Disable</button>}
                    {u.status === 'disabled' && <button class="btn sm ghost" onClick={() => setStatus(u, 'active')}>Enable</button>}
                    {u.id !== user.id && <button class="icon-btn" aria-label={`Delete ${u.name}`} onClick={() => setDel(u)}><Icon name="trash" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title={filter === 'staff' ? 'No team members' : 'No client logins yet'}>{filter === 'client' && 'Open a client and use Portal access to invite them.'}</Empty>}
      </div>

      {adding && (
        <Dialog title="Invite a team member" onClose={() => setAdding(null)} footer={<><button class="btn ghost" onClick={() => setAdding(null)}>Cancel</button><button class="btn" disabled={act.busy || !adding.name || !adding.email} onClick={invite}>Send invitation</button></>}>
          <div class="stack">
            <Field label="Role">
              <select class="select" value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value })}>
                <option value="rep">Sales rep: sees only clients assigned to them</option>
                <option value="admin">Admin: full access to everything</option>
              </select>
            </Field>
            <Field label="Name"><input class="input" value={adding.name} onInput={(e) => setAdding({ ...adding, name: e.target.value })} /></Field>
            <Field label="Email"><input class="input" type="email" value={adding.email} onInput={(e) => setAdding({ ...adding, email: e.target.value })} /></Field>
            <p class="small muted">They’ll receive a one-time link (valid 24 hours) to create their password.</p>
          </div>
          {act.error && <div class="alert bad mt">{act.error}</div>}
        </Dialog>
      )}
      {del && (
        <Dialog title={`Delete ${del.name}’s login?`} onClose={() => setDel(null)} footer={<><button class="btn ghost" onClick={() => setDel(null)}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={remove}>Delete login</button></>}>
          <p style="margin-top:0">This signs them out everywhere and removes their access. Their email can be invited again later with fresh permissions.</p>
          <p class="muted small">Business records are kept: clients, deals, notes and history stay. {del.role === 'rep' && 'Their open tasks move to you and their deals become unowned.'}</p>
        </Dialog>
      )}
    </div>
  );
}

// ---------- Settings ----------
export function Settings() {
  const [tab, setTab] = useState(query().tab || 'services');
  return (
    <div class="page">
      <div class="page-head"><div><div class="eyebrow">Agency</div><h1>Settings</h1></div></div>
      <div class="tabs">
        {[['services', 'Services and prices'], ['pipeline', 'Pipeline stages'], ['commissions', 'Commission rules'], ['company', 'Company'], ['payments', 'Integrations']].map(([k, l]) => <button aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'company' && <CompanySettings />}
      {tab === 'payments' && <PaymentSettings />}
      {tab === 'services' && <ServicesSettings />}
      {tab === 'pipeline' && <StageSettings />}
      {tab === 'commissions' && <CommissionSettings />}
    </div>
  );
}

function ServicesSettings() {
  const { loading, data, error, reload } = useLoad('/services');
  const [edit, setEdit] = useState(null);
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const save = () => act.run(async () => {
    if (edit.id) await api('PUT', `/services/${edit.id}`, { name: edit.name, description: edit.description, setup: edit.setup, monthly: edit.monthly, active: edit.active });
    else await api('POST', '/services', edit);
    setEdit(null);
    toast('Service saved.');
    reload();
  });
  return (
    <div class="stack">
      <div class="alert info">Prices are blank until you set them. Blank prices show as “not set” on deals and proposals.</div>
      {SERVICE_CATEGORIES.map((cat) => {
        const list = data.services.filter((s) => s.category === cat.id);
        if (!list.length) return null;
        return (
          <section class="card" style="padding:0">
            <div style="padding:14px 18px 0"><h2>{cat.name}</h2></div>
            <div class="table-wrap"><table>
              <tbody>{list.map((s) => (
                <tr class="click" onClick={() => setEdit({ ...s, setup: dollars(s.setup_cents), monthly: dollars(s.monthly_cents), active: !!s.active })}>
                  <td><strong style={s.active ? '' : 'opacity:.5'}>{s.name}</strong><div class="small muted">{s.description}</div></td>
                  <td style="white-space:nowrap" class={s.setup_cents == null ? 'faint' : ''}>{s.setup_cents == null ? 'Setup not set' : `${money(s.setup_cents)} setup`}</td>
                  <td style="white-space:nowrap" class={s.monthly_cents == null ? 'faint' : ''}>{s.monthly_cents == null ? 'Monthly not set' : `${money(s.monthly_cents)}/mo`}</td>
                  <td>{!s.active && <span class="badge">Hidden</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        );
      })}
      <button class="btn secondary" onClick={() => setEdit({ name: '', description: '', setup: '', monthly: '', category: 'run', active: true })}><Icon name="plus" />Add a service</button>
      {edit && (
        <Dialog title={edit.id ? 'Edit service' : 'New service'} onClose={() => setEdit(null)} footer={<><button class="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button class="btn" disabled={act.busy} onClick={save}>Save</button></>}>
          <div class="form-grid">
            <Field label="Name"><input class="input" value={edit.name} onInput={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {!edit.id ? <Field label="Category"><select class="select" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{SERVICE_CATEGORIES.map((c) => <option value={c.id}>{c.name}</option>)}</select></Field> : <div />}
            <div class="full"><Field label="Description"><textarea class="textarea" value={edit.description || ''} onInput={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
            <Field label="Default setup price ($)"><input class="input" inputMode="decimal" value={edit.setup} onInput={(e) => setEdit({ ...edit, setup: e.target.value })} placeholder="Not set" /></Field>
            <Field label="Default monthly price ($)"><input class="input" inputMode="decimal" value={edit.monthly} onInput={(e) => setEdit({ ...edit, monthly: e.target.value })} placeholder="Not set" /></Field>
            {edit.id && <label class="check full"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Offer this service (unchecked hides it from new deals)</label>}
          </div>
          {act.error && <div class="alert bad mt">{act.error}</div>}
        </Dialog>
      )}
    </div>
  );
}

function StageSettings() {
  const { loading, data, error, reload } = useLoad('/sales/pipeline');
  const [stages, setStages] = useState(null);
  const [newName, setNewName] = useState('');
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const list = stages || data.stages;
  const edit = (i, k, v) => setStages(list.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const moveBy = (i, d) => { const l = [...list]; const [x] = l.splice(i, 1); l.splice(i + d, 0, x); setStages(l); };
  const save = () => act.run(async () => { await api('PUT', '/sales/stages', { stages: list.map(({ id, name, outcome }) => ({ id, name, outcome })) }); setStages(null); toast('Pipeline stages saved.'); reload(); });
  const add = () => act.run(async () => { await api('POST', '/sales/stages', { name: newName, outcome: 'open' }); setNewName(''); setStages(null); reload(); });
  const remove = (s) => act.run(async () => { await api('DELETE', `/sales/stages/${s.id}`); setStages(null); reload(); });
  return (
    <section class="card">
      {list.some((s) => s.provisional) && <div class="alert info mb">These are suggested starting stages, not an approved process. Rename, reorder or remove them, then save to make them official.</div>}
      {list.map((s, i) => (
        <div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <div class="row" style="gap:2px"><button class="icon-btn" disabled={i === 0} onClick={() => moveBy(i, -1)} aria-label="Move up">↑</button><button class="icon-btn" disabled={i === list.length - 1} onClick={() => moveBy(i, 1)} aria-label="Move down">↓</button></div>
          <input class="input" style="flex:1;min-width:160px" value={s.name} onInput={(e) => edit(i, 'name', e.target.value)} aria-label="Stage name" />
          <select class="select" style="width:140px" value={s.outcome} onChange={(e) => edit(i, 'outcome', e.target.value)} aria-label="Stage outcome"><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select>
          <button class="icon-btn" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <div class="row mt"><input class="input" style="flex:1" placeholder="New stage name" value={newName} onInput={(e) => setNewName(e.target.value)} /><button class="btn secondary" disabled={!newName.trim()} onClick={add}>Add stage</button></div>
      {act.error && <div class="alert bad mt">{act.error}</div>}
      <div class="row mt"><button class="btn" disabled={act.busy} onClick={save}>Save stages</button>{stages && <button class="btn ghost" onClick={() => setStages(null)}>Discard changes</button>}</div>
    </section>
  );
}

const TRIGGERS = { deal_won: 'When a deal is marked Won', contract_signed: 'When the contract is signed (coming with contracts)', invoice_paid: 'When an invoice is paid (coming with payments)' };

function CommissionSettings() {
  const { loading, data, error, reload } = useLoad('/sales/commission-rules');
  const team = useLoad('/team');
  const [edit, setEdit] = useState(null);
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const save = () => act.run(async () => {
    const body = { ...edit, repId: edit.rep_id || null };
    if (edit.id) await api('PUT', `/sales/commission-rules/${edit.id}`, body); else await api('POST', '/sales/commission-rules', body);
    setEdit(null);
    toast('Rule saved.');
    reload();
  });
  const remove = (r) => confirm(`Delete “${r.name}”?`) && act.run(async () => { await api('DELETE', `/sales/commission-rules/${r.id}`); reload(); });
  return (
    <div class="stack">
      <div class="alert warn">No commission rules have been approved yet. Calculations using a rule that isn’t marked approved are labeled “provisional” everywhere they appear.</div>
      <section class="card">
        {data.rules.length ? data.rules.map((r) => (
          <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="flex:1;min-width:0">
              <strong>{r.name}</strong> {r.approved ? <span class="badge good">Approved</span> : <span class="badge warn">Provisional</span>} {!r.active && <span class="badge">Off</span>}
              <div class="small muted">{(r.rate_bps / 100).toFixed(2)}% of {r.basis === 'setup' ? 'setup fees' : r.basis === 'monthly' ? `monthly fees for ${r.months || 1} month(s)` : `setup + ${r.months || 1} month(s) of monthly fees`} · {TRIGGERS[r.trigger].split(' (')[0].toLowerCase()} · {r.rep_name || 'all reps'}</div>
            </div>
            <button class="btn sm ghost" onClick={() => setEdit({ ...r, ratePercent: r.rate_bps / 100, active: !!r.active, approved: !!r.approved })}>Edit</button>
            <button class="icon-btn" onClick={() => remove(r)} aria-label="Delete rule"><Icon name="trash" size={14} /></button>
          </div>
        )) : <Empty title="No commission rules yet">Add a rule to start tracking what reps earn.</Empty>}
        <button class="btn secondary mt" onClick={() => setEdit({ name: '', basis: 'setup', ratePercent: '', months: '', trigger: 'deal_won', rep_id: '', active: true, approved: false })}><Icon name="plus" />Add rule</button>
      </section>
      {edit && (
        <Dialog title={edit.id ? 'Edit rule' : 'New commission rule'} onClose={() => setEdit(null)} footer={<><button class="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button class="btn" disabled={act.busy} onClick={save}>Save</button></>}>
          <div class="form-grid">
            <div class="full"><Field label="Rule name"><input class="input" value={edit.name} onInput={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. New business: 10% of setup" /></Field></div>
            <Field label="Rate (%)"><input class="input" inputMode="decimal" value={edit.ratePercent} onInput={(e) => setEdit({ ...edit, ratePercent: e.target.value })} /></Field>
            <Field label="Paid on"><select class="select" value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value })}><option value="setup">Setup fees</option><option value="monthly">Monthly fees</option><option value="both">Setup + monthly</option></select></Field>
            {edit.basis !== 'setup' && <Field label="Months of monthly fees"><input class="input" inputMode="numeric" value={edit.months ?? ''} onInput={(e) => setEdit({ ...edit, months: e.target.value })} placeholder="e.g. 3" /></Field>}
            <Field label="Earned"><select class="select" value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([k, v]) => <option value={k}>{v}</option>)}</select></Field>
            <Field label="Applies to"><select class="select" value={edit.rep_id || ''} onChange={(e) => setEdit({ ...edit, rep_id: e.target.value })}><option value="">All reps</option>{(team.data?.team || []).filter((t) => t.role === 'rep' || t.role === 'admin').map((t) => <option value={t.id}>{t.name}</option>)}</select></Field>
            <label class="check full"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Rule is on</label>
            <label class="check full"><input type="checkbox" checked={edit.approved} onChange={(e) => setEdit({ ...edit, approved: e.target.checked })} />Approved: this is the agreed rule (removes the “provisional” label)</label>
          </div>
          {act.error && <div class="alert bad mt">{act.error}</div>}
        </Dialog>
      )}
    </div>
  );
}

// ---------- Commissions report ----------
export function Commissions({ user }) {
  const [mine, setMine] = useState(false);
  const { loading, data, error, reload } = useLoad(`/sales/commissions${mine ? '?mine=1' : ''}`, [mine]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  return (
    <div class="page">
      <div class="page-head">
        <div><div class="eyebrow">Sales</div><h1>Commissions</h1><p class="sub">Calculated from won deals and the configured rules. Each line shows the rule and deal it came from.</p></div>
        <div class="row" style="align-items:stretch">
          {user.role === 'admin' && <select class="select" value={mine ? 'mine' : 'all'} onChange={(e) => setMine(e.target.value === 'mine')} aria-label="Whose commissions"><option value="all">Everyone</option><option value="mine">Only mine</option></select>}
          <div class="stat" style="min-width:200px"><div class="label">{user.role === 'rep' || mine ? 'Your total' : 'Total'}{data.anyProvisional ? ' (provisional)' : ''}</div><div class="value">{money(data.totalCents)}</div></div>
        </div>
      </div>
      {data.anyProvisional && <div class="alert warn mb">Some or all of these numbers use rules that haven’t been approved yet, so they’re estimates, not payouts.</div>}
      {data.notYetCalculated && <div class="alert info mb">{data.notYetCalculated}</div>}
      <div class="card table-wrap" style="padding:0">
        {data.lines.length ? (
          <table>
            <thead><tr><th>Deal</th>{user.role === 'admin' && <th>Rep</th>}<th>Rule</th><th>Base</th><th>Commission</th></tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr>
                <td><a href={`/clients/${l.clientId}?tab=deals`}><strong>{l.clientName}</strong></a><div class="small muted">Won {date(l.wonAt)}</div></td>
                {user.role === 'admin' && <td>{l.repName || <span class="faint">Unowned</span>}</td>}
                <td>{l.ruleName}<div class="small muted">{l.explanation}</div></td>
                <td>{money(l.baseCents)}</td>
                <td><strong>{money(l.amountCents)}</strong> {l.provisional && <span class="badge warn">Provisional</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty title="No commissions yet">{user.role === 'admin' ? 'Add rules in Settings, then mark deals Won.' : 'Commissions appear here when your deals are won.'}</Empty>}
      </div>
    </div>
  );
}

// Legal details printed on every agreement.
function CompanySettings() {
  const { loading, data, error, reload } = useLoad('/settings/company');
  const [form, setForm] = useState(null);
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const f = form || { legalName: '', address: '', signer: '', email: 'info@detcorddigital.com', ...data.company };
  const save = (e) => { e.preventDefault(); act.run(async () => { await api('PUT', '/settings/company', f); toast('Company details saved.'); reload(); }); };
  return (
    <form class="card stack" style="max-width:640px" onSubmit={save}>
      <p class="muted" style="margin:0">These appear in the Parties section of every agreement. Agreements can’t be sent until the legal name and address are filled in.</p>
      <Field label="Legal business name" help="as registered, e.g. Detcord Digital LLC"><input class="input" value={f.legalName} onInput={(e) => setForm({ ...f, legalName: e.target.value })} /></Field>
      <Field label="Business address"><input class="input" value={f.address} onInput={(e) => setForm({ ...f, address: e.target.value })} /></Field>
      <Field label="Default signer for Detcord" help="name and title"><input class="input" value={f.signer} onInput={(e) => setForm({ ...f, signer: e.target.value })} /></Field>
      <Field label="Notice email"><input class="input" type="email" value={f.email} onInput={(e) => setForm({ ...f, email: e.target.value })} /></Field>
      <Field label="Phone for customers" help="shown on website check reports"><input class="input" type="tel" value={f.phone || ''} onInput={(e) => setForm({ ...f, phone: e.target.value })} /></Field>
      {act.error && <div class="alert bad">{act.error}</div>}
      <div><button class="btn" disabled={act.busy}>Save</button></div>
    </form>
  );
}

// Clover status. "Connected" only after a real test call succeeded.
function PaymentSettings() {
  const { loading, data, error, reload } = useLoad('/settings/integrations');
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const c = data.clover;
  const label = { not_configured: ['Not set up', 'bad'], untested: ['Set up, not tested', 'warn'], failing: ['Test failed', 'bad'], connected: ['Connected', 'good'] }[c.state];
  const test = () => act.run(async () => {
    try { await api('POST', '/settings/integrations/clover/test'); toast('Clover answered. Payments are connected.'); } finally { reload(); }
  });
  return (
    <div class="stack" style="max-width:720px">
      <section class="card">
        <div class="row between"><h2 style="margin:0">Clover online payments</h2><span class={`badge ${label[1]}`}>{label[0]}</span></div>
        <p class="muted">Clients pay invoices on Clover’s secure checkout page. An invoice is marked paid only when Clover’s signed confirmation reaches the portal, never from a button click.</p>
        <dl class="kv">
          <dt>Mode</dt><dd>{c.sandbox ? 'Sandbox (test cards, no real charges)' : 'Live'}</dd>
          {c.missing.length > 0 && <><dt>Missing</dt><dd>{c.missing.join(', ')}<div class="small muted">Bob adds these as Worker secrets (setup Task 4).</div></dd></>}
          <dt>Last test</dt><dd>{c.lastTest ? `${c.lastTest.ok ? 'Passed' : 'Failed'} ${dateTime(c.lastTest.at)} by ${c.lastTest.by}${c.lastTest.error ? `: ${c.lastTest.error}` : ''}` : 'Never'}</dd>
          <dt>Last confirmation</dt><dd>{c.lastWebhook ? `${dateTime(c.lastWebhook.at)} (${c.lastWebhook.status || 'event'})` : 'None received yet'}</dd>
          <dt>Webhook URL</dt><dd style="font-family:monospace;font-size:13px">{location.origin}/api/webhooks/clover</dd>
        </dl>
        {act.error && <div class="alert bad mt">{act.error}</div>}
        <div class="row mt">
          <button class="btn" onClick={test} disabled={!c.configured || act.busy}>Test connection</button>
          <span class="small muted">Creates a $1 checkout page to prove the credentials work. Nothing is charged.</span>
        </div>
      </section>
      <IntegrationCard title="Text messages (Twilio)" item={data.twilio} task="Task 5" path="twilio"
        about="Sends website check reports by text, and later powers GOAT Command. Connected only after the test below passes."
        okText={(t) => `${t.trial ? 'Trial account. ' : ''}Sending from ${t.from}.`} testNote="Checks the API key and the sending number. No text is sent." />
      <IntegrationCard title="Google speed test and Business Profile" item={data.google} task="Task 10" path="google"
        about="Website checks use Google PageSpeed and Google Places. Without a key, the speed test runs only when Google's shared limit allows, and the Google profile check is skipped."
        okText={() => 'PageSpeed and Places both answered.'} testNote="Runs one speed test and one Places search." />
      <GoatIntegrations />
      <section class="card">
        <div class="row between"><h2 style="margin:0">Email</h2><span class={`badge ${data.email.configured ? 'good' : 'bad'}`}>{data.email.configured ? 'Set up' : 'Not set up'}</span></div>
        <p class="muted" style="margin-bottom:0">{data.email.configured ? 'Invites, receipts and agreement notices are emailed from info@detcorddigital.com.' : 'Without email, invite links are shown to you to share by hand, and receipts are not sent. Bob sets this up in Task 2.'}</p>
      </section>
    </div>
  );
}

// GOAT Command: Claude drafts plans; requests arrive by email and text.
function GoatIntegrations() {
  const { data } = useLoad('/settings/integrations/goat');
  if (!data) return null;
  const claude = { ...data.claude, missing: data.claude.configured ? [] : ['ANTHROPIC_API_KEY'] };
  const inbound = (x) => STATE[x.state] || STATE.untested;
  return (
    <>
      <IntegrationCard title="Claude (GOAT plans)" item={claude} task="Task 6" path="claude"
        about="Drafts a plan for each GOAT request so the client can approve it. Without it, your team writes every plan by hand."
        okText={(t) => `Sample plan: “${t.sample}”`} testNote="Drafts one sample plan. Nothing is sent to anyone." />
      <IntegrationCard title="Deepgram (meeting transcripts)" item={{ ...data.deepgram, missing: data.deepgram.configured ? [] : ['DEEPGRAM_API_KEY'] }} task="Task 6" path="deepgram"
        about="Turns recorded sales meetings into transcripts with speakers, so Claude can draft CRM notes. Without it, recordings are kept but not transcribed."
        okText={() => 'Deepgram accepted the key.'} testNote="Checks the key with Deepgram. No audio is sent." />
      <section class="card">
        <h2>GOAT requests by email and text</h2>
        <dl class="kv">
          <dt>Email</dt><dd><span class={`badge ${inbound(data.email)[1]}`}>{data.email.state === 'connected' ? 'Receiving' : 'Nothing received yet'}</span>{data.email.lastReceived && <div class="small muted">Last email {dateTime(data.email.lastReceived.at)}</div>}<div class="small muted">Bob routes goat@ to the portal in Task 7. It shows as receiving after the first real email arrives.</div></dd>
          <dt>Text</dt><dd><span class={`badge ${inbound(data.sms)[1]}`}>{data.sms.state === 'connected' ? 'Receiving' : data.sms.state === 'not_configured' ? 'Not set up' : 'Nothing received yet'}</span>{data.sms.lastReceived && <div class="small muted">Last text {dateTime(data.sms.lastReceived.at)}</div>}<div class="small muted">Needs TWILIO_AUTH_TOKEN and this incoming-message webhook on the Twilio number: <span style="font-family:monospace">{data.sms.webhook}</span></div></dd>
        </dl>
      </section>
    </>
  );
}

const STATE = { not_configured: ['Not set up', 'bad'], untested: ['Set up, not tested', 'warn'], failing: ['Test failed', 'bad'], connected: ['Connected', 'good'] };

function IntegrationCard({ title, item, task, path, about, okText, testNote }) {
  const [t, setT] = useState(item);
  const act = useAction();
  const label = STATE[t.state];
  const test = () => act.run(async () => {
    try {
      const r = await api('POST', `/settings/integrations/${path}/test`);
      setT({ ...t, state: 'connected', lastTest: r });
      toast(`${title.split(' (')[0]} connected.`);
    } catch (e) {
      setT({ ...t, state: 'failing', lastTest: { ok: false, error: e.data?.error || e.message, at: Date.now() } });
      throw e;
    }
  });
  const last = t.lastTest;
  return (
    <section class="card">
      <div class="row between"><h2 style="margin:0">{title}</h2><span class={`badge ${label[1]}`}>{label[0]}</span></div>
      <p class="muted">{about}</p>
      <dl class="kv">
        {t.missing?.length > 0 && <><dt>Missing</dt><dd>{t.missing.join(', ')}<div class="small muted">Bob adds these as Worker secrets ({task}).</div></dd></>}
        {!t.configured && !t.missing && <><dt>Missing</dt><dd>GOOGLE_API_KEY<div class="small muted">Bob adds this as a Worker secret ({task}).</div></dd></>}
        <dt>Last test</dt><dd>{last ? `${last.ok ? 'Passed' : 'Failed'} ${dateTime(last.at)}${last.by ? ` by ${last.by}` : ''}${last.ok ? `. ${okText(last)}` : last.error ? `: ${last.error}` : ''}${!last.ok && typeof last.pagespeed === 'string' ? ` ${last.pagespeed}` : ''}${!last.ok && typeof last.places === 'string' ? ` ${last.places}` : ''}` : 'Never'}</dd>
      </dl>
      {act.error && <div class="alert bad mt">{act.error}</div>}
      <div class="row mt">
        <button class="btn" onClick={test} disabled={!t.configured || act.busy}>{act.busy ? 'Testing…' : 'Test connection'}</button>
        <span class="small muted">{testNote}</span>
      </div>
    </section>
  );
}
