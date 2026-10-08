import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { verifySignature } from '../src/worker/routes/email-delivery.js';
import { renderEmail, sendEmail } from '../src/worker/lib/email.js';
import worker from '../src/worker/index.js';
import { as, api } from './helpers.js';

describe('email delivery', () => {
  it('verifies the published Svix test vector, rejects tampering and stale replays', async () => {
    const body = '{"event_type":"ping","data":{"success":true}}';
    const headers = new Headers({ 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' });
    const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
    expect(await verifySignature(body, headers, secret, 1731705121000)).toBe(true);
    expect(await verifySignature(body + ' ', headers, secret, 1731705121000)).toBe(false);
    expect(await verifySignature(body, headers, secret, 1731705721000)).toBe(false);
  });
  it('records immediate failures without retaining password links', async () => {
    const result = await sendEmail(env, { to: 'delivery@example.com', subject: 'Invite', text: 'secret-one-time-link' });
    expect(result.status).toBe('not_configured');
    const row = await env.DB.prepare('SELECT * FROM outbound_emails WHERE recipient=?').bind('delivery@example.com').first();
    expect(row.status).toBe('not_configured');
    expect(JSON.stringify(row)).not.toContain('secret-one-time-link');
  });
  it('exposes delivery records to admins only', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    const a = await (await admin.call('GET', '/api/dashboard')).json();
    const b = await (await rep.call('GET', '/api/dashboard')).json();
    expect(a.emails).toBeDefined();
    expect(b.emails).toBeUndefined();
    expect((await api('POST', '/api/webhooks/resend', {})).status).toBe(503);
  });
  it('records signed bounces, deduplicates alerts, and never loops on alert failures', async () => {
    const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
    const configured = { ...env, RESEND_WEBHOOK_SECRET: secret, EMAIL_ALERT_TO: 'admin@example.com', RESEND_API_KEY: 'test' };
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO outbound_emails (id,provider_id,recipient,subject,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, id, 'recipient@example.com', 'Report', 'accepted', Date.now(), 0).run();
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'alert-provider' }), { status: 200 }));
    async function deliver(type, eventId, providerId = id, when = Date.now()) {
      const body = JSON.stringify({ type, created_at: new Date(when).toISOString(), data: { email_id: providerId, bounce: { message: 'Blocked due to content' } } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${eventId}.${timestamp}.${body}`)))));
      return worker.fetch(new Request('https://portal.test/api/webhooks/resend', { method: 'POST', headers: { 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }, body }), configured, {});
    }
    try {
      expect((await deliver('email.bounced', 'bounce-1')).status).toBe(200);
      expect((await deliver('email.bounced', 'bounce-1')).status).toBe(200);
      expect(mock).toHaveBeenCalledTimes(1);
      const email = await env.DB.prepare('SELECT * FROM outbound_emails WHERE id=?').bind(id).first();
      expect(email.status).toBe('bounced');
      expect(email.error).toBe('Blocked due to content');
      await deliver('email.sent', 'older-sent', id, Date.now() - 60000);
      expect((await env.DB.prepare('SELECT status FROM outbound_emails WHERE id=?').bind(id).first()).status).toBe('bounced');
      await deliver('email.bounced', 'alert-bounce', 'alert-provider');
      expect(mock).toHaveBeenCalledTimes(1);
      const activity = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE id='email-alert/bounce-1'").first();
      expect(activity.n).toBe(1);
    } finally { mock.mockRestore(); }
  });
  it('removes only the image for the comparison send', () => {
    const input = { origin: 'https://portal.test', heading: 'Report', paragraphs: ['Same content'] };
    expect(renderEmail(input).html).toContain('<img');
    expect(renderEmail({ ...input, omitLogo: true }).html).not.toContain('<img');
    expect(renderEmail(input).text).toBe(renderEmail({ ...input, omitLogo: true }).text);
  });
});
