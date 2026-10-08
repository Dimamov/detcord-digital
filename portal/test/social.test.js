import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as, BASE } from './helpers.js';
import worker from '../src/worker/index.js';
import { localTime, readZernio } from '../src/worker/lib/social.js';

afterEach(() => vi.restoreAllMocks());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// A client with a portal login, an assigned rep, a Zernio profile with two accounts, and a shared photo.
async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const owner = await as('client');
  const stranger = await as('client');
  const id = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const t = Date.now();
  const profile = `prof_${id.slice(0, 6)}`;
  const mediaId = crypto.randomUUID();
  const internalId = crypto.randomUUID();
  const otherMedia = crypto.randomUUID();
  await env.MEDIA.put(`clients/${id}/${mediaId}`, PNG);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO clients (id, name, city, state, zernio_profile_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, 'Corktown Coffee', 'Detroit', 'MI', profile, t, t),
    env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(otherId, 'Other Co', t, t),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(id, owner.id),
    env.DB.prepare('INSERT INTO client_members (client_id, user_id) VALUES (?,?)').bind(otherId, stranger.id),
    env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(id, rep.id, t),
    env.DB.prepare("INSERT INTO media (id, client_id, filename, content_type, size, r2_key, visibility, created_at) VALUES (?,?,?,?,?,?,'shared',?)").bind(mediaId, id, 'latte.png', 'image/png', PNG.length, `clients/${id}/${mediaId}`, t),
    env.DB.prepare("INSERT INTO media (id, client_id, filename, content_type, size, r2_key, visibility, created_at) VALUES (?,?,?,?,?,?,'internal',?)").bind(internalId, id, 'secret.png', 'image/png', PNG.length, `clients/${id}/${internalId}`, t),
    env.DB.prepare("INSERT INTO media (id, client_id, filename, content_type, size, r2_key, visibility, created_at) VALUES (?,?,?,?,?,?,'shared',?)").bind(otherMedia, otherId, 'theirs.png', 'image/png', PNG.length, `clients/${otherId}/${otherMedia}`, t),
  ]);
  return { admin, rep, owner, stranger, clientId: id, otherId, profile, mediaId, internalId, otherMedia };
}

// Fake Zernio. Records calls; `post` decides what POST /posts and GET /posts/:id answer.
function mockZernio(profile, { post = () => [201, { post: { _id: 'zp_1', status: 'published', platforms: [{ platform: 'facebook', status: 'published', platformPostUrl: 'https://facebook.com/p/1' }] } }], get } = {}) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input?.url || input);
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers || {}, body: typeof init.body === 'string' ? init.body : null });
    if (url.startsWith('https://upload.zernio.test/')) return new Response(null, { status: 200 });
    if (!url.startsWith('https://zernio.com/api/v1/')) return new Response('{}');
    const path = url.slice('https://zernio.com/api/v1'.length);
    if (path.startsWith('/accounts')) {
      return Response.json({ accounts: [
        { _id: 'acc_fb', platform: 'facebook', username: 'corktowncoffee', displayName: 'Corktown Coffee', isActive: true, profileId: { _id: profile, name: 'x' } },
        { _id: 'acc_ig', platform: 'instagram', username: 'corktown.coffee', isActive: true, profileId: { _id: profile, name: 'x' } },
        { _id: 'acc_other', platform: 'twitter', username: 'someoneelse', isActive: true, profileId: { _id: 'another_profile', name: 'y' } },
      ] });
    }
    if (path === '/media/presign') return Response.json({ uploadUrl: 'https://upload.zernio.test/abc', publicUrl: 'https://media.zernio.com/temp/latte.png', key: 'temp/latte.png', expiresIn: 3600 });
    if (path === '/posts' && method === 'POST') { const [status, body] = post(); return Response.json(body, { status }); }
    if (path.startsWith('/posts/')) { const [status, body] = get(); return Response.json(body, { status }); }
    if (path === '/profiles' && method === 'POST') return Response.json({ profile: { _id: 'prof_new', name: JSON.parse(init.body).name } }, { status: 201 });
    if (path === '/profiles') return Response.json({ profiles: [{ _id: profile }] });
    if (path.startsWith('/connect/')) return Response.json({ authUrl: 'https://www.facebook.com/dialog/oauth?x=1' });
    return Response.json({ error: 'Not found' }, { status: 404 });
  });
  return calls;
}

