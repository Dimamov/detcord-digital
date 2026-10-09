import { useState, useEffect, useRef } from 'preact/hooks';
import { useLoad, api, toast, money, dollars, date, dateTime, navigate } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, useAction } from '../ui.jsx';
import { FilePicker } from './files.jsx';
import {
  contractTotals, signingStatementFor, termsVersionOf, TERMS_V1, TERMS_2026_10, TERMS_VERSIONS, TERM_MONTHS, EARLY_TERMINATION, DEFAULT_EARLY_TERMINATION,
} from '../../shared/contract.js';

const STATUS = { draft: ['Draft', ''], sent: ['Awaiting signature', 'warn'], signed: ['Signed', 'good'], void: ['Voided', 'bad'] };
export const ContractBadge = ({ status }) => <span class={`badge ${STATUS[status]?.[1] || ''}`}>{STATUS[status]?.[0] || status}</span>;

// Client record tab: list of agreements plus "New agreement".
export function ContractsTab({ clientId, user }) {
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/contracts`, [clientId]);
  const [starting, setStarting] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <section class="card">
      <div class="row between mb"><h2 style="margin:0">Agreements</h2>{user.role !== 'client' && <button class="btn" onClick={() => setStarting(true)}><Icon name="plus" />New agreement</button>}</div>
      {starting && <NewAgreement clientId={clientId} onClose={() => setStarting(false)} />}
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
                <div class="muted">{money(ct.totals.monthlyNet ?? ct.totals.monthly)}/mo{ct.totals.termMonths ? ` · ${ct.totals.termMonths} mo term` : ''}</div>
              </div>
              {user.role !== 'client' && ct.status === 'sent' && ct.change_requests > 0 && <span class="badge bad">Changes requested</span>}
              <ContractBadge status={ct.status} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// Choose where a new draft starts. Parties always come from the client record.
function NewAgreement({ clientId, onClose }) {
  const [from, setFrom] = useState('services');
  const [templateId, setTemplateId] = useState('');
  const templates = useLoad('/contract-templates');
  const create = useAction();
  const list = templates.data?.templates || [];
  const start = () => create.run(async () => {
    const { id } = await api('POST', `/clients/${clientId}/contracts`, { from, templateId: from === 'template' ? templateId : undefined });
    navigate(`/contracts/${id}`);
  });
  const option = (value, title, help) => (
    <label class="check"><input type="radio" name="from" checked={from === value} onChange={() => setFrom(value)} /><span><strong>{title}</strong><div class="small muted">{help}</div></span></label>
  );
  return (
    <Dialog title="New agreement" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={create.busy || (from === 'template' && !templateId)} onClick={start}>Start draft</button></>}>
      <div class="stack">
        {option('services', 'From this client’s services', 'Services and prices chosen in the discovery and on the client record.')}
        {option('template', 'From a template', 'A package set up in Settings: services, prices, scope and payment terms.')}
        {from === 'template' && (
          templates.loading ? <Loading /> : list.length ? (
            <select class="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
              <option value="">Choose a template…</option>
              {list.map((t) => <option value={t.id}>{t.name} · {money(t.totals.setup)} one-time, {money(t.totals.monthlyNet ?? t.totals.monthly)}/mo{t.totals.termMonths ? `, ${t.totals.termMonths} mo term` : ''}</option>)}
            </select>
          ) : <p class="small muted" style="margin:0">No templates yet. Admins add them in Settings → Agreement templates.</p>
        )}
        {option('blank', 'Blank agreement', 'No services or prices. Add everything by hand.')}
        <p class="small faint" style="margin:0">Client name, address and notice email are filled in from the client record either way.</p>
      </div>
      {create.error && <div class="alert bad mt">{create.error}</div>}
    </Dialog>
  );
}

export function ContractPage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/contracts/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (user.role === 'client') return <ClientContract data={data} reload={reload} />;
  if (data.contract.status === 'draft') return <ContractEditor key={data.contract.id} data={data} user={user} reload={reload} />;
  return <StaffContractView key={data.contract.id} data={data} user={user} reload={reload} />;
}

// Any agreement staff can see can be copied into a new draft. Signatures and frozen documents never carry over.
async function duplicateContract(contract) {
  const { id, number } = await api('POST', `/contracts/${contract.id}/duplicate`);
  toast(`New draft ${number} created from ${contract.number}.`);
  navigate(`/contracts/${id}`);
}

const termLabel = (m) => (Number(m) ? `${m} months` : 'Month to month');

// Totals rows shared by the editor and the sent view. Fixed terms show the discount and the value for the term.
function TotalsList({ totals }) {
  return (
    <dl class="kv">
      <dt>One-time</dt><dd>{money(totals.setup)}</dd>
      <dt>Monthly</dt><dd>{money(totals.monthly)}/mo</dd>
      {totals.monthlyDiscount > 0 && <><dt>Term discount ({totals.discountPct}%)</dt><dd>−{money(totals.monthlyDiscount)}/mo</dd><dt>Monthly after discount</dt><dd>{money(totals.monthlyNet)}/mo</dd></>}
      <dt>Deposit</dt><dd>{money(totals.deposit)}</dd>
      <dt>Balance after deposit</dt><dd>{money(totals.setupAfterDeposit)}</dd>
      <dt>Term</dt><dd>{termLabel(totals.termMonths)}</dd>
      {totals.termMonths
        ? <><dt>Contract value for the term</dt><dd><strong>{money(totals.termValue)}</strong></dd></>
        : <><dt>First-year value</dt><dd><strong>{money(totals.setup + totals.monthly * 12)}</strong></dd></>}
    </dl>
  );
}

const CopiedFrom = ({ copiedFrom }) => copiedFrom && <div class="small muted">Copied from <a href={`/contracts/${copiedFrom.id}`}>{copiedFrom.number}</a>.</div>;

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
    termMonths: d.termMonths || 0, termDiscountPct: d.termDiscountPct ? String(d.termDiscountPct) : '', termsVersion: termsVersionOf(d),
    providerSigner: d.providerSigner || '', clientLegalName: d.clientLegalName || '', clientAddress: d.clientAddress || '', clientEmail: d.clientEmail || '',
    attachments: d.attachments || [],
  };
}
const centsOf = (v) => (v === '' || v == null || Number.isNaN(Number(String(v).replace(/[$,]/g, ''))) ? null : Math.round(Number(String(v).replace(/[$,]/g, '')) * 100));

// Where each sending problem (from signingProblems) is fixed: Settings → Company, or a field in the editor.
const PROBLEM_FIELDS = {
  'Who signs for Detcord': 'f-providerSigner', 'Client’s legal business name': 'f-clientLegalName', 'Client’s address': 'f-clientAddress',
  'Client’s notice email': 'f-clientEmail', 'At least one service': 'f-add-service', 'When monthly billing starts': 'f-monthlyStart',
  'Deposit is larger than the first invoice total': 'f-deposit',
  'Term: month to month, or 3, 6, 9 or 12 months': 'f-termMonths', 'A fixed term needs at least one monthly fee': 'f-termMonths',
  'A term discount needs a fixed term': 'f-termDiscountPct', 'Term discount between 0 and 50%': 'f-termDiscountPct',
};
function problemTarget(p, services) {
  if (p.includes('(Settings → Company)')) return { href: '/settings?tab=company' };
  if (PROBLEM_FIELDS[p]) return { id: PROBLEM_FIELDS[p] };
  const svc = (prefix, field) => {
    if (!p.startsWith(prefix)) return null;
    const s = services.find((x) => p.startsWith(`${prefix}${x.name}`));
    return s ? { id: `f-svc-${s.serviceId}-${field(s)}` } : null;
  };
  // Prices point at whichever price is still empty.
  return svc('Both prices for ', (s) => (centsOf(s.setup) == null ? 'setup' : 'monthly')) || svc('Scope for ', () => 'scope') || {};
}
function goToField(id) {
  const el = document.getElementById(id) || (id === 'f-add-service' && document.getElementById('f-services'));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus?.({ preventScroll: true });
}
function ProblemList({ problems, services, user }) {
  return (
    <ul class="small" style="margin:6px 0 0;padding-left:18px">
      {problems.map((p) => {
        const t = problemTarget(p, services);
        if (t.href) return <li>{user.role === 'admin' ? <a href={t.href}>{p}</a> : <>{p} <span class="faint">(an admin sets this)</span></>}</li>;
        if (t.id) return <li><a href={`#${t.id}`} onClick={(e) => { e.preventDefault(); goToField(t.id); }}>{p}</a></li>;
        return <li>{p}</li>;
      })}
    </ul>
  );
}

