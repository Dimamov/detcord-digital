// Built-in industries (with their own discovery questions), "Other", and industries staff added themselves.
import { fail, now, newId } from './util.js';
import { INDUSTRIES, INDUSTRY_IDS } from '../../shared/discovery/industries.js';

// "Pool cleaner", "pool  cleaners" and "Pool Cleaners" are the same industry.
const keyOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/s$/, '');

export async function checkIndustry(db, id) {
  if (!id) return null;
  if (INDUSTRY_IDS.includes(id) || id === 'other') return id;
  if (await db.prepare('SELECT 1 FROM custom_industries WHERE id=?').bind(String(id)).first()) return id;
  fail(400, 'Choose a valid industry.');
}

export const listCustomIndustries = async (db) =>
  (await db.prepare('SELECT id, name FROM custom_industries ORDER BY name COLLATE NOCASE').all()).results;

// Returns the matching industry when the name already exists (built-in or added), so typing "plumbing" twice
// never makes two categories.
export async function addIndustry(db, user, raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) fail(400, 'Industry names are 2 to 60 characters.');
  const key = keyOf(name);
  if (!key) fail(400, 'Enter an industry name.');
  const builtIn = INDUSTRIES.find((i) => keyOf(i.name) === key || keyOf(i.id) === key);
  if (builtIn) return { id: builtIn.id, name: builtIn.name, created: false };
  if (key === 'other') return { id: 'other', name: 'Other', created: false };
  const existing = await db.prepare('SELECT id, name FROM custom_industries WHERE name_key=?').bind(key).first();
  if (existing) return { ...existing, created: false };
  const id = `x-${newId()}`;
  await db.prepare('INSERT INTO custom_industries (id, name, name_key, created_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT(name_key) DO NOTHING')
    .bind(id, name, key, user.id, now()).run();
  const row = await db.prepare('SELECT id, name FROM custom_industries WHERE name_key=?').bind(key).first();
  return { ...row, created: row.id === id };
}
