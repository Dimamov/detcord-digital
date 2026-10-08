import { useState, useRef } from 'preact/hooks';
import { useLoad, api, toast, navigate, date, dateTime } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, Field, Dialog, CopyButton, useAction } from '../ui.jsx';

const TONE = { draft: 'info', ready: 'accent', shared: 'good' };
const Badge = ({ r }) => <span class={`badge ${TONE[r.status] || ''}`}>{r.status_label}</span>;
const DELIVERY = { sent: ['Sent', 'good'], not_configured: ['Not sent: email isn’t set up', 'warn'], failed: ['Failed', 'bad'], skipped: ['Not sent', ''] };

// The last 12 months, newest first, as "YYYY-MM".
function months(current) {
  const [y, m] = current.split('-').map(Number);
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 15));
    return { v: d.toISOString().slice(0, 7), l: d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + (i === 0 ? ' (so far)' : '') };
  });
}

// ---------- Client record tab (staff) ----------

export function ReportsTab({ client }) {
  const { loading, data, error, reload } = useLoad(`/clients/${client.id}/monthly-reports`);
  const [month, setMonth] = useState(null);
  const [notes, setNotes] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const act = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const picked = month || data.defaultMonth;
  const existing = data.reports.find((r) => r.month === picked);

  const generate = (overwrite = false) => act.run(async () => {
    try {
      const res = await api('POST', `/clients/${client.id}/monthly-reports`, { month: picked, meetingNotes: notes, overwrite });
      setConfirm(false);
      toast(res.report.draft_source === 'ai' ? 'Claude drafted the report. Review it before sharing.' : 'Report started from the facts. Write it up, then share.');
      navigate(`/reports/monthly/${res.report.id}`);
    } catch (e) {
      if (e.data?.needsConfirm) { setConfirm(true); return; }
      throw e;
    }
  });

  return (
    <div class="stack">
      {!data.ready.ai && <div class="alert warn">Claude is not set up yet (ANTHROPIC_API_KEY), so reports start from the facts and your team writes them by hand.</div>}
      <section class="card">
        <h2>Monthly report</h2>
        <p class="small muted" style="margin-top:0">Built only from what the portal recorded for {client.name} that month: requests, website checks, services, invoices, agreements, meetings and tasks. Traffic, rankings and ad results aren’t connected, so they’re never included. Nothing is shared until you press Share.</p>
        <div class="row" style="align-items:flex-end">
          <Field label="Month">
            <select class="select" value={picked} onChange={(e) => setMonth(e.target.value)}>
              {months(data.currentMonth).map((m) => <option value={m.v}>{m.l}</option>)}
            </select>
          </Field>
          <button class="btn" disabled={act.busy || existing?.status === 'shared'} onClick={() => generate(false)}>
            {act.busy ? (data.ready.ai ? 'Claude is writing…' : 'Gathering…') : existing ? 'Generate again' : data.ready.ai ? 'Generate with Claude' : 'Start from the facts'}
          </button>
        </div>
        <label class="check mt"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />Include meeting summaries (never transcripts). Off: only meeting titles and dates.</label>
        {existing?.status === 'shared' && <p class="small muted">This month is shared. Open it and unshare it to make changes.</p>}
        {existing && existing.status !== 'shared' && <p class="small muted">Generating again replaces the current draft{existing.edited ? ', including your team’s edits' : ''}.</p>}
        {act.error && <div class="alert bad mt">{act.error}</div>}
      </section>
      <section class="card">
        <h2>Reports</h2>
        {data.reports.length === 0 ? <Empty title="No reports yet">Pick a month above to start one.</Empty> : (
          <div class="list">{data.reports.map((r) => (
            <a class="list-item" href={`/reports/monthly/${r.id}`}>
              <Icon name="doc" />
              <div style="flex:1;min-width:0"><div class="title">{r.month_label}</div><div class="meta truncate">{r.headline || 'No headline yet'}{r.shared_at ? ` · shared ${date(r.shared_at)}` : ''}</div></div>
              <Badge r={r} />
            </a>
          ))}</div>
        )}
      </section>
      {confirm && (
        <Dialog title="Replace your team’s edits?" onClose={() => setConfirm(false)}
          footer={<><button class="btn secondary" onClick={() => setConfirm(false)}>Keep my edits</button><button class="btn danger" disabled={act.busy} onClick={() => generate(true)}>Replace</button></>}>
          <p>Someone on your team edited this report. Generating it again replaces those edits with a new draft.</p>
        </Dialog>
      )}
    </div>
  );
}

