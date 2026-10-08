// Small key/value settings store and document numbering.
import { now } from './util.js';

export async function getSettings(db, prefix) {
  const rows = (await db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').bind(`${prefix}%`).all()).results;
  const out = {};
  for (const r of rows) {
    try { out[r.key.slice(prefix.length)] = JSON.parse(r.value); } catch { out[r.key.slice(prefix.length)] = r.value; }
  }
  return out;
}

export async function putSetting(db, key, value, userId = null) {
  await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(key, JSON.stringify(value), now(), userId).run();
}

// Atomic per-year sequence: DD-2026-0001 for contracts, INV-2026-0001 for invoices.
export async function nextNumber(db, prefix) {
  const year = new Date().toLocaleString('en-US', { timeZone: 'America/Detroit', year: 'numeric' });
  const name = `${prefix}-${year}`;
  const row = await db.prepare(`INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`).bind(name).first();
  return `${name}-${String(row.value).padStart(4, '0')}`;
}
