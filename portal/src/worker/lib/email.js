// Branded transactional email via Resend. Every email has the centered PNG logo header.

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderEmail({ origin, heading, paragraphs = [], button, footnote }) {
  const logo = `${origin}/detcord-logo-transparent.png`;
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`).join('');
  const cta = button
    ? `<p style="margin:24px 0;text-align:center"><a href="${esc(button.url)}" style="display:inline-block;background:#ff6a00;color:#0b0b0b;font-weight:700;padding:14px 26px;border-radius:8px;text-decoration:none">${esc(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#5b6573">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>`
    : '';
  const note = footnote ? `<p style="margin:16px 0 0;font-size:13px;color:#5b6573">${esc(footnote)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td align="center" style="background:#07090c;padding:24px"><img src="${logo}" width="180" alt="Detcord Digital" style="display:block;margin:0 auto;width:180px;height:auto"></td></tr>
<tr><td style="padding:28px 28px 32px;font:16px/1.6 Arial,sans-serif;color:#19212c">
<h1 style="font-size:22px;margin:0 0 16px">${esc(heading)}</h1>${body}${cta}${note}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8f9fb;font:12px/1.5 Arial,sans-serif;color:#5b6573;text-align:center">Detcord Digital · info@detcorddigital.com</td></tr>
</table></td></tr></table></body></html>`;
  const textBody = [heading, '', ...paragraphs, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footnote ? ['', footnote] : []), '', 'Detcord Digital · info@detcorddigital.com'].join('\n');
  return { html, text: textBody };
}

// Returns { status: 'sent' | 'not_configured' | 'failed', error? }. Never throws.
export async function sendEmail(env, { to, subject, html, text, idempotencyKey }) {
  if (!env.RESEND_API_KEY) return { status: 'not_configured', error: 'Email sending is not configured (RESEND_API_KEY missing).' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, reply_to: env.REPLY_TO, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { status: 'sent' };
    const reason = res.status === 401 ? 'The email provider rejected the API key.'
      : res.status === 403 || res.status === 422 ? 'The email provider rejected the sender or recipient.'
      : `The email provider returned ${res.status}.`;
    return { status: 'failed', error: reason };
  } catch {
    return { status: 'failed', error: 'Could not reach the email provider.' };
  }
}
