// The website check as a real PDF document, built on the server for printing and attaching to emails.
// It is laid out for paper rather than copied from the screen: no buttons, no app chrome, findings that
// never split across pages, and our own footer instead of the browser's URL and date stamp.
import { launcher } from './screenshots.js';

const TZ = 'America/Detroit';
const SEVERITY = {
  critical: { label: 'Fix first', blurb: 'These cost you customers right now.', color: '#d63b3b' },
  important: { label: 'Fix next', blurb: 'Clear opportunities to rank higher and get more calls.', color: '#d98a00' },
  minor: { label: 'Worth fixing', blurb: 'Smaller improvements that add up.', color: '#2f80d8' },
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const longDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
const isoDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
const host = (url) => String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
const tone = (n) => (n == null ? 'none' : n >= 80 ? 'good' : n >= 55 ? 'warn' : 'bad');
const TONE = { good: '#1f9d6b', warn: '#d98a00', bad: '#d63b3b', none: '#9aa3ad' };
// Same rule as the portal: a design score from the page's code alone overstates how good it looks.
const designScore = (r) => (r.design?.lighthouse?.mobile || r.design?.lighthouse?.desktop ? r.scores?.design ?? null : null);

export const pdfFileName = (v) => `${v.business.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Website'} - Website check - ${isoDate(v.checkedAt)}.pdf`;

function ring(score, grade) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return `<div class="ring"><svg width="116" height="116" viewBox="0 0 116 116" aria-hidden="true">
    <circle cx="58" cy="58" r="${r}" fill="none" stroke="#e7eaee" stroke-width="10"/>
    <circle cx="58" cy="58" r="${r}" fill="none" stroke="${TONE[tone(score)]}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 58 58)"/>
  </svg><div class="ring-num"><strong>${esc(score)}</strong><span>Grade ${esc(grade)}</span></div></div>`;
}

function summary(v) {
  const scores = { ...v.scores, design: designScore(v) };
  const rows = v.categories
    .filter((c) => !c.separate || scores[c.id] != null)
    .map((c) => `<div class="cat${c.separate ? ' sep' : ''}">
      <div class="cat-row"><span>${esc(c.label)}${c.separate ? ' <em>· scored separately</em>' : ''}</span><strong>${esc(scores[c.id] ?? '—')}</strong></div>
      <div class="bar"><span style="width:${scores[c.id] ?? 0}%;background:${TONE[tone(scores[c.id])]}"></span></div></div>`).join('');
  const counts = ['critical', 'important', 'minor'].map((s) => {
    const n = v.findings.filter((f) => f.severity === s).length;
    return `<span class="count"><i style="background:${SEVERITY[s].color}"></i>${n} ${SEVERITY[s].label.toLowerCase()}</span>`;
  }).join('');
  return `<section class="summary">${ring(v.overall, v.grade)}<div class="cats">${rows}
    <div class="counts">${counts}<span class="count"><i style="background:${TONE.good}"></i>${v.passed.length} passing</span></div></div></section>`;
}

function coverage(v) {
  const lines = [];
  if (v.coverage?.pagespeed === 'skipped') lines.push('Google’s speed test wasn’t included this time.');
  if (v.coverage?.google === 'skipped') lines.push('The Google Business Profile check wasn’t included.');
  return lines.length ? `<p class="aside">${lines.map(esc).join(' ')}</p>` : '';
}

