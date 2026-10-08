// Question helpers shared by all discovery content.
//
// Question shape:
//   { id, q, type, options?, hint?, placeholder?, showIf?, optional? }
// type: 'text' | 'long' | 'single' | 'multi' | 'scale' (1-5) | 'number' | 'money' | 'yesno'
// hint: what the rep should listen for, or a talk track. Shown small under the question.
// showIf: { id, in: [...] } | { id, notIn: [...] } | { id, gte: n } | { id, lte: n } | { id, answered: true }

export const q = (id, text, type = 'text', extra = {}) => ({ id, q: text, type, ...extra });

// options('a|Label A', 'b|Label B') or options('Label') where value = slug of label
export const opts = (...items) => items.map((it) => {
  const [v, l] = it.includes('|') ? it.split('|') : [slug(it), it];
  return { v, l };
});

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function visible(question, answers) {
  const cond = question.showIf;
  if (!cond) return true;
  const a = answers[cond.id];
  if (cond.answered) return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.length);
  const vals = Array.isArray(a) ? a : [a];
  if (cond.in) return vals.some((v) => cond.in.includes(v));
  if (cond.notIn) return a !== undefined && !vals.some((v) => cond.notIn.includes(v));
  if (cond.gte !== undefined) return Number(a) >= cond.gte;
  if (cond.lte !== undefined) return a !== undefined && a !== '' && Number(a) <= cond.lte;
  return true;
}

// Rule matching used by recommendation and objection rules.
export function matches(cond, answers) {
  if (!cond) return true;
  if (cond.all) return cond.all.every((x) => matches(x, answers));
  if (cond.any) return cond.any.some((x) => matches(x, answers));
  const a = answers[cond.id];
  if (a === undefined || a === null || a === '') return false;
  const vals = Array.isArray(a) ? a : [a];
  if (cond.in) return vals.some((v) => cond.in.includes(v));
  if (cond.notIn) return !vals.some((v) => cond.notIn.includes(v));
  if (cond.includesNone) return !vals.some((v) => cond.includesNone.includes(v));
  if (cond.gte !== undefined) return Number(a) >= cond.gte;
  if (cond.lte !== undefined) return Number(a) <= cond.lte;
  if (cond.eq !== undefined) return a === cond.eq;
  return false;
}
