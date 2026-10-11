import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as } from './helpers.js';
import { parsePage, checkTarget } from '../src/worker/lib/audit/crawl.js';
import { designChecks } from '../src/worker/lib/audit/design.js';
import { runAudit } from '../src/worker/lib/audit/index.js';
import { launcher } from '../src/worker/lib/audit/screenshots.js';

// A stand-in for Cloudflare's browser: records the pages it was asked to load and returns a tiny JPEG.
function fakeBrowser() {
  const visits = [];
  const browser = {
    newPage: async () => {
      const page = { setViewport: async (v) => { page.view = v; }, setUserAgent: async () => {}, goto: async (u) => { visits.push([u, page.view.width]); },
        screenshot: async () => PIXEL.split(',')[1], close: async () => {} };
      return page;
    },
    close: async () => {},
  };
  vi.spyOn(launcher, 'launch').mockResolvedValue(browser);
  return visits;
}
import { sendSms, toE164 } from '../src/worker/lib/sms.js';

const SITE = 'https://www.greatlakesplumbing.com';
const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const HOME = `<!doctype html><html><head>
<title>Home</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script><script src="/d.js"></script>
</head><body>
<header><a href="/">Great Lakes Plumbing</a> <a href="/services">Services</a> <a href="/contact">Contact us</a> <a href="/old-page">Specials</a></header>
<h1>Welcome</h1><h1>Plumbing you can trust</h1>
<p>Call (248) 555-0199 for fast service. We fix leaks, drains and water heaters.</p>
<img src="/img/truck.jpg"><img src="/img/team.jpg"><img src="/img/missing.jpg" alt="">
<img src="http://cdn.oldhost.com/banner.jpg" alt="banner">
<footer>© 2019 Great Lakes Plumbing</footer>
</body></html>`;
const CONTACT = `<!doctype html><html lang="en"><head><title>Contact</title></head><body><h1>Contact</h1>
<form><input name="name"><input name="phone"><textarea></textarea><button>Send</button></form>
<a href="tel:2485550199">Call</a> <a href="/broken-link">Old link</a></body></html>`;
const SERVICES = `<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Services</h1><p>Drain cleaning in Troy and Royal Oak.</p></body></html>`;

function psi(strategy) {
  return {
    lighthouseResult: {
      categories: { performance: { score: strategy === 'mobile' ? 0.38 : 0.71 }, accessibility: { score: 0.78 }, 'best-practices': { score: 0.74 }, seo: { score: 0.83 } },
      audits: {
        'largest-contentful-paint': { score: 0.1, numericValue: 6400, displayValue: '6.4 s', title: 'Largest Contentful Paint' },
        'color-contrast': { score: 0, title: 'Background and foreground colors do not have a sufficient contrast ratio.', details: { items: [{}, {}, {}] } },
        'uses-optimized-images': { score: 0.3, title: 'Efficiently encode images', displayValue: 'Potential savings of 1,240 KiB' },
        'font-size': { score: 1, title: 'Document uses legible font sizes' },
        'image-aspect-ratio': { score: 0, title: 'Displays images with incorrect aspect ratio', details: { items: [{}] } },
        'final-screenshot': { details: { data: PIXEL } },
      },
    },
    loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4100, category: 'SLOW' } }, overall_category: 'SLOW' },
  };
}

const PLACES_SELF = { places: [{ id: 'p1', displayName: { text: 'Great Lakes Plumbing' }, formattedAddress: '100 Main St, Troy, MI 48084', nationalPhoneNumber: '(248) 555-0111',
  websiteUri: 'https://greatlakesplumbing.com/', rating: 4.1, userRatingCount: 12, businessStatus: 'OPERATIONAL', primaryTypeDisplayName: { text: 'Plumber' }, photos: [{}, {}], location: { latitude: 42.6, longitude: -83.1 } }] };