function ContractEditor({ data, user, reload }) {
  const { contract, client } = data;
  const [form, setForm] = useState(() => toForm(contract));
  const [saved, setSaved] = useState(contract);
  const [state, setState] = useState('saved');
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [problems, setProblems] = useState(null);
  const [tried, setTried] = useState(false);
  const catalog = useLoad('/services');
  const timer = useRef();
  const send = useAction();

  const save = async (f) => {
    setState('saving');
    try {
      const body = { ...f, attachments: f.attachments.map((a) => a.id), services: f.services.map(({ serviceId, setup, monthly, scope }) => ({ serviceId, setup, monthly, scope })) };
      const res = await api('PATCH', `/contracts/${contract.id}`, body);
      setSaved(res.contract);
      setProblems(null);
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
  const totals = contractTotals({ services: form.services.map((s) => ({ setupCents: centsOf(s.setup), monthlyCents: centsOf(s.monthly) })), depositCents: centsOf(form.deposit), termMonths: form.termMonths, termDiscountPct: form.termDiscountPct });
  const settings = saved.termsSettings || {};
  const revisedTerms = form.termsVersion === TERMS_2026_10;
  const available = (catalog.data?.services || []).filter((s) => s.active && !form.services.some((x) => x.serviceId === s.id));

  const doSend = () => send.run(async () => {
    clearTimeout(timer.current);
    await save(form);
    try {
      const res = await api('POST', `/contracts/${contract.id}/send`);
      toast(res.noLogins ? 'Sent. This client has no portal login yet: invite them from Portal access so they can sign.' : 'Sent for signature. The client was emailed.');
      reload();
    } catch (e) {
      // Listed in the banner below with links to each field, not as a bare error.
      if (e.data?.problems) { setProblems(e.data.problems); setTried(true); return; }
      throw e;
    }
  });
  const copy = () => send.run(async () => { clearTimeout(timer.current); await save(form); await duplicateContract(saved); });
  const saveTemplate = () => {
    const name = prompt('Name this template (e.g. Local SEO starter). It copies services, prices, scope and payment terms, not this client’s details or files.');
    if (!name) return;
    send.run(async () => { clearTimeout(timer.current); await save(form); await api('POST', `/contracts/${contract.id}/template`, { name }); toast(`Template “${name}” saved. Find it in Settings → Agreement templates.`); });
  };
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
      {blocking?.length > 0 && (
        <div class={`alert ${tried ? 'bad' : 'warn'} mb`}>
          <strong>{tried ? 'A few details are missing before this can be sent:' : 'Before this can be sent:'}</strong>
          <ProblemList problems={blocking} services={form.services} user={user} />
        </div>
      )}
      <div class="grid main-side">
        <div class="stack">
          <section class="card">
            <Field label="Agreement title"><input id="f-title" class="input" value={form.title} onInput={(e) => update({ title: e.target.value })} /></Field>
          </section>
          <section class="card" id="f-services">
            <h2>Services, prices and scope</h2>
            <p class="small muted" style="margin-top:-6px">Enter 0 where a service has no one-time or monthly charge. Scope is what the client is buying: deliverables, quantities, cadence.</p>
            {form.services.map((s, i) => (
              <div class="svc-row">
                <div class="row between"><strong>{s.name}</strong><button class="icon-btn" onClick={() => update({ services: form.services.filter((_, k) => k !== i) })} aria-label={`Remove ${s.name}`}><Icon name="trash" size={16} /></button></div>
                {saved.reviewServices?.includes(s.name) && <div class="small" style="color:var(--warn)">Newer service wording, reviewed with version 2026-10 terms. Move this draft to 2026-10 under Term.</div>}
                <div class="form-grid mt" style="margin-top:8px">
                  <Field label="One-time ($)"><input id={`f-svc-${s.serviceId}-setup`} class="input" inputMode="decimal" value={s.setup} onInput={(e) => setService(i, { setup: e.target.value })} placeholder="0" /></Field>
                  <Field label="Monthly ($)"><input id={`f-svc-${s.serviceId}-monthly`} class="input" inputMode="decimal" value={s.monthly} onInput={(e) => setService(i, { monthly: e.target.value })} placeholder="0" /></Field>
                  <div class="full"><Field label="Scope"><textarea id={`f-svc-${s.serviceId}-scope`} class="textarea" value={s.scope} onInput={(e) => setService(i, { scope: e.target.value })} placeholder="e.g. 10 service-area pages, monthly technical fixes, 2 blog posts per month, monthly report" /></Field></div>
                </div>
              </div>
            ))}
            {available.length > 0 && (
              <select id="f-add-service" class="select mt" value="" onChange={(e) => { const s = available.find((x) => x.id === e.target.value); if (s) update({ services: [...form.services, { serviceId: s.id, name: s.name, setup: dollars(s.setup_cents), monthly: dollars(s.monthly_cents), scope: '' }] }); }}>
                <option value="">+ Add a service…</option>
                {available.map((s) => <option value={s.id}>{s.name}</option>)}
              </select>
            )}
          </section>
          <section class="card">
            <h2>Payment</h2>
            <div class="form-grid">
              <Field label="Deposit at signing ($)" help="credited against one-time fees"><input id="f-deposit" class="input" inputMode="decimal" value={form.deposit} onInput={(e) => update({ deposit: e.target.value })} placeholder="0" /></Field>
              <Field label="Monthly billing starts"><input id="f-monthlyStart" class="input" type="date" value={form.monthlyStart} onInput={(e) => update({ monthlyStart: e.target.value })} /></Field>
              <Field label="Invoices due (days)"><input class="input" type="number" min="0" max="90" value={form.paymentDays} onInput={(e) => update({ paymentDays: e.target.value })} /></Field>
              <Field label="Client feedback period (business days)"><input class="input" type="number" min="1" max="30" value={form.feedbackDays} onInput={(e) => update({ feedbackDays: e.target.value })} /></Field>
              <div class="full"><Field label="Payment schedule and milestones" help="leave blank for: deposit at signing, rest on completion, monthly in advance"><textarea class="textarea" value={form.paymentTerms} onInput={(e) => update({ paymentTerms: e.target.value })} /></Field></div>
              <div class="full"><Field label="Ad budget and third-party costs" help="leave blank: not included, need written approval"><input class="input" value={form.thirdParty} onInput={(e) => update({ thirdParty: e.target.value })} /></Field></div>
            </div>
          </section>
          <section class="card">
            <h2>Term</h2>
            <div class="form-grid">
              <Field label="Term"><select id="f-termMonths" class="select" value={form.termMonths} onChange={(e) => update({ termMonths: Number(e.target.value) })}>{TERM_MONTHS.map((m) => <option value={m}>{termLabel(m)}</option>)}</select></Field>
              <Field label="Term discount (%)" help="optional, off monthly fees"><input id="f-termDiscountPct" class="input" inputMode="decimal" value={form.termDiscountPct} onInput={(e) => update({ termDiscountPct: e.target.value })} placeholder="0" /></Field>
              <div class="full small muted">
                {!Number(form.termMonths) ? 'Either party can cancel a monthly service with 30 days’ notice.'
                  : revisedTerms ? `After ${form.termMonths} months: month to month with 30 days’ notice. Early termination: ${EARLY_TERMINATION[settings.earlyTermination || DEFAULT_EARLY_TERMINATION].label.toLowerCase()} (an admin sets this in Settings → Agreement templates).`
                    : `Version 1 terms: the term is added to Additional scope as a change to “Term and cancellation”, with no early termination fee. After ${form.termMonths} months: month to month with 30 days’ notice. Move this draft to version 2026-10 to use the early termination rule.`}
              </div>
              <Field label="Terms version" help="new agreements use 2026-10">
                <select id="f-termsVersion" class="select" value={form.termsVersion} onChange={(e) => update({ termsVersion: e.target.value })}>
                  {[TERMS_2026_10, TERMS_V1].map((v) => <option value={v}>{TERMS_VERSIONS[v]}</option>)}
                </select>
              </Field>
            </div>
          </section>
          <section class="card">
            <h2>Parties</h2>
            <div class="form-grid">
              <Field label="Client legal name"><input id="f-clientLegalName" class="input" value={form.clientLegalName} onInput={(e) => update({ clientLegalName: e.target.value })} /></Field>
              <Field label="Client notice email"><input id="f-clientEmail" class="input" type="email" value={form.clientEmail} onInput={(e) => update({ clientEmail: e.target.value })} /></Field>
              <div class="full"><Field label="Client address"><input id="f-clientAddress" class="input" value={form.clientAddress} onInput={(e) => update({ clientAddress: e.target.value })} /></Field></div>
              <Field label="Signs for Detcord"><input id="f-providerSigner" class="input" value={form.providerSigner} onInput={(e) => update({ providerSigner: e.target.value })} /></Field>
              <div class="small muted" style="align-self:end">Detcord’s legal name and address come from Settings → Company.</div>
            </div>
          </section>
          <section class="card">
            <h2>Additional scope and exceptions</h2>
            <textarea class="textarea" style="min-height:120px" value={form.additional} onInput={(e) => update({ additional: e.target.value })} placeholder="Anything agreed that changes the standard terms. Name the section it changes." />
            <div class="row between mt"><strong>Attached materials</strong><button class="btn sm secondary" onClick={() => setPicker(true)}><Icon name="image" />Attach files</button></div>
            {form.attachments.length ? <div class="row mt" style="gap:8px">{form.attachments.map((a) => <span class="badge" style="white-space:normal;overflow-wrap:anywhere">{a.filename} <button class="linkish" onClick={() => update({ attachments: form.attachments.filter((x) => x.id !== a.id) })} aria-label={`Remove ${a.filename}`}>×</button></span>)}</div>
              : <p class="small muted">Logos, photos or materials the work relies on. Optional.</p>}
          </section>
        </div>
        <aside class="stack" style="position:sticky;top:16px">
          <section class="card">
            <h3>Totals</h3>
            <TotalsList totals={totals} />
          </section>
          <section class="card">
            <h3>{blocking?.length ? 'Before you send' : 'Ready to send'}</h3>
            {blocking?.length ? <ProblemList problems={blocking} services={form.services} user={user} />
              : <p class="small muted" style="margin:0">Sending signs for Detcord, freezes this version and emails the client a link to review and sign.</p>}
          </section>
          {saved.reviewServices?.length > 0 && <div class="alert warn small">The wording for {saved.reviewServices.join(', ')} was reviewed with version 2026-10 terms, not version 1. Move this draft to 2026-10 under Term.</div>}
          <div class="alert info small">{revisedTerms ? 'General terms: version 2026-10, Detcord’s current Michigan agreement language.' : 'General terms: version 1, the original agreement language. Move this draft to version 2026-10 under Term.'}</div>
          <CopiedFrom copiedFrom={data.copiedFrom} />
          <div class="row" style="gap:6px">
            <button class="btn ghost sm" onClick={copy} disabled={send.busy}><Icon name="copy" />Duplicate</button>
            {user.role === 'admin' && <button class="btn ghost sm" onClick={saveTemplate} disabled={send.busy}><Icon name="doc" />Save as template</button>}
            <button class="btn ghost sm" onClick={remove}><Icon name="trash" />Delete draft</button>
          </div>
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
  const redraft = () => {
    if (!confirm(`Void ${contract.number} (reason: Changes requested) and open an editable copy? The client can no longer sign this version.`)) return;
    act.run(async () => {
      const { id, number } = await api('POST', `/contracts/${contract.id}/redraft`);
      toast(`${contract.number} voided. Make the changes in draft ${number}, then send it.`);
      navigate(`/contracts/${id}`);
    });
  };
  const requests = data.changeRequests || [];
  const open = contract.status === 'sent' ? requests.filter((cr) => cr.version === contract.version) : [];
  return (
    <div class="page" style="max-width:1200px">
      <Head contract={contract} client={client}>
        <a class="btn secondary" href={`/api/contracts/${contract.id}/document?download=1`}><Icon name="download" />Download</a>
        {contract.status === 'sent' && <button class="btn secondary" onClick={withdraw} disabled={act.busy}><Icon name="pen" />Edit</button>}
        {contract.status === 'sent' && <button class={`btn ${open.length ? '' : 'secondary'}`} onClick={redraft} disabled={act.busy}><Icon name="copy" />Void and redraft</button>}
        <button class="btn secondary" onClick={() => act.run(() => duplicateContract(contract))} disabled={act.busy}><Icon name="copy" />Duplicate</button>
        {contract.status === 'signed' && contract.totals.monthly > 0 && <button class="btn" onClick={monthly} disabled={act.busy}><Icon name="plus" />Monthly invoice</button>}
        {user.role === 'admin' && contract.status !== 'void' && <button class="btn ghost" onClick={voidIt} disabled={act.busy}>Void</button>}
      </Head>
      {act.error && <div class="alert bad mb">{act.error}</div>}
      {open.length > 0 && <div class="alert bad mb"><strong>{client.name} asked for changes.</strong> The sent version can’t change. Use <strong>Void and redraft</strong> to make an editable copy, then send it again.</div>}
      <div class="grid main-side">
        <DocFrame id={contract.id} version={contract.version} tall />
        <aside class="stack">
          {requests.length > 0 && (
            <section class="card">
              <h3>Change requests</h3>
              {requests.map((cr) => (
                <div style="padding:8px 0;border-bottom:1px solid var(--line)">
                  <div class="small muted">{cr.author_name} · {dateTime(cr.created_at)} · v{cr.version}</div>
                  <div style="white-space:pre-wrap">{cr.note}</div>
                </div>
              ))}
            </section>
          )}
          <section class="card">
            <h3>Record</h3>
            <dl class="kv">
              <dt>Sent</dt><dd>{dateTime(contract.issued_at) || '—'}</dd>
              {contract.signed_at && <><dt>Signed</dt><dd>{dateTime(contract.signed_at)}</dd><dt>Signer</dt><dd>{contract.signer_name}, {contract.signer_title}<div class="small muted">{contract.signer_email}</div></dd></>}
              {contract.voided_at && <><dt>Voided</dt><dd>{dateTime(contract.voided_at)}<div class="small muted">{contract.void_reason}</div></dd></>}
              <dt>Document hash</dt><dd class="small" style="font-family:monospace">{contract.document_hash?.slice(0, 16)}…</dd>
            </dl>
            <CopiedFrom copiedFrom={data.copiedFrom} />
          </section>
          <section class="card">
            <h3>Totals</h3>
            <TotalsList totals={contract.totals} />
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
              <label class="check small"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} required />{signingStatementFor(contract.data)}</label>
              {act.error && <div class="alert bad">{act.error}</div>}
              <button class="btn block" disabled={act.busy || !form.consent}><Icon name="pen" />Sign agreement</button>
              <p class="small faint" style="margin:0">Your typed name, account, time and a fingerprint of this exact document are recorded.</p>
            </form>
          )}
          {contract.status === 'sent' && !done && <AskForChanges contract={contract} requests={data.changeRequests || []} reload={reload} />}
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

// Client: ask Detcord to change something before signing. The sent document itself never changes.
function AskForChanges({ contract, requests, reload }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const submit = (e) => {
    e.preventDefault();
    act.run(async () => {
      const res = await api('POST', `/contracts/${contract.id}/changes`, { note });
      toast(res.emailed ? 'Sent. Your Detcord team was emailed and will follow up.' : 'Saved. Your Detcord team will see it in the portal and follow up.');
      setNote(''); setOpen(false); reload();
    });
  };
  const mine = requests.filter((cr) => cr.version === contract.version);
  return (
    <section class="card stack">
      <div class="row between"><h3 style="margin:0">Need changes?</h3>{!open && <button class="btn sm secondary" onClick={() => setOpen(true)}><Icon name="pen" />Ask for changes</button>}</div>
      {mine.map((cr) => <div class="small"><div class="muted">You asked {dateTime(cr.created_at)}{cr.author_name ? ` (${cr.author_name})` : ''}</div><div style="white-space:pre-wrap">{cr.note}</div></div>)}
      {!open && !mine.length && <p class="small muted" style="margin:0">Tell Detcord what should be different. They’ll send you an updated agreement to sign.</p>}
      {open && (
        <form class="stack" onSubmit={submit}>
          <Field label="What would you like changed?"><textarea class="textarea" required value={note} onInput={(e) => setNote(e.target.value)} placeholder="e.g. Start monthly billing in December, or drop the blog posts" /></Field>
          {act.error && <div class="alert bad">{act.error}</div>}
          <div class="row"><button class="btn" disabled={act.busy || !note.trim()}>Send request</button><button type="button" class="btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </section>
  );
}

// ---- admin: agreement templates (Settings) -------------------------------------

function toTemplateForm(t) {
  const { services, deposit, paymentDays, feedbackDays, paymentTerms, thirdParty, additional, termMonths, termDiscountPct } = toForm({ title: '', data: { ...t.data, attachments: [] } });
  return { id: t.id, name: t.name || '', description: t.description || '', services, deposit, paymentDays, feedbackDays, paymentTerms, thirdParty, additional, termMonths, termDiscountPct };
}
const BLANK_TEMPLATE = { services: [], depositCents: null, paymentDays: 15, feedbackDays: 10, paymentTerms: '', thirdParty: '', additional: '', termMonths: 0, termDiscountPct: 0 };

// The early termination rule for fixed terms (version 2026-10 terms).
function AgreementTermsSettings() {
  const { loading, data, error, reload } = useLoad('/settings/contracts');
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const put = (patch, message) => act.run(async () => { await api('PUT', '/settings/contracts', patch); toast(message); reload(); });
  return (
    <section class="card stack">
      <h2 style="margin:0">Agreement terms</h2>
      <p class="small muted" style="margin:0">New agreements use {TERMS_VERSIONS[TERMS_2026_10].toLowerCase()}. Drafts, sent and signed agreements keep the version they were created with; a draft can be moved to 2026-10 in the editor.</p>
      <Field label="Early termination of fixed terms" help="version 2026-10 terms">
        <select class="select" value={data.earlyTermination} onChange={(e) => put({ earlyTermination: e.target.value }, 'Early termination rule saved.')} disabled={act.busy}>
          {Object.entries(EARLY_TERMINATION).map(([k, rule]) => <option value={k}>{rule.label}{k === DEFAULT_EARLY_TERMINATION ? ' (default)' : ''}</option>)}
        </select>
      </Field>
      <p class="small muted" style="margin:0">{EARLY_TERMINATION[data.earlyTermination].text}</p>
      <p class="small faint" style="margin:0">Drafts follow this rule until they are sent; a sent agreement keeps the rule it was sent with. Version 1 agreements with a fixed term have no early termination fee.</p>
      {act.error && <div class="alert bad">{act.error}</div>}
    </section>
  );
}

// Packages reps can start an agreement from. Terms only: parties always come from the client.
export function TemplateSettings() {
  const [archived, setArchived] = useState(false);
  const { loading, data, error, reload } = useLoad(`/contract-templates${archived ? '?archived=1' : ''}`, [archived]);
  const [edit, setEdit] = useState(null);
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const setArchive = (t, value) => act.run(async () => { await api('PUT', `/contract-templates/${t.id}`, { archived: value }); toast(value ? `${t.name} archived.` : `${t.name} restored.`); reload(); });
  return (
    <div class="stack">
      <AgreementTermsSettings />
      <div class="alert info">Templates hold services, prices, scope, payment terms and the contract term. Starting an agreement from one copies those terms; the client’s legal name, address and email always come from the client record. New agreements use the current general terms (version 2026-10).</div>
      <section class="card">
        {data.templates.length ? data.templates.map((t) => (
          <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="flex:1;min-width:0">
              <strong style={t.archived_at ? 'opacity:.5' : ''}>{t.name}</strong> {t.archived_at && <span class="badge">Archived</span>}
              <div class="small muted">{t.data.services.map((s) => s.name).join(', ') || 'No services'} · {money(t.totals.setup)} one-time · {money(t.totals.monthlyNet ?? t.totals.monthly)}/mo{t.totals.termMonths ? ` · ${t.totals.termMonths} mo term` : ''}{t.description ? ` · ${t.description}` : ''}</div>
            </div>
            <button class="btn sm ghost" onClick={() => setEdit(toTemplateForm(t))}>Edit</button>
            <button class="btn sm ghost" disabled={act.busy} onClick={() => setArchive(t, !t.archived_at)}>{t.archived_at ? 'Restore' : 'Archive'}</button>
          </div>
        )) : <Empty title="No agreement templates yet">Add a package here, or open a draft agreement and use Save as template.</Empty>}
        {act.error && <div class="alert bad mt">{act.error}</div>}
        <div class="row mt">
          <button class="btn secondary" onClick={() => setEdit(toTemplateForm({ data: BLANK_TEMPLATE }))}><Icon name="plus" />Add a template</button>
          <label class="check small" style="margin-left:auto"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label>
        </div>
      </section>
      {edit && <TemplateDialog edit={edit} setEdit={setEdit} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function TemplateDialog({ edit, setEdit, onSaved }) {
  const catalog = useLoad('/services');
  const act = useAction();
  const set = (patch) => setEdit({ ...edit, ...patch });
  const setService = (i, patch) => set({ services: edit.services.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const available = (catalog.data?.services || []).filter((s) => s.active && !edit.services.some((x) => x.serviceId === s.id));
  const save = () => act.run(async () => {
    const { id, ...body } = edit;
    body.services = edit.services.map(({ serviceId, setup, monthly, scope }) => ({ serviceId, setup, monthly, scope }));
    if (id) await api('PUT', `/contract-templates/${id}`, body); else await api('POST', '/contract-templates', body);
    toast('Template saved.');
    onSaved();
  });
  return (
    <Dialog title={edit.id ? 'Edit template' : 'New agreement template'} onClose={() => setEdit(null)} footer={<><button class="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button class="btn" disabled={act.busy || !edit.name.trim()} onClick={save}>Save</button></>}>
      <div class="stack">
        <div class="form-grid">
          <Field label="Template name"><input class="input" value={edit.name} onInput={(e) => set({ name: e.target.value })} placeholder="e.g. Local SEO starter" /></Field>
          <Field label="Note for the team" help="optional"><input class="input" value={edit.description} onInput={(e) => set({ description: e.target.value })} placeholder="Who this package fits" /></Field>
        </div>
        <h3 style="margin:0">Services, prices and scope</h3>
        {edit.services.map((s, i) => (
          <div class="svc-row">
            <div class="row between"><strong>{s.name}</strong><button class="icon-btn" onClick={() => set({ services: edit.services.filter((_, k) => k !== i) })} aria-label={`Remove ${s.name}`}><Icon name="trash" size={16} /></button></div>
            <div class="form-grid" style="margin-top:8px">
              <Field label="One-time ($)"><input class="input" inputMode="decimal" value={s.setup} onInput={(e) => setService(i, { setup: e.target.value })} placeholder="0" /></Field>
              <Field label="Monthly ($)"><input class="input" inputMode="decimal" value={s.monthly} onInput={(e) => setService(i, { monthly: e.target.value })} placeholder="0" /></Field>
              <div class="full"><Field label="Scope"><textarea class="textarea" value={s.scope} onInput={(e) => setService(i, { scope: e.target.value })} placeholder="e.g. 10 service-area pages, monthly technical fixes, monthly report" /></Field></div>
            </div>
          </div>
        ))}
        {available.length > 0 && (
          <select class="select" value="" onChange={(e) => { const s = available.find((x) => x.id === e.target.value); if (s) set({ services: [...edit.services, { serviceId: s.id, name: s.name, setup: dollars(s.setup_cents), monthly: dollars(s.monthly_cents), scope: '' }] }); }}>
            <option value="">+ Add a service…</option>
            {available.map((s) => <option value={s.id}>{s.name}</option>)}
          </select>
        )}
        <h3 style="margin:0">Payment</h3>
        <div class="form-grid">
          <Field label="Deposit at signing ($)" help="credited against one-time fees"><input class="input" inputMode="decimal" value={edit.deposit} onInput={(e) => set({ deposit: e.target.value })} placeholder="0" /></Field>
          <Field label="Invoices due (days)"><input class="input" type="number" min="0" max="90" value={edit.paymentDays} onInput={(e) => set({ paymentDays: e.target.value })} /></Field>
          <Field label="Client feedback period (business days)"><input class="input" type="number" min="1" max="30" value={edit.feedbackDays} onInput={(e) => set({ feedbackDays: e.target.value })} /></Field>
          <Field label="Term"><select class="select" value={edit.termMonths} onChange={(e) => set({ termMonths: Number(e.target.value) })}>{TERM_MONTHS.map((m) => <option value={m}>{termLabel(m)}</option>)}</select></Field>
          <Field label="Term discount (%)" help="optional, off monthly fees"><input class="input" inputMode="decimal" value={edit.termDiscountPct} onInput={(e) => set({ termDiscountPct: e.target.value })} placeholder="0" /></Field>
          <div class="full"><Field label="Payment schedule and milestones" help="leave blank for: deposit at signing, rest on completion, monthly in advance"><textarea class="textarea" value={edit.paymentTerms} onInput={(e) => set({ paymentTerms: e.target.value })} /></Field></div>
          <div class="full"><Field label="Ad budget and third-party costs" help="leave blank: not included, need written approval"><input class="input" value={edit.thirdParty} onInput={(e) => set({ thirdParty: e.target.value })} /></Field></div>
          <div class="full"><Field label="Additional scope and exceptions"><textarea class="textarea" value={edit.additional} onInput={(e) => set({ additional: e.target.value })} placeholder="Anything agreed that changes the standard terms. Name the section it changes." /></Field></div>
        </div>
      </div>
      {act.error && <div class="alert bad mt">{act.error}</div>}
    </Dialog>
  );
}
