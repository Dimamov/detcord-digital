import { useState, useEffect, useRef } from 'preact/hooks';
import { useLoad, api, toast, money, dollars, date, dateTime, navigate } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, useAction } from '../ui.jsx';
import { FilePicker } from './files.jsx';
import { contractTotals, SIGNING_STATEMENT } from '../../shared/contract.js';

const STATUS = { draft: ['Draft', ''], sent: ['Awaiting signature', 'warn'], signed: ['Signed', 'good'], void: ['Voided', 'bad'] };
export const ContractBadge = ({ status }) => <span class={`badge ${STATUS[status]?.[1] || ''}`}>{STATUS[status]?.[0] || status}</span>;

// Client record tab: list of agreements plus "New agreement".
export function ContractsTab({ clientId, user }) {
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/contracts`, [clientId]);
  const create = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const start = () => create.run(async () => { const { id } = await api('POST', `/clients/${clientId}/contracts`, {}); navigate(`/contracts/${id}`); });
  return (
    <section class="card">
      <div class="row between mb"><h2 style="margin:0">Agreements</h2>{user.role !== 'client' && <button class="btn" onClick={start} disabled={create.busy}><Icon name="plus" />New agreement</button>}</div>
      {create.error && <div class="alert bad mb">{create.error}</div>}
      {!data.contracts.length ? <Empty title="No agreements yet">{user.role !== 'client' ? 'Start one: services, prices and recommended scope are filled in from the discovery.' : 'Agreements from Detcord appear here when they are ready to sign.'}</Empty> : (
        <div class="list">
          {data.contracts.map((ct) => (
            <a class="list-item" href={`/contracts/${ct.id}`}>
              <Icon name="doc" />
              <div style="flex:1;min-width:0">
                <div class="title">{ct.title}</div>
                <div class="meta">{ct.number} · v{ct.version} · {ct.signed_at ? `signed ${date(ct.signed_at)} by ${ct.signer_name}` : ct.issued_at ? `sent ${date(ct.issued_at)}` : `updated ${date(ct.updated_at)}`}</div>
              </div>
              <div style="text-align:right" class="small">
                <div>{money(ct.totals.setup)} one-time</div>
                <div class="muted">{money(ct.totals.monthly)}/mo</div>
              </div>
              <ContractBadge status={ct.status} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContractPage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/contracts/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (user.role === 'client') return <ClientContract data={data} reload={reload} />;
  if (data.contract.status === 'draft') return <ContractEditor data={data} user={user} reload={reload} />;
  return <StaffContractView data={data} user={user} reload={reload} />;
}

function DocFrame({ id, version, tall = false }) {
  return <iframe class="doc-frame" style={tall ? 'height:78vh' : ''} title="Agreement document" src={`/api/contracts/${id}/document?v=${version}-${Date.now()}`} />;
}

function Head({ contract, client, children }) {
  return (
    <div class="page-head">
      <div>
        <a class="small muted" href={`/clients/${client.id}?tab=contracts`}>← {client.name}</a>
        <h1>{contract.title}</h1>
        <div class="row mt" style="gap:8px"><ContractBadge status={contract.status} /><span class="faint small">{contract.number} · version {contract.version}</span></div>
      </div>
      <div class="row">{children}</div>
    </div>
  );
}

// ---- staff editor ------------------------------------------------------------

function toForm(ct) {
  const d = ct.data;
  return {
    title: ct.title,
    services: d.services.map((s) => ({ serviceId: s.serviceId, name: s.name, setup: dollars(s.setupCents), monthly: dollars(s.monthlyCents), scope: s.scope || '' })),
    deposit: dollars(d.depositCents), monthlyStart: d.monthlyStart || '', paymentDays: d.paymentDays ?? 15, feedbackDays: d.feedbackDays ?? 10,
    paymentTerms: d.paymentTerms || '', thirdParty: d.thirdParty || '', additional: d.additional || '',
    providerSigner: d.providerSigner || '', clientLegalName: d.clientLegalName || '', clientAddress: d.clientAddress || '', clientEmail: d.clientEmail || '',
    attachments: d.attachments || [],
  };
}
const centsOf = (v) => (v === '' || v == null || Number.isNaN(Number(String(v).replace(/[$,]/g, ''))) ? null : Math.round(Number(String(v).replace(/[$,]/g, '')) * 100));

function ContractEditor({ data, user, reload }) {
  const { contract, client } = data;
  const [form, setForm] = useState(() => toForm(contract));
  const [saved, setSaved] = useState(contract);
  const [state, setState] = useState('saved');
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [problems, setProblems] = useState(null);
  const catalog = useLoad('/services');
  const timer = useRef();
  const send = useAction();

  const save = async (f) => {
    setState('saving');
    try {
      const body = { ...f, attachments: f.attachments.map((a) => a.id), services: f.services.map(({ serviceId, setup, monthly, scope }) => ({ serviceId, setup, monthly, scope })) };
      const res = await api('PATCH', `/contracts/${contract.id}`, body);
      setSaved(res.contract);
      setState('saved');
    } catch (e) { setState('error'); toast(e.message, 'bad'); }
  };
  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    setState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const setService = (i, patch) => update({ services: form.services.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const totals = contractTotals({ services: form.services.map((s) => ({ setupCents: centsOf(s.setup), monthlyCents: centsOf(s.monthly) })), depositCents: centsOf(form.deposit) });
  const available = (catalog.data?.services || []).filter((s) => s.active && !form.services.some((x) => x.serviceId === s.id));

  const doSend = () => send.run(async () => {
    clearTimeout(timer.current);
    await save(form);
    try {
      const res = await api('POST', `/contracts/${contract.id}/send`);
      toast(res.noLogins ? 'Sent. This client has no portal login yet: invite them from Portal access so they can sign.' : 'Sent for signature. The client was emailed.');
      reload();
    } catch (e) {
      if (e.data?.problems) { setProblems(e.data.problems); throw new Error('A few details are missing before this can be sent.'); }
      throw e;
    }
  });
  const remove = async () => {
    if (!confirm('Delete this draft agreement?')) return;
    try { await api('DELETE', `/contracts/${contract.id}`); navigate(`/clients/${client.id}?tab=contracts`); } catch (e) { toast(e.message, 'bad'); }
  };
  const blocking = problems || saved.problems;

  return (
    <div class="page" style="max-width:1200px">
      <Head contract={saved} client={client}>
        <span class="small faint">{{ saved: 'All changes saved', saving: 'Saving…', pending: 'Editing…', error: 'Not saved' }[state]}</span>
        <button class="btn secondary" onClick={() => { clearTimeout(timer.current); save(form).then(() => setPreview(true)); }}><Icon name="eye" />Preview</button>
        <button class="btn" onClick={doSend} disabled={send.busy}><Icon name="pen" />Send for signature</button>
      </Head>
      {send.error && <div class="alert bad mb">{send.error}</div>}
      <div class="grid main-side">
        <div class="stack">
          <section class="card">
            <Field label="Agreement title"><input class="input" value={form.title} onInput={(e) => update({ title: e.target.value })} /></Field>
          </section>
          <section class="card">
            <h2>Services, prices and scope</h2>
            <p class="small muted" style="margin-top:-6px">Enter 0 where a service has no one-time or monthly charge. Scope is what the client is buying: deliverables, quantities, cadence.</p>
            {form.services.map((s, i) => (
              <div class="svc-row">
                <div class="row between"><strong>{s.name}</strong><button class="icon-btn" onClick={() => update({ services: form.services.filter((_, k) => k !== i) })} aria-label={`Remove ${s.name}`}><Icon name="trash" size={16} /></button></div>
                {saved.reviewServices?.includes(s.name) && <div class="small" style="color:var(--warn)">New service wording: have it reviewed by counsel before relying on it.</div>}
                <div class="form-grid mt" style="margin-top:8px">
                  <Field label="One-time ($)"><input class="input" inputMode="decimal" value={s.setup} onInput={(e) => setService(i, { setup: e.target.value })} placeholder="0" /></Field>
                  <Field label="Monthly ($)"><input class="input" inputMode="decimal" value={s.monthly} onInput={(e) => setService(i, { monthly: e.target.value })} placeholder="0" /></Field>
                  <div class="full"><Field label="Scope"><textarea class="textarea" value={s.scope} onInput={(e) => setService(i, { scope: e.target.value })} placeholder="e.g. 10 service-area pages, monthly technical fixes, 2 blog posts per month, monthly report" /></Field></div>
                </div>
              </div>
            ))}
            {available.length > 0 && (
              <select class="select mt" value="" onChange={(e) => { const s = available.find((x) => x.id === e.target.value); if (s) update({ services: [...form.services, { serviceId: s.id, name: s.name, setup: dollars(s.setup_cents), monthly: dollars(s.monthly_cents), scope: '' }] }); }}>
                <option value="">+ Add a service…</option>
                {available.map((s) => <option value={s.id}>{s.name}</option>)}
              </select>
            )}
          </section>
          <section class="card">
            <h2>Payment</h2>
            <div class="form-grid">
              <Field label="Deposit at signing ($)" help="credited against one-time fees"><input class="input" inputMode="decimal" value={form.deposit} onInput={(e) => update({ deposit: e.target.value })} placeholder="0" /></Field>
              <Field label="Monthly billing starts"><input class="input" type="date" value={form.monthlyStart} onInput={(e) => update({ monthlyStart: e.target.value })} /></Field>
              <Field label="Invoices due (days)"><input class="input" type="number" min="0" max="90" value={form.paymentDays} onInput={(e) => update({ paymentDays: e.target.value })} /></Field>
              <Field label="Client feedback period (business days)"><input class="input" type="number" min="1" max="30" value={form.feedbackDays} onInput={(e) => update({ feedbackDays: e.target.value })} /></Field>
              <div class="full"><Field label="Payment schedule and milestones" help="leave blank for: deposit at signing, rest on completion, monthly in advance"><textarea class="textarea" value={form.paymentTerms} onInput={(e) => update({ paymentTerms: e.target.value })} /></Field></div>
              <div class="full"><Field label="Ad budget and third-party costs" help="leave blank: not included, need written approval"><input class="input" value={form.thirdParty} onInput={(e) => update({ thirdParty: e.target.value })} /></Field></div>
            </div>
          </section>
          <section class="card">
            <h2>Parties</h2>
            <div class="form-grid">
              <Field label="Client legal name"><input class="input" value={form.clientLegalName} onInput={(e) => update({ clientLegalName: e.target.value })} /></Field>
              <Field label="Client notice email"><input class="input" type="email" value={form.clientEmail} onInput={(e) => update({ clientEmail: e.target.value })} /></Field>
              <div class="full"><Field label="Client address"><input class="input" value={form.clientAddress} onInput={(e) => update({ clientAddress: e.target.value })} /></Field></div>
              <Field label="Signs for Detcord"><input class="input" value={form.providerSigner} onInput={(e) => update({ providerSigner: e.target.value })} /></Field>
              <div class="small muted" style="align-self:end">Detcord’s legal name and address come from Settings → Company.</div>
            </div>
          </section>
          <section class="card">
            <h2>Additional scope and exceptions</h2>
            <textarea class="textarea" style="min-height:120px" value={form.additional} onInput={(e) => update({ additional: e.target.value })} placeholder="Anything agreed that changes the standard terms. Name the section it changes." />
            <div class="row between mt"><strong>Attached materials</strong><button class="btn sm secondary" onClick={() => setPicker(true)}><Icon name="image" />Attach files</button></div>
            {form.attachments.length ? <div class="row mt" style="gap:8px">{form.attachments.map((a) => <span class="badge">{a.filename} <button class="linkish" onClick={() => update({ attachments: form.attachments.filter((x) => x.id !== a.id) })} aria-label={`Remove ${a.filename}`}>×</button></span>)}</div>
              : <p class="small muted">Logos, photos or materials the work relies on. Optional.</p>}
          </section>
        </div>
        <aside class="stack" style="position:sticky;top:16px">
          <section class="card">
            <h3>Totals</h3>
            <dl class="kv">
              <dt>One-time</dt><dd>{money(totals.setup)}</dd>
              <dt>Monthly</dt><dd>{money(totals.monthly)}/mo</dd>
              <dt>Deposit</dt><dd>{money(totals.deposit)}</dd>
              <dt>Balance after deposit</dt><dd>{money(totals.setupAfterDeposit)}</dd>
              <dt>First-year value</dt><dd><strong>{money(totals.setup + totals.monthly * 12)}</strong></dd>
            </dl>
          </section>
          <section class="card">
            <h3>{blocking?.length ? 'Before you send' : 'Ready to send'}</h3>
            {blocking?.length ? <ul class="small" style="margin:0;padding-left:18px">{blocking.map((p) => <li>{p}</li>)}</ul>
              : <p class="small muted" style="margin:0">Sending signs for Detcord, freezes this version and emails the client a link to review and sign.</p>}
          </section>
          {saved.reviewServices?.length > 0 && <div class="alert warn small">Legal review: the wording for {saved.reviewServices.join(', ')} is new and has not been reviewed by counsel yet.</div>}
          <div class="alert info small">The general terms are Detcord’s existing Michigan agreement language. Generated agreements are not a substitute for legal advice.</div>
          <button class="btn ghost sm" onClick={remove}><Icon name="trash" />Delete draft</button>
        </aside>
      </div>
      {preview && <Dialog title="Preview" onClose={() => setPreview(false)} footer={<a class="btn secondary" href={`/api/contracts/${contract.id}/document?download=1`}><Icon name="download" />Download</a>}><DocFrame id={contract.id} version={saved.version} tall /></Dialog>}
      {picker && <FilePicker clientId={client.id} user={user} picked={form.attachments} onChange={(attachments) => update({ attachments })} onClose={() => setPicker(false)} />}
    </div>
  );
}

// ---- staff: sent / signed / void ---------------------------------------------

function StaffContractView({ data, user, reload }) {
  const { contract, client } = data;
  const act = useAction();
  const withdraw = () => {
    if (!confirm('Edit this agreement? The client will no longer be able to sign the current version until you send it again.')) return;
    act.run(async () => { await api('PATCH', `/contracts/${contract.id}`, {}); reload(); });
  };
  const voidIt = () => {
    const reason = prompt('Why is this agreement being voided?');
    if (!reason) return;
    act.run(async () => { await api('POST', `/contracts/${contract.id}/void`, { reason }); toast('Agreement voided.'); reload(); });
  };
  const monthly = () => act.run(async () => {
    const { id } = await api('POST', `/clients/${client.id}/invoices`, { monthlyFromContract: contract.id });
    navigate(`/invoices/${id}`);
  });
  return (
    <div class="page" style="max-width:1200px">
      <Head contract={contract} client={client}>
        <a class="btn secondary" href={`/api/contracts/${contract.id}/document?download=1`}><Icon name="download" />Download</a>
        {contract.status === 'sent' && <button class="btn secondary" onClick={withdraw} disabled={act.busy}><Icon name="pen" />Edit</button>}
        {contract.status === 'signed' && contract.totals.monthly > 0 && <button class="btn" onClick={monthly} disabled={act.busy}><Icon name="plus" />Monthly invoice</button>}
        {user.role === 'admin' && contract.status !== 'void' && <button class="btn ghost" onClick={voidIt} disabled={act.busy}>Void</button>}
      </Head>
      {act.error && <div class="alert bad mb">{act.error}</div>}
      <div class="grid main-side">
        <DocFrame id={contract.id} version={contract.version} tall />
        <aside class="stack">
          <section class="card">
            <h3>Record</h3>
            <dl class="kv">
              <dt>Sent</dt><dd>{dateTime(contract.issued_at) || '—'}</dd>
              {contract.signed_at && <><dt>Signed</dt><dd>{dateTime(contract.signed_at)}</dd><dt>Signer</dt><dd>{contract.signer_name}, {contract.signer_title}<div class="small muted">{contract.signer_email}</div></dd></>}
              {contract.voided_at && <><dt>Voided</dt><dd>{dateTime(contract.voided_at)}<div class="small muted">{contract.void_reason}</div></dd></>}
              <dt>Document hash</dt><dd class="small" style="font-family:monospace">{contract.document_hash?.slice(0, 16)}…</dd>
            </dl>
          </section>
          <section class="card">
            <h3>Totals</h3>
            <dl class="kv"><dt>One-time</dt><dd>{money(contract.totals.setup)}</dd><dt>Monthly</dt><dd>{money(contract.totals.monthly)}/mo</dd><dt>Deposit</dt><dd>{money(contract.totals.deposit)}</dd></dl>
          </section>
          {contract.status === 'sent' && <div class="alert info small">Waiting for the client to sign in their portal. Editing withdraws this version.</div>}
          {contract.status === 'signed' && <div class="alert good small">Locked. Services were activated and invoices created. <a href={`/clients/${client.id}?tab=billing`}>See billing</a>.</div>}
        </aside>
      </div>
    </div>
  );
}

// ---- client: review and sign ---------------------------------------------------

function ClientContract({ data, reload }) {
  const { contract, client } = data;
  const [form, setForm] = useState({ name: '', title: '', password: '', consent: false });
  const act = useAction();
  const [done, setDone] = useState(null);
  const sign = (e) => {
    e.preventDefault();
    act.run(async () => {
      const res = await api('POST', `/contracts/${contract.id}/sign`, { ...form, documentHash: contract.document_hash });
      setDone(res);
      reload();
    });
  };
  return (
    <div class="page" style="max-width:1200px">
      <div class="page-head">
        <div>
          <a class="small muted" href="/">← Home</a>
          <h1>{contract.title}</h1>
          <div class="row mt" style="gap:8px"><ContractBadge status={contract.status} /><span class="faint small">{contract.number}</span></div>
        </div>
        <a class="btn secondary" href={`/api/contracts/${contract.id}/document?download=1`}><Icon name="download" />Download a copy</a>
      </div>
      <div class="grid main-side">
        <DocFrame id={contract.id} version={contract.version} tall />
        <aside class="stack">
          {contract.status === 'sent' && !done && (
            <form class="card stack" onSubmit={sign}>
              <h2 style="margin:0">Sign this agreement</h2>
              <p class="small muted" style="margin:0">Read the full agreement first. You can download a copy, or ask for a paper version at info@detcorddigital.com.</p>
              <Field label="Your full name"><input class="input" required value={form.name} onInput={(e) => setForm({ ...form, name: e.target.value })} autocomplete="name" /></Field>
              <Field label="Your title" help={`at ${client.name}`}><input class="input" required value={form.title} onInput={(e) => setForm({ ...form, title: e.target.value })} placeholder="Owner" /></Field>
              <Field label="Your portal password" help="confirms it’s you"><input class="input" type="password" required value={form.password} onInput={(e) => setForm({ ...form, password: e.target.value })} autocomplete="current-password" /></Field>
              <label class="check small"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} required />{SIGNING_STATEMENT}</label>
              {act.error && <div class="alert bad">{act.error}</div>}
              <button class="btn block" disabled={act.busy || !form.consent}><Icon name="pen" />Sign agreement</button>
              <p class="small faint" style="margin:0">Your typed name, account, time and a fingerprint of this exact document are recorded.</p>
            </form>
          )}
          {(done || contract.status === 'signed') && (
            <section class="card">
              <h2 style="margin-top:0">Signed. Thank you!</h2>
              <p class="muted">{contract.signer_name ? `Signed by ${contract.signer_name} on ${dateTime(contract.signed_at)}.` : 'Your signature was recorded.'} A copy stays here in your portal.</p>
              {(done?.invoices?.length > 0) && <a class="btn block" href="/invoices"><Icon name="card" />View your deposit invoice</a>}
            </section>
          )}
          {contract.status === 'void' && <div class="alert warn">This agreement was voided by Detcord and is kept here for your records.</div>}
        </aside>
      </div>
    </div>
  );
}
