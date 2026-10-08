// Client Google Ads accounts and Detcord MCC link requests. Staff only; admins manage the integration.
import { Hono } from 'hono';
import { fail, now, readJson, logActivity } from '../lib/util.js';
import { requireClient, requireRole } from '../lib/auth.js';
import { getSettings, putSetting } from '../lib/settings.js';
import { cleanCustomerId, formatCustomerId, requestLink, refreshLink, adsReady, adsMissing, testAds, STATUS_LABEL } from '../lib/google-ads.js';

const r = new Hono();

export const adsView = (cl) => ({
  customer_id: formatCustomerId(cl.ads_customer_id), status: cl.ads_link_status, status_label: STATUS_LABEL[cl.ads_link_status] || null,
  error: cl.ads_link_error, requested_at: cl.ads_link_requested_at, checked_at: cl.ads_link_checked_at,
});

// Saves the account and sends the request; used by the new-client form too.
export async function setAdsAccount(c, client, raw, user) {
  const db = c.env.DB;
  if (raw === null || raw === '') {
    await db.prepare('UPDATE clients SET ads_customer_id=NULL, ads_link_status=NULL, ads_link_error=NULL, ads_link_requested_at=NULL, ads_link_checked_at=NULL, updated_at=? WHERE id=?').bind(now(), client.id).run();
    return null;
  }
  const id = cleanCustomerId(raw);
  if (!id) fail(400, 'Enter the 10-digit Google Ads customer ID, like 123-456-7890.');
  if (id === client.ads_customer_id && ['pending', 'active'].includes(client.ads_link_status)) return client.ads_link_status;
  await db.prepare('UPDATE clients SET ads_customer_id=?, updated_at=? WHERE id=?').bind(id, now(), client.id).run();
  const res = await requestLink(c.env, db, { ...client, ads_customer_id: id }, user.id);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'google_ads',
    summary: res.status === 'pending' ? `Sent a Google Ads link request to ${formatCustomerId(id)}` : res.status === 'active' ? `Google Ads ${formatCustomerId(id)} is already linked` : res.status === 'waiting_setup' ? `Saved Google Ads ${formatCustomerId(id)}; the link request goes out once Google Ads is set up` : `Google Ads link request to ${formatCustomerId(id)} failed` });
  return res.status;
}

const load = async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  return { user, client: await c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(client.id).first() };
};

r.get('/clients/:id/google-ads', async (c) => {
  const { client } = await load(c);
  return c.json({ ads: adsView(client), ready: adsReady(c.env) });
});

r.put('/clients/:id/google-ads', async (c) => {
  const { user, client } = await load(c);
  const b = await readJson(c);
  await setAdsAccount(c, client, b.customerId ?? null, user);
  return c.json({ ads: adsView(await c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(client.id).first()) });
});

// Send again (after a refusal, a failure, or once setup is done).
r.post('/clients/:id/google-ads/request', async (c) => {
  const { user, client } = await load(c);
  if (!client.ads_customer_id) fail(400, 'Add the Google Ads customer ID first.');
  if (client.ads_link_status === 'active') fail(409, 'This account is already linked.');
  await requestLink(c.env, c.env.DB, client, user.id);
  return c.json({ ads: adsView(await c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(client.id).first()) });
});

r.post('/clients/:id/google-ads/check', async (c) => {
  const { client } = await load(c);
  if (!adsReady(c.env)) fail(400, 'Google Ads isn’t set up yet, so the status can’t be checked.');
  await refreshLink(c.env, c.env.DB, client);
  return c.json({ ads: adsView(await c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(client.id).first()) });
});

// ---------- Admin: integration status, test, and sending requests saved before setup ----------

r.get('/settings/integrations/google-ads', async (c) => {
  requireRole(c, 'admin');
  const s = await getSettings(c.env.DB, 'integration.googleAds.');
  const waiting = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE ads_link_status='waiting_setup'").first();
  const ready = adsReady(c.env);
  return c.json({
    configured: ready, missing: adsMissing(c.env), lastTest: s.test || null, waiting: waiting.n,
    manager: formatCustomerId(String(c.env.GOOGLE_ADS_MANAGER_ID || '4482626468')),
    state: !ready ? 'not_configured' : s.test?.ok ? 'connected' : s.test ? 'failing' : 'untested',
  });
});

r.post('/settings/integrations/google-ads/test', async (c) => {
  const user = requireRole(c, 'admin');
  if (!adsReady(c.env)) return c.json({ ok: false, error: `Missing Worker secrets: ${adsMissing(c.env).join(', ')}.` }, 400);
  let result;
  try { result = { ok: true, ...(await testAds(c.env)) }; } catch (e) { result = { ok: false, error: e.message }; }
  result = { ...result, at: now(), by: user.name };
  await putSetting(c.env.DB, 'integration.googleAds.test', result, user.id);
  return c.json(result, result.ok ? 200 : 502);
});

r.post('/settings/integrations/google-ads/send-waiting', async (c) => {
  const user = requireRole(c, 'admin');
  if (!adsReady(c.env)) fail(400, 'Google Ads isn’t set up yet.');
  const rows = (await c.env.DB.prepare("SELECT * FROM clients WHERE ads_link_status='waiting_setup' LIMIT 50").all()).results;
  const out = { sent: 0, failed: 0 };
  for (const cl of rows) {
    const res = await requestLink(c.env, c.env.DB, cl, user.id);
    if (res.status === 'failed') out.failed++; else out.sent++;
  }
  return c.json(out);
});

export default r;
