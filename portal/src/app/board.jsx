import { useState, useEffect, useRef } from 'preact/hooks';
import { api, toast } from './lib.js';
import { Icon } from './ui.jsx';

// Dashboard cards each person can rearrange. Drag a card by its handle (mouse or touch), or use the
// arrow buttons (keyboard); hide cards you don't use. The layout is saved to the person's login.
const COLS = ['top', 'main', 'side'];
const COL_LABEL = { top: 'Top', main: 'Main column', side: 'Side column' };
const cache = {};

// Saved order first, then any card the saved layout doesn't know yet, in its default spot.
function arrange(cards, saved) {
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const hidden = new Set((saved?.hidden || []).filter((id) => byId[id]));
  const placed = new Set();
  const cols = Object.fromEntries(COLS.map((k) => [k, []]));
  for (const k of COLS) {
    for (const id of saved?.[k] || []) if (byId[id] && !hidden.has(id) && !placed.has(id)) { cols[k].push(id); placed.add(id); }
  }
  cards.forEach((c, i) => {
    if (placed.has(c.id) || hidden.has(c.id)) return;
    const list = cols[c.col];
    // Keep it near the cards that came before it by default.
    const prev = cards.slice(0, i).reverse().find((p) => list.includes(p.id));
    list.splice(prev ? list.indexOf(prev.id) + 1 : 0, 0, c.id);
  });
  return { ...cols, hidden: [...hidden] };
}

