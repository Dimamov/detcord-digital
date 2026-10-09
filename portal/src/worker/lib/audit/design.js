// Design and user experience: checks the page's code can prove, the Lighthouse design scores, and (when
// ANTHROPIC_API_KEY is set) Claude's review of the phone and desktop screenshots PageSpeed already takes.
// The visual review is extra: if it is skipped or fails, the check still finishes with the code-based findings.
import Anthropic from '@anthropic-ai/sdk';
import { DESIGN_AUDITS } from './google.js';
import { SERVICES } from '../../../shared/services.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (xs) => xs.slice(0, 3).map((x) => `"${x.slice(0, 40)}"`).join(', ');

const TRUST = [
  { label: 'licensed or insured', re: /\blicen[sc]ed\b|\blicen[sc]e\s*(#|no\.?|number)|\binsured\b|\bbonded\b/i },
  { label: 'a guarantee or warranty', re: /\bguarantee[ds]?\b|\bwarrant(y|ies)\b|money[- ]back/i },
  { label: 'accreditations or awards', re: /\bBBB\b|better business bureau|\baccredited\b|\bcertified\b|\baward/i },
  { label: 'years in business or local ownership', re: /\bsince (19|20)\d{2}\b|\b\d{1,3}\+?\s+years?\s+(of\s+)?(experience|in business|serving)|\b(family|locally|veteran)[- ]owned\b/i },
];

// Findings from the crawled HTML only. `reported` holds ids already raised elsewhere (no call to action at all,
// no tap-to-call, no form), so the same gap isn't reported twice.
export function designChecks({ home, pages, reported }) {
  const findings = [];
  const passed = [];
  const add = (f) => findings.push({ cat: 'design', ...f });
  const l = home.layout || {};
  const vp = String(home.viewport || '');

  if (l.topCtas?.length) passed.push(`Call to action near the top of the homepage (${quote(l.topCtas)})`);
  else if (!reported.has('no-cta')) add({ id: 'design-cta-top', severity: 'important', title: 'Your main call to action is buried',
    detail: `We found no button or link like "Call now", "Get a quote" or "Book online" in the header or first section of your homepage${l.ctaTexts?.length ? `; the first ones appear further down (${quote(l.ctaTexts)})` : ''}.`,
    why: 'Most visitors decide in the first few seconds whether to act. If the next step isn\'t on the first screen, many leave without scrolling.',
    fix: 'Put one bold button ("Get a free quote" or "Call now") in the header and in the first section, and keep it visible on phones.', service: 'web' });

  const telAnywhere = pages.some((p) => p.links.some((x) => x.kind === 'tel'));
  if (l.topTel) passed.push('Tap-to-call link in the header or first section');
  else if (telAnywhere && !reported.has('no-tap-call')) add({ id: 'design-call-top', severity: 'minor', title: 'Your tap-to-call link isn\'t near the top',
    detail: 'Your site has a tap-to-call link, but not in the header or first section of the homepage.',
    why: 'Phone visitors who want to call shouldn\'t have to scroll to find the number.',
    fix: 'Show the phone number as a tap-to-call link in the header on every page.', service: 'web' });

  const homeForm = home.forms > 0 && home.inputs >= 2;
  const formElsewhere = pages.slice(1).some((p) => p.forms > 0 && p.inputs >= 2);
  if (homeForm) passed.push('Contact form on the homepage');
  else if (formElsewhere && !reported.has('no-form')) add({ id: 'design-form-home', severity: 'minor', title: 'Visitors have to leave the homepage to send a request',
    detail: 'Your contact form is on another page; the homepage has none.',
    why: 'Every extra click loses some people. A short form on the homepage catches visitors who are ready now.',
    fix: 'Add a short quote form (name, phone, what they need) to the homepage, or a button that opens it.', service: 'web' });
  const longest = Math.max(0, ...pages.map((p) => p.layout?.maxFormFields || 0));
  if (longest > 7) add({ id: 'design-form-long', severity: 'minor', title: 'Your contact form asks for a lot',
    detail: `Your longest form has ${longest} fields to fill in.`,
    why: 'Each extra field lowers the number of people who finish the form, especially on phones.',
    fix: 'Ask only for name, phone or email, and what they need. Collect the rest on the call.', service: 'web' });

  if (vp) {
    const maxScale = Number((vp.match(/maximum-scale\s*=\s*([\d.]+)/i) || [])[1]);
    if (/user-scalable\s*=\s*(no|0)\b/i.test(vp) || (maxScale && maxScale < 2)) add({ id: 'design-zoom', severity: 'important', title: 'Visitors can\'t zoom in on phones',
      detail: `Your mobile viewport setting ("${vp.slice(0, 80)}") stops visitors from pinching to zoom.`,
      why: 'People who need bigger text can\'t read the page, which also fails accessibility guidelines.',
      fix: 'Remove "user-scalable=no" and "maximum-scale" from the viewport tag.', service: 'accessibility' });
    if (!/width\s*=\s*device-width/i.test(vp)) add({ id: 'design-viewport-width', severity: 'important', title: 'Your pages may not fit phone screens',
      detail: `Your viewport tag ("${vp.slice(0, 80)}") doesn't set width=device-width.`,
      why: 'Without it, phones may show a shrunken desktop page that visitors have to zoom and scroll sideways to read.',
      fix: 'Use <meta name="viewport" content="width=device-width, initial-scale=1">.', service: 'web' });
  }

  if (l.smallFonts >= 3) add({ id: 'design-small-text', severity: 'minor', title: 'Some text is set very small',
    detail: `The styles written into your homepage set text below 12 pixels in ${plural(l.smallFonts, 'place')}.`,
    why: 'Small text is hard to read on a phone, especially for older customers, and they leave rather than zoom.',
    fix: 'Use at least 16 pixels for body text and 12 pixels for fine print.', service: 'web' });

  if (l.navLabels?.length > 9) add({ id: 'design-nav-crowded', severity: 'minor', title: 'Your menu has a lot of choices',
    detail: `The homepage menu has ${l.navLabels.length} links, for example ${quote(l.navLabels)}.`,
    why: 'Long menus make visitors work to find what they need. Simple menus get more people to the right page.',
    fix: 'Keep 5 to 7 top-level items (Services, Areas, Reviews, About, Contact) and group the rest under them.', service: 'web' });
  else if (l.navLabels?.length >= 3) passed.push(`Menu is easy to scan (${l.navLabels.length} links)`);

  const text = pages.map((p) => p.text).join(' ');
  const trust = TRUST.filter((t) => t.re.test(text)).map((t) => t.label);
  if (!trust.length) add({ id: 'design-trust', severity: 'important', title: 'Your site gives visitors few reasons to trust you',
    detail: 'On the pages we checked we found no mention of being licensed or insured, a guarantee or warranty, accreditations or awards, or how long you\'ve been in business.',
    why: 'Before calling a business they don\'t know, people look for proof it is legitimate and reliable. Trust signals near the top turn browsers into callers.',
    fix: 'Add a short row near the top: licensed and insured, your guarantee, years in business, and badges such as BBB or manufacturer certifications.', service: 'web' });
  else passed.push(`Trust signals on the site: ${trust.join(', ')}`);

  return { findings, passed };
}

// The Lighthouse side of the section: accessibility and best-practices scores on both tests, and the
// failing design-related audits, each with the tests it failed on.
export function lighthouseDesign(mobile, desktop) {
  const scores = (r) => (r?.ok ? { accessibility: r.scores.accessibility, bestPractices: r.scores.bestPractices } : null);
  const failing = [];
  for (const id of DESIGN_AUDITS) {
    const on = [['mobile', mobile], ['desktop', desktop]].filter(([, r]) => r?.ok && r.audits?.[id] && r.audits[id].score < 0.9);
    if (!on.length) continue;
    const a = on[0][1].audits[id];
    failing.push({ id, title: a.title, value: a.value, items: a.items, on: on.map(([n]) => n) });
  }
  return { mobile: scores(mobile), desktop: scores(desktop), failing };
}

// ---------- Claude's visual review ----------

const SEVERITIES = ['critical', 'important', 'minor'];
const serviceIds = SERVICES.map((s) => s.id);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['impression', 'findings'],
  properties: {
    impression: { type: 'string', description: 'Two or three sentences: the overall first impression on a phone and on a computer.' },
    findings: {
      type: 'array',
      description: '3 to 6 findings, most important first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'seen', 'why', 'fix', 'severity', 'view', 'service'],
        properties: {
          title: { type: 'string', description: 'A short headline written to the owner, under 70 characters.' },
          seen: { type: 'string', description: 'Exactly what is visible in the screenshot, naming the element.' },
          why: { type: 'string', description: 'Why it matters for getting calls and leads.' },
          fix: { type: 'string', description: 'How to fix it, specifically.' },
          severity: { type: 'string', enum: SEVERITIES },
          view: { type: 'string', enum: ['mobile', 'desktop', 'both'] },
          service: { type: 'string', enum: serviceIds },
        },
      },
    },
  },
};

