import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as, BASE } from './helpers.js';
import { twilioSignature, handleEmail, stripQuoted } from '../src/worker/routes/inbound.js';
import { autoDraft } from '../src/worker/lib/goat.js';

afterEach(() => vi.restoreAllMocks());

const uid = () => crypto.randomUUID().slice(0, 8);

// A client business with a portal login, an assigned rep and a contact who texts.
async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const owner = await as('client');
  const stranger = await as('client');
  const otherRep = await as('rep');
  const id = crypto.randomUUID();
  const phone = `248555${String(Math.floor(1000 + Math.random() * 8999))}`;
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO clients (id, name, city, state, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(id, `Main St Bakery ${uid()}`, 'Troy', 'MI', t, t),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(id, owner.id),
    env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, rep.id, t),
    env.DB.prepare('INSERT INTO contacts (id, client_id, name, phone, email, created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, 'Sam Rivera', `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`, `sam-${uid()}@mainstbakery.com`, t),
  ]);
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE client_id=?').bind(id).first();
  return { admin, rep, owner, stranger, otherRep, clientId: id, phone: `+1${phone}`, contact };
}

async function text(params, { sign = true } = {}) {
  const url = `${BASE}/api/webhooks/twilio`;
  const all = { AccountSid: 'ACtest', MessageSid: `SM${uid()}${uid()}`, NumMedia: '0', ...params };
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (sign) headers['X-Twilio-Signature'] = await twilioSignature('test-auth-token', url, all);
  const res = await SELF.fetch(url, { method: 'POST', headers, body: new URLSearchParams(all).toString() });
  return { res, body: await res.text(), sid: all.MessageSid };
}

