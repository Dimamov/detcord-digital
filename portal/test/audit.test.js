import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { as } from './helpers.js';
import { parsePage, checkTarget } from '../src/worker/lib/audit/crawl.js';
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

// A small fake internet: the customer's site, Google PageSpeed, Google Places, Resend and Twilio.
function fakeInternet({ siteDown = false } = {}) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    if (url.startsWith('https://www.googleapis.com/pagespeedonline')) {
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
    expect((await otherRep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', to: 'x@example.com' })).status).toBe(404);
    expect((await otherRep.call('GET', `/api/audits/${a.id}/shot/mobile`)).status).toBe(404);
    expect((await admin.call('GET', `/api/audits/${a.id}`)).status).toBe(200);
    expect((await otherRep.call('DELETE', `/api/audits/${a.id}`)).status).toBe(404);
  });

  it('refuses private and malformed addresses', async () => {
    const { rep, clientId } = await setup();
    for (const url of ['http://localhost:8787', 'http://192.168.1.10', 'http://10.0.0.5/admin', 'ftp://example.com', 'http://intranet']) {
      expect((await rep.call('POST', `/api/clients/${clientId}/audits`, { url })).status, url).toBe(400);
    }
    expect(checkTarget('greatlakesplumbing.com').url.href).toBe('https://greatlakesplumbing.com/');
  });

  it('sends the customer a no-login report that hides what staff removed', async () => {
    const { rep, clientId } = await setup();
    const calls = fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect((await rep.call('PATCH', `/api/audits/${a.id}`, { hidden: ['stale', 'not-a-real-id'], note: 'Great meeting you today, Sam.' })).status).toBe(200);
    const detail = await (await rep.call('GET', `/api/audits/${a.id}`)).json();
    expect(detail.hidden).toEqual(['stale']);
    expect(detail.recipients.emails.map((e) => e.value)).toEqual(['sam@greatlakesplumbing.com', 'owner@greatlakesplumbing.com']);

    const sent = await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'email', to: 'sam@greatlakesplumbing.com', firstName: 'Sam' });
    // The test environment has no email key, so the portal says so instead of claiming it was sent.
    expect(sent.status).toBe(503);
    const out = await sent.json();
    expect(out.status).toBe('not_configured');
    const token = out.shareUrl.split('/r/')[1];
    expect(token.length).toBeGreaterThan(30);

    const pub = await SELF.fetch(`https://portal.test/api/public/reports/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get('Cache-Control')).toBe('no-store');
    expect(pub.headers.get('X-Robots-Tag')).toContain('noindex');
    const report = await pub.json();
    expect(report.business).toBe('Great Lakes Plumbing');
    expect(report.note).toBe('Great meeting you today, Sam.');
    expect(report.findings.map((f) => f.id)).not.toContain('stale');
    expect(report.findings.find((f) => f.id === 'gbp-reviews').service).toBe('Reputation management');
    expect(JSON.stringify(report)).not.toMatch(/evidence|client_id|created_by|share_token/);
    expect((await SELF.fetch(`https://portal.test/api/public/reports/${token}/shot/mobile`)).status).toBe(200);
    expect((await SELF.fetch('https://portal.test/api/public/reports/not-a-real-token-but-long-enough-xxxxx')).status).toBe(404);

    // A new link cancels the old one.
    const rotated = await (await rep.call('POST', `/api/audits/${a.id}/share`, { rotate: true })).json();
    expect(rotated.shareUrl).not.toContain(token);
    expect((await SELF.fetch(`https://portal.test/api/public/reports/${token}`)).status).toBe(404);
    expect(calls.some((cl) => cl.url.includes('resend'))).toBe(false);
  });

  it('texts the report only with the customer\'s consent', async () => {
    const { rep, clientId } = await setup();
    const calls = fakeInternet();
    const a = await (await rep.call('POST', `/api/clients/${clientId}/audits`, {})).json();
    expect((await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'sms', to: '248-555-0177' })).status).toBe(400);
    expect((await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'sms', to: '555', consent: true })).status).toBe(400);
    const res = await rep.call('POST', `/api/audits/${a.id}/send`, { channel: 'sms', to: '(248) 555-0177', consent: true, firstName: 'Sam' });
    expect(res.status).toBe(200);
    const twilio = calls.find((cl) => cl.url.endsWith('/Messages.json'));
    const form = new URLSearchParams(twilio.init.body);
    expect(form.get('To')).toBe('+12485550177');
    expect(form.get('MessagingServiceSid')).toBe('MGtest');
    expect(form.get('Body')).toMatch(/^Hi Sam, here's the website and Google check for Great Lakes Plumbing .*\/r\/[\w-]+ Reply STOP to opt out\.$/);
    const detail = await (await rep.call('GET', `/api/audits/${a.id}`)).json();
    expect(detail.deliveries[0]).toMatchObject({ channel: 'sms', recipient: '+12485550177', status: 'sent', provider_id: 'SM123' });
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