const PLACES_COMP = { places: [
  { id: 'p1', displayName: { text: 'Great Lakes Plumbing' }, rating: 4.1, userRatingCount: 12 },
  { id: 'c1', displayName: { text: 'Royal Flush Plumbing' }, rating: 4.8, userRatingCount: 412, businessStatus: 'OPERATIONAL' },
  { id: 'c2', displayName: { text: 'Troy Drain Pros' }, rating: 4.6, userRatingCount: 188, businessStatus: 'OPERATIONAL' },
] };

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const CRITIQUE = {
  impression: 'On a phone the page opens on a large photo of a truck with no headline or button visible. On a computer the menu is clear but the phone number is small.',
  findings: [
    { title: 'No call button on the first phone screen', seen: 'The phone screenshot shows a full-width truck photo and no button or phone number.', why: 'Visitors ready to call have to scroll to find how.', fix: 'Add a "Call now" button over the photo.', severity: 'important', view: 'mobile', service: 'web' },
    { title: 'Headline doesn\'t say what you do', seen: 'The headline reads "Welcome".', why: 'Visitors can\'t tell at a glance that you fix plumbing in Troy.', fix: 'Use "Plumbing repairs in Troy, MI" as the headline.', severity: 'important', view: 'both', service: 'branding' },
    { title: 'Phone number is small', seen: 'On the computer screenshot the phone number in the top corner is small grey text.', why: 'Callers miss it.', fix: 'Make it larger and bolder.', severity: 'minor', view: 'desktop', service: 'not-a-service' },
  ],
};

// A small fake internet: the customer's site, Google PageSpeed, Google Places, Resend, Twilio and (optionally) Claude.
function fakeInternet({ siteDown = false, claude = null, psiLimited = false } = {}) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input?.url || input);
    const method = init.method || input?.method || 'GET';
    calls.push({ url, method, init });
    if (url.includes('api.anthropic.com')) {
      if (claude === 'error') return new Response('{"type":"error","error":{"type":"api_error","message":"boom"}}', { status: 500, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(CRITIQUE) }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://www.googleapis.com/pagespeedonline')) {
      if (psiLimited) return new Response('{"error":{"code":429}}', { status: 429 });
      const strategy = new URL(url).searchParams.get('strategy');
      return new Response(JSON.stringify(psi(strategy)), { status: 200 });
    }
    if (url.startsWith('https://places.googleapis.com')) {
      const q = JSON.parse(init.body).textQuery;
      return new Response(JSON.stringify(/^Plumber in/.test(q) ? PLACES_COMP : PLACES_SELF), { status: 200 });
    }
    if (url.startsWith('https://api.resend.com')) return new Response('{"id":"em_1"}', { status: 200 });
    if (url.includes('api.twilio.com') && url.endsWith('/Messages.json')) return new Response('{"sid":"SM123"}', { status: 201 });
    if (siteDown && url.includes('greatlakesplumbing')) throw new TypeError('connect failed');
    if (url === 'http://www.greatlakesplumbing.com/') return new Response(null, { status: 301, headers: { Location: `${SITE}/` } });
    if (url === 'https://greatlakesplumbing.com/') return new Response(null, { status: 301, headers: { Location: `${SITE}/` } });
    if (url === `${SITE}/`) return html(HOME);
    if (url === `${SITE}/contact`) return html(CONTACT);
    if (url === `${SITE}/services`) return html(SERVICES);
    if (url.startsWith(`${SITE}/detcord-check-`)) return html(HOME); // soft 404
    if (url === `${SITE}/img/missing.jpg`) return new Response(null, { status: 404 });
    if (url.startsWith(`${SITE}/img/`)) return new Response(null, { status: 200, headers: { 'Content-Length': '900000', 'Content-Type': 'image/jpeg' } });
    if (url.startsWith(SITE)) return html('<h1>Not found</h1>', 404);
    return new Response('not mocked', { status: 599 });
  });
  return calls;
}