function metric(label, value, suffix = '') {
  return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value ?? '—')}${value != null ? `<small>${esc(suffix)}</small>` : ''}</strong></div>`;
}

function design(v, shots) {
  const d = v.design;
  if (!d && !shots.mobile && !shots.desktop) return '';
  const lh = d?.lighthouse || {};
  const impression = d?.visual?.status === 'done' && d.visual.impression;
  const figs = [
    shots.mobile && `<figure class="phone"><img src="${shots.mobile}" alt=""><figcaption>Phone</figcaption></figure>`,
    shots.desktop && `<figure class="desktop"><img src="${shots.desktop}" alt=""><figcaption>Computer</figcaption></figure>`,
  ].filter(Boolean).join('');
  const metrics = lh.mobile || lh.desktop ? `<div class="metrics">
    ${metric('Accessibility on a phone', lh.mobile?.accessibility, '/100')}${metric('Best practices on a phone', lh.mobile?.bestPractices, '/100')}
    ${metric('Accessibility on a computer', lh.desktop?.accessibility, '/100')}${metric('Best practices on a computer', lh.desktop?.bestPractices, '/100')}</div>` : '';
  return `<section class="block design">
    <h2>Your homepage today</h2>
    ${figs ? `<div class="shots">${figs}</div>` : ''}
    ${impression ? `<div class="impression"><strong>First impression</strong><p>${esc(impression)}</p></div>` : ''}
    ${metrics}
  </section>`;
}

function speed(v) {
  const m = v.speed?.mobile;
  if (!m) return '';
  const secs = (ms) => (ms == null ? null : `${(ms / 1000).toFixed(1)}s`);
  return `<section class="block keep"><h2>Speed on a phone</h2><div class="metrics">
    ${metric('Google speed score', m.scores?.performance, '/100')}${metric('Main content appears', secs(m.lab?.lcp))}
    ${metric('Accessibility', m.scores?.accessibility, '/100')}${metric('Desktop speed score', v.speed.desktop?.scores?.performance, '/100')}</div>
    <p class="aside">Google recommends the main content appear within 2.5 seconds.</p></section>`;
}

function google(v) {
  const g = v.google;
  if (!g) return '';
  if (!g.profile) return `<section class="block keep"><h2>Google Maps and the local 3-pack</h2><p>We couldn’t find a Google Business Profile for ${esc(v.business)}.</p></section>`;
  const row = (x, me) => `<tr${me ? ' class="me"' : ''}><td>${esc(x.name)}${me ? ' <b class="you">You</b>' : ''}</td><td>${x.rating ? `${esc(x.rating)} ★` : '—'}</td><td>${esc(x.reviews ?? '—')}</td></tr>`;
  return `<section class="block keep"><h2>Google Maps and the local 3-pack</h2>
    <table><thead><tr><th>Business</th><th>Rating</th><th>Reviews</th></tr></thead><tbody>${row(g.profile, true)}${(g.competitors || []).map((x) => row(x)).join('')}</tbody></table>
    ${g.competitors?.length ? '<p class="aside">Competitors are the top Google results for the same category nearby.</p>' : ''}</section>`;
}

function findings(v) {
  const label = (id) => v.categories.find((c) => c.id === id)?.label || '';
  return ['critical', 'important', 'minor'].map((s) => {
    const list = v.findings.filter((f) => f.severity === s);
    if (!list.length) return '';
    const sev = SEVERITY[s];
    const items = list.map((f, i) => {
      const where = f.source === 'visual' ? ` · visual review${f.view && f.view !== 'both' ? ` (${f.view === 'mobile' ? 'phone' : 'computer'})` : ''}` : '';
      // The section heading travels with its first finding so a heading never sits alone at the bottom of a page.
      const head = i === 0 ? `<h2 class="sev" style="--sev:${sev.color}">${esc(sev.label)} <span>${list.length}</span><small>${esc(sev.blurb)}</small></h2>` : '';
      return `<article class="finding" style="--sev:${sev.color}">${head}<div class="f-body">
        <div class="f-cat">${esc(label(f.cat))}${esc(where)}</div>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.detail)}</p>
        <dl><dt>Why it matters</dt><dd>${esc(f.why)}</dd><dt>How to fix it</dt><dd>${esc(f.fix)}</dd></dl>
        ${f.service ? `<div class="f-svc">Detcord service: ${esc(f.service)}</div>` : ''}
      </div></article>`;
    }).join('');
    return `<section class="sev-group">${items}</section>`;
  }).join('');
}

function passed(v) {
  if (!v.passed.length) return '';
  return `<section class="block keep"><h2>What’s working</h2><ul class="passed">${v.passed.map((p) => `<li>${esc(p.title)}</li>`).join('')}</ul></section>`;
}

const CSS = `
@page { size: Letter; margin: 0.6in 0.65in 0.75in; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #1a222c; font: 10.5pt/1.5 Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { line-height: 1.2; margin: 0; }
p { margin: 0; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #ff6a00; }
.eyebrow { color: #e85d00; text-transform: uppercase; letter-spacing: .14em; font-size: 8pt; font-weight: 800; }
.top h1 { font-size: 22pt; letter-spacing: -.01em; margin: 4px 0 2px; }
.top .sub { color: #5b6573; }
.top img { height: 64px; width: auto; }
.note { margin-top: 16px; padding: 10px 14px; border-left: 3px solid #ff6a00; background: #fbf7f3; white-space: pre-wrap; }
.summary { display: flex; gap: 28px; align-items: center; margin-top: 18px; padding: 16px 18px; border: 1px solid #e3e6ea; border-radius: 10px; break-inside: avoid; }
.ring { position: relative; width: 116px; height: 116px; flex: none; }
.ring-num { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring-num strong { font-size: 30pt; line-height: 1; }
.ring-num span { font-size: 8.5pt; color: #5b6573; margin-top: 3px; }
.cats { flex: 1; display: grid; gap: 7px; }
.cat-row { display: flex; justify-content: space-between; font-size: 10pt; }
.cat-row em { font-style: normal; color: #8a94a0; }
.cat.sep { padding-top: 7px; border-top: 1px dashed #e3e6ea; }
.bar { height: 6px; border-radius: 99px; background: #eef0f3; margin-top: 3px; overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 99px; }
.counts { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; font-size: 9pt; color: #3b4450; }
.count i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.aside { margin-top: 10px; color: #6b7480; font-size: 9pt; }
.block { margin-top: 22px; }
.keep { break-inside: avoid; }
.block h2 { font-size: 13pt; margin-bottom: 10px; }
.shots { display: flex; gap: 18px; align-items: flex-start; justify-content: center; break-inside: avoid; }
.shots figure { margin: 0; text-align: center; }
.shots figcaption { color: #8a94a0; font-size: 8.5pt; margin-top: 4px; }
.shots .phone img { width: 112px; border: 5px solid #1a1a1a; border-radius: 12px; display: block; }
.shots .desktop { flex: 0 1 4.3in; }
.shots .desktop img { width: 100%; border: 1px solid #e3e6ea; border-radius: 6px; display: block; }
.impression { margin-top: 12px; padding: 10px 14px; border-left: 3px solid #ff6a00; background: #f7f8fa; break-inside: avoid; }
.impression p { margin-top: 3px; }
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.metric { display: flex; justify-content: space-between; align-items: baseline; padding: 7px 10px; background: #f7f8fa; border-radius: 6px; font-size: 9.5pt; }
.metric small { color: #8a94a0; font-weight: 500; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { text-align: left; color: #6b7480; font-weight: 600; border-bottom: 1px solid #d0d5db; padding: 5px 6px; }
td { border-bottom: 1px solid #eef0f3; padding: 6px; }
tr.me td { font-weight: 600; }
.you { font-size: 7.5pt; color: #e85d00; border: 1px solid #f3c39b; border-radius: 99px; padding: 0 6px; }
.sev-group { margin-top: 24px; }
h2.sev { display: flex; align-items: baseline; gap: 8px; font-size: 13pt; color: var(--sev); padding-bottom: 6px; margin-bottom: 4px; border-bottom: 2px solid var(--sev); }
h2.sev span { font-size: 9pt; color: #fff; background: var(--sev); border-radius: 99px; padding: 1px 7px; }
h2.sev small { font-size: 9pt; font-weight: 500; color: #6b7480; margin-left: auto; }
.finding { break-inside: avoid; }
.f-body { padding: 12px 0 12px 14px; border-left: 3px solid var(--sev); margin-top: 10px; }
.finding + .finding .f-body { margin-top: 12px; }
.f-cat { font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #8a94a0; font-weight: 600; }
.finding h3 { font-size: 11.5pt; margin: 2px 0 5px; }
dl { display: grid; grid-template-columns: 96px 1fr; gap: 4px 12px; margin: 8px 0 0; font-size: 9.5pt; }
dt { font-weight: 700; color: #3b4450; }
dd { margin: 0; color: #3b4450; }
.f-svc { margin-top: 6px; font-size: 8.5pt; color: #8a94a0; }
.passed { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 24px; font-size: 9.5pt; }
.passed li { break-inside: avoid; padding: 3px 0 3px 18px; position: relative; color: #3b4450; }
.passed li::before { content: '✓'; position: absolute; left: 0; color: #1f9d6b; font-weight: 700; }
.method { margin-top: 18px; color: #6b7480; font-size: 8.5pt; }
.close { margin-top: 26px; padding: 18px 20px; border: 1px solid #f3c39b; background: #fdf6f0; border-radius: 10px; break-inside: avoid; }
.close h2 { font-size: 13pt; }
.close p { margin-top: 4px; }
.close .contact { margin-top: 8px; font-weight: 700; }
`;

// shots: { mobile, desktop } as data: URIs (or null). logo: a data: URI (or null).
export function reportHtml(v, { shots = {}, logo = null } = {}) {
  const lh = v.design?.visual?.status === 'done';
  const contact = [v.contact?.phone, v.contact?.email].filter(Boolean).map(esc).join('  ·  ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.business)} – Website and Google check</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header class="top"><div><div class="eyebrow">Website and Google check</div><h1>${esc(v.business)}</h1>
  <div class="sub">${esc(host(v.url))} · checked ${esc(longDate(v.checkedAt))}</div></div>${logo ? `<img src="${logo}" alt="Detcord Digital">` : ''}</header>
${v.note ? `<div class="note">${esc(v.note)}</div>` : ''}
${summary(v)}
${coverage(v)}
${design(v, shots)}
${speed(v)}
${google(v)}
${findings(v)}
${passed(v)}
<p class="method">We checked ${esc(v.pagesChecked)} page${v.pagesChecked === 1 ? '' : 's'}${v.facts?.linksChecked ? ` and ${esc(v.facts.linksChecked)} links` : ''}, Google’s mobile and desktop tests, and Google Maps.${lh ? ' The visual review was written with AI (Claude) from screenshots of your homepage.' : ''} Results reflect the website and Google listing on ${esc(longDate(v.checkedAt))}.</p>
<section class="close"><h2>Want these fixed?</h2><p>Detcord Digital fixes everything in this report and keeps it fixed, so more of the people searching for you become calls.</p>
  ${contact ? `<p class="contact">${contact}</p>` : ''}</section>
</body></html>`;
}

// Our own footer replaces the browser's URL and timestamp. Puppeteer's templates need inline styles.
export const pdfFooter = (v) => `<div style="width:100%;margin:0 0.65in;display:flex;justify-content:space-between;font:7.5pt Helvetica,Arial,sans-serif;color:#8a94a0">
  <span>${esc(v.business)} · Website and Google check · ${esc(longDate(v.checkedAt))}</span>
  <span>Detcord Digital · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

export async function reportPdf(env, v, assets) {
  let browser;
  try {
    browser = await launcher.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setContent(reportHtml(v, assets), { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    return await page.pdf({
      format: 'letter', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: pdfFooter(v),
    });
  } finally {
    try { await browser?.close(); } catch {}
  }
}