describe('GOAT requests in the portal', () => {
  it('runs request, plan, approval and completion with the scope checked on every step', async () => {
    const { rep, owner, stranger, otherRep, clientId } = await setup();
    const key = `k-${uid()}${uid()}`;
    let res = await owner.call('POST', `/api/clients/${clientId}/goat`, { body: 'Change my hours for Thanksgiving: closed Thursday.', submitKey: key });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    // A double-clicked submit does not create a second request.
    res = await owner.call('POST', `/api/clients/${clientId}/goat`, { body: 'Change my hours for Thanksgiving: closed Thursday.', submitKey: key });
    expect(await res.json()).toMatchObject({ id, duplicate: true });

    // Other businesses and unassigned reps get the same 404 as a missing request.
    expect((await stranger.call('GET', `/api/goat/${id}`)).status).toBe(404);
    expect((await otherRep.call('GET', `/api/goat/${id}`)).status).toBe(404);
    expect((await stranger.call('POST', `/api/clients/${clientId}/goat`, { body: 'hi' })).status).toBe(404);
    expect((await stranger.call('GET', '/api/goat')).json()).resolves.toMatchObject({ requests: [] });

    // Only staff write plans; only the client approves.
    expect((await owner.call('PUT', `/api/goat/${id}/proposal`, { summary: 'x' })).status).toBe(403);
    res = await rep.call('PUT', `/api/goat/${id}/proposal`, { summary: 'Post Thanksgiving hours on your website and Google profile.', steps: ['Add a holiday banner', 'Set special hours on Google'], content: 'Closed Thursday, Nov 26 for Thanksgiving.' });
    expect(res.status).toBe(200);
    let detail = await (await owner.call('GET', `/api/goat/${id}`)).json();
    expect(detail.request.status).toBe('proposed');
    expect(detail.request.proposal.execution).toBe('team');
    expect((await rep.call('POST', `/api/goat/${id}/approve`, { hash: detail.request.proposal_hash })).status).toBe(403);
    expect((await rep.call('POST', `/api/goat/${id}/done`, { note: 'x' })).status).toBe(409); // not approved yet
    expect((await owner.call('POST', `/api/goat/${id}/approve`, { hash: 'stale' })).status).toBe(409);
    expect((await owner.call('POST', `/api/goat/${id}/approve`, { hash: detail.request.proposal_hash })).status).toBe(200);

    // A material change after approval needs approval again.
    res = await rep.call('PUT', `/api/goat/${id}/proposal`, { summary: 'Post Thanksgiving hours on your website, Google profile and Facebook.', steps: ['Add a holiday banner'], content: 'Closed Thursday.' });
    expect(await res.json()).toMatchObject({ reapproval: true, status: 'proposed' });
    detail = await (await owner.call('GET', `/api/goat/${id}`)).json();
    expect(detail.request.approved_at).toBeNull();
    expect((await owner.call('POST', `/api/goat/${id}/approve`, { hash: detail.request.proposal_hash })).status).toBe(200);

    await rep.call('POST', `/api/goat/${id}/comment`, { body: 'Google needs the owner login.', internal: true });
    await rep.call('POST', `/api/goat/${id}/comment`, { body: 'Starting on this now.' });
    expect((await rep.call('POST', `/api/goat/${id}/start`, {})).status).toBe(200);
    expect((await rep.call('POST', `/api/goat/${id}/done`, { note: 'Banner is live and Google shows special hours.', url: 'https://mainstbakery.com' })).status).toBe(200);

    detail = await (await owner.call('GET', `/api/goat/${id}`)).json();
    expect(detail.request).toMatchObject({ status: 'done', result_note: 'Banner is live and Google shows special hours.' });
    expect(detail.events.some((e) => e.body === 'Starting on this now.')).toBe(true);
    expect(detail.events.some((e) => e.body === 'Google needs the owner login.')).toBe(false); // internal note hidden
    expect(detail.request.sender_address).toBeUndefined();
    const staffView = await (await rep.call('GET', `/api/goat/${id}`)).json();
    expect(staffView.events.some((e) => e.body === 'Google needs the owner login.' && e.internal)).toBe(true);
  });

  it('refuses attachments from another client or internal files for client logins', async () => {
    const { owner, clientId, admin } = await setup();
    const other = await setup();
    const t = Date.now();
    const foreign = crypto.randomUUID();
    const internal = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO media (id, client_id, filename, content_type, size, r2_key, visibility, created_at) VALUES (?,?,?,?,?,?,'shared',?)").bind(foreign, other.clientId, 'x.png', 'image/png', 1, `k/${foreign}`, t),
      env.DB.prepare("INSERT INTO media (id, client_id, filename, content_type, size, r2_key, visibility, created_at) VALUES (?,?,?,?,?,?,'internal',?)").bind(internal, clientId, 'y.png', 'image/png', 1, `k/${internal}`, t),
    ]);
    expect((await owner.call('POST', `/api/clients/${clientId}/goat`, { body: 'Use this photo', mediaIds: [foreign] })).status).toBe(400);
    expect((await owner.call('POST', `/api/clients/${clientId}/goat`, { body: 'Use this photo', mediaIds: [internal] })).status).toBe(400);
    expect((await admin.call('POST', `/api/clients/${clientId}/goat`, { body: 'Use this photo', mediaIds: [internal] })).status).toBe(201);
  });

  it('drafts a plan with Claude and sends it to the client', async () => {
    const { owner, clientId } = await setup();
    const { id } = await (await owner.call('POST', `/api/clients/${clientId}/goat`, { body: 'Make a Facebook post about our pumpkin bread.' })).json();
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
      const url = String(input?.url || input);
      calls.push({ url, body: init.body || (input?.body ? await new Response(input.body).text() : '') });
      if (url.includes('api.anthropic.com')) {
        return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: JSON.stringify({ category: 'social', summary: 'Post about your pumpkin bread on Facebook.', steps: ['Write the post', 'Publish on Facebook'], content: 'Pumpkin bread is back!', questions: ['Do you have a photo?'] }) }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    });
    await autoDraft({ ...env, ANTHROPIC_API_KEY: 'test-key' }, id);
    const req = calls.find((x) => x.url.includes('api.anthropic.com'));
    expect(req).toBeTruthy();
    const sent = JSON.parse(req.body);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.messages[0].content).toContain('pumpkin bread');
    const detail = await (await owner.call('GET', `/api/goat/${id}`)).json();
    expect(detail.request).toMatchObject({ status: 'proposed', category: 'social' });
    expect(detail.request.proposal).toMatchObject({ summary: 'Post about your pumpkin bread on Facebook.', questions: ['Do you have a photo?'], execution: 'team' });
  });
});