async function setup() {
  const admin = await as('admin');
  const rep = await as('rep');
  const otherRep = await as('rep');
  const res = await rep.call('POST', '/api/clients', { name: 'Great Lakes Plumbing', phone: '248-555-0100', email: 'owner@greatlakesplumbing.com', website: 'greatlakesplumbing.com', city: 'Troy', industry: 'plumbing',
    contact: { name: 'Sam Rivera', email: 'sam@greatlakesplumbing.com', phone: '248-555-0177' } });
  const { id: clientId } = await res.json();
  return { admin, rep, otherRep, clientId };
}

afterEach(() => vi.restoreAllMocks());

describe('website audit', () => {
  it('runs a full check and reports measured, specific findings', async () => {
    const { rep, clientId } = await setup();
    const calls = fakeInternet();
    const res = await rep.call('POST', `/api/clients/${clientId}/audits`, {});
    expect(res.status).toBe(201);
    const a = await res.json();
    expect(a.status).toBe('done');
    const ids = a.result.findings.map((f) => f.id);
    for (const id of ['title-length', 'desc-missing', 'h1-multiple', 'sitemap', 'robots-missing', 'thin-content', 'img-alt', 'schema', 'phone-mismatch',
      'no-reviews-onsite', 'gbp-reviews', 'gbp-rating', 'gbp-phone', 'gbp-hours', 'gbp-photos', 'stale', 'mixed', 'broken-links', 'broken-images',
      'soft-404', 'blocking-scripts', 'heavy-images', 'psi-perf', 'psi-a11y', 'field-slow', 'lh-color-contrast']) expect(ids, id).toContain(id);
    // Things the site does right are not reported as problems.
    for (const id of ['viewport', 'no-https', 'no-https-redirect', 'no-tap-call', 'no-form', 'gbp-missing', 'city-missing', 'lh-font-size']) expect(ids, id).not.toContain(id);
    const broken = a.result.findings.find((f) => f.id === 'broken-links');
    expect(broken.evidence).toEqual(expect.arrayContaining([`${SITE}/old-page`, `${SITE}/broken-link`]));
    expect(a.result.findings.find((f) => f.id === 'gbp-reviews').detail).toContain('Royal Flush Plumbing has 412 reviews');
    expect(a.result.findings.find((f) => f.id === 'stale').detail).toContain('2019');
    expect(a.result.google.profile.name).toBe('Great Lakes Plumbing');
    expect(a.result.google.competitors.map((c) => c.name)).toEqual(['Royal Flush Plumbing', 'Troy Drain Pros']);
    expect(a.result.speed.mobile.scores.performance).toBe(38);
    expect(a.result.coverage).toMatchObject({ site: 'checked', pagespeed: 'checked', google: 'checked' });
    for (const k of ['seo', 'local', 'ux', 'tech']) expect(a.result.scores[k]).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThan(70);
    expect(a.result.shots.mobile).toBe(true);
    expect(await env.MEDIA.get(`audits/${a.id}/mobile`)).not.toBeNull();
    // Design and user experience: its own score, kept out of the overall score so older checks stay comparable.
    for (const id of ['design-cta-top', 'design-call-top', 'design-form-home', 'design-trust', 'lh-image-aspect-ratio']) {
      expect(a.result.findings.find((f) => f.id === id)?.cat, id).toBe('design');
    }
    expect(a.result.scores.design).toBeGreaterThanOrEqual(0);
    const four = ['seo', 'local', 'ux', 'tech'].map((k) => a.result.scores[k]);
    expect(a.score).toBe(Math.round(four.reduce((x, y) => x + y, 0) / 4));
    expect(a.categories.find((c) => c.id === 'design')).toMatchObject({ label: 'Design and user experience', separate: true });
    expect(a.result.design.lighthouse.mobile).toEqual({ accessibility: 78, bestPractices: 74 });
    expect(a.result.design.lighthouse.failing.map((f) => [f.id, f.on])).toEqual([['color-contrast', ['mobile', 'desktop']], ['image-aspect-ratio', ['mobile', 'desktop']]]);
    // No ANTHROPIC_API_KEY in tests: the visual review is skipped, says why, and Claude is never called.
    expect(a.result.design.visual).toMatchObject({ status: 'skipped', reason: 'ANTHROPIC_API_KEY is not set.' });
    expect(a.result.coverage.visual).toBe('skipped');
    expect(a.result.findings.some((f) => f.source === 'visual')).toBe(false);
    expect(calls.some((cl) => cl.url.includes('anthropic'))).toBe(false);
    // Stays within the free plan's 50 subrequests.
    expect(calls.length).toBeLessThanOrEqual(50);
    expect(calls.every((cl) => !cl.url.includes('localhost'))).toBe(true);
  });

  it('reports an unreachable site instead of failing', async () => {
    const { rep, clientId } = await setup();
    fakeInternet({ siteDown: true });
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect(a.status).toBe('done');
    expect(a.result.findings[0]).toMatchObject({ id: 'site-down', severity: 'critical' });
    expect(a.result.scores.tech).toBe(0);
  });

  it('enforces access on the server', async () => {
    const { rep, otherRep, admin, clientId } = await setup();
    fakeInternet();
    expect((await otherRep.call('POST', `/api/clients/${clientId}/audits`, {})).status).toBe(404);
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect((await otherRep.call('GET', `/api/audits/${a.id}`)).status).toBe(404);
    expect((await otherRep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', name: 'X', email: 'x@example.com' })).status).toBe(404);
    expect((await otherRep.call('GET', `/api/reports/${a.id}/shot/mobile`)).status).toBe(404);
    expect((await otherRep.call('GET', `/api/reports/${a.id}`)).status).toBe(404);
    expect((await admin.call('GET', `/api/audits/${a.id}`)).status).toBe(200);
    expect((await otherRep.call('DELETE', `/api/audits/${a.id}`)).status).toBe(404);
  });

  it('builds the report as a print-ready PDF', async () => {
    const { rep, otherRep, clientId } = await setup();
    fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    let html;
    vi.spyOn(launcher, 'launch').mockResolvedValue({
      newPage: async () => ({ setContent: async (h) => { html = h; }, pdf: async () => new TextEncoder().encode('%PDF-1.7 test') }),
      close: async () => {},
    });
    const res = await rep.call('GET', `/api/reports/${a.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=".+ - Website check - \d{4}-\d{2}-\d{2}\.pdf"/);
    expect(await res.text()).toBe('%PDF-1.7 test');
    // A document, not a web page: no buttons or links, and the findings and contact details are all there.
    expect(html).not.toMatch(/<button|<a\s/);
    expect(html).toContain('Want these fixed?');
    expect(html).toContain(a.result.findings[0].title.replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    expect((await otherRep.call('GET', `/api/reports/${a.id}/pdf`)).status).toBe(404);
  });

  it('refuses private and malformed addresses', async () => {
    const { rep, clientId } = await setup();
    for (const url of ['http://localhost:8787', 'http://192.168.1.10', 'http://10.0.0.5/admin', 'ftp://example.com', 'http://intranet']) {
      expect((await rep.call('POST', `/api/clients/${clientId}/audits`, { url })).status, url).toBe(400);
    }
    expect(checkTarget('greatlakesplumbing.com').url.href).toBe('https://greatlakesplumbing.com/');
  });

  it('emails a portal invite that opens the report, and shows it only after it is sent', async () => {
    const { rep, admin, clientId } = await setup();
    const calls = fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect((await rep.call('PATCH', `/api/audits/${a.id}`, { hidden: ['stale', 'not-a-real-id'], note: 'Great meeting you today, Sam.' })).status).toBe(200);
    const detail = await (await rep.call('GET', `/api/audits/${a.id}`)).json();
    expect(detail.hidden).toEqual(['stale']);
    expect(detail.people[0]).toMatchObject({ name: 'Sam Rivera', email: 'sam@greatlakesplumbing.com', phone: '248-555-0177', login: null });

    const sent = await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', name: 'Sam Rivera', email: 'sam@greatlakesplumbing.com' });
    // The test environment has no email key, so the portal says so and hands staff the link instead of claiming it was sent.
    expect(sent.status).toBe(503);
    const out = await sent.json();
    expect(out).toMatchObject({ status: 'not_configured', linkKind: 'invite' });
    expect(out.manualLink).toContain(`/activate?next=${encodeURIComponent(`/reports/${a.id}`)}#`);
    expect(calls.some((cl) => cl.url.includes('resend'))).toBe(false);

    // Sam sets a password from the link and lands in the portal with the report.
    const act = await SELF.fetch('https://portal.test/api/auth/activate', { method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: out.manualLink.split('#')[1], password: 'a long enough password' }) });
    expect(act.status).toBe(200);
    const cookie = act.headers.get('Set-Cookie').split(';')[0];
    const sam = (path) => SELF.fetch(`https://portal.test${path}`, { headers: { Cookie: cookie } });
    const list = await (await sam('/api/reports')).json();
    expect(list.reports.map((x) => x.id)).toEqual([a.id]);
    const report = await sam(`/api/reports/${a.id}`);
    expect(report.status).toBe(200);
    expect(report.headers.get('Cache-Control')).toBe('no-store');
    const r = await report.json();
    expect(r).toMatchObject({ business: 'Great Lakes Plumbing', note: 'Great meeting you today, Sam.', preview: false });
    expect(r.findings.map((f) => f.id)).not.toContain('stale');
    expect(r.findings.find((f) => f.id === 'gbp-reviews').service).toBe('Reputation management');
    // The design and user experience area is part of the customer's report.
    expect(r.categories.map((c) => c.id)).toContain('design');
    expect(r.scores.design).toBe(a.result.scores.design);
    expect(r.findings.find((f) => f.id === 'design-trust')).toMatchObject({ cat: 'design', service: 'Web design, development and conversion optimization' });
    expect(r.design.lighthouse.desktop).toEqual({ accessibility: 78, bestPractices: 74 });
    expect(r.design.visual).toEqual({ status: 'skipped', impression: null });
    expect(JSON.stringify(r)).not.toContain('ANTHROPIC_API_KEY');
    expect((await sam(`/api/reports/${a.id}/shot/desktop`)).status).toBe(200);
    expect(JSON.stringify(r)).not.toMatch(/evidence|created_by|hidden|pagespeedReason/);
    expect((await sam(`/api/reports/${a.id}/shot/mobile`)).status).toBe(200);
    // Staff-only screens stay closed to the customer.
    expect((await sam(`/api/audits/${a.id}`)).status).toBe(403);
    expect((await sam(`/api/clients/${clientId}/audits`)).status).toBe(403);

    // A newer check isn't visible to the customer until it is sent.
    const b = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect((await sam(`/api/reports/${b.id}`)).status).toBe(404);
    expect((await sam(`/api/reports/${b.id}/shot/mobile`)).status).toBe(404);
    // Now that Sam has a login, sending again links straight to the report.
    const again = await (await rep.call('POST', `/api/audits/${b.id}/send`, { channel: 'email', name: 'Sam Rivera', email: 'SAM@greatlakesplumbing.com' })).json();
    expect(again.linkKind).toBe('login');
    expect(again.manualLink).toMatch(new RegExp(`^https://[^/]+/reports/${b.id}$`));
    expect((await sam(`/api/reports/${b.id}`)).status).toBe(200);

    // Another business's owner can't open it.
    const other = await (await admin.call('POST', '/api/clients', { name: 'Other Co', email: 'x@other.com' })).json();
    const o = await (await admin.call('POST', '/api/users', { role: 'client', email: 'owner@other.com', name: 'Olive', clientId: other.id })).json();
    const oa = await SELF.fetch('https://portal.test/api/auth/activate', { method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: o.manualLink.split('#')[1], password: 'a long enough password' }) });
    const oc = oa.headers.get('Set-Cookie').split(';')[0];
    expect((await SELF.fetch(`https://portal.test/api/reports/${a.id}`, { headers: { Cookie: oc } })).status).toBe(404);
    expect((await (await SELF.fetch('https://portal.test/api/reports', { headers: { Cookie: oc } })).json()).reports).toEqual([]);
  });

  it('won\'t attach the report to someone else\'s login', async () => {
    const { rep, admin, clientId } = await setup();
    fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    const res = await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', name: 'Boss', email: admin.email });
    expect(res.status).toBe(409);
    expect((await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', name: '', email: 'x@y.com' })).status).toBe(400);
  });

  it('texts a portal link only with the customer\'s consent', async () => {
    const { rep, clientId } = await setup();
    const calls = fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    const person = { channel: 'sms', name: 'Sam Rivera', email: `sam-${a.id.slice(0, 6)}@greatlakesplumbing.com` };
    expect((await rep.call('POST', `/api/audits/${a.id}/send`, { ...person, phone: '248-555-0177' })).status).toBe(400);
    expect((await rep.call('POST', `/api/audits/${a.id}/send`, { ...person, phone: '555', consent: true })).status).toBe(400);
    const res = await rep.call('POST', `/api/audits/${a.id}/send`, { ...person, phone: '(248) 555-0177', consent: true });
    expect(res.status).toBe(200);
    expect((await res.json()).manualLink).toBe(null);
    const twilio = calls.find((cl) => cl.url.endsWith('/Messages.json'));
    const form = new URLSearchParams(twilio.init.body);
    expect(form.get('To')).toBe('+12485550177');
    expect(form.get('MessagingServiceSid')).toBe('MGtest');
    expect(form.get('Body')).toMatch(/^Hi Sam, your website and Google check for Great Lakes Plumbing is ready in your Detcord portal \(score \d+\/100\): https:\/\/[^/]+\/activate\?next=%2Freports%2F[\w-]+#[\w.-]+ Reply STOP to opt out\.$/);
    const detail = await (await rep.call('GET', `/api/audits/${a.id}`)).json();
    expect(detail.deliveries[0]).toMatchObject({ channel: 'sms', recipient: '+12485550177', status: 'sent', provider_id: 'SM123', link_kind: 'invite' });
    expect(detail.sharedAt).toBeTruthy();
    expect(detail.people.find((x) => x.email === person.email).login).toBe('invited');
  });

  it('never claims texting works without credentials', async () => {
    expect((await sendSms({}, { to: '+12485550177', body: 'x' })).status).toBe('not_configured');
    expect(toE164('248.555.0177')).toBe('+12485550177');
    expect(toE164('1 (248) 555-0177')).toBe('+12485550177');
    expect(toE164('055-555-0177')).toBe(null);
    const admin = await as('admin');
    const integ = await (await admin.call('GET', '/api/settings/integrations')).json();
    expect(integ.twilio.state).toBe('untested');
    expect(integ.google.state).toBe('untested');
  });
});

describe('design review', () => {
  async function runWithClaude(claude, opts = {}) {
    const { rep, clientId } = await setup();
    const all = fakeInternet({ claude, ...opts });
    const plain = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    const client = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO audits (id, client_id, url, status, created_by, created_at) VALUES (?,?,?,'running',?,?)").bind(id, clientId, `${SITE}/`, rep.id, Date.now()).run();
    const before = all.length;
    const out = await runAudit({ ...env, ANTHROPIC_API_KEY: 'test-key', ...opts.env }, { auditId: id, client, url: `${SITE}/` });
    expect(out.ok).toBe(true);
    const a = await (await rep.call('GET', `/api/audits/${id}`)).json();
    return { rep, clientId, plain, a, calls: all.slice(before) };
  }

  it('stores Claude\'s critique of the screenshots without changing any score', async () => {
    const { rep, plain, a, calls } = await runWithClaude('ok');
    const req = calls.filter((cl) => cl.url.includes('api.anthropic.com'));
    expect(req).toHaveLength(1);
    // The extra call stays within the free plan's 50 subrequests.
    expect(calls.length).toBeLessThanOrEqual(50);
    const sent = JSON.parse(req[0].init.body);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.system).toMatch(/only what is visible/i);
    expect(sent.system).toMatch(/never invent numbers/i);
    const content = sent.messages[0].content;
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(content.at(-1).text).toContain('Main heading (H1): Welcome / Plumbing you can trust');
    expect(content.at(-1).text).toContain('Menu links:');
    const services = sent.output_config.format.schema.properties.findings.items.properties.service.enum;
    expect(services).toEqual(expect.arrayContaining(['web', 'email', 'sms']));
    expect(services).not.toContain('email-sms');

    expect(a.result.design.visual).toEqual({ status: 'done', impression: CRITIQUE.impression });
    const visual = a.result.findings.filter((f) => f.source === 'visual');
    expect(visual.map((f) => f.id)).toEqual(['visual-1', 'visual-2', 'visual-3']);
    expect(visual[0]).toMatchObject({ cat: 'design', severity: 'important', view: 'mobile', title: 'No call button on the first phone screen', detail: CRITIQUE.findings[0].seen, service: 'web' });
    expect(visual[2].service).toBe('web'); // an unknown service id falls back to web design
    // Claude's opinions are shown, never scored: same site, same scores.
    expect(a.score).toBe(plain.score);
    expect(a.result.scores).toEqual(plain.result.scores);

    // Staff can hide one; the customer sees the rest, labeled as coming from the visual review.
    await rep.call('PATCH', `/api/audits/${a.id}`, { hidden: ['visual-2'] });
    const r = await (await rep.call('GET', `/api/reports/${a.id}`)).json();
    expect(r.findings.filter((f) => f.source === 'visual').map((f) => f.id)).toEqual(['visual-1', 'visual-3']);
    expect(r.design.visual).toEqual({ status: 'done', impression: CRITIQUE.impression });
  });

  it('takes its own screenshots when PageSpeed returns none, and leaves design unscored without Google\'s tests', async () => {
    const visits = fakeBrowser();
    const { a, calls } = await runWithClaude('ok', { psiLimited: true });
    expect(visits.slice(-2)).toEqual([[`${SITE}/`, 390], [`${SITE}/`, 1350]]);
    const sent = JSON.parse(calls.find((cl) => cl.url.includes('api.anthropic.com')).init.body);
    expect(sent.messages[0].content.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(a.result.design.visual.status).toBe('done');
    expect(a.result.shots).toEqual({ mobile: true, desktop: true });
    expect(a.result.scores.design).toBeNull();
  });

  it('says why the review was skipped when neither PageSpeed nor our browser gives a screenshot', async () => {
    const { rep, clientId, a } = await runWithClaude('ok', { psiLimited: true, env: { BROWSER: undefined } });
    expect(a.result.design.visual).toMatchObject({ status: 'skipped' });
    expect(a.result.design.visual.reason).toMatch(/PageSpeed returned none and browser rendering is not set up/i);
    expect(a.result.scores.design).toBeNull();
    const { audits } = await (await rep.call('GET', `/api/clients/${clientId}/audits`)).json();
    expect(audits.find((x) => x.id === a.id).design_score).toBeNull();
  });

  it('finishes the check with the code-based findings when Claude fails', async () => {
    const { plain, a } = await runWithClaude('error');
    expect(a.status).toBe('done');
    expect(a.result.design.visual.status).toBe('skipped');
    expect(a.result.design.visual.reason).toMatch(/Could not reach Claude/);
    expect(a.result.findings.some((f) => f.source === 'visual')).toBe(false);
    expect(a.result.findings.some((f) => f.id === 'design-trust')).toBe(true);
    expect(a.score).toBe(plain.score);
  });

  const BAD = `<!doctype html><html><head><meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>.legal{font-size:10px} .tiny{font-size: 9px}</style></head><body>
    <nav>${['Home', 'About', 'Services', 'Drains', 'Water heaters', 'Sewers', 'Gas lines', 'Areas', 'Blog', 'Careers', 'Contact'].map((t) => `<a href="/${t}">${t}</a>`).join(' ')}</nav>
    <h1>Welcome</h1><p style="font-size:8px">tiny</p><h2>About us</h2>${'<p>We fix pipes.</p>'.repeat(400)}
    <a href="/quote">Get a free quote</a> <a href="tel:2485550100">(248) 555-0100</a>
    <form>${Array.from({ length: 9 }, (_, i) => `<input name="f${i}">`).join('')}<button>Send</button></form></body></html>`;
  const GOOD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
    <header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/reviews">Reviews</a><a href="/contact">Contact</a></nav>
    <a href="tel:2485550100">Call now</a></header>
    <h1>Plumbing repairs in Troy, MI</h1><p>Licensed and insured. Family-owned since 1998.</p>
    <form><input name="name"><input name="phone"><textarea name="need"></textarea><button>Get a free quote</button></form>
    <h2>Services</h2><p>Drains and water heaters.</p></body></html>`;

  it('reads layout hints from the HTML and reports only what it proves', () => {
    const bad = parsePage(BAD, 'https://x.com/');
    expect(bad.layout).toMatchObject({ topCtas: [], topTel: false, ctaTexts: ['Get a free quote'], smallFonts: 3, maxFormFields: 9 });
    expect(bad.layout.navLabels).toHaveLength(11);
    const { findings } = designChecks({ home: bad, pages: [bad], reported: new Set() });
    expect(findings.map((f) => f.id).sort()).toEqual(['design-call-top', 'design-cta-top', 'design-form-long', 'design-nav-crowded', 'design-small-text', 'design-trust', 'design-viewport-width', 'design-zoom']);
    expect(findings.every((f) => f.cat === 'design' && f.why && f.fix && f.service)).toBe(true);
    expect(findings.find((f) => f.id === 'design-cta-top').detail).toContain('"Get a free quote"');
    // Gaps the main checks already reported aren't repeated.
    expect(designChecks({ home: bad, pages: [bad], reported: new Set(['no-cta']) }).findings.map((f) => f.id)).not.toContain('design-cta-top');

    const good = parsePage(GOOD, 'https://x.com/');
    expect(good.layout).toMatchObject({ topCtas: ['Call now', 'Get a free quote'], topTel: true, navLabels: ['Home', 'Services', 'Reviews', 'Contact'], smallFonts: 0, maxFormFields: 3 });
    const ok = designChecks({ home: good, pages: [good], reported: new Set() });
    expect(ok.findings).toEqual([]);
    expect(ok.passed).toEqual(expect.arrayContaining(['Tap-to-call link in the header or first section', 'Contact form on the homepage', 'Trust signals on the site: licensed or insured, years in business or local ownership']));
  });
});

describe('page parser', () => {
  it('reads titles, headings, links, schema and phone numbers', () => {
    const p = parsePage(`<html lang="en"><head><title>Drain Cleaning in Troy, MI | GLP</title><meta name="description" content="Fast drains.">
      <link rel="canonical" href="https://x.com/"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Plumber","telephone":"248-555-0100"}]}</script></head>
      <body><!-- <h1>commented</h1> --><h1>Drain &amp; Sewer</h1><a href="tel:+12485550100">Call</a><a href="https://facebook.com/x">FB</a><a href="/about#team">About</a>
      <iframe src="https://www.google.com/maps/embed?pb=1"></iframe><p>Call 248.555.0100 today</p></body></html>`, 'https://x.com/');
    expect(p.title).toBe('Drain Cleaning in Troy, MI | GLP');
    expect(p.headings.h1).toEqual(['Drain & Sewer']);
    expect(p.schemaTypes).toEqual(['Plumber']);
    expect(p.phones).toEqual(['2485550100']);
    expect(p.links.map((l) => l.kind)).toEqual(['tel', 'external', 'internal']);
    expect(p.links[2].url).toBe('https://x.com/about');
    expect(p.mapEmbed).toBe(true);
    expect(p.canonical).toBe('https://x.com/');
  });
});
