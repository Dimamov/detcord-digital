import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { api, toast } from './lib.js';
import { INDUSTRIES, INDUSTRY_GROUPS, industryById } from '../shared/discovery/industries.js';

// Industries staff added themselves, loaded once and shared by every picker and label.
const custom = signal(null);
let loading = null;
function loadCustom() {
  if (!loading) loading = api('GET', '/industries').then((r) => { custom.value = r.custom; }).catch(() => { loading = null; });
  return loading;
}

export function useIndustries() {
  useEffect(() => { if (!custom.value) loadCustom(); }, []);
  return custom.value || [];
}

export function industryName(id) {
  if (!id) return '';
  if (id === 'other') return 'Other';
  if (industryById[id]) return industryById[id].name;
  if (!custom.value) loadCustom(); // the label fills in once the list arrives
  return custom.value?.find((i) => i.id === id)?.name || '';
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => norm(a).replace(/s$/, '') === norm(b).replace(/s$/, '');

// Type to search; if nothing fits, the last option adds what was typed as a new industry.
export function IndustrySelect({ value, onChange, required }) {
  const added = useIndustries();
  const [text, setText] = useState(null); // null = not typing; show the chosen name
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef();

  const groupName = Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g.id, g.name]));
  const all = [
    ...INDUSTRIES.map((i) => ({ id: i.id, name: i.name, group: groupName[i.group] })),
    ...added.map((i) => ({ id: i.id, name: i.name, group: 'Added by your team' })),
    { id: 'other', name: 'Other', group: '' },
  ];
  const q = norm(text || '');
  const matches = q ? all.filter((i) => norm(i.name).includes(q) || norm(i.group).includes(q)) : all;
  const exact = q && all.some((i) => same(i.name, q) || same(i.id, q));
  const options = [...matches, ...(q.length >= 2 && !exact ? [{ id: '+', name: text.trim(), group: '' }] : [])];

  const choose = async (o) => {
    if (!o) return;
    if (o.id === '+') {
      setBusy(true);
      try {
        const { industry } = await api('POST', '/industries', { name: o.name });
        if (industry.created) custom.value = [...(custom.value || []), { id: industry.id, name: industry.name }].sort((a, b) => a.name.localeCompare(b.name));
        toast(industry.created ? `Added “${industry.name}” as a new industry.` : `Using ${industry.name}.`);
        onChange(industry.id);
      } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
    } else onChange(o.id);
    setText(null); setOpen(false); input.current?.blur();
  };

  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { setText(null); setOpen(false); }
  };

  let lastGroup = null;
  return (
    <div class="combo">
      <input ref={input} class="input" role="combobox" aria-expanded={open} aria-autocomplete="list" autocomplete="off"
        placeholder="Type or choose an industry…" required={required && !value} disabled={busy}
        value={text ?? industryName(value)}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => { setOpen(false); setText(null); }}
        onInput={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(''); }}
        onKeyDown={key} />
      {open && options.length > 0 && (
        <div class="combo-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => {
            const head = o.group && o.group !== lastGroup && !q ? <div class="combo-group">{o.group}</div> : null;
            lastGroup = o.group;
            return (
              <>
                {head}
                <div role="option" aria-selected={i === active} class={`combo-option ${i === active ? 'active' : ''} ${o.id === value ? 'chosen' : ''}`}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(o)}>
                  {o.id === '+' ? <>Add “<strong>{o.name}</strong>” as a new industry</> : o.name}
                  {q && o.group && <span class="faint small"> · {o.group}</span>}
                </div>
              </>
            );
          })}
        </div>
      )}
    </div>
  );
}
