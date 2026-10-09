// Fetches a customer's website the way a visitor and a search engine would, and extracts what the checks need.
// Everything is bounded: a subrequest budget, per-request timeouts and a body size cap.

export const UA = 'Mozilla/5.0 (compatible; DetcordSiteCheck/1.0; +https://www.detcorddigital.com)';
const MAX_BODY = 1_500_000;

export class Budget {
  constructor(max) { this.left = max; }
  take() { if (this.left <= 0) return false; this.left -= 1; return true; }
}

// Public web hosts only. Workers can't reach private networks, but refusing them here keeps the intent explicit.
export function checkTarget(raw, { allowPrivate = false } = {}) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: 'That website address is not valid.' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: 'Only http and https websites can be checked.' };
  if (u.port && !['80', '443'].includes(u.port) && !allowPrivate) return { error: 'Only standard web ports can be checked.' };
  const h = u.hostname.toLowerCase();
  const privateHost = h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h) || !h.includes('.')
    || /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)
    || h.startsWith('[');
  if (privateHost && !allowPrivate) return { error: 'That address is not a public website.' };
  u.hash = '';
  return { url: u };
}

// One request with manual redirects, timing and a body cap. Never throws.
export async function get(url, budget, { method = 'GET', maxRedirects = 5, timeout = 12000, body = true } = {}) {
  const chain = [];
  let current = String(url);
  const started = Date.now();
  for (let i = 0; i <= maxRedirects; i++) {
    if (!budget.take()) return { ok: false, error: 'budget', chain, url: current };
    let res;
    try {
      res = await fetch(current, { method, redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : 'unreachable', chain, url: current, ms: Date.now() - started };
    }
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) {
      chain.push({ from: current, status: res.status });
      try { current = new URL(loc, current).href; } catch { return { ok: false, error: 'bad_redirect', chain, url: current }; }
      try { await res.body?.cancel(); } catch {}
      continue;
    }
    const ms = Date.now() - started;
    let text = '';
    if (body && method !== 'HEAD') {
      try { text = await readCapped(res); } catch { text = ''; }
    } else {
      try { await res.body?.cancel(); } catch {}
    }
    return { ok: true, status: res.status, url: current, chain, headers: res.headers, text, ms };
  }
  return { ok: false, error: 'redirect_loop', chain, url: current };
}

async function readCapped(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (size > MAX_BODY) { try { await reader.cancel(); } catch {} break; }
  }
  return out;
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '').replace(/\/?>$/, '');
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const blocks = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))];
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' '));

