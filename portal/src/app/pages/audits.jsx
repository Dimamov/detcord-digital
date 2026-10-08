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
  const [sending, setSending] = useState(false);
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
    if (!confirm('Delete this check? Links already sent to the customer stop working.')) return;
    await api('DELETE', `/audits/${a.id}`);
    navigate(`/clients/${a.clientId}?tab=audits`);
  });
  const preview = () => run(async () => {
    const r = a.shareUrl ? { shareUrl: a.shareUrl } : await api('POST', `/audits/${a.id}/share`, {});
    window.open(r.shareUrl, '_blank', 'noopener');
    if (!a.shareUrl) reload();
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
            <button class="btn secondary" onClick={preview} disabled={busy}><Icon name="eye" />Customer view</button>
            <button class="btn" onClick={() => setSending(true)}><Icon name="mail" />Send to customer</button>
          </div>
        )}
      </div>
      {a.status === 'failed' && <div class="alert bad">{a.error}</div>}
      {a.status === 'running' && <div class="alert">This check is still running. Refresh in a moment.</div>}
      {a.status === 'done' && (
        <div class="grid main-side">
          <div>
            <Report r={a.result} business={a.client.name} categories={a.categories} serviceNames={a.serviceNames} hidden={hidden} onToggle={toggle} staff shotBase={`/api/audits/${a.id}/shot`} />
          </div>
          <aside class="stack">
            <div class="card">
              <h3>Note to the customer</h3>
              <p class="faint small" style="margin-top:-6px">Shown at the top of their report and in the email.</p>
              <textarea class="input" rows="4" maxLength={1500} placeholder="Great talking with you today. Here's what we found…" value={note ?? a.note ?? ''} onInput={(e) => setNote(e.target.value)} />
              {note !== null && <div class="row mt"><button class="btn sm" onClick={saveNote} disabled={busy}>Save note</button><button class="btn sm ghost" onClick={() => setNote(null)}>Cancel</button></div>}
            </div>
            <div class="card">
              <h3>Customer link</h3>
              {a.shareUrl ? (
                <div class="stack" style="gap:8px">
                  <div class="faint small">No login needed. Expires {date(a.shareExpiresAt)}.</div>
                  <div class="row wrap"><CopyButton text={a.shareUrl} /><button class="btn sm ghost" disabled={busy} onClick={() => run(async () => { if (!confirm('Make a new link? Links already sent stop working.')) return; await api('POST', `/audits/${a.id}/share`, { rotate: true }); reload(); })}>New link</button></div>
                </div>
              ) : <div class="faint small">Created when you first send or preview the report.</div>}
              {hidden.size > 0 && <div class="alert mt small">{hidden.size} finding{hidden.size === 1 ? ' is' : 's are'} hidden from the customer.</div>}
            </div>
            <div class="card">
              <h3>Sent</h3>
              {a.deliveries.length ? (
                <div class="stack" style="gap:8px">
                  {a.deliveries.map((d) => (
                    <div class="small">
                      <div class="row between"><span><Icon name={d.channel === 'sms' ? 'phone' : 'mail'} size={14} /> {d.recipient}</span><span class={`badge ${d.status === 'sent' ? 'good' : 'bad'}`}>{d.status === 'sent' ? 'Sent' : d.status === 'not_configured' ? 'Not set up' : 'Failed'}</span></div>
                      <div class="faint">{ago(d.created_at)}{d.by_name ? ` · ${d.by_name}` : ''}{d.error ? ` · ${d.error}` : ''}</div>
                    </div>
                  ))}
                </div>
              ) : <div class="faint small">Not sent yet.</div>}
            </div>
            <button class="btn ghost sm" onClick={remove} disabled={busy}><Icon name="trash" size={14} />Delete this check</button>
          </aside>
        </div>
      )}
      {sending && <SendDialog audit={a} onClose={() => setSending(false)} onSent={() => { setSending(false); reload(); }} />}
    </div>
  );
}

