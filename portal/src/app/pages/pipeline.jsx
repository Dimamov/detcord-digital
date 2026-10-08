import { useState } from 'preact/hooks';
import { useLoad, api, toast, money, due, query } from '../lib.js';
import { Loading, ErrorBox, Empty, Icon } from '../ui.jsx';
import { TaskLine } from './dashboard.jsx';
import { NewTask } from './clients.jsx';
import { industryName } from '../industries.jsx';

export function Pipeline({ user }) {
  const { loading, data, error, reload } = useLoad('/sales/pipeline');
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [mine, setMine] = useState(false);
  if (loading) return <div class="page"><Loading /></div>;
  if (error) return <div class="page"><ErrorBox error={error} retry={reload} /></div>;
  const move = async (deal, stage) => {
    if (deal.stage_id === stage.id) return;
    const lostReason = stage.outcome === 'lost' ? prompt(`Why was ${deal.client_name} lost?`) : undefined;
    if (stage.outcome === 'lost' && lostReason === null) return;
    try {
      await api('PATCH', `/sales/deals/${deal.id}`, { stageId: stage.id, lostReason });
      toast(stage.outcome === 'won' ? `🎉 ${deal.client_name} won!` : `Moved to ${stage.name}.`);
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const deals = mine ? data.deals.filter((d) => d.owner_id === user.id) : data.deals;
  const provisional = data.stages.some((s) => s.provisional);
  return (
    <div class="page" style="max-width:none">
      <div class="page-head">
        <div><div class="eyebrow">Sales</div><h1>Pipeline</h1><p class="sub">Drag a deal to move it, or change its stage from the client record.</p></div>
        <div class="row">
          {user.role === 'admin' && <label class="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only my deals</label>}
          <a class="btn" href="/clients/new"><Icon name="plus" />New client</a>
        </div>
      </div>
      {provisional && user.role === 'admin' && <div class="alert info mb">These pipeline stages are a starting suggestion. Rename or reorder them in <a href="/settings">Settings</a>.</div>}
      {!data.deals.length ? <div class="card"><Empty goat title="No deals yet" action={<a class="btn" href="/clients/new">Add a client</a>}>Every new client starts with a deal in the first stage.</Empty></div> : (
        <div class="board">
          {data.stages.map((s) => {
            const list = deals.filter((d) => d.stage_id === s.id);
            const monthly = list.reduce((a, d) => a + (d.monthly_cents || 0), 0);
            return (
              <div class={`column ${over === s.id ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) move(dragging, s); setDragging(null); }}>
                <div class="column-head"><span>{s.name}</span><span class="badge">{list.length}</span></div>
                {monthly > 0 && <div class="small faint" style="padding:0 4px 8px">{money(monthly)}/mo</div>}
                {list.map((d) => {
                  const nd = d.next_due ? due(d.next_due) : null;
                  return (
                    <a class="deal" style="display:block;text-decoration:none" href={`/clients/${d.client_id}?tab=deals`} draggable onDragStart={() => setDragging(d)} onDragEnd={() => setDragging(null)}>
                      <div class="name">{d.client_name}</div>
                      <div class="small muted">{industryName(d.industry)}</div>
                      <div class="row small mt" style="gap:8px">
                        {(d.setup_cents || d.monthly_cents) ? <span>{d.monthly_cents ? `${money(d.monthly_cents)}/mo` : money(d.setup_cents)}</span> : null}
                        {nd && <span class={nd.tone || 'faint'}>{nd.text}</span>}
                        {user.role === 'admin' && d.owner && <span class="faint">{d.owner}</span>}
                      </div>
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Tasks({ user }) {
  const [scope, setScope] = useState(user.role === 'admin' && query().scope === 'all' ? 'all' : 'mine');
  const [showDone, setShowDone] = useState(false);
  const { loading, data, error, reload } = useLoad(`/sales/tasks?scope=${scope}&open=${!showDone}`, [scope, showDone]);
  const done = async (t, v) => { try { await api('PATCH', `/sales/tasks/${t.id}`, { done: v }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const groups = { Overdue: [], Today: [], Upcoming: [], 'No date': [], Done: [] };
  for (const t of data?.tasks || []) {
    if (t.done_at) groups.Done.push(t);
    else if (!t.due_at) groups['No date'].push(t);
    else { const d = due(t.due_at); groups[d.tone === 'overdue' ? 'Overdue' : d.text === 'Today' ? 'Today' : 'Upcoming'].push(t); }
  }
  return (
    <div class="page" style="max-width:860px">
      <div class="page-head">
        <div><div class="eyebrow">Follow-ups</div><h1>Tasks</h1></div>
        <div class="row">
          {user.role === 'admin' && <select class="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Whose tasks"><option value="mine">My tasks</option><option value="all">Everyone’s tasks</option></select>}
          <label class="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show done</label>
        </div>
      </div>
      <section class="card mb"><NewTask onAdded={reload} user={user} /></section>
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !data.tasks.length ? <div class="card"><Empty title="No tasks">Add a follow-up above, or from any client.</Empty></div> : (
        Object.entries(groups).filter(([, l]) => l.length).map(([name, list]) => (
          <section class="card">
            <h2 class={name === 'Overdue' ? 'overdue' : ''}>{name} <span class="faint small">({list.length})</span></h2>
            {list.map((t) => <div class="row" style="align-items:flex-start"><div style="flex:1"><TaskLine t={t} onDone={done} /></div>{scope === 'all' && <span class="faint small" style="padding-top:12px">{t.owner}</span>}</div>)}
          </section>
        ))
      )}
    </div>
  );
}
