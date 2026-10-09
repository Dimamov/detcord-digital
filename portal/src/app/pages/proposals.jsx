import { useState } from 'preact/hooks';
import { useLoad, api, toast, navigate, money, dollars, date, dateTime } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, CopyButton, useAction } from '../ui.jsx';
import { SERVICE_CATEGORIES } from '../../shared/services.js';

const TONE = { draft: 'info', shared: 'accent', accepted: 'good' };
const LABEL = { draft: 'Draft', shared: 'Shared', accepted: 'Accepted' };
const Badge = ({ status }) => <span class={`badge ${TONE[status] || ''}`}>{LABEL[status] || status}</span>;
const DELIVERY = { sent: ['Sent', 'good'], not_configured: ['Not sent: email isn’t set up', 'warn'], failed: ['Failed', 'bad'], skipped: ['Not sent', ''] };
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

// ---------- Service checklist (builder and "Change services") ----------

// Builder rows keyed by service id: { checked, setup, monthly, scope } with prices as dollar strings.
const pickState = (catalog, current) => Object.fromEntries(catalog.map((s) => {
  const mine = current?.find((x) => x.serviceId === s.serviceId);
  return [s.serviceId, mine
    ? { checked: true, setup: dollars(mine.setupCents), monthly: dollars(mine.monthlyCents), scope: mine.scope || '' }
    : { checked: current ? false : s.checked, setup: dollars(s.setupCents), monthly: dollars(s.monthlyCents), scope: '' }];
}));
const pickedServices = (catalog, pick) => catalog.filter((s) => pick[s.serviceId].checked)
  .map((s) => ({ serviceId: s.serviceId, setup: pick[s.serviceId].setup, monthly: pick[s.serviceId].monthly, scope: pick[s.serviceId].scope }));
const toCents = (v) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return v === '' || !Number.isFinite(n) ? null : Math.round(n * 100); };

