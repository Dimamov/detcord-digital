import { useEffect, useRef, useState } from 'preact/hooks';
import { api, useLoad, navigate, toast, query, date, dateTime, ago } from '../lib.js';
import { Icon, Loading, ErrorBox, Empty, Field, Dialog, useAction, CopyButton, Spinner } from '../ui.jsx';

const STEPS = ['Loading the homepage', 'Reading key pages, links and images', 'Running Google\'s mobile and desktop speed tests', 'Looking up the Google Business Profile and nearby competitors', 'Scoring and writing up the findings'];
const SEVERITY = {
  critical: { label: 'Fix first', tone: 'bad', blurb: 'These cost you customers right now.' },
  important: { label: 'Fix next', tone: 'warn', blurb: 'Clear opportunities to rank higher and get more calls.' },
  minor: { label: 'Worth fixing', tone: 'info', blurb: 'Smaller improvements that add up.' },
};
const tone = (s) => (s == null ? '' : s >= 80 ? 'good' : s >= 55 ? 'warn' : 'bad');
const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);

// ---------- Client record tab ----------
export function AuditsTab({ client, user, onChanged }) {
  const { loading, data, error, reload } = useLoad(`/clients/${client.id}/audits`);
  const [url, setUrl] = useState(client.website || '');
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [runError, setRunError] = useState(null);
  const started = useRef(false);

  const start = async () => {
    setRunError(null);
    setRunning(true);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 7000);
    try {
      const a = await api('POST', `/clients/${client.id}/audits`, { url });
      if (a.status === 'failed') { setRunError(a.error || 'The check could not finish.'); reload(); }
      else navigate(`/audits/${a.id}`);
      onChanged?.();
    } catch (e) {
      setRunError(e.message);
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  };

  // "Create client and run a check" lands here with ?run=1.
  useEffect(() => {
    if (query().run === '1' && !started.current && url) {
      started.current = true;
      history.replaceState({}, '', '?tab=audits');
      start();
    }
  }, []);

  return (
    <div class="stack">
      <div class="card">
        <div class="card-head"><h2>Website and Google check</h2></div>
        <p class="muted small" style="margin-top:-6px">Checks search visibility, local search and the Google Business Profile, mobile experience, speed, security and broken links, then writes a plain-English report you can email or text to the customer.</p>
        {running ? (
          <div class="audit-progress" role="status" aria-live="polite">
            <Spinner />
            <ol>
              {STEPS.map((s, i) => <li class={i < step ? 'done' : i === step ? 'now' : ''}>{i < step ? <Icon name="check" size={14} /> : <span class="dot" />}{s}</li>)}
            </ol>
            <p class="faint small">This usually takes 20 to 60 seconds. Keep this page open.</p>
          </div>
        ) : (
          <form class="row wrap" style="gap:10px;align-items:flex-end" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <Field label="Website"><input class="input" style="min-width:280px" placeholder="example.com" value={url} onInput={(e) => setUrl(e.target.value)} required /></Field>
            <button class="btn"><Icon name="bolt" />Run website check</button>
          </form>
        )}
        {runError && <div class="alert bad mt">{runError}</div>}
      </div>

      <div class="card">
        <div class="card-head"><h2>Past checks</h2></div>
        {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !data.audits.length ? (
          <Empty title="No checks yet">Run the first one above. It makes a strong opener for a sales call.</Empty>
        ) : (
          <div class="list">
            {data.audits.map((a) => (
              <a class="list-item" href={`/audits/${a.id}`}>
                <span class={`score-pill ${tone(a.score)}`}>{a.status === 'done' ? a.score : a.status === 'running' ? '…' : '!'}</span>
                <div style="flex:1;min-width:0">
                  <div class="truncate"><strong>{a.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong></div>
                  <div class="faint small">{a.status === 'failed' ? a.error : a.status === 'running' ? 'Running now' : `${dateTime(a.created_at)}${a.by_name ? ` · ${a.by_name}` : ''}`}</div>
                </div>
                {a.sent > 0 && <span class="badge good">Sent</span>}
                <Icon name="arrow" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Staff audit page ----------
export function AuditPage({ id, user }) {
  const { loading, data, error, reload } = useLoad(`/audits/${id}`);
  const [sending, setSending] = useState(null);
  const [manual, setManual] = useState(null);
  const [note, setNote] = useState(null);
  const { run, busy } = useAction();
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const a = data;
  const hidden = new Set(a.hidden);
  const toggle = (fid) => run(async () => {
    const next = hidden.has(fid) ? a.hidden.filter((h) => h !== fid) : [...a.hidden, fid];
    await api('PATCH', `/audits/${a.id}`, { hidden: next });
    await reload();
  });
  const saveNote = () => run(async () => { await api('PATCH', `/audits/${a.id}`, { note }); setNote(null); toast('Note saved.'); await reload(); });
  const remove = () => run(async () => {
    if (!confirm('Delete this check? It also disappears from the customer\'s portal.')) return;
    await api('DELETE', `/audits/${a.id}`);
    navigate(`/clients/${a.clientId}?tab=audits`);
  });

  return (
    <div class="page" style="max-width:1080px">
      <div class="page-head">
        <div>
          <a class="small muted" href={`/clients/${a.clientId}?tab=audits`}>← {a.client.name}</a>
          <h1>Website check</h1>
          <p class="sub">{a.url.replace(/\/$/, '')} · {dateTime(a.createdAt)}</p>
        </div>
        {a.status === 'done' && (
          <div class="row wrap">
            <a class="btn ghost" href={`/reports/${a.id}`}><Icon name="eye" />Customer view</a>
            <button class="btn secondary" onClick={() => setSending('sms')}><Icon name="phone" />Text</button>
            <button class="btn" onClick={() => setSending('email')}><Icon name="mail" />Email</button>
          </div>
        )}
      </div>
      {a.status === 'failed' && <div class="alert bad">{a.error}</div>}
      {a.status === 'running' && <div class="alert">This check is still running. Refresh in a moment.</div>}
      {manual && (
        <div class="alert warn mb">
          <strong>{manual.channel === 'sms' ? 'Texting' : 'Email'} isn't connected yet, so nothing was sent.</strong> The report is in {manual.name}'s portal. Send them this {manual.kind === 'invite' ? 'one-time setup link (valid 7 days)' : 'link'} yourself:
          <div class="row mt"><code class="small" style="word-break:break-all">{manual.link}</code><CopyButton text={manual.link} /></div>
        </div>
      )}
      {a.status === 'done' && (
        <div class="grid main-side">
          <div>
            <Report r={a.result} business={a.client.name} categories={a.categories} serviceNames={a.serviceNames} hidden={hidden} onToggle={toggle} staff shotBase={`/api/reports/${a.id}/shot`} />
          </div>
          <aside class="stack">
            <div class="card">
              <h3>Note to the customer</h3>
              <p class="faint small" style="margin-top:-6px">Shown at the top of their report and in the email.</p>
              <textarea class="input" rows="4" maxLength={1500} placeholder="Great talking with you today. Here's what we found…" value={note ?? a.note ?? ''} onInput={(e) => setNote(e.target.value)} />
              {note !== null && <div class="row mt"><button class="btn sm" onClick={saveNote} disabled={busy}>Save note</button><button class="btn sm ghost" onClick={() => setNote(null)}>Cancel</button></div>}
            </div>
            <div class="card">
              <h3>In the customer's portal</h3>
              <div class="faint small">{a.sharedAt ? `Visible to ${a.client.name}'s portal logins since ${date(a.sharedAt)}.` : 'Not yet. It appears in their portal when you first email or text it.'}</div>
              {hidden.size > 0 && <div class="alert mt small">{hidden.size} finding{hidden.size === 1 ? ' is' : 's are'} hidden from the customer.</div>}
            </div>
            <div class="card">
              <h3>Sent</h3>
              {a.deliveries.length ? (
                <div class="stack" style="gap:8px">
                  {a.deliveries.map((d) => (
                    <div class="small">
                      <div class="row between"><span><Icon name={d.channel === 'sms' ? 'phone' : 'mail'} size={14} /> {d.recipient}</span><span class={`badge ${d.status === 'sent' ? 'good' : 'bad'}`}>{d.status === 'sent' ? 'Sent' : d.status === 'not_configured' ? 'Not sent' : 'Failed'}</span></div>
                      <div class="faint">{ago(d.created_at)}{d.by_name ? ` · ${d.by_name}` : ''} · {d.link_kind === 'invite' ? 'password setup link' : 'sign-in link'}{d.error ? ` · ${d.error}` : ''}</div>
                    </div>
                  ))}
                </div>
              ) : <div class="faint small">Not sent yet.</div>}
            </div>
            <button class="btn ghost sm" onClick={remove} disabled={busy}><Icon name="trash" size={14} />Delete this check</button>
          </aside>
        </div>
      )}
      {sending && <SendDialog audit={a} channel={sending} onClose={() => setSending(null)} onDone={(m) => { setSending(null); setManual(m); reload(); }} />}
    </div>
  );
}

// Email or text one person. They get a link into their portal: a password setup link the first time, a sign-in link after.
function SendDialog({ audit, channel, onClose, onDone }) {
  const people = audit.people;
  const [pick, setPick] = useState(0);
  const [p, setP] = useState(people[0]);
  const [consent, setConsent] = useState(false);
  const { busy, error, run } = useAction();
  const sms = channel === 'sms';
  const choose = (i) => { setPick(i); setP(people[i]); };
  const send = () => run(async () => {
    try {
      const r = await api('POST', `/audits/${audit.id}/send`, { channel, name: p.name, email: p.email, phone: p.phone, consent });
      toast(sms ? `Texted ${p.name.split(' ')[0]} a link to the report.` : `Emailed ${p.name.split(' ')[0]} a link to the report.`);
      onDone(null);
      return r;
    } catch (e) {
      if (e.data?.manualLink) { onDone({ channel, name: p.name, kind: e.data.linkKind, link: e.data.manualLink }); return; }
      throw e;
    }
  });
  const ready = p.name && p.email && (!sms || (p.phone && consent));
  return (
    <Dialog title={sms ? 'Text the report' : 'Email the report'} onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy || !ready} onClick={send}>{busy ? 'Sending…' : sms ? 'Send text' : 'Send email'}</button></>}>
      <div class="stack">
        {!audit.channels[channel] && <div class="alert warn small">{sms ? 'Texting (Twilio) isn\'t connected yet.' : 'Email sending isn\'t connected yet.'} The report still goes into their portal, and you'll get the link to send yourself.</div>}
        {people.length > 1 && <div class="chips">{people.map((x, i) => <button type="button" class="chip" aria-pressed={pick === i} onClick={() => choose(i)}>{x.name || x.email}</button>)}</div>}
        <Field label="Name"><input class="input" value={p.name} onInput={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Email" help={sms ? 'for their portal login' : undefined}><input class="input" type="email" value={p.email} onInput={(e) => setP({ ...p, email: e.target.value, login: null })} /></Field>
        {sms && <Field label="Mobile number"><input class="input" type="tel" value={p.phone} onInput={(e) => setP({ ...p, phone: e.target.value })} /></Field>}
        {sms && <label class="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{p.name ? p.name.split(' ')[0] : 'The customer'} agreed to get this by text.</label>}
        <div class="faint small">{p.login === 'active'
          ? `${p.name.split(' ')[0]} already has a portal login, so the link opens the report after they sign in.`
          : 'This creates their portal login. The link lets them set a password and opens the report. It works once and lasts 7 days.'}</div>
        {sms && <div class="faint small">They'll get: "Hi {p.name.split(' ')[0] || '…'}, your website and Google check for {audit.client.name} is ready in your Detcord portal (score {audit.result.overall}/100): &lt;link&gt; Reply STOP to opt out."</div>}
        {error && <div class="alert bad">{error}</div>}
      </div>
    </Dialog>
  );
}

// ---------- The report in the customer's portal (staff see the same page as a preview) ----------
export function ReportPage({ id, user }) {
  const { loading, data: d, error, reload } = useLoad(`/reports/${id}`);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const mailto = `mailto:${d.contact.email}?subject=${encodeURIComponent(`Website check for ${d.business}`)}`;
  return (
    <div class="page report-page" style="max-width:860px">
      {d.preview && <div class="alert info mb no-print row between"><span>Preview: this is what {d.business} sees in their portal.</span><a class="btn sm secondary" href={`/audits/${d.id}`}>Back to the check</a></div>}
      <div class="page-head">
        <div>
          <div class="eyebrow">Website and Google check</div>
          <h1>{d.business}</h1>
          <p class="sub">{d.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} · checked {date(d.checkedAt)}</p>
        </div>
        <button class="btn secondary no-print" onClick={() => print()}><Icon name="download" />Save as PDF</button>
      </div>
      {d.note && <div class="report-note">{d.note}</div>}
      <Report r={d} business={d.business} categories={d.categories} shotBase={`/api/reports/${d.id}/shot`} />
      <div class="report-cta">
        <h2>Want these fixed?</h2>
        <p>Detcord Digital fixes everything in this report and keeps it fixed, so more of the people searching for you become calls.</p>
        <div class="row wrap" style="justify-content:center">
          <a class="btn" href={mailto}><Icon name="bolt" />LIGHT THE FUSE</a>
          {d.contact.phone && <a class="btn secondary" href={`tel:${d.contact.phone}`}><Icon name="phone" />{d.contact.phone}</a>}
        </div>
        <p class="faint small">{d.contact.email}</p>
      </div>
      <p class="faint small center">Results reflect the website and Google listing on {date(d.checkedAt)}.</p>
    </div>
  );
}

// Client home card: every check Detcord has shared with this business.
export function ReportsCard() {
  const { data } = useLoad('/reports');
  const reports = data?.reports || [];
  if (!reports.length) return null;
  return (
    <section class="card mb attention">
      <h2>Your website reports</h2>
      <div class="list">
        {reports.map((r) => (
          <a class="list-item" href={`/reports/${r.id}`}>
            <span class={`score-pill ${tone(r.score)}`}>{r.score}</span>
            <div style="flex:1;min-width:0"><div class="title truncate">Website and Google check</div><div class="meta truncate">{r.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} · {date(r.shared_at)}</div></div>
            <span class="btn sm">View</span>
          </a>
        ))}
      </div>
    </section>
  );
}

// ---------- The report body, shared by staff and customer views ----------
function Report({ r, business, categories, serviceNames = {}, hidden, onToggle, staff = false, shotBase }) {
  const findings = r.findings;
  const visible = staff ? findings : findings.filter((f) => !hidden?.has(f.id));
  const svc = (s) => (staff ? serviceNames[s] : s);
  const g = r.google;
  const m = r.speed?.mobile;
  return (
    <div class="report">
      <div class="card report-summary">
        <ScoreRing score={r.overall} grade={r.grade} />
        <div style="flex:1;min-width:220px">
          <div class="cat-bars">
            {categories.map((c) => (
              <div class="cat-bar">
                <div class="row between small"><span>{c.label}</span><strong>{r.scores[c.id] ?? '—'}</strong></div>
                <div class="bar"><span class={tone(r.scores[c.id])} style={`width:${r.scores[c.id] ?? 0}%`} /></div>
              </div>
            ))}
          </div>
          <div class="row wrap mt" style="gap:8px">
            {['critical', 'important', 'minor'].map((s) => {
              const n = visible.filter((f) => f.severity === s && !(staff && hidden?.has(f.id))).length;
              return <span class={`badge ${SEVERITY[s].tone}`}>{n} {SEVERITY[s].label.toLowerCase()}</span>;
            })}
            <span class="badge good">{r.passed.length} passing</span>
          </div>
        </div>
      </div>

      {(r.coverage?.pagespeed === 'skipped' || r.coverage?.google === 'skipped') && (
        <div class="alert small mt">
          {r.coverage.pagespeed === 'skipped' && <div>Google's speed test wasn't included this time{staff && r.coverage.pagespeedReason ? `: ${r.coverage.pagespeedReason}` : '.'}</div>}
          {r.coverage.google === 'skipped' && <div>The Google Business Profile check wasn't included{staff && r.coverage.googleReason ? `: ${r.coverage.googleReason}` : '.'}</div>}
        </div>
      )}

      {(r.shots?.mobile || m) && (
        <div class="card mt report-speed">
          {r.shots?.mobile && <img class="phone-shot" src={`${shotBase}/mobile`} alt={`${business} homepage on a phone`} loading="lazy" />}
          {m && (
            <div style="flex:1">
              <h3>Speed on a phone</h3>
              <div class="grid two">
                <Metric label="Google speed score" value={m.scores.performance} suffix="/100" tone={tone(m.scores.performance)} />
                <Metric label="Main content appears" value={secs(m.lab.lcp)} tone={m.lab.lcp == null ? '' : m.lab.lcp <= 2500 ? 'good' : m.lab.lcp <= 4000 ? 'warn' : 'bad'} />
                <Metric label="Accessibility" value={m.scores.accessibility} suffix="/100" tone={tone(m.scores.accessibility)} />
                <Metric label="Desktop speed score" value={r.speed.desktop?.scores.performance ?? '—'} suffix={r.speed.desktop ? '/100' : ''} tone={tone(r.speed.desktop?.scores.performance)} />
              </div>
              <p class="faint small">Google recommends the main content appear within 2.5 seconds.</p>
            </div>
          )}
        </div>
      )}

      {g && (
        <div class="card mt">
          <h3>Google Maps and the local 3-pack</h3>
          {g.profile ? (
            <div class="table-wrap"><table>
              <thead><tr><th>Business</th><th>Rating</th><th>Reviews</th></tr></thead>
              <tbody>
                <tr class="me"><td><strong>{g.profile.name}</strong> <span class="badge accent">You</span></td><td>{g.profile.rating ? `${g.profile.rating} ★` : '—'}</td><td>{g.profile.reviews}</td></tr>
                {(g.competitors || []).map((c) => <tr><td>{c.name}</td><td>{c.rating ? `${c.rating} ★` : '—'}</td><td>{c.reviews ?? '—'}</td></tr>)}
              </tbody>
            </table></div>
          ) : <p class="muted">We couldn't find a Google Business Profile for {business}.</p>}
          {g.competitors?.length > 0 && <p class="faint small">Competitors are the top Google results for the same category nearby.</p>}
        </div>
      )}

      {['critical', 'important', 'minor'].map((s) => {
        const list = visible.filter((f) => f.severity === s);
        if (!list.length) return null;
        return (
          <section class="mt-lg">
            <h2 class="sev-head"><span class={`badge ${SEVERITY[s].tone}`}>{SEVERITY[s].label}</span><span class="faint small">{SEVERITY[s].blurb}</span></h2>
            <div class="stack">
              {list.map((f) => {
                const off = staff && hidden?.has(f.id);
                return (
                  <article class={`card finding ${off ? 'off' : ''}`}>
                    <div class="row between" style="align-items:flex-start;gap:12px">
                      <div>
                        <div class="faint small">{categories.find((c) => c.id === f.cat)?.label}</div>
                        <h3 style="margin:2px 0 6px">{f.title}</h3>
                      </div>
                      {staff && <button class="btn sm ghost" onClick={() => onToggle(f.id)} title={off ? 'Show this to the customer' : 'Hide this from the customer'}><Icon name="eye" size={14} />{off ? 'Hidden' : 'Hide'}</button>}
                    </div>
                    <p>{f.detail}</p>
                    <p class="muted"><strong>Why it matters:</strong> {f.why}</p>
                    <p class="muted"><strong>How to fix it:</strong> {f.fix}</p>
                    {svc(f.service) && <div class="faint small">Detcord service: {svc(f.service)}</div>}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {r.passed.length > 0 && (
        <section class="mt-lg">
          <h2 class="sev-head"><span class="badge good">What's working</span></h2>
          <div class="card"><ul class="passed">{r.passed.map((p) => <li><Icon name="check" size={14} />{p.title}</li>)}</ul></div>
        </section>
      )}
      <p class="faint small mt">We checked {r.pagesChecked} page{r.pagesChecked === 1 ? '' : 's'}{r.facts?.linksChecked ? ` and ${r.facts.linksChecked} links` : ''}, Google's mobile and desktop tests, and Google Maps.</p>
    </div>
  );
}

function Metric({ label, value, suffix = '', tone: t }) {
  return <div class="metric"><div class="faint small">{label}</div><div class={`metric-value ${t || ''}`}>{value ?? '—'}<span class="faint small">{value != null && value !== '—' ? suffix : ''}</span></div></div>;
}

function ScoreRing({ score, grade }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div class={`score-ring ${tone(score)}`} role="img" aria-label={`Overall score ${score} out of 100, grade ${grade}`}>
      <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--line)" stroke-width="12" />
        <circle cx="66" cy="66" r={r} fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-dasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 66 66)" />
      </svg>
      <div class="score-num"><strong>{score}</strong><span>Grade {grade}</span></div>
    </div>
  );
}