// ---------- One report: staff edit and share; clients read ----------

export function MonthlyReportPage({ id }) {
  const { loading, data, error, reload } = useLoad(`/monthly-reports/${id}`, [id]);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  if (!data.staff) {
    const r = data.report;
    return (
      <div class="page monthly-page" style="max-width:820px">
        <div class="row between no-print mb"><a class="small muted" href="/reports">← Reports</a><button class="btn secondary" onClick={() => print()}><Icon name="download" />Save as PDF</button></div>
        <ReportBody business={r.business} label={r.month_label} content={r.content} />
        <p class="faint small center mt">Questions about this report? Email <a href={`mailto:${data.contact.email}`}>{data.contact.email}</a>{data.contact.phone ? ` or call ${data.contact.phone}` : ''}.</p>
      </div>
    );
  }
  return <StaffReport r={data.report} reload={reload} />;
}

function ReportBody({ business, label, content: c }) {
  return (
    <article class="monthly-report">
      <header>
        <div class="eyebrow">Monthly report · {label}</div>
        <div class="faint small">{business}</div>
        <h1>{c.headline || 'Untitled report'}</h1>
      </header>
      {c.summary && <p class="lead">{c.summary}</p>}
      {c.sections.map((s) => (
        <section>
          <h2>{s.title}</h2>
          {s.bullets.length ? <ul>{s.bullets.map((b) => <li>{b}</li>)}</ul> : <p class="muted">Nothing to report.</p>}
        </section>
      ))}
      {c.next_month?.length > 0 && (
        <section class="next">
          <h2>Next month</h2>
          <ul>{c.next_month.map((b) => <li>{b}</li>)}</ul>
        </section>
      )}
      <footer class="faint small">Prepared by Detcord Digital from the work recorded in your portal.</footer>
    </article>
  );
}

const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const toForm = (c) => ({ ...c, sections: c.sections.map((s) => ({ title: s.title, bullets: s.bullets.join('\n') })), next_month: c.next_month.join('\n'), staff_notes: c.staff_notes.join('\n') });
const fromForm = (f) => ({ ...f, sections: f.sections.map((s) => ({ title: s.title, bullets: lines(s.bullets) })), next_month: lines(f.next_month), staff_notes: lines(f.staff_notes) });