function ServiceChecklist({ catalog, pick, setPick }) {
  const set = (id, patch) => setPick({ ...pick, [id]: { ...pick[id], ...patch } });
  const chosen = catalog.filter((s) => pick[s.serviceId].checked);
  const setupTotal = chosen.reduce((t, s) => t + (toCents(pick[s.serviceId].setup) || 0), 0);
  const monthlyTotal = chosen.reduce((t, s) => t + (toCents(pick[s.serviceId].monthly) || 0), 0);
  return (
    <div class="stack">
      {SERVICE_CATEGORIES.map((cat) => {
        const list = catalog.filter((s) => s.category === cat.id);
        if (!list.length) return null;
        return (
          <div>
            <div class="eyebrow" style="margin:6px 0 2px">{cat.name}</div>
            {list.map((s) => {
              const p = pick[s.serviceId];
              return (
                <div class={`svc-pick${p.checked ? ' on' : ''}`}>
                  <label class="check">
                    <input type="checkbox" checked={p.checked} onChange={(e) => set(s.serviceId, { checked: e.target.checked })} />
                    <span style="min-width:0">
                      <strong>{s.name}</strong>
                      {s.priority && s.priority !== 'later' && <span class="badge accent" style="margin-left:6px">Discovery: {s.priority === 'start-with' ? 'start with' : 'next'}</span>}
                      {s.status && <span class="badge" style="margin-left:6px">{s.status}</span>}
                      <div class="small muted">{s.description}</div>
                      {s.reasons.length > 0 && p.checked && <div class="small faint">{s.reasons.join(' ')}</div>}
                    </span>
                  </label>
                  {p.checked && (
                    <div class="form-grid svc-pick-fields">
                      <Field label="One-time ($)"><input class="input" inputMode="decimal" value={p.setup} onInput={(e) => set(s.serviceId, { setup: e.target.value })} placeholder="0" /></Field>
                      <Field label="Monthly ($)"><input class="input" inputMode="decimal" value={p.monthly} onInput={(e) => set(s.serviceId, { monthly: e.target.value })} placeholder="0" /></Field>
                      <div class="full"><Field label="Scope" help="optional, one line"><input class="input" value={p.scope} maxLength={600} onInput={(e) => set(s.serviceId, { scope: e.target.value })} placeholder="e.g. 10 service-area pages and monthly fixes" /></Field></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <div class="row between svc-total"><strong>{chosen.length} service{chosen.length === 1 ? '' : 's'}</strong><span>{money(setupTotal)} one-time · {money(monthlyTotal)}/mo</span></div>
    </div>
  );
}

// ---------- Client record tab (staff) ----------

export function ProposalsTab({ client }) {
  const { loading, data, error, reload } = useLoad(`/clients/${client.id}/proposals`);
  const [building, setBuilding] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div class="stack">
      {!data.ready.ai && <div class="alert warn">Claude is not set up yet (ANTHROPIC_API_KEY), so proposals start from the catalog and the discovery and your team writes them by hand.</div>}
      {building ? <Builder client={client} data={data} onClose={() => setBuilding(false)} /> : (
        <section class="card">
          <div class="row between mb"><h2 style="margin:0">Proposals</h2><button class="btn" onClick={() => setBuilding(true)}><Icon name="plus" />New proposal</button></div>
          {data.proposals.length === 0 ? <Empty title="No proposals yet">Check the services, and Claude explains each one in {client.name}’s own words from the discovery, meetings and website check.</Empty> : (
            <div class="list one-col">{data.proposals.map((p) => (
              <a class="list-item" href={`/proposals/${p.id}`}>
                <Icon name="doc" />
                <div style="flex:1;min-width:0"><div class="title truncate">{p.title}</div><div class="meta truncate">{p.services.join(', ')}</div></div>
                <div style="text-align:right" class="small"><div>{money(p.investment.setupCents)} one-time</div><div class="muted">{money(p.investment.monthlyCents)}/mo</div></div>
                <Badge status={p.status} />
              </a>
            ))}</div>
          )}
        </section>
      )}
    </div>
  );
}

function Builder({ client, data, onClose }) {
  const [pick, setPick] = useState(() => pickState(data.services));
  const [title, setTitle] = useState(`Marketing proposal for ${client.name}`);
  const act = useAction();
  const count = Object.values(pick).filter((p) => p.checked).length;
  const go = () => act.run(async () => {
    const res = await api('POST', `/clients/${client.id}/proposals`, { title, services: pickedServices(data.services, pick) });
    toast(res.proposal.draft_source === 'ai' ? 'Claude drafted the proposal. Review it before sharing.' : 'Proposal started. Write it up, then share.');
    navigate(`/proposals/${res.proposal.id}`);
  });
  return (
    <section class="card stack">
      <div class="row between"><h2 style="margin:0">New proposal</h2><button class="btn ghost sm" onClick={onClose}>Cancel</button></div>
      <p class="small muted" style="margin:0">Checked: the discovery’s recommended services and the ones on the client record. Prices start from the client record or the catalog. Claude never sees or writes prices; the totals are worked out by the portal.</p>
      <Field label="Title"><input class="input" value={title} maxLength={160} onInput={(e) => setTitle(e.target.value)} /></Field>
      <ServiceChecklist catalog={data.services} pick={pick} setPick={setPick} />
      {act.error && <div class="alert bad">{act.error}</div>}
      <div class="row">
        <button class="btn" disabled={act.busy || !count} onClick={go}>{act.busy ? (data.ready.ai ? 'Claude is writing…' : 'Gathering…') : data.ready.ai ? 'Generate with Claude' : 'Start from the facts'}</button>
        <span class="small muted">Uses the discovery, pre-call answers, meeting notes and the latest website check. Nothing is shared until you press Share.</span>
      </div>
    </section>
  );
}

// ---------- One proposal: staff edit and share; clients read and respond ----------

export function ProposalPage({ id }) {
  const { loading, data, error, reload } = useLoad(`/proposals/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (!data.staff) return <ClientProposal data={data} reload={reload} />;
  return <StaffProposal p={data.proposal} reload={reload} />;
}

function Investment({ inv }) {
  return (
    <section class="invest">
      <h2>Your investment</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Service</th><th class="num">One-time</th><th class="num">Monthly</th></tr></thead>
          <tbody>{inv.lines.map((l) => <tr><td>{l.name}</td><td class="num">{l.setupCents == null ? '—' : money(l.setupCents)}</td><td class="num">{l.monthlyCents == null ? '—' : money(l.monthlyCents)}</td></tr>)}</tbody>
          <tfoot><tr><th>Total</th><th class="num">{money(inv.setupCents)}</th><th class="num">{money(inv.monthlyCents)}/mo</th></tr></tfoot>
        </table>
      </div>
      {inv.unpriced.length > 0 && <p class="small muted">Price to be confirmed: {inv.unpriced.join(', ')}.</p>}
      <p class="small faint">Final terms, start date and any deposit are set out in your service agreement.</p>
    </section>
  );
}

function ProposalBody({ business, title, content: c, investment, sharedAt }) {
  return (
    <article class="monthly-report proposal-doc">
      <header>
        <div class="eyebrow">Proposal{sharedAt ? ` · ${date(sharedAt)}` : ''}</div>
        <div class="faint small">Prepared for {business}</div>
        <h1>{title}</h1>
      </header>
      {c.intro && c.intro.split(/\n+/).map((para) => <p class="lead">{para}</p>)}
      {c.services.map((s) => (
        <section class="proposal-svc">
          <h2>{s.name}</h2>
          {s.why && <p>{s.why}</p>}
          {s.concerns.length > 0 && (
            <div class="told-us">
              <h3>What you told us</h3>
              <ul>{s.concerns.map((x) => (
                <li>{x.concern}{x.quote && <blockquote>“{x.quote}”</blockquote>}{x.source && <span class="faint small"> {x.source}</span>}</li>
              ))}</ul>
            </div>
          )}
          <div class="grid two">
            {s.features.length > 0 && <div><h3>What we’ll do</h3><ul>{s.features.map((f) => <li>{f}</li>)}</ul></div>}
            {s.benefits.length > 0 && <div><h3>What it means for you</h3><ul>{s.benefits.map((f) => <li>{f}</li>)}</ul></div>}
          </div>
          {s.timeline && <p class="small"><strong>How it gets going:</strong> {s.timeline}</p>}
        </section>
      ))}
      <Investment inv={investment} />
      {c.next_steps?.length > 0 && (
        <section class="next">
          <h2>Next steps</h2>
          <ol>{c.next_steps.map((b) => <li>{b}</li>)}</ol>
        </section>
      )}
      <footer class="faint small">Prepared by Detcord Digital from what you shared with us and what we found on your website.</footer>
    </article>
  );
}

// The editable form: lists as newline text; concerns as rows.
const toForm = (c) => ({ ...c, services: c.services.map((s) => ({ ...s, features: s.features.join('\n'), benefits: s.benefits.join('\n') })), next_steps: c.next_steps.join('\n'), staff_notes: c.staff_notes.join('\n') });
const fromForm = (f) => ({ ...f, services: f.services.map((s) => ({ ...s, features: lines(s.features), benefits: lines(s.benefits), concerns: s.concerns.filter((x) => x.concern.trim() || x.quote.trim()) })), next_steps: lines(f.next_steps), staff_notes: lines(f.staff_notes) });

function StaffProposal({ p, reload }) {
  const [f, setF] = useState(() => toForm(p.content));
  const [title, setTitle] = useState(p.title);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState(null); // share | unshare | delete | services | regenerate
  const [shareResult, setShareResult] = useState(null);
  const act = useAction();
  const locked = p.status !== 'draft';
  const set = (patch) => { setF({ ...f, ...patch }); setDirty(true); };
  const setSvc = (i, patch) => set({ services: f.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setConcern = (i, k, patch) => setSvc(i, { concerns: f.services[i].concerns.map((x, j) => (j === k ? { ...x, ...patch } : x)) });

  const save = () => act.run(async () => {
    const res = await api('PATCH', `/proposals/${p.id}`, { title, content: fromForm(f) });
    setF(toForm(res.proposal.content));
    setDirty(false);
    toast('Saved.');
    reload();
  });
  const agreement = () => act.run(async () => {
    try {
      const res = await api('POST', `/proposals/${p.id}/agreement`, {});
      toast(`Agreement ${res.number} started with these services and prices.`);
      navigate(`/contracts/${res.id}`);
    } catch (e) {
      if (e.data?.id) { navigate(`/contracts/${e.data.id}`); return; }
      throw e;
    }
  });

  return (
    <div class="page narrow">
      <a class="small muted no-print" href={`/clients/${p.client_id}?tab=proposals`}>← {p.client_name}</a>
      <div class="page-head">
        <div style="min-width:0">
          <div class="eyebrow">Proposal{p.version ? ` · version ${p.version}` : ''}</div>
          <h1>{p.title}</h1>
          <div class="row mt" style="gap:8px"><Badge status={p.status} /><span class="faint small">{p.draft_source === 'ai' ? 'Drafted by Claude' : 'Started from the facts'}{p.generated_at ? ` · ${p.generated_by ? `${p.generated_by}, ` : ''}${dateTime(p.generated_at)}` : ''}</span></div>
        </div>
        <div class="row no-print">
          {p.contract
            ? <a class="btn secondary" href={`/contracts/${p.contract.id}`}><Icon name="doc" />Agreement {p.contract.number}</a>
            : <button class="btn secondary" disabled={act.busy || dirty} onClick={agreement}>Create agreement</button>}
          {p.status === 'shared' && <button class="btn secondary" onClick={() => setDialog('unshare')}>Unshare</button>}
          {p.status === 'draft' && <>
            <button class="btn ghost" onClick={() => setPreview(!preview)}><Icon name="eye" />{preview ? 'Edit' : 'Preview'}</button>
            <button class="btn" disabled={act.busy} onClick={() => setDialog('share')}>Share with client</button>
          </>}
          {locked && <button class="btn ghost" onClick={() => print()}><Icon name="download" />Print</button>}
        </div>
      </div>
      <dl class="kv small mb">
        {p.edited_at && <><dt>Edited</dt><dd>{p.edited_by || 'Someone'} · {dateTime(p.edited_at)}</dd></>}
        {p.shared_at && <><dt>Shared</dt><dd>{p.shared_by || 'Someone'} · {dateTime(p.shared_at)}</dd></>}
        {p.unshared_at && <><dt>Last unshared</dt><dd>{p.unshared_by || 'Someone'} · {dateTime(p.unshared_at)}</dd></>}
        {p.accepted_at && <><dt>Accepted</dt><dd>{p.accepted_name} · {dateTime(p.accepted_at)}</dd></>}
      </dl>
      {p.error && <div class="alert bad mb">{p.error}</div>}
      {p.status === 'accepted' && <div class="alert good mb no-print">{p.accepted_name} accepted this proposal. {p.contract ? <>Draft agreement <a href={`/contracts/${p.contract.id}`}>{p.contract.number}</a> has its services and prices: set the term and deposit, then send it.</> : 'Create the agreement to send it for signature.'}</div>}
      {p.status === 'shared' && <div class="alert info mb no-print">The client can see this proposal and accept it. Unshare it to make changes; they lose access until you share it again.</div>}
      {p.questions.length > 0 && (
        <section class="card mb no-print">
          <h2>Client questions</h2>
          {p.questions.map((q) => <div class="task"><div style="flex:1;min-width:0"><div style="white-space:pre-wrap">{q.note}</div><div class="meta small faint">{q.author_name} · {dateTime(q.created_at)} · on version {q.version}</div></div></div>)}
        </section>
      )}
      {p.status === 'shared' && p.delivery && <Delivery list={p.delivery} />}

      {(locked || preview) ? (
        <section class="card"><ProposalBody business={p.client_name} title={locked ? p.title : title} content={locked ? p.content : fromForm(f)} investment={p.investment} sharedAt={p.shared_at} /></section>
      ) : (
        <div class="stack">
          <section class="card stack">
            <Field label="Title"><input class="input" value={title} maxLength={160} onInput={(e) => { setTitle(e.target.value); setDirty(true); }} /></Field>
            <Field label="Introduction" help="their situation, in their terms"><textarea class="textarea" rows={6} value={f.intro} maxLength={4000} onInput={(e) => set({ intro: e.target.value })} /></Field>
          </section>
          <section class="card">
            <div class="row between"><h2 style="margin:0">Services and prices</h2><button class="btn sm secondary" disabled={dirty} onClick={() => setDialog('services')}>Change services or prices</button></div>
            {dirty && <p class="small muted">Save your text first to change services.</p>}
            <div class="table-wrap mt">
              <table>
                <thead><tr><th>Service</th><th class="num">One-time</th><th class="num">Monthly</th></tr></thead>
                <tbody>{p.investment.lines.map((l) => <tr><td>{l.name}</td><td class="num">{l.setupCents == null ? '—' : money(l.setupCents)}</td><td class="num">{l.monthlyCents == null ? '—' : money(l.monthlyCents)}</td></tr>)}</tbody>
                <tfoot><tr><th>Total</th><th class="num">{money(p.investment.setupCents)}</th><th class="num">{money(p.investment.monthlyCents)}/mo</th></tr></tfoot>
              </table>
            </div>
          </section>
          {f.services.map((s, i) => (
            <section class="card stack">
              <div><div class="eyebrow">Service {i + 1}</div><h2 style="margin:4px 0 0">{s.name}</h2>{p.services[i]?.scope && <div class="small muted">Scope: {p.services[i].scope}</div>}</div>
              <Field label="Why we chose it"><textarea class="textarea" rows={3} value={s.why} maxLength={2000} onInput={(e) => setSvc(i, { why: e.target.value })} /></Field>
              <div class="form-grid">
                <Field label="What we’ll do" help="one per line"><textarea class="textarea" rows={5} value={s.features} onInput={(e) => setSvc(i, { features: e.target.value })} /></Field>
                <Field label="What it means for them" help="one per line"><textarea class="textarea" rows={5} value={s.benefits} onInput={(e) => setSvc(i, { benefits: e.target.value })} /></Field>
              </div>
              <div>
                <div class="small" style="font-weight:600;margin-bottom:6px">What they told us</div>
                {s.concerns.map((x, k) => (
                  <div class="report-edit-section concern-edit">
                    <div class="row nowrap">
                      <input class="input" aria-label="Concern" placeholder="The concern, or what we observed" value={x.concern} maxLength={600} onInput={(e) => setConcern(i, k, { concern: e.target.value })} />
                      <button class="icon-btn" aria-label="Remove this concern" onClick={() => setSvc(i, { concerns: s.concerns.filter((_, j) => j !== k) })}><Icon name="trash" /></button>
                    </div>
                    <div class="form-grid" style="margin-top:8px">
                      <input class="input" aria-label="Their words, exactly" placeholder="Their exact words (optional)" value={x.quote} maxLength={600} onInput={(e) => setConcern(i, k, { quote: e.target.value })} />
                      <input class="input" aria-label="Source" placeholder="Source, e.g. Discovery call" value={x.source} maxLength={120} onInput={(e) => setConcern(i, k, { source: e.target.value })} />
                    </div>
                  </div>
                ))}
                <button class="btn sm secondary mt" style="margin-top:8px" onClick={() => setSvc(i, { concerns: [...s.concerns, { concern: '', quote: '', source: '' }] })}><Icon name="plus" />Add a concern</button>
              </div>
              <Field label="How it gets going" help="general terms, no dates"><textarea class="textarea" rows={2} value={s.timeline} maxLength={1000} onInput={(e) => setSvc(i, { timeline: e.target.value })} /></Field>
            </section>
          ))}
          <section class="card stack">
            <Field label="Next steps" help="one per line"><textarea class="textarea" rows={4} value={f.next_steps} onInput={(e) => set({ next_steps: e.target.value })} /></Field>
            <Field label="Notes for the team" help="never shown to the client"><textarea class="textarea" rows={4} value={f.staff_notes} onInput={(e) => set({ staff_notes: e.target.value })} /></Field>
            {act.error && <div class="alert bad">{act.error}</div>}
            <div class="row">
              <button class="btn" disabled={act.busy || !dirty} onClick={save}>Save</button>
              <span class="small muted">{dirty ? 'Unsaved changes' : p.edited ? 'Saved' : ''}</span>
              <span style="flex:1" />
              <button class="btn sm ghost" onClick={() => setDialog('regenerate')}>{p.ready.ai ? 'Generate again' : 'Rebuild from the facts'}</button>
              <button class="btn sm ghost" onClick={() => setDialog('delete')}>Delete</button>
            </div>
          </section>
        </div>
      )}
      {(locked || preview) && p.content.staff_notes?.length > 0 && (
        <section class="card no-print"><h2>Notes for the team</h2><p class="small muted" style="margin-top:0">Never shown to the client.</p><ul>{p.content.staff_notes.map((n) => <li>{n}</li>)}</ul></section>
      )}
      {act.error && (locked || preview) && <div class="alert bad">{act.error}</div>}
      <details class="card no-print facts">
        <summary>Versions ({p.versions.length})</summary>
        <p class="small muted">Every generated draft and every version shared with the client is kept.</p>
        <div class="list">{p.versions.map((v) => (
          <details class="list-item" style="display:block">
            <summary>{v.kind === 'shared' ? `Shared version ${v.version}` : 'Generated draft'} · {v.by || 'Someone'} · {dateTime(v.at)}</summary>
            <div class="mt"><ProposalBody business={p.client_name} title={p.title} content={v.content} investment={v.investment} /></div>
          </details>
        ))}</div>
      </details>
      {p.facts && (
        <details class="card no-print facts">
          <summary>Facts this proposal was built from</summary>
          <p class="small muted">Gathered {dateTime(p.generated_at)}. Claude saw only this (no prices). Generate again to refresh it.</p>
          <pre>{JSON.stringify(p.facts, null, 2)}</pre>
        </details>
      )}

      {dialog === 'share' && <ShareDialog p={p} dirty={dirty} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setShareResult(res); reload(); }} />}
      {dialog === 'unshare' && <UnshareDialog p={p} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setF(toForm(res.proposal.content)); reload(); }} />}
      {dialog === 'delete' && <DeleteDialog p={p} onClose={() => setDialog(null)} />}
      {dialog === 'services' && <ServicesDialog p={p} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setF(toForm(res.proposal.content)); reload(); }} />}
      {dialog === 'regenerate' && <RegenerateDialog p={p} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setF(toForm(res.proposal.content)); setDirty(false); reload(); }} />}
      {shareResult && !shareResult.delivery.some((d) => d.status === 'sent') && (
        <Dialog title="Shared" onClose={() => setShareResult(null)} footer={<button class="btn" onClick={() => setShareResult(null)}>Done</button>}>
          <p>{shareResult.delivery.length ? 'The proposal is in the client’s portal, but no email went out. Send them this link yourself:' : 'The proposal is in the client’s portal. Send them this link if you want them to know:'}</p>
          <div class="row nowrap"><input class="input" readOnly value={shareResult.link} /><CopyButton text={shareResult.link} /></div>
        </Dialog>
      )}
    </div>
  );
}

function Delivery({ list }) {
  if (!list.length) return null;
  return (
    <div class="alert small mb no-print">
      {list.map((d) => <div>{d.name} ({d.email}): <span class={`badge ${DELIVERY[d.status]?.[1] || ''}`}>{DELIVERY[d.status]?.[0] || d.status}</span>{d.error && d.status !== 'not_configured' ? ` ${d.error}` : ''}</div>)}
    </div>
  );
}

function ServicesDialog({ p, onClose, onDone }) {
  const { loading, data, error } = useLoad(`/clients/${p.client_id}/proposals`);
  const [edited, setPick] = useState(null);
  const pick = edited || (data ? pickState(data.services, p.services) : null);
  const act = useAction();
  const go = () => act.run(async () => { onDone(await api('PATCH', `/proposals/${p.id}`, { services: pickedServices(data.services, pick) })); toast('Services saved.'); });
  return (
    <Dialog title="Services and prices" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" disabled={act.busy || !pick} onClick={go}>Save</button></>}>
      {loading || !pick ? <Loading /> : error ? <ErrorBox error={error} /> : <>
        <p class="small muted" style="margin-top:0">What you wrote for services that stay is kept. New services start empty: write them by hand or generate again.</p>
        <ServiceChecklist catalog={data.services} pick={pick} setPick={setPick} />
      </>}
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function RegenerateDialog({ p, onClose, onDone }) {
  const act = useAction();
  const go = () => act.run(async () => {
    const res = await api('POST', `/proposals/${p.id}/generate`, { overwrite: true });
    toast(res.proposal.draft_source === 'ai' ? 'Claude drafted it again.' : 'Rebuilt from the facts.');
    onDone(res);
  });
  return (
    <Dialog title={p.ready.ai ? 'Generate again?' : 'Rebuild from the facts?'} onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>{act.busy ? (p.ready.ai ? 'Claude is writing…' : 'Gathering…') : 'Replace the text'}</button></>}>
      <p>The facts are gathered again and the text is replaced{p.edited ? ', including your team’s edits' : ''}. Services and prices stay. The current text is kept under Versions.</p>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function ShareDialog({ p, dirty, onClose, onDone }) {
  const [email, setEmail] = useState(p.ready.email);
  const act = useAction();
  const go = () => act.run(async () => {
    const res = await api('POST', `/proposals/${p.id}/share`, { email });
    const sent = res.delivery.filter((d) => d.status === 'sent').length;
    toast(sent ? `Shared and emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.` : 'Shared. The client can see it in their portal.');
    onDone(res);
  });
  return (
    <Dialog title="Share this proposal?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" disabled={act.busy || dirty} onClick={go}>{act.busy ? 'Sharing…' : 'Share'}</button></>}>
      {dirty && <div class="alert warn">Save your changes first.</div>}
      <p>The client’s portal logins will see it on their home page and can accept it or ask a question. Notes for the team and the facts stay internal. After sharing, it can’t be edited unless you unshare it.</p>
      <label class="check"><input type="checkbox" checked={email} disabled={!p.ready.email} onChange={(e) => setEmail(e.target.checked)} />Email the client’s portal logins a link</label>
      {!p.ready.email && <p class="small muted">Email isn’t set up (RESEND_API_KEY), so nothing will be emailed. You’ll get the link to send yourself.</p>}
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function UnshareDialog({ p, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const act = useAction();
  const go = () => act.run(async () => { onDone(await api('POST', `/proposals/${p.id}/unshare`, { reason })); toast('Unshared. You can edit it now.'); });
  return (
    <Dialog title="Unshare this proposal?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>Unshare</button></>}>
      <p>The client stops seeing it until you share it again, as a new version. This is recorded in the client’s activity.</p>
      <Field label="Reason (optional)"><input class="input" value={reason} maxLength={300} onInput={(e) => setReason(e.target.value)} placeholder="Add AI search visibility" /></Field>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function DeleteDialog({ p, onClose }) {
  const act = useAction();
  const go = () => act.run(async () => { await api('DELETE', `/proposals/${p.id}`); toast('Proposal deleted.'); navigate(`/clients/${p.client_id}?tab=proposals`); });
  return (
    <Dialog title="Delete this proposal?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>Delete</button></>}>
      <p>The draft, its versions and its facts are removed for good.</p>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

// ---------- Client view ----------

function ClientProposal({ data, reload }) {
  const p = data.proposal;
  const [dialog, setDialog] = useState(null); // accept | ask
  const open = p.status === 'shared';
  return (
    <div class="page monthly-page" style="max-width:860px">
      <div class="row between no-print mb"><a class="small muted" href="/">← Home</a><button class="btn secondary" onClick={() => print()}><Icon name="download" />Save as PDF</button></div>
      {p.status === 'accepted' && <div class="alert good mb">You accepted this proposal on {date(p.accepted_at)}. Your Detcord team is preparing your service agreement; you’ll get it in your portal to review and sign. Nothing is signed or billed until then.</div>}
      {open && (
        <section class="card mb no-print respond">
          <div style="flex:1;min-width:0"><strong>Ready to go ahead?</strong><div class="small muted">Accepting tells us to prepare your service agreement with these services and prices. You review and sign it before anything starts or is billed.</div></div>
          <div class="row"><button class="btn secondary" onClick={() => setDialog('ask')}>Ask a question</button><button class="btn" onClick={() => setDialog('accept')}><Icon name="check" />Accept proposal</button></div>
        </section>
      )}
      <ProposalBody business={p.business} title={p.title} content={p.content} investment={p.investment} sharedAt={p.shared_at} />
      {p.questions.length > 0 && (
        <section class="card mt no-print">
          <h2>Your questions</h2>
          {p.questions.map((q) => <div class="task"><div style="flex:1;min-width:0"><div style="white-space:pre-wrap">{q.note}</div><div class="small faint">{q.author_name} · {dateTime(q.created_at)}</div></div></div>)}
        </section>
      )}
      <p class="faint small center mt">Questions? Email <a href={`mailto:${data.contact.email}`}>{data.contact.email}</a>{data.contact.phone ? ` or call ${data.contact.phone}` : ''}.</p>
      {dialog === 'accept' && <AcceptDialog p={p} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog === 'ask' && <AskDialog p={p} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
    </div>
  );
}

function AcceptDialog({ p, onClose, onDone }) {
  const act = useAction();
  const go = () => act.run(async () => { await api('POST', `/proposals/${p.id}/accept`, {}); toast('Accepted. Your Detcord team will send your agreement.'); onDone(); });
  return (
    <Dialog title="Accept this proposal?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Not yet</button><button class="btn" disabled={act.busy} onClick={go}>{act.busy ? 'Accepting…' : 'Accept proposal'}</button></>}>
      <p>We’ll prepare your service agreement with {p.content.services.length === 1 ? 'this service' : `these ${p.content.services.length} services`} and prices: {money(p.investment.setupCents)} one-time and {money(p.investment.monthlyCents)} a month.</p>
      <p class="small muted">Accepting doesn’t sign anything or charge you. You review the agreement and sign it in your portal.</p>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function AskDialog({ p, onClose, onDone }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const go = () => act.run(async () => { await api('POST', `/proposals/${p.id}/questions`, { note }); toast('Sent. Your Detcord team will get back to you.'); onDone(); });
  return (
    <Dialog title="Ask a question or request changes" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" disabled={act.busy || !note.trim()} onClick={go}>Send</button></>}>
      <Field label="Your question"><textarea class="textarea" rows={5} value={note} maxLength={4000} onInput={(e) => setNote(e.target.value)} placeholder="Could we start with SEO and add the rest later?" /></Field>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

// Client home and Business page: proposals shared with them.
export function ProposalsCard({ clientId }) {
  const { data } = useLoad('/proposals');
  const list = (data?.proposals || []).filter((p) => !clientId || p.client_id === clientId);
  if (!list.length) return null;
  return (
    <section class="card mb">
      <h2>Proposals</h2>
      <div class="list one-col">{list.slice(0, 5).map((p) => (
        <a class="list-item" href={`/proposals/${p.id}`}>
          <Icon name="doc" />
          <div style="flex:1;min-width:0"><div class="title truncate">{p.title}</div><div class="meta truncate">{p.services.join(', ')}</div></div>
          {p.status === 'accepted' ? <span class="badge good">Accepted</span> : <span class="btn sm">Review</span>}
        </a>
      ))}</div>
    </section>
  );
}