describe('GOAT by text', () => {
  it('rejects unsigned or wrongly signed webhooks', async () => {
    expect((await text({ From: '+12485550100', Body: 'hi' }, { sign: false })).res.status).toBe(403);
  });

  it('turns a known contact’s text into a request once, and YES approves the waiting plan', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ sid: 'SMout' }), { status: 201 }));
    const { rep, phone, clientId } = await setup();
    const sid = `SM${uid()}${uid()}`;
    const first = await text({ From: phone, Body: 'Please add our new muffin to the menu page', MessageSid: sid });
    expect(first.body).toContain('Got it');
    const again = await text({ From: phone, Body: 'Please add our new muffin to the menu page', MessageSid: sid });
    expect(again.body).not.toContain('Got it');
    const rows = (await env.DB.prepare('SELECT * FROM goat_requests WHERE client_id=?').bind(clientId).all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'sms', sender_address: phone, status: 'new' });

    await rep.call('PUT', `/api/goat/${rows[0].id}/proposal`, { summary: 'Add the blueberry muffin to your menu page.' });
    const yes = await text({ From: phone, Body: 'Yes' });
    expect(yes.body).toContain('Approved');
    const after = await env.DB.prepare('SELECT status, approved_via FROM goat_requests WHERE id=?').bind(rows[0].id).first();
    expect(after).toMatchObject({ status: 'approved', approved_via: 'sms' });
    expect((await text({ From: phone, Body: 'yes' })).body).toContain('Nothing is waiting');
  });

  it('holds unknown numbers, asks who they are once, and never trusts the claimed business', async () => {
    const { admin, rep, clientId } = await setup();
    const from = `+1313555${String(Math.floor(1000 + Math.random() * 8999))}`;
    const first = await text({ From: from, Body: 'Change my hours to 9-5' });
    expect(first.body).toContain('name and your business name');
    const claim = await text({ From: from, Body: 'Sam from Main St Bakery' });
    expect(claim.body).toContain('confirm your number');
    const held = (await env.DB.prepare("SELECT * FROM goat_requests WHERE sender_address=?").bind(from).all()).results;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ client_id: null, status: 'unmatched' });

    // Reps and clients can't see or act on unmatched requests; the admin confirms them.
    expect((await rep.call('GET', `/api/goat/${held[0].id}`)).status).toBe(404);
    const list = await (await admin.call('GET', '/api/goat')).json();
    expect(list.unmatched.find((x) => x.id === held[0].id)).toMatchObject({ claimed_business: 'Sam from Main St Bakery' });
    expect((await rep.call('POST', `/api/goat/${held[0].id}/match`, { clientId })).status).toBe(404);
    expect((await admin.call('POST', `/api/goat/${held[0].id}/match`, { clientId, name: 'Sam Rivera' })).status).toBe(200);
    const matched = await env.DB.prepare('SELECT client_id, status FROM goat_requests WHERE id=?').bind(held[0].id).first();
    expect(matched).toMatchObject({ client_id: clientId, status: 'new' });
    // The number is now a contact, so the next text is recognized.
    const next = await text({ From: from, Body: 'Also add a holiday banner' });
    expect(next.body).toContain('Got it');
  });
});

describe('GOAT by email', () => {
  const message = (from, raw, headers = {}) => ({ from, to: 'goat@in.detcorddigital.com', raw: new Response(raw).body, headers: new Headers(headers) });
  const ctx = { waitUntil: () => {} };

  it('creates a request for a known address once, and holds unknown or failed-auth senders', async () => {
    const { clientId, contact } = await setup();
    const id = `<${uid()}@mail.example>`;
    const raw = `From: Sam Rivera <${contact.email}>\r\nTo: goat@detcorddigital.com\r\nSubject: Holiday hours\r\nMessage-ID: ${id}\r\nContent-Type: text/plain\r\n\r\nWe're closed Thursday.\r\n\r\nOn Mon, Nov 2, Detcord wrote:\r\n> earlier message\r\n`;
    await handleEmail(message(contact.email, raw), env, ctx);
    await handleEmail(message(contact.email, raw), env, ctx);
    const rows = (await env.DB.prepare('SELECT * FROM goat_requests WHERE client_id=? AND channel=?').bind(clientId, 'email').all()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: 'Holiday hours', body: "We're closed Thursday.", status: 'new' });

    const spoof = `From: ${contact.email}\r\nSubject: Change bank info\r\nMessage-ID: <${uid()}@x>\r\n\r\nPlease update.\r\n`;
    await handleEmail(message(contact.email, spoof, { 'Authentication-Results': 'mx.cloudflare.net; dmarc=fail' }), env, ctx);
    const held = await env.DB.prepare("SELECT * FROM goat_requests WHERE subject='Change bank info'").first();
    expect(held).toMatchObject({ client_id: null, status: 'unmatched' });
  });

  it('ignores auto-replies and our own messages', async () => {
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM goat_requests').first()).n;
    await handleEmail(message('someone@example.com', `From: someone@example.com\r\nSubject: Out of office\r\nMessage-ID: <${uid()}@x>\r\n\r\nAway.\r\n`, { 'Auto-Submitted': 'auto-replied' }), env, ctx);
    await handleEmail(message('info@detcorddigital.com', `From: info@detcorddigital.com\r\nSubject: GOAT\r\nMessage-ID: <${uid()}@x>\r\n\r\nLoop.\r\n`), env, ctx);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM goat_requests').first()).n).toBe(before);
  });

  it('strips quoted history', () => {
    expect(stripQuoted('New text\n\nOn Tue, Bob wrote:\n> old')).toBe('New text');
    expect(stripQuoted('Line one\n> quoted\nLine two')).toBe('Line one\nLine two');
  });
});
