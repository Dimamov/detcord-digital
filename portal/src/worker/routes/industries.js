// Industries staff added at intake. Staff only; clients never pick an industry.
import { Hono } from 'hono';
import { readJson } from '../lib/util.js';
import { requireRole } from '../lib/auth.js';
import { addIndustry, listCustomIndustries } from '../lib/industries.js';

const r = new Hono();

r.get('/industries', async (c) => {
  requireRole(c, 'admin', 'rep');
  return c.json({ custom: await listCustomIndustries(c.env.DB) });
});

r.post('/industries', async (c) => {
  const user = requireRole(c, 'admin', 'rep');
  const b = await readJson(c);
  return c.json({ industry: await addIndustry(c.env.DB, user, b.name) });
});

export default r;
