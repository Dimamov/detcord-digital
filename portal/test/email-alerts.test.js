import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { sendEmail } from '../src/worker/lib/email.js';
import { as } from './helpers.js';

describe('failed email alerts in the portal', () => {
  it('gives the client\'s rep a task and notes it on the client record, once', async () => {
    const admin = await as('admin');
    const rep = await as('rep');
    const { id: clientId } = await (await admin.call('POST', '/api/clients', { name: 'Bounce Roofing', repId: rep.id })).json();
    await admin.call('POST', `/api/clients/${clientId}/contacts`, { name: 'Pat', email: 'Pat@Bounce.example' });
    const configured = { ...env, RESEND_API_KEY: 'test', EMAIL_FROM: 'x@detcorddigital.com' };
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"Invalid to"}', { status: 422 }));
    try {
      const r = await sendEmail(configured, { to: 'pat@bounce.example', subject: 'Your website check', text: 'hi' });
      expect(r.status).toBe('failed');
    } finally { mock.mockRestore(); }
    const tasks = (await env.DB.prepare('SELECT * FROM tasks WHERE client_id=?').bind(clientId).all()).results;
    expect(tasks.length).toBe(1);
    expect(tasks[0].owner_id).toBe(rep.id);
    expect(tasks[0].title).toContain('pat@bounce.example');
    const notes = (await env.DB.prepare('SELECT * FROM notes WHERE client_id=?').bind(clientId).all()).results;
    expect(notes.length).toBe(1);
    expect(notes[0].visibility).toBe('internal');
    const view = await (await rep.call('GET', '/api/clients/' + clientId)).json();
    expect(view.notes.length).toBe(1);
  });

  it('sends unmatched failures to admins and skips the missing-key case', async () => {
    const admin = await as('admin');
    const configured = { ...env, RESEND_API_KEY: 'test', EMAIL_FROM: 'x@detcorddigital.com' };
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    try { await sendEmail(configured, { to: 'nobody@unknown.example', subject: 'Hello', text: 'hi' }); } finally { mock.mockRestore(); }
    expect(await env.DB.prepare("SELECT 1 FROM tasks WHERE owner_id=? AND title LIKE '%nobody@unknown.example%'").bind(admin.id).first()).toBeTruthy();
    await sendEmail(env, { to: 'nokey@unknown.example', subject: 'Hello', text: 'hi' });
    expect(await env.DB.prepare("SELECT 1 FROM tasks WHERE title LIKE '%nokey@unknown.example%'").first()).toBeNull();
  });
});
