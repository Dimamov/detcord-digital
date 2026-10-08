// Clover Hosted Checkout. The browser never decides that a payment succeeded:
// only a webhook signed with CLOVER_WEBHOOK_SECRET can record a payment.
// Docs: docs.clover.com/docs/creating-a-hosted-checkout-session and /docs/ecomm-hosted-checkout-webhook

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function cloverConfig(env) {
  const missing = ['CLOVER_MERCHANT_ID', 'CLOVER_PRIVATE_TOKEN', 'CLOVER_WEBHOOK_SECRET'].filter((k) => !env[k]);
  const base = env.CLOVER_API_BASE || 'https://apisandbox.dev.clover.com';
  return { ready: missing.length === 0, missing, base, sandbox: base.includes('sandbox') };
}

// Creates a checkout page for one amount. Returns { checkoutSessionId, href, expirationTime }.
export async function createCheckout(env, { amountCents, name, note, customer, successUrl, failureUrl }) {
  const cfg = cloverConfig(env);
  const res = await fetch(`${cfg.base}/invoicingcheckoutservice/v1/checkouts`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'X-Clover-Merchant-Id': env.CLOVER_MERCHANT_ID,
      authorization: `Bearer ${env.CLOVER_PRIVATE_TOKEN}`,
    },
    body: JSON.stringify({
      customer: customer || {},
      shoppingCart: { lineItems: [{ name: name.slice(0, 127), note: (note || '').slice(0, 255), price: amountCents, unitQty: 1 }] },
      redirectUrls: { success: successUrl, failure: failureUrl },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.href || !body.checkoutSessionId) {
    const msg = body.message || body.error?.message || `Clover answered ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Header format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>".
export async function verifyCloverSignature(secret, header, rawBody, { toleranceSec = 3600, nowMs = Date.now() } = {}) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.trim().split('=').map((s) => s.trim())));
  const t = Number(parts.t);
  const v1 = String(parts.v1 || '').toLowerCase();
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  // Accept seconds or milliseconds timestamps.
  const tMs = t > 1e12 ? t : t * 1000;
  if (Math.abs(nowMs - tMs) > toleranceSec * 1000) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${parts.t}.${rawBody}`)));
  let diff = sig.length ^ v1.length;
  for (let i = 0; i < Math.min(sig.length, v1.length); i++) diff |= sig.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// Field names per Clover docs (Type, Status, Id, MerchantId, Data, Message); casing normalized.
export function readCloverEvent(json) {
  const get = (k) => json[k] ?? json[k.charAt(0).toUpperCase() + k.slice(1)] ?? json[k.toUpperCase()];
  return {
    type: String(get('type') || '').toUpperCase(),
    status: String(get('status') || '').toUpperCase(),
    paymentId: get('id') ? String(get('id')) : null,
    merchantId: get('merchantId') ? String(get('merchantId')) : null,
    sessionId: get('data') ? String(get('data')) : null,
    message: get('message') ? String(get('message')) : null,
  };
}