export const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
export const digits10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Extracts the facts the checks use from one HTML page.
export function parsePage(html, pageUrl) {
  const base = new URL(pageUrl);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const head = (noComments.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
  const metas = tags(noComments, 'meta').map(attrs);
  const meta = (key) => metas.find((m) => (m.name || m.property || '').toLowerCase() === key)?.content ?? null;
  const linkTags = tags(noComments, 'link').map(attrs);
  const rels = (r) => linkTags.filter((l) => (l.rel || '').toLowerCase().split(/\s+/).includes(r));

  const bodyHtml = noComments.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const bodyOnly = (bodyHtml.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, bodyHtml])[1];
  const visibleText = stripTags(bodyOnly);
  const words = visibleText.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;

  const anchors = blocks(noComments, 'a').map((m) => {
    const a = attrs(m[0].match(/^<a\b[^>]*>/i)[0]);
    return { href: a.href || '', text: stripTags(m[1]).slice(0, 120), rel: a.rel || '', aria: a['aria-label'] || '' };
  });
  const links = [];
  for (const a of anchors) {
    const h = a.href.trim();
    if (!h || h.startsWith('#') || /^javascript:/i.test(h)) continue;
    if (/^tel:/i.test(h) || /^mailto:/i.test(h) || /^sms:/i.test(h)) { links.push({ ...a, kind: h.split(':')[0].toLowerCase() }); continue; }
    try {
      const u = new URL(h, base);
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      u.hash = '';
      const internal = u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '');
      links.push({ ...a, url: u.href, kind: internal ? 'internal' : 'external' });
    } catch {}
  }

  const images = tags(noComments, 'img').map(attrs).map((i) => {
    const src = i.src || i['data-src'] || (i.srcset || '').split(/\s+/)[0] || '';
    let url = null;
    try { if (src && !src.startsWith('data:')) url = new URL(src, base).href; } catch {}
    return { url, hasAlt: i.alt !== undefined, alt: i.alt || '', sized: !!(i.width && i.height), lazy: i.loading === 'lazy' };
  });

  const jsonld = [];
  for (const m of blocks(noComments, 'script')) {
    if (!/application\/ld\+json/i.test(m[0])) continue;
    try { jsonld.push(JSON.parse(m[1].trim())); } catch { jsonld.push({ invalid: true }); }
  }
  const schemaTypes = new Set();
  const schemaNodes = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n['@type']) { (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).forEach((t) => schemaTypes.add(String(t))); schemaNodes.push(n); }
    if (n['@graph']) walk(n['@graph']);
  };
  jsonld.forEach(walk);
  const microdata = (noComments.match(/itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)/gi) || []).map((s) => s.split('/').pop());
  microdata.forEach((t) => schemaTypes.add(t));

  const headScripts = tags(head, 'script').map(attrs);
  const blockingScripts = headScripts.filter((s) => s.src && s.async === undefined && s.defer === undefined && !/module/i.test(s.type || '')).length;
  const blockingCss = rels('stylesheet').filter((l) => !l.media || /all|screen/i.test(l.media)).length;

  const isHttps = base.protocol === 'https:';
  const insecure = new Set();
  if (isHttps) {
    for (const t of [...tags(noComments, 'img'), ...tags(noComments, 'script'), ...tags(noComments, 'iframe'), ...tags(noComments, 'source')]) {
      const a = attrs(t);
      if (/^http:\/\//i.test(a.src || '')) insecure.add(a.src);
    }
    for (const l of rels('stylesheet')) if (/^http:\/\//i.test(l.href || '')) insecure.add(l.href);
  }

  const phones = new Set();
  for (const m of visibleText.matchAll(PHONE_RE)) phones.add(`${m[1]}${m[2]}${m[3]}`);
  for (const l of links) if (l.kind === 'tel') phones.add(digits10(l.href));

  const years = [...visibleText.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
  const forms = tags(noComments, 'form').length;
  const inputs = tags(noComments, 'input').map(attrs).filter((i) => !['hidden', 'submit', 'button', 'search'].includes((i.type || '').toLowerCase())).length;
  const iframes = tags(noComments, 'iframe').map(attrs).map((f) => f.src || '');
  const buttons = blocks(noComments, 'button').map((m) => stripTags(m[1]));

  const headings = {};
  for (const n of [1, 2, 3]) headings[`h${n}`] = blocks(noComments, `h${n}`).map((m) => stripTags(m[1])).filter(Boolean);
  const layout = layoutHints(noComments, bodyOnly);

  return {
    title: (() => { const t = noComments.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i); return t ? decode(t[1]) : null; })(),
    description: meta('description'),
    robots: (meta('robots') || '').toLowerCase(),
    viewport: meta('viewport'),
    canonical: rels('canonical')[0]?.href || null,
    lang: (noComments.match(/<html\b[^>]*\blang=["']?([a-zA-Z-]+)/i) || [])[1] || null,
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image') },
    favicon: rels('icon').length > 0 || rels('shortcut').length > 0 || rels('apple-touch-icon').length > 0,
    headings,
    words,
    text: visibleText.slice(0, 20000),
    links,
    images,
    schemaTypes: [...schemaTypes],
    schemaNodes,
    invalidJsonLd: jsonld.filter((j) => j.invalid).length,
    blockingScripts,
    blockingCss,
    insecure: [...insecure].slice(0, 10),
    phones: [...phones],
    copyrightYear: years.length ? Math.max(...years) : null,
    forms,
    inputs,
    mapEmbed: iframes.some((s) => /google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps/i.test(s)) || /maps\.googleapis\.com\/maps\/api\/js/i.test(noComments),
    iframes: iframes.length,
    buttons,
    layout,
    bytes: html.length,
  };
}

// Words that make a link or button a call to action ("Call now", "Get a free quote", "Book online").
export const CTA_RE = /\b(call|quote|estimate|book|schedul\w*|request|get started|appointment|order|reserve|consult\w*|sign up|apply)\b/i;

// What the page's code says about layout, for the design checks. "Top" is the markup before the first H2 that follows
// the H1 (the header and first section on most layouts), capped at the first 40% of the page. External stylesheets
// aren't fetched, so font sizes only cover styles written into the page itself.
function layoutHints(noComments, bodyOnly) {
  const h1At = Math.max(0, bodyOnly.search(/<h1\b/i));
  const h2 = /<h2\b/gi;
  h2.lastIndex = h1At;
  const nextH2 = h2.exec(bodyOnly)?.index ?? bodyOnly.length;
  const top = bodyOnly.slice(0, Math.min(nextH2, Math.max(4000, Math.round(bodyOnly.length * 0.4))));
  const clickables = (html) => [
    ...blocks(html, 'a').map((m) => stripTags(m[1]) || attrs(m[0].match(/^<a\b[^>]*>/i)[0])['aria-label'] || ''),
    ...blocks(html, 'button').map((m) => stripTags(m[1])),
    ...tags(html, 'input').map(attrs).filter((i) => /^(submit|button)$/i.test(i.type || '')).map((i) => i.value || ''),
  ].filter((t) => t && t.length <= 60);
  const ctas = (list) => [...new Set(list.filter((t) => CTA_RE.test(t)))];

  const navs = blocks(bodyOnly, 'nav');
  const navLabels = navs.length ? [...new Set(navs.flatMap((m) => blocks(m[0], 'a').map((a) => stripTags(a[1]))).filter((t) => t && t.length <= 40))] : null;

  const css = [...blocks(noComments, 'style').map((m) => m[1]), ...[...noComments.matchAll(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi)].map((m) => m[1])].join(';');
  let smallFonts = 0;
  for (const m of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)(px|pt)\b/gi)) {
    if ((m[2].toLowerCase() === 'pt' ? Number(m[1]) * 4 / 3 : Number(m[1])) < 12) smallFonts += 1;
  }
  const formFields = blocks(noComments, 'form').map((m) => tags(m[1], 'input').map(attrs).filter((i) => !['hidden', 'submit', 'button', 'search', 'image', 'reset'].includes((i.type || '').toLowerCase())).length
    + tags(m[1], 'textarea').length + tags(m[1], 'select').length);

  return {
    topCtas: ctas(clickables(top)).slice(0, 5),
    topTel: /<a\b[^>]*href\s*=\s*["']?tel:/i.test(top),
    ctaTexts: ctas(clickables(bodyOnly)).slice(0, 6),
    navLabels: navLabels && navLabels.slice(0, 40),
    smallFonts,
    maxFormFields: formFields.length ? Math.max(...formFields) : 0,
  };
}

// Picks the internal pages most useful to check: contact, services, about, locations, then whatever is left.
export function pickPages(home, max) {
  const seen = new Set([home.url.replace(/\/$/, '')]);
  const scored = [];
  for (const l of home.parsed.links) {
    if (l.kind !== 'internal') continue;
    const key = l.url.replace(/\/$/, '');
    if (seen.has(key) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(\?|$)/i.test(key)) continue;
    seen.add(key);
    const s = `${l.url} ${l.text}`.toLowerCase();
    const score = /contact/.test(s) ? 5 : /service|what-we-do/.test(s) ? 4 : /about/.test(s) ? 3 : /location|area|cities/.test(s) ? 3 : /review|testimonial/.test(s) ? 2 : 1;
    scored.push({ url: l.url, score });
  }
  return { pages: scored.sort((a, b) => b.score - a.score).slice(0, max).map((p) => p.url), internalCount: seen.size };
}

// Runs fn over items with a fixed number in flight.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// Crawls the homepage, a few key pages, robots.txt, the sitemap and a sample of links and images.
export async function crawl(target, { allowPrivate = false, budget = new Budget(40), maxPages = 6, maxLinks = 15, maxImages = 6 } = {}) {
  const out = { requested: target.href, problems: [] };
  const home = await get(target.href, budget, { timeout: 15000 });
  out.home = home.ok ? { url: home.url, status: home.status, ms: home.ms, chain: home.chain, headers: Object.fromEntries(home.headers), bytes: home.text.length } : { error: home.error, chain: home.chain };
  if (!home.ok || home.status >= 400 || !/<html|<body|<head|<!doctype/i.test(home.text.slice(0, 5000))) {
    out.reachable = false;
    return out;
  }
  out.reachable = true;
  const finalUrl = new URL(home.url);
  if (!allowPrivate && checkTarget(finalUrl.href).error) { out.reachable = false; out.home.error = 'redirected_private'; return out; }
  out.home.parsed = parsePage(home.text, home.url);
  const origin = finalUrl.origin;

  const httpUrl = `http://${finalUrl.host}/`;
  const [httpRes, robots, notFound] = await Promise.all([
    finalUrl.protocol === 'https:' ? get(httpUrl, budget, { maxRedirects: 0, body: false, timeout: 8000 }) : Promise.resolve(null),
    get(`${origin}/robots.txt`, budget, { timeout: 8000 }),
    get(`${origin}/detcord-check-${Date.now().toString(36)}`, budget, { timeout: 8000, body: false }),
  ]);
  out.https = finalUrl.protocol === 'https:';
  // true: http redirects to https. false: http serves the page insecurely. null: http isn't served at all (fine).
  out.httpRedirectsToHttps = httpRes ? (httpRes.chain.length ? /^https:/i.test(httpRes.url) : httpRes.ok ? false : null) : false;
  const robotsText = robots.ok && robots.status === 200 && !/<html/i.test(robots.text.slice(0, 500)) ? robots.text.slice(0, 20000) : null;
  out.robots = { found: !!robotsText, blocksAll: robotsText ? robotsBlocksAll(robotsText) : false, sitemaps: robotsText ? [...robotsText.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [] };
  out.soft404 = notFound.ok ? notFound.status === 200 : null;

  let sitemap = null;
  for (const sUrl of [...new Set([...out.robots.sitemaps.slice(0, 1), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])]) {
    const s = await get(sUrl, budget, { timeout: 8000 });
    if (s.ok && s.status === 200 && /<(urlset|sitemapindex)\b/i.test(s.text)) { sitemap = { url: s.url, urls: (s.text.match(/<loc>/gi) || []).length, index: /<sitemapindex/i.test(s.text) }; break; }
    if (!s.ok && s.error === 'budget') break;
  }
  out.sitemap = sitemap;

  const { pages, internalCount } = pickPages({ url: home.url, parsed: out.home.parsed }, maxPages);
  out.internalLinkCount = internalCount;
  const fetched = await pool(pages, 4, async (u) => {
    const r = await get(u, budget, { timeout: 10000 });
    if (!r.ok) return { url: u, error: r.error };
    const isHtml = /text\/html|xhtml/i.test(r.headers.get('content-type') || '') || /<html/i.test(r.text.slice(0, 2000));
    return { url: r.url, requested: u, status: r.status, ms: r.ms, parsed: isHtml && r.status < 400 ? parsePage(r.text, r.url) : null };
  });
  out.pages = fetched.filter((p) => p.error !== 'budget');

  // Broken links: internal links not already fetched, plus homepage images.
  const checked = new Map(out.pages.map((p) => [p.requested || p.url, p.status ?? p.error]));
  const allLinks = [...new Set([out.home.parsed, ...out.pages.map((p) => p.parsed).filter(Boolean)]
    .flatMap((p) => p.links.filter((l) => l.kind === 'internal').map((l) => l.url)))]
    .filter((u) => !checked.has(u) && u.replace(/\/$/, '') !== home.url.replace(/\/$/, ''));
  const linkSample = allLinks.slice(0, maxLinks);
  const linkResults = await pool(linkSample, 5, async (u) => {
    let r = await get(u, budget, { method: 'HEAD', body: false, timeout: 8000 });
    if (r.ok && [403, 405, 501].includes(r.status)) r = await get(u, budget, { body: false, timeout: 8000 });
    return { url: u, status: r.ok ? r.status : null, error: r.ok ? null : r.error };
  });
  const imgSample = [...new Set(out.home.parsed.images.map((i) => i.url).filter(Boolean))].slice(0, maxImages);
  const imgResults = await pool(imgSample, 5, async (u) => {
    const r = await get(u, budget, { method: 'HEAD', body: false, timeout: 8000 });
    return { url: u, status: r.ok ? r.status : null, error: r.ok ? null : r.error, bytes: r.ok ? Number(r.headers.get('content-length')) || null : null };
  });
  const brokenPages = out.pages.filter((p) => p.status >= 400).map((p) => ({ url: p.requested || p.url, status: p.status }));
  out.links = {
    checked: linkResults.filter((l) => l.error !== 'budget').length + out.pages.length,
    broken: [...brokenPages, ...linkResults.filter((l) => l.status >= 400 || l.error === 'unreachable').map((l) => ({ url: l.url, status: l.status || 'no response' }))],
  };
  out.images = {
    checked: imgResults.filter((l) => l.error !== 'budget').length,
    broken: imgResults.filter((l) => l.status >= 400).map((l) => ({ url: l.url, status: l.status })),
    heavy: imgResults.filter((l) => l.bytes && l.bytes > 500_000).map((l) => ({ url: l.url, bytes: l.bytes })),
  };
  out.subrequestsLeft = budget.left;
  return out;
}

function robotsBlocksAll(txt) {
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) { applies = ua[1].trim() === '*' || /googlebot/i.test(ua[1]); continue; }
    if (applies && /^disallow:\s*\/\s*$/i.test(line)) return true;
  }
  return false;
}