function StaffReport({ r, reload }) {
  const [f, setF] = useState(() => toForm(r.content));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState(null); // share | unshare | delete
  const [shareResult, setShareResult] = useState(null);
  const act = useAction();
  const shared = r.status === 'shared';
  const set = (patch) => { setF({ ...f, ...patch }); setDirty(true); };
  const setSection = (i, patch) => set({ sections: f.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = (extra = {}) => act.run(async () => {
    const res = await api('PATCH', `/monthly-reports/${r.id}`, { content: fromForm(f), ...extra });
    setF(toForm(res.report.content));
    setDirty(false);
    toast(extra.status === 'ready' ? 'Marked ready to share.' : 'Saved.');
    reload();
  });

  return (
    <div class="page narrow">
      <a class="small muted no-print" href={`/clients/${r.client_id}?tab=reports`}>← {r.client_name}</a>
      <div class="page-head">
        <div>
          <div class="eyebrow">Monthly report</div>
          <h1>{r.month_label}</h1>
          <div class="row mt" style="gap:8px"><Badge r={r} /><span class="faint small">{r.draft_source === 'ai' ? 'Drafted by Claude' : 'Started from the facts'} · {r.generated_by ? `${r.generated_by}, ` : ''}{dateTime(r.generated_at)}</span></div>
        </div>
        <div class="row no-print">
          {shared
            ? <button class="btn secondary" onClick={() => setDialog('unshare')}>Unshare</button>
            : <>
              <button class="btn ghost" onClick={() => setPreview(!preview)}><Icon name="eye" />{preview ? 'Edit' : 'Preview'}</button>
              <button class="btn" disabled={act.busy} onClick={() => setDialog('share')}>Share with client</button>
            </>}
        </div>
      </div>
      <dl class="kv small mb">
        {r.edited_at && <><dt>Edited</dt><dd>{r.edited_by || 'Someone'} · {dateTime(r.edited_at)}</dd></>}
        {r.shared_at && <><dt>Shared</dt><dd>{r.shared_by || 'Someone'} · {dateTime(r.shared_at)}</dd></>}
        {r.unshared_at && <><dt>Last unshared</dt><dd>{r.unshared_by || 'Someone'} · {dateTime(r.unshared_at)}</dd></>}
      </dl>
      {r.error && <div class="alert bad mb">{r.error}</div>}
      {!r.ready.ai && r.draft_source === 'staff' && !shared && <div class="alert warn mb">Claude is not set up yet (ANTHROPIC_API_KEY). The facts are filled in below as a starting point; write the headline and summary yourself.</div>}

      {shared && <div class="alert info mb">The client can see this report. Unshare it to make changes; they lose access until you share it again.</div>}
      {shared && r.delivery && <Delivery list={r.delivery} />}
      {(shared || preview) ? (
        <section class="card"><ReportBody business={r.client_name} label={r.month_label} content={shared ? r.content : fromForm(f)} /></section>
      ) : (
        <section class="card stack">
          <Field label="Headline"><input class="input" value={f.headline} maxLength={200} onInput={(e) => set({ headline: e.target.value })} /></Field>
          <Field label="Summary"><textarea class="textarea" rows={5} value={f.summary} maxLength={3000} onInput={(e) => set({ summary: e.target.value })} /></Field>
          {f.sections.map((s, i) => (
            <div class="report-edit-section">
              <div class="row nowrap">
                <input class="input" aria-label="Section title" value={s.title} maxLength={120} onInput={(e) => setSection(i, { title: e.target.value })} />
                <button class="icon-btn" aria-label={`Remove section ${s.title}`} onClick={() => set({ sections: f.sections.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
              </div>
              <textarea class="textarea mt" rows={Math.max(3, s.bullets.split('\n').length + 1)} aria-label={`${s.title} bullets, one per line`} value={s.bullets} onInput={(e) => setSection(i, { bullets: e.target.value })} />
            </div>
          ))}
          <button class="btn sm secondary" style="align-self:flex-start" onClick={() => set({ sections: [...f.sections, { title: '', bullets: '' }] })}><Icon name="plus" />Add a section</button>
          <Field label="Next month" help="one per line"><textarea class="textarea" rows={4} value={f.next_month} onInput={(e) => set({ next_month: e.target.value })} /></Field>
          <Field label="Notes for the team" help="never shown to the client"><textarea class="textarea" rows={4} value={f.staff_notes} onInput={(e) => set({ staff_notes: e.target.value })} /></Field>
          {act.error && <div class="alert bad">{act.error}</div>}
          <div class="row">
            <button class="btn" disabled={act.busy || !dirty} onClick={() => save()}>Save</button>
            {r.status === 'draft' && <button class="btn secondary" disabled={act.busy} onClick={() => save({ status: 'ready' })}>Save and mark ready</button>}
            <span class="small muted">{dirty ? 'Unsaved changes' : r.edited ? 'Saved' : ''}</span>
            <span style="flex:1" />
            <button class="btn sm ghost" onClick={() => setDialog('delete')}>Delete</button>
          </div>
        </section>
      )}
      {(shared || preview) && r.content.staff_notes?.length > 0 && (
        <section class="card no-print"><h2>Notes for the team</h2><p class="small muted" style="margin-top:0">Never shown to the client.</p><ul>{r.content.staff_notes.map((n) => <li>{n}</li>)}</ul></section>
      )}
      <details class="card no-print facts">
        <summary>Facts this report was built from</summary>
        <p class="small muted">Gathered {dateTime(r.generated_at)}{r.meeting_notes ? ', with meeting summaries' : ''}. Claude saw only this. Generate again from the client’s Reports tab to refresh it.</p>
        <pre>{JSON.stringify(r.facts, null, 2)}</pre>
      </details>

      {dialog === 'share' && <ShareDialog r={r} dirty={dirty} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setShareResult(res); reload(); }} />}
      {dialog === 'unshare' && <UnshareDialog r={r} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setF(toForm(res.report.content)); reload(); }} />}
      {dialog === 'delete' && <DeleteDialog r={r} onClose={() => setDialog(null)} />}
      {shareResult && !shareResult.delivery.some((d) => d.status === 'sent') && (
        <Dialog title="Shared" onClose={() => setShareResult(null)} footer={<button class="btn" onClick={() => setShareResult(null)}>Done</button>}>
          <p>{shareResult.delivery.length ? 'The report is in the client’s portal, but no email went out. Send them this link yourself:' : 'The report is in the client’s portal. Send them this link if you want them to know:'}</p>
          <div class="row nowrap"><input class="input" readOnly value={shareResult.link} /><CopyButton text={shareResult.link} /></div>
        </Dialog>
      )}
    </div>
  );
}

function Delivery({ list }) {
  if (!list.length) return null;
  return (
    <div class="alert small mb">
      {list.map((d) => <div>{d.name} ({d.email}): <span class={`badge ${DELIVERY[d.status]?.[1] || ''}`}>{DELIVERY[d.status]?.[0] || d.status}</span>{d.error && d.status !== 'not_configured' ? ` ${d.error}` : ''}</div>)}
    </div>
  );
}

function ShareDialog({ r, dirty, onClose, onDone }) {
  const [email, setEmail] = useState(r.ready.email);
  const act = useAction();
  const go = () => act.run(async () => {
    const res = await api('POST', `/monthly-reports/${r.id}/share`, { email });
    const sent = res.delivery.filter((d) => d.status === 'sent').length;
    toast(sent ? `Shared and emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.` : 'Shared. The client can see it in their portal.');
    onDone(res);
  });
  return (
    <Dialog title={`Share the ${r.month_label} report?`} onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn" disabled={act.busy || dirty} onClick={go}>{act.busy ? 'Sharing…' : 'Share'}</button></>}>
      {dirty && <div class="alert warn">Save your changes first.</div>}
      <p>The client’s portal logins will see this report under Reports. Notes for the team and the facts stay internal. After sharing, it can’t be edited unless you unshare it.</p>
      <label class="check"><input type="checkbox" checked={email} disabled={!r.ready.email} onChange={(e) => setEmail(e.target.checked)} />Email the client’s portal logins a link</label>
      {!r.ready.email && <p class="small muted">Email isn’t set up (RESEND_API_KEY), so nothing will be emailed. You’ll get the link to send yourself.</p>}
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function UnshareDialog({ r, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const act = useAction();
  const go = () => act.run(async () => { onDone(await api('POST', `/monthly-reports/${r.id}/unshare`, { reason })); toast('Unshared. You can edit it now.'); });
  return (
    <Dialog title="Unshare this report?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>Unshare</button></>}>
      <p>The client stops seeing it until you share it again. This is recorded in the client’s activity.</p>
      <Field label="Reason (optional)"><input class="input" value={reason} maxLength={300} onInput={(e) => setReason(e.target.value)} placeholder="Fix a typo" /></Field>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

function DeleteDialog({ r, onClose }) {
  const act = useAction();
  const go = () => act.run(async () => { await api('DELETE', `/monthly-reports/${r.id}`); toast('Report deleted.'); navigate(`/clients/${r.client_id}?tab=reports`); });
  return (
    <Dialog title="Delete this report?" onClose={onClose}
      footer={<><button class="btn secondary" onClick={onClose}>Cancel</button><button class="btn danger" disabled={act.busy} onClick={go}>Delete</button></>}>
      <p>The draft and its facts are removed for good. You can generate the month again later.</p>
      {act.error && <div class="alert bad">{act.error}</div>}
    </Dialog>
  );
}

// ---------- Reports page: clients see what's shared with them; staff see every report they can reach ----------

export function ReportsPage({ user }) {
  const staff = user.role !== 'client';
  const monthly = useLoad('/monthly-reports');
  const checks = useLoad(staff ? null : '/reports');
  if (monthly.loading) return <div class="page"><Loading /></div>;
  if (monthly.error) return <div class="page"><ErrorBox error={monthly.error} retry={monthly.reload} /></div>;
  const list = monthly.data.reports;
  const sites = checks.data?.reports || [];
  return (
    <div class="page narrow">
      <div class="page-head"><div><div class="eyebrow">{staff ? 'All clients' : 'Your business'}</div><h1>Reports</h1></div></div>
      <section class="card">
        <h2>Monthly reports</h2>
        {list.length === 0 ? <Empty title="No monthly reports yet">{staff ? 'Start one from a client’s Reports tab.' : 'Your Detcord team shares a short report on each month’s work here.'}</Empty> : (
          <div class="list">{list.map((r) => (
            <a class="list-item" href={`/reports/monthly/${r.id}`}>
              <Icon name="doc" />
              <div style="flex:1;min-width:0"><div class="title">{staff ? `${r.client_name} · ` : ''}{r.month_label}</div><div class="meta truncate">{r.headline}</div></div>
              {staff ? <Badge r={r} /> : <span class="btn sm">Read</span>}
            </a>
          ))}</div>
        )}
      </section>
      {sites.length > 0 && (
        <section class="card">
          <h2>Website checks</h2>
          <div class="list">{sites.map((r) => (
            <a class="list-item" href={`/reports/${r.id}`}>
              <Icon name="globe" />
              <div style="flex:1;min-width:0"><div class="title">Website and Google check: {r.score}/100</div><div class="meta truncate">{r.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} · {date(r.shared_at)}</div></div>
              <span class="btn sm">View</span>
            </a>
          ))}</div>
        </section>
      )}
    </div>
  );
}

// Client home card: the latest shared monthly reports.
export function MonthlyReportsCard() {
  const { data } = useLoad('/monthly-reports');
  const list = (data?.reports || []).slice(0, 3);
  if (!list.length) return null;
  return (
    <section class="card mb">
      <div class="card-head"><h2>Monthly reports</h2><a class="small muted" href="/reports">All reports</a></div>
      <div class="list">{list.map((r) => (
        <a class="list-item" href={`/reports/monthly/${r.id}`}>
          <Icon name="doc" />
          <div style="flex:1;min-width:0"><div class="title">{r.month_label}</div><div class="meta truncate">{r.headline}</div></div>
          <span class="btn sm">Read</span>
        </a>
      ))}</div>
    </section>
  );
}

// ---------- Settings (admin): draft a month for every active client ----------

export function BulkReports() {
  const { data } = useLoad('/settings/integrations/goat');
  const [state, setState] = useState(null); // { month_label, total, done, results, running }
  const stop = useRef(false);
  const [error, setError] = useState(null);
  const run = async () => {
    stop.current = false;
    setError(null);
    let offset = 0;
    let acc = { results: [], done: 0, total: null, running: true };
    setState(acc);
    try {
      while (offset !== null && !stop.current) {
        const res = await api('POST', '/monthly-reports/bulk', { offset });
        acc = { ...acc, month_label: res.month_label, total: res.total, done: res.done, results: [...acc.results, ...res.results] };
        setState(acc);
        offset = res.next;
      }
    } catch (e) {
      setError(`${e.message} The reports already drafted are kept; press the button again to carry on.`);
    }
    setState({ ...acc, running: false });
  };
  const count = (s) => state.results.filter((x) => x.status === s).length;
  const ai = data?.claude?.configured;
  return (
    <section class="card">
      <h2>Monthly reports</h2>
      <p class="muted">Creates a draft of last month’s report for every active client{ai ? ', written by Claude,' : ''} one client at a time. Clients that already have a report for that month are skipped. Nothing is shared: your team reviews each draft on the client’s Reports tab.</p>
      {data && !ai && <div class="alert warn">Claude is not set up yet (ANTHROPIC_API_KEY), so drafts start from the facts and your team writes them by hand.</div>}
      <div class="row">
        <button class="btn" disabled={state?.running} onClick={run}>{state?.running ? 'Drafting…' : 'Draft last month’s reports for all active clients'}</button>
        {state?.running && <button class="btn ghost" onClick={() => { stop.current = true; }}>Stop after this batch</button>}
      </div>
      {state && (
        <div class="mt">
          <div class="small">{state.month_label || 'Starting'}{state.total != null ? `: ${state.done} of ${state.total} clients` : ''}</div>
          {state.total ? <div class="progress"><div style={`width:${Math.round((state.done / state.total) * 100)}%`} /></div> : null}
          {!state.running && state.total != null && <p class="small muted">{count('created')} drafted, {count('manual')} need writing by hand, {count('skipped')} already had a report, {count('failed')} failed.</p>}
          {state.results.filter((x) => x.status !== 'skipped').length > 0 && (
            <div class="list mt">{state.results.filter((x) => x.status !== 'skipped').map((x) => (
              <a class="list-item" href={x.id ? `/reports/monthly/${x.id}` : `/clients/${x.client_id}?tab=reports`}>
                <div style="flex:1;min-width:0"><div class="title">{x.name}</div>{x.error && <div class="meta">{x.error}</div>}</div>
                <span class={`badge ${x.status === 'created' ? 'good' : x.status === 'failed' ? 'bad' : 'warn'}`}>{{ created: 'Drafted', manual: 'Write by hand', failed: 'Failed' }[x.status]}</span>
              </a>
            ))}</div>
          )}
        </div>
      )}
      {error && <div class="alert bad mt">{error}</div>}
    </section>
  );
}