async function draft(user, clientId, body) {
  const res = await user.call('POST', `/api/clients/${clientId}/social/posts`, body);
  expect(res.status).toBe(201);
  return (await res.json()).id;
}
const getPost = async (user, id) => (await (await user.call('GET', `/api/social/posts/${id}`)).json()).post;

describe('Social posts', () => {
  it('needs client approval before publishing, and editing after approval clears it', async () => {
    const { rep, owner, clientId, profile, mediaId } = await setup();
    const calls = mockZernio(profile);
    // Loading the tab reads the accounts from Zernio and keeps only this profile's.
    const tab = await (await rep.call('GET', `/api/clients/${clientId}/social`)).json();
    expect(tab.ready).toBe(true);
    expect(tab.accounts.map((a) => a.id)).toEqual(['acc_fb', 'acc_ig']);

    const id = await draft(rep, clientId, { content: 'Pumpkin lattes are back.', mediaIds: [mediaId], accountIds: ['acc_fb'] });
    // Drafts are invisible to the client.
    expect((await owner.call('GET', `/api/social/posts/${id}`)).status).toBe(404);
    expect((await (await owner.call('GET', `/api/clients/${clientId}/social`)).json()).posts).toHaveLength(0);

    // No publish without approval.
    expect((await rep.call('POST', `/api/social/posts/${id}/publish`)).status).toBe(409);
    expect((await rep.call('POST', `/api/social/posts/${id}/send`)).status).toBe(200);
    expect((await rep.call('POST', `/api/social/posts/${id}/publish`)).status).toBe(409);
    // Staff can't approve as the client.
    const seen = await getPost(owner, id);
    expect(seen).toMatchObject({ status: 'pending_approval', content: 'Pumpkin lattes are back.', accounts: [{ id: 'acc_fb', platform: 'facebook', username: 'corktowncoffee' }] });
    expect((await rep.call('POST', `/api/social/posts/${id}/approve`, { hash: seen.hash })).status).toBe(403);
    expect((await owner.call('POST', `/api/social/posts/${id}/approve`, { hash: 'stale' })).status).toBe(409);
    expect((await owner.call('POST', `/api/social/posts/${id}/approve`, { hash: seen.hash })).status).toBe(200);
    expect((await getPost(rep, id)).approved).toBe(true);

    // Staff change the accounts after approval: the approval is cleared and the client must approve again.
    const edit = await (await rep.call('PUT', `/api/social/posts/${id}`, { content: 'Pumpkin lattes are back.', mediaIds: [mediaId], accountIds: ['acc_fb', 'acc_ig'] })).json();
    expect(edit).toMatchObject({ changed: true, reapproval: true });
    let p = await getPost(owner, id);
    expect(p).toMatchObject({ status: 'pending_approval', approved: false, approved_at: null });
    expect((await rep.call('POST', `/api/social/posts/${id}/publish`)).status).toBe(409);

    expect((await owner.call('POST', `/api/social/posts/${id}/approve`, { hash: p.hash })).status).toBe(200);
    expect(calls.some((x) => x.url.endsWith('/posts') && x.method === 'POST')).toBe(false);

    // Publish sends exactly the approved post, with media copied to Zernio and the idempotency key.
    const res = await rep.call('POST', `/api/social/posts/${id}/publish`);
    expect(res.status).toBe(200);
    const out = (await res.json()).post;
    expect(out.status).toBe('published');
    expect(out.platforms).toEqual([{ platform: 'facebook', status: 'published', url: 'https://facebook.com/p/1', error: null }]);
    const presign = calls.find((x) => x.url.endsWith('/media/presign'));
    expect(JSON.parse(presign.body)).toMatchObject({ filename: 'latte.png', contentType: 'image/png' });
    expect(calls.find((x) => x.url.startsWith('https://upload.zernio.test/')).method).toBe('PUT');
    const sent = calls.find((x) => x.url === 'https://zernio.com/api/v1/posts' && x.method === 'POST');
    expect(sent.headers.Authorization).toBe('Bearer test-zernio-key');
    expect(sent.headers['Idempotency-Key']).toBe(`${id}-${p.hash}`);
    expect(JSON.parse(sent.body)).toEqual({
      content: 'Pumpkin lattes are back.', mediaItems: [{ type: 'image', url: 'https://media.zernio.com/temp/latte.png' }],
      platforms: [{ platform: 'facebook', accountId: 'acc_fb' }, { platform: 'instagram', accountId: 'acc_ig' }], publishNow: true,
    });
    // Once with Zernio it can't be edited.
    expect((await rep.call('PUT', `/api/social/posts/${id}`, { content: 'Changed', accountIds: ['acc_fb'] })).status).toBe(409);
  });

  it('shows partial and failed results as Zernio reports them, and checks status at most every 30 seconds', async () => {
    const { rep, owner, admin, clientId, profile } = await setup();
    let getCalls = 0;
    mockZernio(profile, {
      post: () => [207, { error: 'Some platforms failed', post: { _id: 'zp_2', status: 'partial', platforms: [
        { platform: 'facebook', status: 'published', platformPostUrl: 'https://facebook.com/p/2' },
        { platform: 'instagram', status: 'failed', errorMessage: 'Instagram needs an image.' },
      ] } }],
      get: () => { getCalls++; return [200, { post: { _id: 'zp_2', status: 'failed', platforms: [{ platform: 'facebook', status: 'failed', errorMessage: 'Removed' }] } }]; },
    });
    await rep.call('GET', `/api/clients/${clientId}/social`);
    const when = Date.now() + 3 * 86400000;
    const goatId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO goat_requests (id, client_id, channel, body, status, created_at, updated_at) VALUES (?,?,'portal','Post our weekend hours','approved',?,?)").bind(goatId, clientId, Date.now(), Date.now()).run();
    const id = await draft(rep, clientId, { content: 'Weekend hours', accountIds: ['acc_fb', 'acc_ig'], scheduledFor: when, goatRequestId: goatId });
    await rep.call('POST', `/api/social/posts/${id}/send`);
    // An admin may record approval given by phone, only with a note.
    const p = await getPost(admin, id);
    expect((await rep.call('POST', `/api/social/posts/${id}/approve-for-client`, { hash: p.hash, note: 'By phone' })).status).toBe(403);
    expect((await admin.call('POST', `/api/social/posts/${id}/approve-for-client`, { hash: p.hash })).status).toBe(400);
    expect((await admin.call('POST', `/api/social/posts/${id}/approve-for-client`, { hash: p.hash, note: 'Approved by phone on Oct 8' })).status).toBe(200);
    expect(await getPost(owner, id)).toMatchObject({ approved_via: 'admin', approval_note: 'Approved by phone on Oct 8' });

    const res = await rep.call('POST', `/api/social/posts/${id}/publish`);
    expect(res.status).toBe(200);
    const out = (await res.json()).post;
    expect(out).toMatchObject({ status: 'partial', error: 'Some platforms failed' });
    expect(out.platforms[1]).toEqual({ platform: 'instagram', status: 'failed', url: null, error: 'Instagram needs an image.' });
    // The linked GOAT request mentions the result.
    const note = await env.DB.prepare("SELECT body FROM goat_events WHERE request_id=? AND kind='social'").bind(goatId).first();
    expect(note.body).toContain('partly published');
    expect(note.body).toContain('https://facebook.com/p/2');

    // Just checked at publish, so the check is throttled.
    let chk = await (await owner.call('POST', `/api/social/posts/${id}/check`)).json();
    expect(chk.throttled).toBe(true);
    expect(getCalls).toBe(0);
    await env.DB.prepare('UPDATE social_posts SET checked_at=? WHERE id=?').bind(Date.now() - 31000, id).run();
    chk = await (await owner.call('POST', `/api/social/posts/${id}/check`)).json();
    expect(getCalls).toBe(1);
    expect(chk.post.status).toBe('failed');
    expect(chk.post.platforms[0].error).toBe('Removed');
  });

  it('sends scheduled posts in Detroit time', async () => {
    const { rep, owner, clientId, profile } = await setup();
    const calls = mockZernio(profile, { post: () => [201, { post: { _id: 'zp_3', status: 'scheduled', platforms: [{ platform: 'facebook', status: 'pending' }] } }] });
    await rep.call('GET', `/api/clients/${clientId}/social`);
    const when = Date.UTC(2030, 6, 4, 16, 30); // 12:30 in Detroit (EDT)
    const id = await draft(rep, clientId, { content: 'Fourth of July', accountIds: ['acc_fb'], scheduledFor: when });
    await rep.call('POST', `/api/social/posts/${id}/send`);
    await owner.call('POST', `/api/social/posts/${id}/approve`, { hash: (await getPost(owner, id)).hash });
    expect((await (await rep.call('POST', `/api/social/posts/${id}/publish`)).json()).post.status).toBe('scheduled');
    const body = JSON.parse(calls.find((x) => x.url.endsWith('/posts') && x.method === 'POST').body);
    expect(body).toMatchObject({ scheduledFor: '2030-07-04T12:30:00', timezone: 'America/Detroit' });
    expect(body.publishNow).toBeUndefined();
    expect(localTime(Date.UTC(2030, 0, 15, 17, 0))).toBe('2030-01-15T12:00:00');
  });

  it('keeps every client to their own posts, files and accounts', async () => {
    const { rep, owner, stranger, clientId, otherId, profile, internalId, otherMedia } = await setup();
    mockZernio(profile);
    await rep.call('GET', `/api/clients/${clientId}/social`);
    const id = await draft(rep, clientId, { content: 'Hello', accountIds: ['acc_fb'] });
    await rep.call('POST', `/api/social/posts/${id}/send`);
    const p = await getPost(owner, id);

    // Another business's client gets the same 404 as a missing post.
    const missing = await stranger.call('GET', `/api/social/posts/${crypto.randomUUID()}`);
    const theirs = await stranger.call('GET', `/api/social/posts/${id}`);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect((await stranger.call('POST', `/api/social/posts/${id}/approve`, { hash: p.hash })).status).toBe(404);
    expect((await stranger.call('GET', `/api/clients/${clientId}/social`)).status).toBe(404);

    // Clients can't write posts; staff can't attach another client's or internal files, or accounts from another profile.
    expect((await owner.call('POST', `/api/clients/${clientId}/social/posts`, { content: 'x' })).status).toBe(403);
    expect((await rep.call('POST', `/api/clients/${clientId}/social/posts`, { content: 'x', mediaIds: [otherMedia] })).status).toBe(400);
    expect((await rep.call('POST', `/api/clients/${clientId}/social/posts`, { content: 'x', mediaIds: [internalId] })).status).toBe(400);
    expect((await rep.call('POST', `/api/clients/${clientId}/social/posts`, { content: 'x', accountIds: ['acc_other'] })).status).toBe(400);
    expect((await rep.call('POST', `/api/clients/${otherId}/social/posts`, { content: 'x' })).status).toBe(404);

    // The client can ask for changes with a note, which clears any approval.
    expect((await owner.call('POST', `/api/social/posts/${id}/changes`, {})).status).toBe(400);
    expect((await owner.call('POST', `/api/social/posts/${id}/changes`, { note: 'Say we open at 7' })).status).toBe(200);
    expect((await getPost(rep, id)).status).toBe('changes_requested');

    // Connect links are made server-side and come back to the portal.
    const conn = await (await owner.call('POST', `/api/clients/${clientId}/social/connect`, { platform: 'facebook' })).json();
    expect(conn.url).toContain('facebook.com');
  });

  it('creates the client’s Zernio profile once when connecting', async () => {
    const { rep, otherId } = await setup();
    const t = Date.now();
    const newClient = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO clients (id, name, created_at, updated_at) VALUES (?,?,?,?)').bind(newClient, 'Fresh Bakery', t, t),
      env.DB.prepare('INSERT INTO assignments (client_id, user_id, created_at) VALUES (?,?,?)').bind(newClient, rep.id, t),
    ]);
    const calls = mockZernio('prof_new');
    const res = await rep.call('POST', `/api/clients/${newClient}/social/connect`, { platform: 'googlebusiness', for: 'client' });
    expect(res.status).toBe(200);
    const create = calls.find((x) => x.url.endsWith('/profiles') && x.method === 'POST');
    expect(JSON.parse(create.body).name).toBe(`Fresh Bakery · ${newClient.slice(0, 6)}`);
    const connect = new URL(calls.find((x) => x.url.includes('/connect/')).url);
    expect(connect.pathname).toBe('/api/v1/connect/googlebusiness');
    expect(connect.searchParams.get('profileId')).toBe('prof_new');
    expect(connect.searchParams.get('redirect_url')).toMatch(/\/social$/);
    expect((await env.DB.prepare('SELECT zernio_profile_id FROM clients WHERE id=?').bind(newClient).first()).zernio_profile_id).toBe('prof_new');
    await rep.call('POST', `/api/clients/${newClient}/social/connect`, { platform: 'facebook' });
    expect(calls.filter((x) => x.url.endsWith('/profiles') && x.method === 'POST')).toHaveLength(1);
    expect((await rep.call('POST', `/api/clients/${otherId}/social/connect`, { platform: 'facebook' })).status).toBe(404);
  });

  it('says social posting is not set up without ZERNIO_API_KEY, but drafts and approvals still work', async () => {
    const { admin, owner, clientId } = await setup();
    const spy = vi.spyOn(globalThis, 'fetch');
    const noKey = { ...env, ZERNIO_API_KEY: '' };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const call = async (user, method, path, body) => worker.fetch(new Request(`${BASE}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: user.cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    }), noKey, ctx);

    const tab = await (await call(admin, 'GET', `/api/clients/${clientId}/social`)).json();
    expect(tab).toMatchObject({ ready: false, accounts: [] });
    expect((await call(owner, 'POST', `/api/clients/${clientId}/social/connect`, { platform: 'facebook' })).status).toBe(503);
    const id = (await (await call(admin, 'POST', `/api/clients/${clientId}/social/posts`, { content: 'Draft without Zernio' })).json()).id;
    expect((await call(admin, 'POST', `/api/social/posts/${id}/send`)).status).toBe(200);
    const p = (await (await call(owner, 'GET', `/api/social/posts/${id}`)).json()).post;
    expect((await call(owner, 'POST', `/api/social/posts/${id}/approve`, { hash: p.hash })).status).toBe(200);
    const pub = await call(admin, 'POST', `/api/social/posts/${id}/publish`);
    expect(pub.status).toBe(503);
    expect((await pub.json()).error).toMatch(/isn’t set up/);

    const status = await (await call(admin, 'GET', '/api/settings/integrations/zernio')).json();
    expect(status).toMatchObject({ configured: false, state: 'not_configured', missing: ['ZERNIO_API_KEY'] });
    expect((await call(admin, 'POST', '/api/settings/integrations/zernio/test')).status).toBe(400);
    expect(spy.mock.calls.some(([u]) => String(u?.url || u).includes('zernio.com'))).toBe(false);
  });

  it('marks Zernio connected only after a passing test', async () => {
    const admin = await as('admin');
    await env.DB.prepare("DELETE FROM settings WHERE key='integration.zernio.test'").run();
    expect((await (await admin.call('GET', '/api/settings/integrations/zernio')).json()).state).toBe('untested');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: 'Invalid API key', code: 'unauthorized' }, { status: 401 }));
    const bad = await admin.call('POST', '/api/settings/integrations/zernio/test');
    expect(bad.status).toBe(502);
    expect((await bad.json()).error).toBe('Zernio rejected the API key.');
    expect((await (await admin.call('GET', '/api/settings/integrations/zernio')).json()).state).toBe('failing');
    vi.restoreAllMocks();
    mockZernio('p');
    expect((await admin.call('POST', '/api/settings/integrations/zernio/test')).status).toBe(200);
    expect((await (await admin.call('GET', '/api/settings/integrations/zernio')).json()).state).toBe('connected');
  });
});

describe('readZernio', () => {
  it('keeps Zernio’s status and per-platform links and errors', () => {
    expect(readZernio({ status: 'draft', platforms: [] }).status).toBe('publishing');
    expect(readZernio({ status: 'partial', platforms: [{ platform: 'twitter', status: 'failed', errorMessage: 'Duplicate' }] }))
      .toEqual({ status: 'partial', zernioStatus: 'partial', platforms: [{ platform: 'twitter', status: 'failed', url: null, error: 'Duplicate' }] });
  });
});
