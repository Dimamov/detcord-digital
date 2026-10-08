import { useState, useEffect } from 'preact/hooks';
import { useLoad, api, toast, money, date, dateTime, navigate, query, toInputDate } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, useAction } from '../ui.jsx';

const STATUS = { draft: ['Draft', ''], open: ['Unpaid', 'warn'], paid: ['Paid', 'good'], void: ['Voided', 'bad'] };
export function InvoiceBadge({ inv }) {
  const overdue = inv.status === 'open' && inv.due_at && inv.due_at < Date.now();
  return <span class={`badge ${overdue ? 'bad' : STATUS[inv.status]?.[1] || ''}`}>{overdue ? 'Overdue' : STATUS[inv.status]?.[0]}</span>;
}
const balance = (i) => Math.max(0, i.total_cents - i.paid_cents);

function InvoiceRows({ invoices, showClient }) {
  return (
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoice</th>{showClient && <th>Client</th>}<th>Due</th><th style="text-align:right">Total</th><th style="text-align:right">Balance</th><th>Status</th></tr></thead>
        <tbody>
          {invoices.map((i) => (
            <tr class="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
              <td><a href={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}><strong>{i.number}</strong></a><div class="small muted">{i.title}</div></td>
              {showClient && <td>{i.client_name}</td>}
              <td>{i.due_at ? date(i.due_at) : '—'}</td>
              <td style="text-align:right">{money(i.total_cents)}</td>
              <td style="text-align:right">{i.status === 'void' ? '—' : money(balance(i))}</td>
              <td><InvoiceBadge inv={i} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// All invoices the user can see. Staff: across clients. Client: their own.
export function InvoicesPage({ user }) {
  const [status, setStatus] = useState(query().status || '');
  const { loading, data, error, reload } = useLoad(`/invoices${status ? `?status=${status}` : ''}`, [status]);
  const staff = user.role !== 'client';
  return (
    <div class="page">
      <div class="page-head">
        <div><div class="eyebrow">{staff ? 'Billing' : 'Your account'}</div><h1>Invoices</h1></div>
        {staff && <select class="select" style="width:auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter"><option value="">All</option><option value="unpaid">Unpaid</option><option value="draft">Drafts</option><option value="paid">Paid</option><option value="void">Voided</option></select>}
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <>
          <div class="grid three mb">
            <div class="stat"><div class="label">Outstanding</div><div class="value">{money(data.summary.outstandingCents)}</div></div>
            <div class="stat"><div class="label">Overdue</div><div class="value" style={data.summary.overdueCents ? 'color:var(--bad)' : ''}>{money(data.summary.overdueCents)}</div></div>
            <div class="stat"><div class="label">Paid</div><div class="value">{money(data.summary.paidCents)}</div></div>
          </div>
          {staff && data.payments === 'not_configured' && <div class="alert warn mb">Online card payments are off until Clover is connected (Settings → Payments). Clients see invoices but no Pay button.</div>}
          <section class="card">
            {data.invoices.length ? <InvoiceRows invoices={data.invoices} showClient={staff} /> : <Empty title="No invoices">{staff ? 'Invoices are created from signed agreements, or from a client’s Billing tab.' : 'Invoices from Detcord will appear here.'}</Empty>}
          </section>
        </>
      )}
    </div>
  );
}

// Client record tab.
export function BillingTab({ clientId, user }) {
  const { loading, data, error, reload } = useLoad(`/clients/${clientId}/invoices`, [clientId]);
  const [creating, setCreating] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const open = data.invoices.filter((i) => i.status === 'open');
  return (
    <section class="card">
      <div class="row between mb">
        <div><h2 style="margin:0">Invoices</h2>{open.length > 0 && <div class="small muted">{money(open.reduce((s, i) => s + balance(i), 0))} outstanding</div>}</div>
        <button class="btn" onClick={() => setCreating(true)}><Icon name="plus" />New invoice</button>
      </div>
      {data.invoices.length ? <InvoiceRows invoices={data.invoices} /> : <Empty title="No invoices yet">A signed agreement creates the deposit invoice automatically.</Empty>}
      {creating && <InvoiceForm clientId={clientId} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/invoices/${id}`)} />}
    </section>
  );
}

const blankLine = () => ({ description: '', kind: 'other', quantity: 1, amount: '' });

function InvoiceForm({ clientId, invoice, lines: initialLines, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: invoice?.title || '', dueDate: invoice?.due_at ? toInputDate(invoice.due_at) : toInputDate(Date.now() + 15 * 86400000), notes: invoice?.notes || '',
    lines: initialLines?.map((l) => ({ description: l.description, kind: l.kind, quantity: l.quantity, amount: String(l.unit_cents / 100) })) || [blankLine()],
  });
  const act = useAction();
  const setLine = (i, patch) => setForm({ ...form, lines: form.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const total = form.lines.reduce((s, l) => s + (Number(String(l.amount).replace(/[$,]/g, '')) || 0) * (Number(l.quantity) || 1), 0);
  const submit = (e) => {
    e.preventDefault();
    act.run(async () => {
      if (invoice) { await api('PATCH', `/invoices/${invoice.id}`, form); onSaved(invoice.id); }
      else { const res = await api('POST', `/clients/${clientId}/invoices`, form); onSaved(res.id); }
    });
  };
  return (
    <Dialog title={invoice ? `Edit ${invoice.number}` : 'New invoice'} onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" form="inv-form" disabled={act.busy}>{invoice ? 'Save draft' : 'Create draft'}</button></>}>
      <form id="inv-form" class="stack" onSubmit={submit}>
        <Field label="Title"><input class="input" required value={form.title} onInput={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Website launch milestone" /></Field>
        <Field label="Due date"><input class="input" type="date" value={form.dueDate} onInput={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <div>
          <div class="small muted" style="margin-bottom:6px">Lines (use a negative amount for a credit)</div>
          {form.lines.map((l, i) => (
            <div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:nowrap">
              <input class="input" style="flex:3" required placeholder="Description" value={l.description} onInput={(e) => setLine(i, { description: e.target.value })} />
              <select class="select" style="flex:1.2" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })} aria-label="Type">
                <option value="setup">One-time</option><option value="monthly">Monthly</option><option value="deposit">Deposit</option><option value="credit">Credit</option><option value="other">Other</option>
              </select>
              <input class="input" style="flex:.6" type="number" min="1" value={l.quantity} onInput={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" />
              <input class="input" style="flex:1.2" required inputMode="decimal" placeholder="$" value={l.amount} onInput={(e) => setLine(i, { amount: e.target.value })} aria-label="Amount" />
              <button type="button" class="icon-btn" onClick={() => setForm({ ...form, lines: form.lines.filter((_, k) => k !== i) })} disabled={form.lines.length === 1} aria-label="Remove line"><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <div class="row between"><button type="button" class="btn sm ghost" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}><Icon name="plus" />Add line</button><strong>Total {money(Math.round(total * 100))}</strong></div>
        </div>
        <Field label="Note to client" help="optional"><textarea class="textarea" value={form.notes} onInput={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        {act.error && <div class="alert bad">{act.error}</div>}
      </form>
    </Dialog>
  );
}

export function InvoicePage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/invoices/${id}`, [id]);
  const checkout = query().checkout;
  const [waiting, setWaiting] = useState(checkout === 'done');
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const act = useAction();
  const staff = user.role !== 'client';

  // After Clover redirects back, wait for the signed confirmation instead of trusting the redirect.
  useEffect(() => {
    if (!waiting) return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      await reload();
      if (tries >= 20) { clearInterval(t); setWaiting(false); }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]);
  useEffect(() => { if (waiting && data?.invoice.status === 'paid') { setWaiting(false); history.replaceState({}, '', location.pathname); } }, [data, waiting]);

  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { invoice, lines, payments, client, contract, pay, balanceCents } = data;

  const startPay = () => act.run(async () => { const res = await api('POST', `/invoices/${invoice.id}/checkout`); location.href = res.href; });
  const issue = () => act.run(async () => { const res = await api('POST', `/invoices/${invoice.id}/issue`); toast(res.noLogins ? 'Issued. This client has no portal login yet, so nobody was emailed.' : 'Issued and emailed to the client.'); reload(); });
  const remove = () => confirm('Delete this draft invoice?') && act.run(async () => { await api('DELETE', `/invoices/${invoice.id}`); navigate(`/clients/${client.id}?tab=billing`); });
  const voidIt = () => { const reason = prompt('Why is this invoice being voided?'); if (reason) act.run(async () => { await api('POST', `/invoices/${invoice.id}/void`, { reason }); reload(); }); };
  const approved = payments.filter((p) => p.status === 'approved');

  return (
    <div class="page" style="max-width:960px">
      <div class="page-head">
        <div>
          <a class="small muted" href={staff ? `/clients/${client.id}?tab=billing` : '/invoices'}>← {staff ? client.name : 'Invoices'}</a>
          <h1>{invoice.title}</h1>
          <div class="row mt" style="gap:8px"><InvoiceBadge inv={invoice} /><span class="faint small">{invoice.number}{contract ? ` · agreement ${contract.number}` : ''}</span></div>
        </div>
        <div class="row">
          {staff && invoice.status === 'draft' && <><button class="btn secondary" onClick={() => setEditing(true)}><Icon name="pen" />Edit</button><button class="btn" onClick={issue} disabled={act.busy}>Issue invoice</button></>}
          {staff && user.role === 'admin' && invoice.status === 'open' && <button class="btn secondary" onClick={() => setRecording(true)}>Record payment</button>}
        </div>
      </div>
      {act.error && <div class="alert bad mb">{act.error}</div>}
      {checkout === 'failed' && <div class="alert bad mb">The payment didn’t go through. No charge was recorded. You can try again.</div>}
      {waiting && <div class="alert info mb row" style="gap:10px"><div class="spinner" style="width:18px;height:18px" />Waiting for Clover to confirm your payment. This page updates on its own.</div>}
      {!waiting && checkout === 'done' && invoice.status !== 'paid' && <div class="alert warn mb">We haven’t received Clover’s confirmation yet. If you completed payment, it will show here shortly, and you’ll get an emailed receipt.</div>}

      <div class="grid main-side">
        <section class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th></tr></thead>
              <tbody>
                {lines.map((l) => <tr><td>{l.description}</td><td style="text-align:right">{l.quantity}</td><td style="text-align:right">{money(l.amount_cents)}</td></tr>)}
                <tr><td colSpan={2}><strong>Total</strong></td><td style="text-align:right"><strong>{money(invoice.total_cents)}</strong></td></tr>
                {invoice.paid_cents > 0 && <tr><td colSpan={2}>Paid</td><td style="text-align:right">−{money(invoice.paid_cents)}</td></tr>}
                {invoice.status !== 'void' && <tr><td colSpan={2}><strong>Balance due</strong></td><td style="text-align:right"><strong>{money(balanceCents)}</strong></td></tr>}
              </tbody>
            </table>
          </div>
          {invoice.notes && <p class="muted mt" style="white-space:pre-wrap">{invoice.notes}</p>}
          {invoice.void_reason && <div class="alert warn mt">Voided: {invoice.void_reason}</div>}
        </section>
        <aside class="stack">
          <section class="card">
            <dl class="kv">
              <dt>Issued</dt><dd>{invoice.issued_at ? date(invoice.issued_at) : 'Not yet'}</dd>
              <dt>Due</dt><dd>{invoice.due_at ? date(invoice.due_at) : '—'}</dd>
              {invoice.paid_at && <><dt>Paid in full</dt><dd>{date(invoice.paid_at)}</dd></>}
            </dl>
            {invoice.status === 'open' && (pay.available
              ? <button class="btn block mt" onClick={startPay} disabled={act.busy || waiting}><Icon name="card" />Pay {money(balanceCents)} by card</button>
              : <p class="small muted mt" style="margin-bottom:0">{pay.reason}</p>)}
            {pay.available && pay.sandbox && <p class="small faint" style="margin:8px 0 0">Test mode: Clover sandbox, no real charges.</p>}
          </section>
          <section class="card">
            <h3>Payments</h3>
            {payments.length ? payments.map((p) => (
              <div style="padding:8px 0;border-bottom:1px solid var(--line)">
                <div class="row between"><strong>{money(p.amount_cents)}</strong><span class={`badge ${p.status === 'approved' ? 'good' : 'bad'}`}>{p.status === 'approved' ? 'Confirmed' : 'Declined'}</span></div>
                <div class="small muted">{dateTime(p.received_at)} · {p.provider === 'clover' ? 'Card via Clover' : `Recorded manually (${p.method})`}</div>
                <div class="small faint">Ref {p.provider_payment_id || p.reference || p.id.slice(0, 8)}{staff && p.recorded_by ? ` · by ${p.recorded_by}` : ''}</div>
              </div>
            )) : <p class="small muted" style="margin:0">No payments yet.</p>}
            {approved.length > 0 && <p class="small faint" style="margin:8px 0 0">Receipts are emailed to {staff ? 'the client' : 'you'} when a payment is confirmed.</p>}
          </section>
          {staff && invoice.status === 'draft' && <button class="btn ghost sm" onClick={remove}><Icon name="trash" />Delete draft</button>}
          {user.role === 'admin' && invoice.status === 'open' && invoice.paid_cents === 0 && <button class="btn ghost sm" onClick={voidIt}>Void invoice</button>}
        </aside>
      </div>
      {editing && <InvoiceForm invoice={invoice} lines={lines} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {recording && <RecordPayment invoice={invoice} balance={balanceCents} onClose={() => setRecording(false)} onSaved={() => { setRecording(false); reload(); }} />}
    </div>
  );
}

function RecordPayment({ invoice, balance: due, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: String(due / 100), method: 'check', reference: '' });
  const act = useAction();
  const submit = (e) => { e.preventDefault(); act.run(async () => { const res = await api('POST', `/invoices/${invoice.id}/payments`, form); toast(res.receipt === 'sent' ? 'Payment recorded. A receipt was emailed.' : res.receipt === 'no_recipient' ? 'Payment recorded. No receipt sent: the client has no email on file.' : 'Payment recorded. The receipt email was not sent (email isn’t set up or failed).'); onSaved(); }); };
  return (
    <Dialog title="Record a payment" onClose={onClose} footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" form="pay-form" disabled={act.busy}>Record</button></>}>
      <form id="pay-form" class="stack" onSubmit={submit}>
        <p class="small muted" style="margin:0">For checks, cash or bank transfers you received. Card payments through the portal are recorded automatically by Clover.</p>
        <Field label="Amount ($)"><input class="input" inputMode="decimal" required value={form.amount} onInput={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Method"><select class="select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="check">Check</option><option value="ach">Bank transfer (ACH)</option><option value="cash">Cash</option><option value="card-in-person">Card in person</option><option value="other">Other</option></select></Field>
        <Field label="Reference" help="check number or transfer ID"><input class="input" value={form.reference} onInput={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        {act.error && <div class="alert bad">{act.error}</div>}
      </form>
    </Dialog>
  );
}
