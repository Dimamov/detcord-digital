// Outbound text messages through Twilio. Uses an API key (not the account auth token) and a Messaging Service.

export function twilioConfig(env) {
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET'].filter((k) => !env[k]);
  if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM) missing.push('TWILIO_MESSAGING_SERVICE_SID');
  return { ready: !missing.length, missing };
}

const authHeader = (env) => `Basic ${btoa(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`)}`;

// US numbers only for now: 10 digits, or 11 starting with 1. Returns E.164 or null.
export function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1') && /^[2-9]/.test(d[1])) return `+${d}`;
  return null;
}

// Returns { status: 'sent' | 'not_configured' | 'failed', error?, id? }. Never throws.
export async function sendSms(env, { to, body }) {
  const cfg = twilioConfig(env);
  if (!cfg.ready) return { status: 'not_configured', error: `Texting is not set up (missing ${cfg.missing.join(', ')}).` };
  const form = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', env.TWILIO_FROM);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { status: 'sent', id: data.sid || null };
    // Twilio error codes: 21610 = recipient replied STOP, 21211 = invalid number, 30034/30007 = carrier/A2P blocking.
    const reason = res.status === 401 ? 'Twilio rejected the API key.'
      : data.code === 21610 ? 'This number has opted out of texts (replied STOP).'
      : data.code === 21211 || data.code === 21614 ? 'That phone number can\'t receive texts.'
      : data.message ? `Twilio: ${String(data.message).slice(0, 160)}` : `Twilio returned ${res.status}.`;
    return { status: 'failed', error: reason };
  } catch {
    return { status: 'failed', error: 'Could not reach Twilio.' };
  }
}

// Proves the credentials and the sender without sending a message.
export async function testTwilio(env) {
  const cfg = twilioConfig(env);
  if (!cfg.ready) return { ok: false, error: `Missing Worker secrets: ${cfg.missing.join(', ')}.` };
  const headers = { Authorization: authHeader(env) };
  const acct = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!acct?.ok) return { ok: false, error: acct ? `Twilio rejected the credentials (${acct.status}).` : 'Could not reach Twilio.' };
  const info = await acct.json();
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    const svc = await fetch(`https://messaging.twilio.com/v1/Services/${env.TWILIO_MESSAGING_SERVICE_SID}/PhoneNumbers`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!svc?.ok) return { ok: false, error: 'The Messaging Service was not found for this account.' };
    const numbers = (await svc.json()).phone_numbers || [];
    if (!numbers.length) return { ok: false, error: 'The Messaging Service has no phone number attached.' };
    return { ok: true, account: info.friendly_name, trial: info.type === 'Trial', from: numbers.map((n) => n.phone_number).join(', ') };
  }
  return { ok: true, account: info.friendly_name, trial: info.type === 'Trial', from: env.TWILIO_FROM };
}
