import { useLoad, date } from '../lib.js';
import { Loading, ErrorBox, Empty, Avatar, Icon } from '../ui.jsx';
import { session } from '../lib.js';

// The client workspace. Phase A shows business info, the Detcord team and shared updates.
// GOAT Command, files, contracts, invoices and reports arrive in later phases and are
// shown as "coming soon" rather than as working buttons.
export function ClientHome({ user }) {
  const businesses = session.value?.clients || [];
  if (!businesses.length) {
    return <div class="page"><Empty goat title="Your workspace is being set up">Your Detcord team will connect your business shortly. Questions? Email info@detcorddigital.com.</Empty></div>;
  }
  return <BusinessView id={businesses[0].id} user={user} others={businesses.slice(1)} />;
}

function BusinessView({ id, user, others }) {
  const { loading, data, error, reload } = useLoad(`/clients/${id}`);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { client, team, services, notes } = data;
  return (
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Your business</div>
          <h1>{client.name}</h1>
          <p class="sub">Hi {user.name.split(' ')[0]}. Text it. Email it. Type it. GOAT it.</p>
        </div>
      </div>

      <section class="card mb" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <img src="/goat-96.webp" alt="" style="width:64px;height:64px;border-radius:50%" />
        <div style="flex:1;min-width:220px">
          <h2 style="margin:0 0 4px">ASK THE GOAT</h2>
          <p class="muted" style="margin:0">Soon you’ll be able to ask for website changes, social posts and updates here, by text or by email. You review, you approve, it’s done.</p>
        </div>
        <span class="badge">Coming soon</span>
      </section>

      <div class="grid main-side">
        <div class="stack">
          <section class="card">
            <h2>Updates from Detcord</h2>
            {notes.length ? (
              <div class="list">
                {notes.map((n) => (
                  <div class="list-item" style="align-items:flex-start">
                    <Avatar name={n.author || 'Detcord'} />
                    <div style="flex:1"><div style="white-space:pre-wrap">{n.body}</div><div class="meta">{n.author || 'Detcord'} · {date(n.created_at)}</div></div>
                  </div>
                ))}
              </div>
            ) : <Empty title="No updates yet">Your team will post updates here.</Empty>}
          </section>
          <section class="card">
            <h2>Your services</h2>
            {services.length ? services.map((s) => <div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>{s.name}</span><span class="badge good">Active</span></div>)
              : <p class="muted">Services appear here once they start.</p>}
          </section>
          <section class="card">
            <h2>Coming to your portal</h2>
            <div class="grid two">
              {[['Contracts', 'Review and sign agreements online.'], ['Invoices', 'See balances and pay securely.'], ['Files and photos', 'Share logos, photos and flyers with your team.'], ['Reports', 'Plain-English results with a game plan.']].map(([t, d]) => (
                <div style="padding:12px;border:1px dashed var(--line-strong);border-radius:10px"><strong>{t}</strong><div class="small muted">{d}</div></div>
              ))}
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="card">
            <h2>Your Detcord team</h2>
            {team.length ? team.map((t) => (
              <div class="row" style="padding:8px 0">
                <Avatar name={t.name} />
                <div style="flex:1;min-width:0"><div style="font-weight:600">{t.name}</div><div class="small muted">{t.email}</div></div>
                {t.phone && <a class="icon-btn" href={`tel:${t.phone}`} aria-label={`Call ${t.name}`}><Icon name="phone" /></a>}
                <a class="icon-btn" href={`mailto:${t.email}`} aria-label={`Email ${t.name}`}><Icon name="mail" /></a>
              </div>
            )) : <p class="muted">Reach us at <a href="mailto:info@detcorddigital.com">info@detcorddigital.com</a>.</p>}
          </section>
          <section class="card">
            <h2>Business details</h2>
            <dl class="kv">
              {client.website && <><dt>Website</dt><dd><a href={client.website} target="_blank" rel="noopener">{client.website.replace(/^https?:\/\//, '')}</a></dd></>}
              {client.phone && <><dt>Phone</dt><dd>{client.phone}</dd></>}
              {client.city && <><dt>Location</dt><dd>{[client.city, client.state].filter(Boolean).join(', ')}</dd></>}
            </dl>
            <p class="small faint mt">Something out of date? Tell your Detcord team.</p>
          </section>
          {others.length > 0 && <section class="card"><h2>Other businesses</h2>{others.map((o) => <div>{o.name}</div>)}</section>}
        </div>
      </div>
    </div>
  );
}
