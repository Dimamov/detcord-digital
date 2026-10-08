import { useLoad, money, ago, due, dateTime, api, toast } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon, StatusBadge } from '../ui.jsx';
import { ClientHome } from './client-home.jsx';
import { Board } from '../board.jsx';

export function Dashboard({ user }) {
  if (user.role === 'client') return <ClientHome user={user} />;
  return <StaffDay user={user} />;
}

function greeting(name) {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Detroit' }));
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name.split(' ')[0]}`;
}

export function TaskLine({ t, onDone, showClient = true }) {
  const d = due(t.due_at);
  return (
    <div class={`task ${t.done_at ? 'done' : ''}`}>
      <input type="checkbox" checked={!!t.done_at} aria-label={`Mark "${t.title}" done`} onChange={(e) => onDone(t, e.target.checked)} />
      <div style="flex:1;min-width:0">
        <div class="t">{t.title}</div>
        <div class="small muted row" style="gap:6px">
          <span class={d.tone}>{d.text}</span>
          {showClient && t.client_name && <>· <a href={`/clients/${t.client_id}`}>{t.client_name}</a></>}
        </div>
      </div>
    </div>
  );
}

function StaffDay({ user }) {
  const { loading, data, error, reload } = useLoad('/dashboard');
  const admin = user.role === 'admin';
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const { tasks, pipeline, stale, discoveriesOpen, intakesNew, counts } = data;
  const done = async (t, v) => {
    try { await api('PATCH', `/sales/tasks/${t.id}`, { done: v }); toast(v ? 'Nice. Task done.' : 'Task reopened.'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const open = pipeline.filter((s) => s.outcome === 'open');
  const openValue = open.reduce((s, x) => s + x.monthly, 0);
  const allTasks = [...tasks.overdue, ...tasks.today];

  return (
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">{admin ? 'Detcord Today' : 'My Day'}</div>
          <h1>{greeting(user.name)}</h1>
          <p class="sub">{tasks.overdue.length ? `${tasks.overdue.length} overdue and ${tasks.today.length} due today.` : tasks.today.length ? `${tasks.today.length} follow-ups due today.` : 'Nothing due today. Good time to open new conversations.'}</p>
        </div>
        <div class="row">
          <a class="btn secondary" href="/tasks"><Icon name="tasks" />Tasks</a>
          <a class="btn" href="/clients/new"><Icon name="plus" />New client</a>
        </div>
      </div>

      <Board page="staff-home" cards={[
        { id: 'stats', title: 'Numbers', col: 'top', node: (
      <div class="grid four mb">
        {admin ? <>
          <a class="stat" href="/clients?status=active"><div class="label">Active clients</div><div class="value">{counts.active_clients}</div></a>
          <a class="stat" href="/pipeline"><div class="label">Open pipeline</div><div class="value">{open.reduce((s, x) => s + x.n, 0)}</div><div class="hint">{money(openValue)}/mo in open deals</div></a>
          <a class="stat" href="/clients?status=prospect"><div class="label">Leads and prospects</div><div class="value">{counts.prospects}</div><div class="hint">{counts.new_this_week} new this week</div></a>
          <a class="stat" href="/tasks?scope=all"><div class="label">Team overdue tasks</div><div class="value" style={counts.team_overdue ? 'color:var(--bad)' : ''}>{counts.team_overdue}</div></a>
        </> : <>
          <a class="stat" href="/clients"><div class="label">My clients</div><div class="value">{counts.clients}</div></a>
          <a class="stat" href="/pipeline"><div class="label">Open deals</div><div class="value">{open.reduce((s, x) => s + x.n, 0)}</div><div class="hint">{money(openValue)}/mo</div></a>
          <a class="stat" href="/tasks"><div class="label">Overdue</div><div class="value" style={tasks.overdue.length ? 'color:var(--bad)' : ''}>{tasks.overdue.length}</div></a>
          <a class="stat" href="/commissions"><div class="label">Commissions</div><div class="value"><Icon name="money" size={22} /></div><div class="hint">See earnings</div></a>
        </>}
      </div>
        ) },
        { id: 'email', title: 'Email delivery', col: 'top', node: admin && (<section class="card">
        <h2>Email delivery</h2>
        {!data.emailTrackingReady && <div class="alert warn">Delivery tracking needs its Resend webhook connected. Accepted means the provider accepted the message; delivery is not yet confirmed.</div>}
        {data.emails?.length ? <div class="list">{data.emails.map((e) => <div class="list-item" key={e.id}>
          <div style="flex:1;min-width:0"><div class="title">{e.recipient}</div><div class="meta">{e.subject} · {ago(e.created_at)}</div>{e.error && <div class="small">{e.error}</div>}</div>
          <span class={`badge ${e.status === 'delivered' ? 'good' : ['bounced','failed','suppressed','not_configured'].includes(e.status) ? 'bad' : 'warn'}`}>{e.status === 'accepted' ? 'Accepted — awaiting delivery' : e.status.replaceAll('_', ' ')}</span>
        </div>)}</div> : <p class="muted">New emails will appear here. Failed deliveries also appear in Recent activity.</p>}
      </section>) },
        { id: 'tasks', title: 'Follow-ups due', col: 'main', node: (
          <section class="card">
            <div class="card-head"><h2>Follow-ups due</h2><a class="small muted" href="/tasks">All tasks</a></div>
            {allTasks.length ? allTasks.map((t) => <TaskLine t={t} onDone={done} />)
              : <Empty title="You’re caught up">{tasks.upcoming.length ? `${tasks.upcoming.length} coming up this week.` : 'No follow-ups scheduled.'}</Empty>}
          </section>
        ) },
        { id: 'discovery', title: 'Discovery', col: 'main', node: (intakesNew.length > 0 || discoveriesOpen.length > 0) && (
            <section class="card">
              <h2>Discovery</h2>
              <div class="list">
                {intakesNew.map((i) => (
                  <a class="list-item" href={`/clients/${i.client_id}?tab=discovery`}>
                    <span class="badge accent">Answers in</span>
                    <div style="flex:1"><div class="title">{i.client_name}</div><div class="meta">Pre-call questions answered {ago(i.submitted_at)}</div></div>
                    <Icon name="arrow" />
                  </a>
                ))}
                {discoveriesOpen.map((d) => (
                  <a class="list-item" href={`/discovery/${d.id}`}>
                    <span class="badge warn">In progress</span>
                    <div style="flex:1"><div class="title">{d.client_name}</div><div class="meta">Last edited {ago(d.updated_at)}</div></div>
                    <Icon name="arrow" />
                  </a>
                ))}
              </div>
            </section>
          ) },
        { id: 'stale', title: 'Deals going quiet', col: 'main', node: (
          <section class="card">
            <div class="card-head"><h2>Deals going quiet</h2><a class="small muted" href="/pipeline">Pipeline</a></div>
            {stale.length ? (
              <div class="list">
                {stale.map((d) => (
                  <a class="list-item" href={`/clients/${d.client_id}`}>
                    <div style="flex:1"><div class="title">{d.client_name}</div><div class="meta">{d.stage_name} · no activity since {ago(Math.max(d.last_touch || 0, d.updated_at))}</div></div>
                    <Icon name="arrow" />
                  </a>
                ))}
              </div>
            ) : <Empty title="No stalled deals">Every open deal has had activity this week.</Empty>}
          </section>
        ) },
        { id: 'activity', title: 'Recent activity', col: 'main', node: admin && data.activity.length > 0 && (
            <section class="card">
              <h2>Recent activity</h2>
              <div class="list">
                {data.activity.map((a) => (
                  <div class="list-item">
                    <div style="flex:1;min-width:0">
                      <div>{a.summary}</div>
                      <div class="meta">{a.actor || 'System'}{a.client_name && <> · <a href={`/clients/${a.client_id}`}>{a.client_name}</a></>} · {ago(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) },
        { id: 'pipeline', title: 'Pipeline', col: 'side', node: (
          <section class="card">
            <h2>Pipeline</h2>
            <div class="stack tight">
              {pipeline.map((s) => (
                <a href="/pipeline" class="row between" style="text-decoration:none;padding:6px 0">
                  <span>{s.name}{s.provisional ? '' : ''}</span>
                  <span class="row" style="gap:8px"><span class="faint small">{s.monthly ? `${money(s.monthly)}/mo` : ''}</span><span class="badge">{s.n}</span></span>
                </a>
              ))}
            </div>
          </section>
        ) },
        { id: 'team', title: 'Sales team', col: 'side', node: admin && data.team.length > 0 && (
            <section class="card">
              <div class="card-head"><h2>Sales team</h2><a class="small muted" href="/team">Manage</a></div>
              <div class="list">
                {data.team.map((r) => (
                  <div class="list-item">
                    <div style="flex:1"><div class="title">{r.name}</div><div class="meta">{r.clients} clients · {r.open_deals} open deals</div></div>
                    {r.overdue > 0 && <span class="badge bad">{r.overdue} overdue</span>}
                  </div>
                ))}
              </div>
            </section>
          ) },
        { id: 'attention', title: 'Needs attention', col: 'side', node: admin && (data.invites.length > 0 || counts.unassigned > 0) && (
            <section class="card">
              <h2>Needs attention</h2>
              <div class="stack tight">
                {counts.unassigned > 0 && <a href="/clients?unassigned=1" class="alert warn" style="text-decoration:none">{counts.unassigned} client{counts.unassigned > 1 ? 's have' : ' has'} no sales rep assigned.</a>}
                {data.invites.map((i) => (
                  <a href="/team" class="row between" style="text-decoration:none;padding:6px 0">
                    <span>{i.name} <span class="faint small">({i.role})</span></span>
                    <span class={`badge ${i.state === 'waiting' ? 'info' : 'warn'}`}>{i.state === 'waiting' ? 'Invite sent' : i.state === 'expired' ? 'Invite expired' : 'Not delivered'}</span>
                  </a>
                ))}
              </div>
            </section>
          ) },
      ]} />
    </div>
  );
}