const SYSTEM = `You review the design and user experience of a small business's homepage for Detcord Digital, a marketing agency in Michigan. The review goes into a report the business owner reads.
You get screenshots from Google's PageSpeed test (a phone and a desktop computer; each shows only the first screen of the homepage) and a short summary of the page's code.
Describe only what is visible in the screenshots or stated in the summary. Never invent numbers, metrics, load times, conversion rates, statistics or percentages, and never guess at parts of the page you cannot see. If something can't be judged from a first-screen screenshot, leave it out.
Write to the owner in plain English: short, specific and respectful. Point at the exact element you mean (headline, button, photo, menu, colors, logo).
Give 3 to 6 findings, most important first. Each says what you saw, why it matters for getting calls and leads, and how to fix it. Severity: critical only when the first screen would stop most visitors from contacting the business; important for clear lost leads; minor for polish.
Pick the Detcord service that fits each fix from the ids given. Layout, buttons and pages are usually web; logo, colors and wording are branding; reviews are reputation; contrast and text size are accessibility; booking buttons are booking.`;

const shot = (r) => {
  const m = r?.ok && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(r.screenshot || '');
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
};

// Returns { ok: true, impression, findings } or { ok: false, reason }. Never throws.
export async function visualReview(env, { client, url, home, mobile, desktop }) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, reason: 'ANTHROPIC_API_KEY is not set.' };
  if (!home) return { ok: false, reason: 'The homepage did not load.' };
  const images = [['phone', shot(mobile)], ['desktop computer', shot(desktop)]].filter(([, img]) => img);
  if (!images.length) return { ok: false, reason: 'Google PageSpeed returned no screenshots to review.' };
  const l = home.layout || {};
  const summary = [
    `Business: ${client.name}${client.industry ? ` (${client.industry})` : ''}${client.city ? `, ${client.city}, ${client.state || 'MI'}` : ''}`,
    `Address: ${url}`,
    `Page title: ${home.title || '(none)'}`,
    `Main heading (H1): ${home.headings.h1.slice(0, 2).join(' / ') || '(none)'}`,
    `Calls to action in the header or first section: ${l.topCtas?.join(', ') || '(none found in the code)'}`,
    `First calls to action on the page: ${l.ctaTexts?.join(', ') || '(none found in the code)'}`,
    `Menu links: ${l.navLabels?.slice(0, 15).join(', ') || '(no <nav> menu in the code)'}`,
    `Tap-to-call link near the top: ${l.topTel ? 'yes' : 'no'}`,
  ].join('\n');
  try {
    // No retries, so the review costs exactly one subrequest and a bounded wait.
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60000 });
    const response = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [
        ...images.flatMap(([name, img]) => [{ type: 'text', text: `Homepage on a ${name}:` }, img]),
        { type: 'text', text: `Summary of the page's code:\n${summary}\n\nDetcord services (ids): ${serviceIds.join(', ')}` },
      ] }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { ok: false, reason: `Claude stopped early (${response.stop_reason}).` };
    const out = JSON.parse(response.content.find((b) => b.type === 'text')?.text || '{}');
    const str = (v, max) => String(v || '').trim().slice(0, max);
    const findings = (Array.isArray(out.findings) ? out.findings : [])
      .filter((f) => f && str(f.title, 1) && str(f.seen, 1) && SEVERITIES.includes(f.severity))
      .slice(0, 6)
      .map((f, i) => ({
        id: `visual-${i + 1}`, cat: 'design', source: 'visual', severity: f.severity, view: ['mobile', 'desktop', 'both'].includes(f.view) ? f.view : 'both',
        title: str(f.title, 120), detail: str(f.seen, 600), why: str(f.why, 400), fix: str(f.fix, 400), service: serviceIds.includes(f.service) ? f.service : 'web',
      }));
    const impression = str(out.impression, 800);
    if (!impression && !findings.length) return { ok: false, reason: 'Claude returned an empty review.' };
    return { ok: true, impression, findings };
  } catch (e) {
    return { ok: false, reason: e?.status === 401 ? 'Anthropic rejected the API key.' : `Could not reach Claude (${e?.status || 'network error'}).` };
  }
}