export function Board({ page, cards }) {
  const [saved, setSaved] = useState(cache[page]);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(null); // { id, target: { col, index } }
  const live = cards.filter((c) => c.node !== null && c.node !== undefined && c.node !== false);
  const layout = arrange(live, saved);
  const byId = Object.fromEntries(live.map((c) => [c.id, c]));
  const boardRef = useRef();

  useEffect(() => {
    if (cache[page] !== undefined) return;
    api('GET', `/me/layouts/${page}`).then((r) => { cache[page] = r.layout; setSaved(r.layout); }).catch(() => {});
  }, [page]);

  const save = (next) => {
    const value = { top: next.top, main: next.main, side: next.side, hidden: next.hidden };
    cache[page] = value;
    setSaved(value);
    api('PUT', `/me/layouts/${page}`, value).catch(() => toast('Couldn’t save your layout. Check your connection.', 'bad'));
  };
  const reset = () => {
    cache[page] = null;
    setSaved(null);
    api('DELETE', `/me/layouts/${page}`).catch(() => {});
    toast('Layout reset.');
  };

  const without = (id) => {
    const next = { ...layout };
    for (const k of [...COLS, 'hidden']) next[k] = next[k].filter((x) => x !== id);
    return next;
  };
  const moveTo = (id, col, index) => {
    const from = COLS.find((k) => layout[k].includes(id));
    const next = without(id);
    const at = from === col && layout[col].indexOf(id) < index ? index - 1 : index;
    next[col] = [...next[col].slice(0, at), id, ...next[col].slice(at)];
    save(next);
  };
  const step = (id, col, d) => {
    const i = layout[col].indexOf(id);
    const j = i + d;
    if (j >= 0 && j < layout[col].length) moveTo(id, col, d > 0 ? j + 1 : j);
    else {
      // Past the end of a column: continue into the next one.
      const k = COLS[COLS.indexOf(col) + (d > 0 ? 1 : -1)];
      if (k) moveTo(id, k, d > 0 ? 0 : layout[k].length);
    }
  };
  const hide = (id) => { const next = without(id); next.hidden = [...next.hidden, id]; save(next); };
  const show = (id) => { const next = without(id); const c = byId[id]; next[c.col] = [...next[c.col], id]; save(next); };

  // Pointer dragging works for mouse, pen and touch.
  const targetAt = (x, y, id) => {
    const el = document.elementFromPoint(x, y);
    const card = el?.closest('[data-card]');
    const colEl = el?.closest('[data-col]');
    if (!colEl || !boardRef.current?.contains(colEl)) return null;
    const col = colEl.dataset.col;
    if (card && card.dataset.card !== id) {
      const r = card.getBoundingClientRect();
      const i = layout[col].indexOf(card.dataset.card);
      return { col, index: y > r.top + r.height / 2 ? i + 1 : i };
    }
    if (card) return { col, index: layout[col].indexOf(id) };
    // Empty space in a column: before the first card below the pointer, else at the end.
    const kids = [...colEl.querySelectorAll(':scope > [data-card]')];
    const below = kids.findIndex((k) => k.getBoundingClientRect().top > y);
    return { col, index: below === -1 ? layout[col].length : layout[col].indexOf(kids[below].dataset.card) };
  };
  const startDrag = (e, id) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    let target = null;
    setDrag({ id, target });
    const move = (ev) => {
      target = targetAt(ev.clientX, ev.clientY, id) || target;
      setDrag({ id, target });
      // Scroll when dragging near the top or bottom edge.
      if (ev.clientY < 60) scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) scrollBy(0, 12);
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (target) moveTo(id, target.col, target.index);
    };
    const cancel = () => { target = null; end(); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', cancel);
  };

  const renderCol = (col) => {
    const ids = layout[col];
    if (!editing && !ids.length) return null;
    const drop = drag?.target?.col === col ? drag.target.index : -1;
    return (
      <div class={`board-col stack ${col === 'top' ? 'mb' : ''} ${editing ? 'editing' : ''}`} data-col={col}>
        {editing && <div class="board-col-label">{COL_LABEL[col]}</div>}
        {ids.map((id, i) => (
          <div class={`board-card ${drag?.id === id ? 'dragging' : ''} ${drop === i ? 'drop-before' : ''} ${drop === ids.length && i === ids.length - 1 ? 'drop-after' : ''}`} data-card={id} key={id}>
            {editing && (
              <div class="board-bar">
                <button class="board-handle" onPointerDown={(e) => startDrag(e, id)} aria-label={`Drag ${byId[id].title}`} title="Drag to move">⠿</button>
                <span class="board-title">{byId[id].title}</span>
                <button class="icon-btn" onClick={() => step(id, col, -1)} aria-label={`Move ${byId[id].title} up`} title="Move up">↑</button>
                <button class="icon-btn" onClick={() => step(id, col, 1)} aria-label={`Move ${byId[id].title} down`} title="Move down">↓</button>
                <button class="icon-btn" onClick={() => hide(id)} aria-label={`Hide ${byId[id].title}`} title="Hide"><Icon name="x" size={16} /></button>
              </div>
            )}
            <div class={editing ? 'board-preview' : ''}>{byId[id].node}</div>
          </div>
        ))}
        {editing && !ids.length && <div class={`board-empty ${drop === 0 ? 'drop-before' : ''}`}>Drag a card here</div>}
      </div>
    );
  };

  return (
    <div class={`dash ${drag ? 'is-dragging' : ''}`} ref={boardRef}>
      <div class="row between board-tools">
        {editing ? <span class="small muted">Drag cards by ⠿ or use the arrows. Your layout is saved to your login.</span> : <span />}
        <div class="row">
          {editing && <button class="btn sm ghost" onClick={reset}>Reset to default</button>}
          <button class={`btn sm ${editing ? '' : 'ghost'}`} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Customize'}</button>
        </div>
      </div>
      {editing && layout.hidden.length > 0 && (
        <div class="card board-hidden">
          <span class="small muted">Hidden:</span>
          {layout.hidden.map((id) => <button class="btn sm secondary" onClick={() => show(id)}><Icon name="plus" size={14} />{byId[id].title}</button>)}
        </div>
      )}
      {renderCol('top')}
      <div class="grid main-side">
        {renderCol('main') || <div />}
        {renderCol('side') || <div />}
      </div>
    </div>
  );
}
