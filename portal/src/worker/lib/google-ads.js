// Google Ads: Detcord's manager account (MCC) asks to manage a client's Ads account. The client
// accepts in their own Google Ads account; until then the link is pending. Uses the Google Ads REST
// API with an OAuth refresh token for a user who can manage the MCC.
import { now } from './util.js';

const API = 'https://googleads.googleapis.com';
// Since September 2026 Google grants API access to the Cloud project behind the OAuth client, not to a developer
// token. The token is still sent when one is set (older setups), but it is no longer required.
export const ADS_SECRETS = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'];
export const adsMissing = (env) => ADS_SECRETS.filter((k) => !env[k]);
export const adsReady = (env) => !adsMissing(env).length;
const managerId = (env) => String(env.GOOGLE_ADS_MANAGER_ID || '4482626468').replace(/\D/g, '');
const version = (env) => env.GOOGLE_ADS_API_VERSION || 'v25';

export const STATUS_LABEL = {
  waiting_setup: 'Waiting for Google Ads setup', pending: 'Request sent, waiting for the client to accept', active: 'Linked',
  refused: 'Client declined', cancelled: 'Request cancelled', inactive: 'Link ended', failed: 'Request failed',
};
const FROM_GOOGLE = { PENDING: 'pending', ACTIVE: 'active', REFUSED: 'refused', CANCELED: 'cancelled', INACTIVE: 'inactive' };

// "123-456-7890" → "1234567890"; null when it isn't a 10-digit customer ID.
export function cleanCustomerId(v) {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  return /^\d{10}$/.test(d) ? d : null;
}
export const formatCustomerId = (d) => (d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null);

async function accessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok || !data?.access_token) throw new Error(res ? 'Google rejected the Ads sign-in (refresh token). It may need to be created again.' : 'Could not reach Google.');
  return data.access_token;
}

async function call(env, path, body) {
  const token = await accessToken(env);
  const res = await fetch(`${API}/${version(env)}/customers/${managerId(env)}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}), 'login-customer-id': managerId(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach Google Ads.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.details?.[0]?.errors?.[0];
    const code = detail ? Object.values(detail.errorCode || {})[0] : null;
    throw Object.assign(new Error(friendly(code, detail?.message || data?.error?.message || `Google Ads answered ${res.status}.`)), { code });
  }
  return data;
}

function friendly(code, fallback) {
  const map = {
    DEVELOPER_TOKEN_NOT_APPROVED: 'This Google Cloud project only has test access. Request Basic access on the Google Ads API Overview page in the Google Cloud Console.',
    CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: 'This Google Cloud project only has test access. Request Basic access on the Google Ads API Overview page in the Google Cloud Console.',
    CUSTOMER_NOT_FOUND: 'Google Ads has no account with that customer ID.',
    ALREADY_INVITED_BY_THIS_MANAGER: 'A request from Detcord is already waiting in this account.',
    ALREADY_MANAGED_BY_THIS_MANAGER: 'This account is already linked to Detcord.',
    ALREADY_MANAGED_IN_HIERARCHY: 'This account is already linked under Detcord.',
    CLIENT_HAS_TOO_MANY_MANAGERS: 'This account already has the most managers Google allows.',
    USER_PERMISSION_DENIED: 'The signed-in Google user can’t manage Detcord’s manager account.',
  };
  return map[code] || String(fallback).slice(0, 200);
}

// Current link status as Google sees it, or null when there is no link.
export async function linkStatus(env, customerId) {
  const data = await call(env, 'googleAds:search', {
    query: `SELECT customer_client_link.status, customer_client_link.client_customer FROM customer_client_link WHERE customer_client_link.client_customer = 'customers/${customerId}'`,
  });
  const rows = data.results || [];
  // A previous refused or cancelled link can sit next to a new one; prefer the live one.
  const order = ['ACTIVE', 'PENDING', 'REFUSED', 'CANCELED', 'INACTIVE'];
  const s = rows.map((r) => r.customerClientLink?.status).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  return s ? FROM_GOOGLE[s] || null : null;
}

// Sends the invitation and records the result on the client. Never claims a link Google didn't confirm.
export async function requestLink(env, db, client, userId) {
  const id = client.ads_customer_id;
  const save = (status, error = null) => db.prepare('UPDATE clients SET ads_link_status=?, ads_link_error=?, ads_link_requested_at=?, ads_link_requested_by=?, ads_link_checked_at=?, updated_at=? WHERE id=?')
    .bind(status, error, now(), userId, now(), now(), client.id).run().then(() => ({ status, error }));
  if (!id) return { status: null, error: null };
  if (!adsReady(env)) return save('waiting_setup', null);
  try {
    await call(env, 'customerClientLinks:mutate', { operation: { create: { clientCustomer: `customers/${id}`, status: 'PENDING' } } });
    return save('pending');
  } catch (e) {
    if (e.code === 'ALREADY_INVITED_BY_THIS_MANAGER') return save('pending');
    if (e.code === 'ALREADY_MANAGED_BY_THIS_MANAGER' || e.code === 'ALREADY_MANAGED_IN_HIERARCHY') return save('active');
    return save('failed', e.message);
  }
}

export async function refreshLink(env, db, client) {
  if (!client.ads_customer_id || !adsReady(env)) return { status: client.ads_link_status, error: client.ads_link_error };
  let status = client.ads_link_status;
  let error = null;
  try {
    status = (await linkStatus(env, client.ads_customer_id)) || (status === 'waiting_setup' ? status : 'failed');
    if (status === 'failed') error = 'Google Ads shows no request for this account. Send it again.';
  } catch (e) {
    error = e.message;
  }
  await db.prepare('UPDATE clients SET ads_link_status=?, ads_link_error=?, ads_link_checked_at=? WHERE id=?').bind(status, error, now(), client.id).run();
  return { status, error };
}

// Connection test: reads the manager account itself.
export async function testAds(env) {
  const data = await call(env, 'googleAds:search', { query: 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1' });
  const c = data.results?.[0]?.customer;
  if (!c) throw new Error('Google Ads answered, but not with the manager account.');
  if (!c.manager) throw new Error(`Customer ${formatCustomerId(managerId(env))} is not a manager account.`);
  return { name: c.descriptiveName, id: formatCustomerId(String(c.id)) };
}
