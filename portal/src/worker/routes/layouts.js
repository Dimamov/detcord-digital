// Dashboard card layouts. Each person can only read and change their own; the layout holds card
// ids only, so it can never reveal or unlock a card the person's role doesn't already get.
import { Hono } from 'hono';
import { fail, now, readJson } from '../lib/util.js';
import { requireUser } from '../lib/auth.js';

const r = new Hono();
const PAGES = ['staff-home', 'client-home'];
const ID = /^[a-z0-9-]{1,40}$/;

const page = (c) => {
  const p = c.req.param('page');
  if (!PAGES.includes(p)) fail(404, 'Not found.');
  return p;
};

function clean(v) {
  const list = (x) => (Array.isArray(x) ? [...new Set(x.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 40) : []);
  const out = { top: list(v?.top), main: list(v?.main), side: list(v?.side), hidden: list(v?.hidden) };
  const seen = new Set();
  for (const k of ['top', 'main', 'side', 'hidden']) out[k] = out[k].filter((id) => !seen.has(id) && seen.add(id));
  return out;
}

r.get('/me/layouts/:page', async (c) => {
  const user = requireUser(c);
  const row = await c.env.DB.prepare('SELECT layout FROM user_layouts WHERE user_id=? AND page=?').bind(user.id, page(c)).first();
  return c.json({ layout: row ? JSON.parse(row.layout) : null });
});

r.put('/me/layouts/:page', async (c) => {
  const user = requireUser(c);
  const p = page(c);
  const layout = clean(await readJson(c));
  await c.env.DB.prepare(`INSERT INTO user_layouts (user_id, page, layout, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id, page) DO UPDATE SET layout=excluded.layout, updated_at=excluded.updated_at`)
    .bind(user.id, p, JSON.stringify(layout), now()).run();
  return c.json({ layout });
});

r.delete('/me/layouts/:page', async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare('DELETE FROM user_layouts WHERE user_id=? AND page=?').bind(user.id, page(c)).run();
  return c.json({ ok: true });
});

export default r;
