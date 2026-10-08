import { useLoad, date, money } from '../lib.js';
import { Loading, ErrorBox, Empty, Avatar, Icon } from '../ui.jsx';
import { session } from '../lib.js';
import { ReportsCard } from './audits.jsx';
import { MonthlyReportsCard } from './reports.jsx';
import { GoatCard } from './goat.jsx';
import { Board } from '../board.jsx';

// The client workspace: what needs them (agreements to sign, invoices due), updates, services,
// GOAT requests, reports, files and their Detcord team.
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

      <ActionItems />
      <Board page="client-home" cards={[
        { id: 'reports', title: 'Reports', col: 'top', node: <ReportsCard /> },
        { id: 'monthly', title: 'Monthly reports', col: 'top', node: <MonthlyReportsCard /> },
        { id: 'goat', title: 'Ask the GOAT', col: 'top', node: <GoatCard clientId={client.id} user={user} /> },
        { id: 'updates', title: 'Updates from Detcord', col: 'main', node: (
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
        ) },
        { id: 'services', title: 'Your services', col: 'main', node: (
          <section class="card">
            <h2>Your services</h2>
            {services.length ? services.map((s) => <div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>{s.name}</span><span class="badge good">Active</span></div>)
              : <p class="muted">Services appear here once they start.</p>}
          </section>
        ) },
        { id: 'files', title: 'Files and photos', col: 'main', node: (
          <section class="card">
            <div class="row between"><h2 style="margin:0">Files and photos</h2><a class="btn sm secondary" href="/files"><Icon name="upload" />Share files</a></div>
            <p class="small muted" style="margin-bottom:0">Send logos, photos and flyers for your website, social posts and requests. Your Detcord team sees them right away.</p>
          </section>
        ) },
        { id: 'team', title: 'Your Detcord team', col: 'side', node: (
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
        ) },
        { id: 'details', title: 'Business details', col: 'side', node: (
          <section class="card">
            <h2>Business details</h2>
            <dl class="kv">
              {client.website && <><dt>Website</dt><dd><a href={client.website} target="_blank" rel="noopener">{client.website.replace(/^https?:\/\//, '')}</a></dd></>}
              {client.phone && <><dt>Phone</dt><dd>{client.phone}</dd></>}
              {client.city && <><dt>Location</dt><dd>{[client.city, client.state].filter(Boolean).join(', ')}</dd></>}
            </dl>
            <p class="small faint mt">Something out of date? Tell your Detcord team.</p>
          </section>
        ) },
        { id: 'others', title: 'Other businesses', col: 'side', node: others.length > 0 && <section class="card"><h2>Other businesses</h2>{others.map((o) => <div>{o.name}</div>)}</section> },
      ]} />
    </div>
  );
}

// Agreements waiting for a signature and invoices with a balance, front and center.
function ActionItems() {
  const contracts = useLoad('/contracts');
  const invoices = useLoad('/invoices');
  const toSign = (contracts.data?.contracts || []).filter((c) => c.status === 'sent');
  const due = (invoices.data?.invoices || []).filter((i) => i.status === 'open');
  if (!toSign.length && !due.length) return null;
  return (
    <section class="card mb attention">
      <h2>Needs your attention</h2>
      <div class="list">
        {toSign.map((c) => (
          <a class="list-item" href={`/contracts/${c.id}`}>
            <Icon name="pen" />
            <div style="flex:1"><div class="title">Review and sign: {c.title}</div><div class="meta">Sent {date(c.issued_at)}</div></div>
            <span class="btn sm">Review</span>
          </a>
        ))}
        {due.map((i) => (
          <a class="list-item" href={`/invoices/${i.id}`}>
            <Icon name="card" />
            <div style="flex:1"><div class="title">{i.title}</div><div class="meta">{i.number} · due {date(i.due_at)}</div></div>
            <strong>{money(i.total_cents - i.paid_cents)}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