function SendDialog({ audit, onClose, onSent }) {
  const [channel, setChannel] = useState(audit.channels.email || !audit.channels.sms ? 'email' : 'sms');
  const emails = audit.recipients.emails;
  const phones = audit.recipients.phones;
  const firstOf = (label) => (label || '').split(/\s+/)[0];
  const [to, setTo] = useState({ email: emails[0]?.value || '', sms: phones[0]?.value || '' });
  const [firstName, setFirstName] = useState(firstOf(emails[0]?.label || phones[0]?.label) === audit.client.name.split(/\s+/)[0] ? '' : firstOf(emails[0]?.label || phones[0]?.label));
  const [consent, setConsent] = useState(false);
  const { busy, error, run } = useAction();
  const configured = audit.channels[channel];
  const send = () => run(async () => {
    try {
      await api('POST', `/audits/${audit.id}/send`, { channel, to: to[channel], firstName, consent });
      toast(channel === 'sms' ? 'Report texted.' : 'Report emailed.');
      onSent();
    } catch (e) {
      if (e.data?.status === 'not_configured') {
        toast(`${channel === 'sms' ? 'Texting' : 'Email'} isn't set up yet. Copy the link and send it yourself.`, 'warn');
        onSent();
        return;
      }
      throw e;
    }
  });
  const list = channel === 'email' ? emails : phones;
  return (
    <Dialog title="Send the report" onClose={onClose} footer={<><button class="btn ghost" onClick={onClose}>Cancel</button><button class="btn" disabled={busy || !to[channel] || (channel === 'sms' && !consent)} onClick={send}>{busy ? 'Sending…' : channel === 'sms' ? 'Send text' : 'Send email'}</button></>}>
      <div class="stack">
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={channel === 'email'} onClick={() => setChannel('email')}><Icon name="mail" size={14} />Email</button>
          <button role="tab" aria-selected={channel === 'sms'} onClick={() => setChannel('sms')}><Icon name="phone" size={14} />Text message</button>
        </div>
        {!configured && <div class="alert warn small">{channel === 'sms' ? 'Texting isn\'t connected yet (Twilio).' : 'Email sending isn\'t connected yet.'} You can still create the link and send it yourself.</div>}
        <Field label={channel === 'email' ? 'Email address' : 'Mobile number'}>
          <input class="input" type={channel === 'email' ? 'email' : 'tel'} list={`rcpt-${channel}`} value={to[channel]} onInput={(e) => setTo({ ...to, [channel]: e.target.value })} />
          <datalist id={`rcpt-${channel}`}>{list.map((x) => <option value={x.value}>{x.label}</option>)}</datalist>
        </Field>
        {list.length > 1 && <div class="chips">{list.map((x) => <button type="button" class="chip" aria-pressed={to[channel] === x.value} onClick={() => { setTo({ ...to, [channel]: x.value }); }}>{x.label}</button>)}</div>}
        <Field label="First name" help="optional, for the greeting"><input class="input" value={firstName} onInput={(e) => setFirstName(e.target.value)} /></Field>
        {channel === 'sms' && (
          <label class="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />The customer agreed to get this report by text.</label>
        )}
        <div class="faint small">{channel === 'sms'
          ? `They'll get: "${firstName ? `Hi ${firstName}, h` : 'H'}ere's the website and Google check for ${audit.client.name} from Detcord Digital (score ${audit.result.overall}/100): <link> Reply STOP to opt out."`
          : 'They\'ll get a short email with the score, the top issues, your note, and a button to the full report. Replies go to info@detcorddigital.com.'}</div>
        {error && <div class="alert bad">{error}</div>}
      </div>
    </Dialog>
  );
}

// ---------- Customer report (no login) ----------
export function PublicReport({ token }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    document.title = 'Your website check · Detcord Digital';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    fetch(`/api/public/reports/${encodeURIComponent(token)}`, { credentials: 'omit' })
      .then(async (res) => { const d = await res.json().catch(() => ({})); setState(res.ok ? { data: d } : { error: d.error || 'This report could not be loaded.' }); })
      .catch(() => setState({ error: 'Can’t reach the server. Check your connection and try again.' }));
  }, [token]);
  if (state.loading) return <Loading />;
  if (state.error) return <div class="public-report"><div class="report-top"><img src="/detcord-logo-transparent.webp" alt="Detcord Digital" /></div><div class="alert bad" style="max-width:560px;margin:40px auto">{state.error}</div></div>;
  const d = state.data;
  const mailto = `mailto:${d.contact.email}?subject=${encodeURIComponent(`Website check for ${d.business}`)}`;
  return (
    <div class="public-report">
      <div class="report-top">
        <img src="/detcord-logo-transparent.webp" alt="Detcord Digital" />
        <div class="row no-print"><button class="btn sm secondary" onClick={() => print()}><Icon name="download" size={14} />Save as PDF</button></div>
      </div>
      <div class="report-wrap">
        <p class="eyebrow">Website and Google check</p>
        <h1 style="margin:4px 0 2px">{d.business}</h1>
        <p class="muted">{d.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} · checked {date(d.checkedAt)}</p>
        {d.note && <div class="report-note">{d.note}</div>}
        <Report r={d} business={d.business} categories={d.categories} shotBase={`/api/public/reports/${encodeURIComponent(token)}/shot`} />
        <div class="report-cta">
          <h2>Want these fixed?</h2>
          <p>Detcord Digital fixes everything in this report and keeps it fixed, so more of the people searching for you become calls.</p>
          <div class="row wrap" style="justify-content:center">
            <a class="btn" href={mailto}><Icon name="bolt" />LIGHT THE FUSE</a>
            {d.contact.phone && <a class="btn secondary" href={`tel:${d.contact.phone}`}><Icon name="phone" />{d.contact.phone}</a>}
          </div>
          <p class="faint small">{d.contact.email}</p>
        </div>
        <p class="faint small center">This report link expires {date(d.expiresAt)}. Results reflect the site and Google listing at the time of the check.</p>
      </div>
    </div>
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
      <p class="faint small mt">We checked {r.pagesChecked} page{r.pagesChecked === 1 ? '' : 's'}{r.facts ? ` and ${r.facts.linksChecked} links` : ''}, Google's mobile and desktop tests, and Google Maps.</p>
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
