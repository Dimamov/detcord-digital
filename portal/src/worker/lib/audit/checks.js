// Turns crawl, PageSpeed and Google profile data into scored findings written for a business owner.
// Every finding says what was found, why it matters, and how to fix it; nothing is reported that wasn't measured.
import { digits10 } from './crawl.js';
import { LIGHTHOUSE_PICKS } from './google.js';

export const CATEGORIES = [
  { id: 'seo', label: 'Search visibility', blurb: 'Whether Google can find, understand and rank your pages.' },
  { id: 'local', label: 'Local search and Google profile', blurb: 'How you show up when nearby customers search on Google and Maps.' },
  { id: 'ux', label: 'Mobile and customer experience', blurb: 'Whether visitors can easily read, trust and contact you, especially on phones.' },
  { id: 'tech', label: 'Speed, security and site health', blurb: 'Load speed, security and broken pages or links.' },
];

const WEIGHT = { critical: 25, important: 10, minor: 4 };
const SEVERITY_ORDER = { critical: 0, important: 1, minor: 2 };
const STATE_NAMES = { MI: 'michigan', OH: 'ohio', IN: 'indiana', IL: 'illinois', WI: 'wisconsin' };
const fmtMs = (ms) => `${(ms / 1000).toFixed(1)} seconds`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtPhone = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);

export function evaluate({ client, crawl, mobile, desktop, gbp, now = Date.now() }) {
  const findings = [];
  const passed = [];
  const add = (f) => findings.push(f);
  const ok = (cat, title) => passed.push({ cat, title });
  const coverage = {
    site: crawl.reachable ? 'checked' : 'unreachable',
    pagespeed: mobile?.ok ? 'checked' : 'skipped',
    pagespeedReason: mobile?.ok ? null : mobile?.reason || null,
    google: gbp?.ok ? 'checked' : 'skipped',
    googleReason: gbp?.ok ? null : gbp?.reason || null,
  };

  if (!crawl.reachable) {
    const why = { timeout: 'did not respond within 15 seconds', unreachable: 'could not be reached', redirect_loop: 'redirects in a loop', redirected_private: 'redirects to a private address', budget: 'could not be fully checked' }[crawl.home?.error];
    add({ id: 'site-down', cat: 'tech', severity: 'critical', title: 'Your website did not load',
      detail: crawl.home?.status ? `Your homepage returned an error (${crawl.home.status}).` : `Your website ${why || 'did not load'} when we checked it.`,
      why: 'Customers and Google who reach a broken site leave, and Google drops sites that are down repeatedly.',
      fix: 'Check your hosting account and domain renewal first, then confirm the site loads on a phone and a computer.', service: 'hosting' });
  }

  const home = crawl.home?.parsed;
  const pages = [home, ...(crawl.pages || []).map((p) => p.parsed)].filter(Boolean);
  const text = pages.map((p) => p.text).join(' ').toLowerCase();

  if (home) {
    // ---------- Search visibility ----------
    if (!home.title) add({ id: 'title-missing', cat: 'seo', severity: 'critical', title: 'Your homepage has no page title', detail: 'The homepage has no title tag, which is the blue headline Google shows in search results.', why: 'Without it, Google invents one, and you lose the most important ranking signal on the page.', fix: 'Add a title like "Service in City, MI | Business Name", 50 to 60 characters long.', service: 'seo' });
    else if (home.title.length < 25 || home.title.length > 65) add({ id: 'title-length', cat: 'seo', severity: 'important', title: home.title.length < 25 ? 'Your homepage title is too short' : 'Your homepage title gets cut off in Google', detail: `Your title is "${home.title}" (${home.title.length} characters). Google shows about 55 to 60.`, why: 'The title is the headline people see in Google. A short one wastes the chance to say what you do and where; a long one gets cut off.', fix: 'Rewrite it to name your main service, your city and your business name, in 50 to 60 characters.', service: 'seo' });
    else ok('seo', 'Homepage title is a good length');

    if (!home.description) add({ id: 'desc-missing', cat: 'seo', severity: 'important', title: 'Your homepage has no search description', detail: 'There is no meta description, the two-line summary under your link in Google.', why: 'A clear description gets more people to click your listing instead of a competitor\'s.', fix: 'Write a 140 to 160 character summary with your service, your area and a reason to call.', service: 'seo' });
    else if (home.description.length < 70 || home.description.length > 170) add({ id: 'desc-length', cat: 'seo', severity: 'minor', title: 'Your search description is the wrong length', detail: `Your description is ${home.description.length} characters. The best length is 140 to 160.`, why: 'Too short leaves space unused; too long gets cut off mid-sentence.', fix: 'Rewrite it to 140 to 160 characters with a call to action.', service: 'seo' });
    else ok('seo', 'Homepage has a search description');

    const h1 = home.headings.h1;
    if (!h1.length) add({ id: 'h1-missing', cat: 'seo', severity: 'important', title: 'Your homepage has no main heading', detail: 'We found no H1 heading on the homepage.', why: 'The main heading tells Google and visitors what the page is about.', fix: 'Add one main heading that names your service and city, for example "Emergency Plumbing in Troy, MI".', service: 'seo' });
    else if (h1.length > 1) add({ id: 'h1-multiple', cat: 'seo', severity: 'minor', title: 'Your homepage has several main headings', detail: `We found ${h1.length} H1 headings: ${h1.slice(0, 3).map((h) => `"${h.slice(0, 50)}"`).join(', ')}.`, why: 'Several main headings blur what the page is about.', fix: 'Keep one H1 for the page topic and make the rest H2 subheadings.', service: 'seo' });
    else ok('seo', 'Homepage has one clear main heading');

    if (/noindex/.test(home.robots)) add({ id: 'noindex', cat: 'seo', severity: 'critical', title: 'Your homepage tells Google not to list it', detail: 'The homepage has a "noindex" tag.', why: 'Google will remove your homepage from search results. This often gets left behind after a redesign.', fix: 'Remove the noindex setting (in WordPress: Settings → Reading → uncheck "Discourage search engines").', service: 'seo' });
    if (crawl.robots?.blocksAll) add({ id: 'robots-block', cat: 'seo', severity: 'critical', title: 'Your site blocks Google from reading it', detail: 'Your robots.txt file contains "Disallow: /" for all search engines.', why: 'Google cannot crawl any page, so your site can\'t rank.', fix: 'Remove the "Disallow: /" line from robots.txt.', service: 'seo' });
    if (!crawl.sitemap) add({ id: 'sitemap', cat: 'seo', severity: 'important', title: 'We could not find a sitemap', detail: 'There is no sitemap at /sitemap.xml and none is listed in robots.txt.', why: 'A sitemap helps Google find and refresh all your pages, especially new ones.', fix: 'Generate an XML sitemap (most site builders and SEO plugins do this) and submit it in Google Search Console.', service: 'seo' });
    else ok('seo', `Sitemap found (${plural(crawl.sitemap.urls, 'entry', 'entries')})`);
    if (!crawl.robots?.found) add({ id: 'robots-missing', cat: 'seo', severity: 'minor', title: 'Your site has no robots.txt file', detail: 'We could not find /robots.txt.', why: 'It\'s a small file that points search engines to your sitemap and away from pages that shouldn\'t be listed.', fix: 'Add a simple robots.txt that allows crawling and lists your sitemap.', service: 'seo' });

    if (!home.canonical) add({ id: 'canonical', cat: 'seo', severity: 'minor', title: 'Your homepage has no preferred address set', detail: 'There is no canonical tag on the homepage.', why: 'Without it, Google may split ranking between versions such as with and without "www".', fix: 'Add a canonical tag that points to the main address of each page.', service: 'seo' });

    const titles = new Map();
    for (const p of pages) if (p.title) titles.set(p.title, (titles.get(p.title) || 0) + 1);
    const dupes = [...titles].filter(([, n]) => n > 1);
    if (dupes.length && pages.length > 2) add({ id: 'dup-titles', cat: 'seo', severity: 'important', title: 'Several pages share the same title', detail: `${plural(dupes.reduce((s, [, n]) => s + n, 0), 'page')} we checked use the same title, for example "${dupes[0][0].slice(0, 60)}".`, why: 'Pages with identical titles compete with each other, and Google can\'t tell which to show.', fix: 'Give every page its own title that names the service on that page.', service: 'seo' });
    const noDesc = pages.slice(1).filter((p) => !p.description).length;
    if (noDesc >= 2) add({ id: 'pages-no-desc', cat: 'seo', severity: 'minor', title: 'Inner pages are missing search descriptions', detail: `${noDesc} of the ${pages.length - 1} inner pages we checked have no meta description.`, why: 'Each page that appears in Google needs its own summary to earn the click.', fix: 'Write a short unique description for every service and contact page.', service: 'seo' });

    if (home.words < 250) add({ id: 'thin-content', cat: 'seo', severity: 'important', title: 'Your homepage has very little text', detail: `The homepage has about ${home.words} words of readable text.`, why: 'Google ranks pages on what they say. Thin pages rarely rank for competitive local searches.', fix: 'Add 400 or more words covering your services, your area, and why customers choose you.', service: 'content' });
    else ok('seo', `Homepage has enough text (${home.words} words)`);

    const imgs = home.images.filter((i) => i.url);
    const noAlt = imgs.filter((i) => !i.hasAlt || !i.alt.trim()).length;
    if (imgs.length >= 3 && noAlt / imgs.length > 0.3) add({ id: 'img-alt', cat: 'seo', severity: 'important', title: 'Most photos have no description', detail: `${noAlt} of ${imgs.length} images on the homepage have no alt text.`, why: 'Google reads alt text to understand photos, and people using screen readers depend on it.', fix: 'Describe each photo in a few words, for example "technician repairing a furnace in Troy".', service: 'accessibility' });
    else if (imgs.length && !noAlt) ok('seo', 'Images have descriptions');

    const nInternal = crawl.internalLinkCount || 0;
    if (nInternal < 5) add({ id: 'few-pages', cat: 'seo', severity: 'important', title: 'Your site has very few pages', detail: `We found links to ${plural(Math.max(0, nInternal - 1), 'other page')} from the homepage.`, why: 'Businesses that rank well usually have a page for each main service and each area they serve.', fix: 'Add a page per core service and per city you serve, each with real detail and photos.', service: 'web' });
    if (!home.og.title && !home.og.image) add({ id: 'og', cat: 'seo', severity: 'minor', title: 'Links to your site look plain when shared', detail: 'The homepage has no social sharing tags (Open Graph).', why: 'When someone shares your link on Facebook or by text, it shows no image or proper headline.', fix: 'Add Open Graph tags with a title, description and a good photo.', service: 'seo' });
    if (!home.lang) add({ id: 'lang', cat: 'seo', severity: 'minor', title: 'The site doesn\'t declare its language', detail: 'The page has no language attribute.', why: 'It helps screen readers and search engines read the page correctly.', fix: 'Add lang="en" to the page\'s html tag.', service: 'web' });

    // ---------- Local ----------
    const localTypes = home.schemaTypes.concat(...pages.slice(1).map((p) => p.schemaTypes));
    const businessSchema = localTypes.some((t) => /LocalBusiness|Organization|Store|Service|Plumber|Electrician|Dentist|Restaurant|Contractor|Attorney|Physician|AutoRepair|Salon|HVAC|Roofing|Locksmith|Moving|RealEstate|Medical|Clinic|Hotel|Bakery|Cafe|BarOrPub|Gym|ExerciseGym|Florist/i.test(t));
    if (!businessSchema) add({ id: 'schema', cat: 'local', severity: 'important', title: 'Google can\'t read your business details from your site', detail: 'We found no LocalBusiness structured data (schema) on the pages we checked.', why: 'Schema tells Google your exact name, address, phone, hours and service area, which supports Maps rankings and rich results.', fix: 'Add LocalBusiness schema with your name, address, phone, hours, service area and Google profile link.', service: 'seo' });
    else ok('local', 'Business details are marked up for Google');
    if (home.invalidJsonLd) add({ id: 'schema-invalid', cat: 'local', severity: 'minor', title: 'Some of your structured data is broken', detail: `${plural(home.invalidJsonLd, 'block')} of JSON-LD on the homepage could not be read.`, why: 'Google ignores structured data it can\'t parse.', fix: 'Fix the JSON-LD syntax and test it with Google\'s Rich Results Test.', service: 'seo' });

    const sitePhones = new Set(pages.flatMap((p) => p.phones));
    const ourPhone = digits10(client.phone);
    if (!sitePhones.size) add({ id: 'no-phone', cat: 'local', severity: 'important', title: 'We couldn\'t find a phone number on your site', detail: 'No phone number appears in the text of the pages we checked.', why: 'Most local customers want to call. Google also checks that your phone matches your Google profile and directory listings.', fix: 'Show your phone number in the header and footer of every page.', service: 'web' });
    else if (ourPhone.length === 10 && !sitePhones.has(ourPhone)) add({ id: 'phone-mismatch', cat: 'local', severity: 'important', title: 'The phone number on your site doesn\'t match', detail: `Your site shows ${[...sitePhones].slice(0, 2).map(fmtPhone).join(' and ')}, but the number we have for you is ${fmtPhone(ourPhone)}.`, why: 'Google trusts businesses whose name, address and phone match everywhere. Mismatches can lower your Maps ranking.', fix: 'Use one main number on your site, your Google profile and every directory listing.', service: 'citations' });
    else ok('local', 'Phone number is shown on the site');

    const city = String(client.city || '').trim().toLowerCase();
    const state = String(client.state || 'MI').toUpperCase();
    if (city) {
      const inHome = `${home.title} ${home.headings.h1.join(' ')} ${home.description || ''}`.toLowerCase().includes(city);
      const anywhere = text.includes(city);
      if (!anywhere) add({ id: 'city-missing', cat: 'local', severity: 'important', title: `Your site never mentions ${client.city}`, detail: `We didn't find "${client.city}" on the pages we checked.`, why: `To rank for searches like "near me" or "in ${client.city}", Google needs to see where you work.`, fix: `Mention ${client.city} and the nearby towns you serve on the homepage, and add a page for each main area.`, service: 'seo' });
      else if (!inHome) add({ id: 'city-title', cat: 'local', severity: 'important', title: 'Your homepage headline doesn\'t say where you work', detail: `"${client.city}" isn't in your homepage title, main heading or description.`, why: 'The title and main heading are the strongest local signals on the page.', fix: `Put your main service and "${client.city}, ${state}" in the homepage title and main heading.`, service: 'seo' });
      else ok('local', `Homepage targets ${client.city}`);
    }
    const stateName = STATE_NAMES[state];
    const hasAddress = /\b\d{2,6}\s+[a-z0-9 .]+\b(st|street|ave|avenue|rd|road|blvd|dr|drive|hwy|ln|lane|ct|way|pkwy|mile)\b/i.test(text)
      || (stateName && new RegExp(`\\b(${state.toLowerCase()}|${stateName})\\s+\\d{5}\\b`).test(text));
    if (!hasAddress) add({ id: 'no-address', cat: 'local', severity: 'minor', title: 'We couldn\'t find your address or service area', detail: 'No street address or ZIP code appears on the pages we checked.', why: 'Showing an address (or a clear service area for businesses that travel) supports local rankings and builds trust.', fix: 'Add your address, or "Serving <cities>", in the footer of every page.', service: 'seo' });
    if (!pages.some((p) => p.mapEmbed)) add({ id: 'no-map', cat: 'local', severity: 'minor', title: 'There\'s no Google map on your site', detail: 'None of the pages we checked embeds a Google map.', why: 'A map on the contact page helps customers find you and links your site to your Google profile.', fix: 'Embed your Google Maps listing on the contact page.', service: 'web' });
    if (!/review|testimonial|what (our )?(customers|clients) say|★|stars?/i.test(text)) add({ id: 'no-reviews-onsite', cat: 'local', severity: 'minor', title: 'Your site doesn\'t show customer reviews', detail: 'We found no reviews or testimonials on the pages we checked.', why: 'Reviews are the top reason people choose one local business over another.', fix: 'Show your best Google reviews on the homepage and link to your Google profile.', service: 'reputation' });
  }

  // ---------- Google Business Profile ----------
  if (gbp?.ok) {
    const p = gbp.profile;
    if (!p) add({ id: 'gbp-missing', cat: 'local', severity: 'critical', title: 'We couldn\'t find your Google Business Profile', detail: gbp.candidates?.length ? `Searching Google for your business in ${gbp.query} returned other businesses (${gbp.candidates.join(', ')}).` : `Searching Google for your business in ${gbp.query} returned no match.`, why: 'Your Google profile is how you appear in Maps and the local "3-pack", where most local calls come from.', fix: 'Claim or create your Google Business Profile, verify it, and complete every section.', service: 'gbp' });
    else {
      if (p.status && p.status !== 'OPERATIONAL') add({ id: 'gbp-status', cat: 'local', severity: 'critical', title: 'Google lists your business as closed', detail: `Your profile status is "${p.status.replace(/_/g, ' ').toLowerCase()}".`, why: 'Customers see you as closed and call someone else.', fix: 'Update the business status in your Google Business Profile.', service: 'gbp' });
      if (p.reviews < 25) add({ id: 'gbp-reviews', cat: 'local', severity: 'important', title: 'You have few Google reviews', detail: `Your profile has ${plural(p.reviews, 'review')}${p.rating ? ` with a ${p.rating} average` : ''}.${competitorLine(gbp.competitors, 'reviews')}`, why: 'Review count and recency are among the strongest Maps ranking factors, and customers compare them.', fix: 'Ask every happy customer for a review with a direct link, by text right after the job.', service: 'reputation' });
      else ok('local', `${p.reviews} Google reviews`);
      if (p.rating && p.rating < 4.3) add({ id: 'gbp-rating', cat: 'local', severity: 'important', title: 'Your Google rating is below what customers look for', detail: `Your average rating is ${p.rating}.${competitorLine(gbp.competitors, 'rating')}`, why: 'Many customers filter for 4.5 stars or higher.', fix: 'Reply to every review, resolve unhappy customers, and request reviews steadily.', service: 'reputation' });
      else if (p.rating) ok('local', `${p.rating} star Google rating`);
      if (!p.website) add({ id: 'gbp-website', cat: 'local', severity: 'important', title: 'Your Google profile doesn\'t link to your website', detail: 'There is no website on your Google Business Profile.', why: 'You lose clicks from Maps, and Google can\'t connect your site to your profile.', fix: 'Add your website address to the profile.', service: 'gbp' });
      else if (crawl.home?.url && hostOf(p.website) !== hostOf(crawl.home.url)) add({ id: 'gbp-website-mismatch', cat: 'local', severity: 'important', title: 'Your Google profile links to a different website', detail: `The profile links to ${p.website}.`, why: 'Google may not connect your profile with this site.', fix: 'Point the profile at your main website.', service: 'gbp' });
      if (p.phone && clientPhone(client) && digits10(p.phone) !== clientPhone(client)) add({ id: 'gbp-phone', cat: 'local', severity: 'important', title: 'Your Google profile has a different phone number', detail: `Google shows ${p.phone}; we have ${fmtPhone(clientPhone(client))}.`, why: 'Inconsistent phone numbers confuse customers and weaken local rankings.', fix: 'Use the same main number on Google, your website and directories.', service: 'citations' });
      if (!p.hours) add({ id: 'gbp-hours', cat: 'local', severity: 'important', title: 'Your Google profile has no business hours', detail: 'No regular hours are listed on your profile.', why: 'Google favors complete profiles, and customers skip businesses that might be closed.', fix: 'Add regular hours, plus holiday hours when they change.', service: 'gbp' });
      if (p.photos < 10) add({ id: 'gbp-photos', cat: 'local', severity: 'minor', title: 'Your Google profile has few photos', detail: `We found ${plural(p.photos, 'photo')} on your profile.`, why: 'Profiles with many recent photos get more calls and direction requests.', fix: 'Upload photos of your team, work, vehicles and location every month.', service: 'gbp' });
      if (p.reviews >= 25 && p.rating >= 4.3 && p.hours && p.website) ok('local', 'Google profile is well set up');
    }
  }

  // ---------- Customer experience ----------
  if (home) {
    if (!home.viewport) add({ id: 'viewport', cat: 'ux', severity: 'critical', title: 'Your site isn\'t set up for phones', detail: 'The homepage has no mobile viewport setting.', why: 'On phones the page shows as a tiny desktop page. Most local searches happen on phones, and Google ranks the mobile version.', fix: 'Use a responsive design with a mobile viewport tag.', service: 'web' });
    else ok('ux', 'Site is set up for phones');
    const tel = pages.some((p) => p.links.some((l) => l.kind === 'tel'));
    if (!tel) add({ id: 'no-tap-call', cat: 'ux', severity: 'important', title: 'Phone visitors can\'t tap to call you', detail: 'There\'s no tap-to-call link on the pages we checked.', why: 'On a phone, people expect to tap your number to call. Every extra step loses callers.', fix: 'Make the phone number a tap-to-call link and add a "Call now" button on mobile.', service: 'web' });
    else ok('ux', 'Tap-to-call link present');
    const hasForm = pages.some((p) => p.forms > 0 && p.inputs >= 2);
    const booking = pages.some((p) => p.links.some((l) => /calendly|acuityscheduling|square\.site|book|schedul|appointment|housecallpro|jobber|servicetitan/i.test(`${l.url || ''} ${l.text}`)));
    if (!hasForm && !booking) add({ id: 'no-form', cat: 'ux', severity: 'important', title: 'There\'s no way to contact you online', detail: 'We found no contact form or booking link on the pages we checked.', why: 'Many customers would rather fill in a form, especially after hours. Without one, those leads go elsewhere.', fix: 'Add a short quote or contact form (name, phone, what they need) and an online booking option if you take appointments.', service: booking ? 'web' : 'booking' });
    else ok('ux', hasForm ? 'Contact form found' : 'Online booking link found');
    const ctaText = [...home.buttons, ...home.links.map((l) => l.text)].join(' ').toLowerCase();
    if (!/call|quote|estimate|book|schedule|contact|get started|request|appointment|order|reserve|free/.test(ctaText)) add({ id: 'no-cta', cat: 'ux', severity: 'important', title: 'Your homepage has no clear call to action', detail: 'We found no button or link like "Call now", "Get a quote" or "Book online" on the homepage.', why: 'Visitors need to be told the next step. Clear calls to action turn visitors into leads.', fix: 'Add a bold button near the top: "Get a free quote" or "Call now".', service: 'web' });
    const year = new Date(now).getUTCFullYear();
    if (home.copyrightYear && home.copyrightYear < year - 1) add({ id: 'stale', cat: 'ux', severity: 'minor', title: 'Your site looks out of date', detail: `The footer says © ${home.copyrightYear}.`, why: 'Visitors read an old date as a sign the business may not be active.', fix: 'Update the footer year (or make it automatic) and refresh old content.', service: 'hosting' });
    if (!home.favicon) add({ id: 'favicon', cat: 'ux', severity: 'minor', title: 'Your site has no browser icon', detail: 'We found no favicon.', why: 'The small logo in browser tabs and Google results makes your business look established.', fix: 'Add your logo as a favicon.', service: 'branding' });
  }

  // ---------- Speed, security and health ----------
  if (crawl.reachable) {
    if (!crawl.https) add({ id: 'no-https', cat: 'tech', severity: 'critical', title: 'Your site isn\'t secure (no HTTPS)', detail: 'The site loads over http:// without encryption.', why: 'Browsers label it "Not secure", which scares customers off, and Google ranks secure sites higher.', fix: 'Install a free SSL certificate and redirect all pages to https://.', service: 'hosting' });
    else if (crawl.httpRedirectsToHttps === false) add({ id: 'no-https-redirect', cat: 'tech', severity: 'important', title: 'The insecure version of your site still loads', detail: 'Visiting http:// shows the page without redirecting to the secure https:// version.', why: 'Visitors and Google can land on the "Not secure" version.', fix: 'Redirect every http:// address to https://.', service: 'hosting' });
    else ok('tech', 'Site is secure (HTTPS)');
    if (home?.insecure?.length) add({ id: 'mixed', cat: 'tech', severity: 'important', title: 'Some files load insecurely', detail: `${plural(home.insecure.length, 'file')} on the homepage load over http://, for example ${home.insecure[0]}.`, why: 'Browsers may block these files or warn visitors that the page isn\'t fully secure.', fix: 'Change those file links to https://.', service: 'hosting' });
    const hops = crawl.home.chain?.length || 0;
    if (hops > 2) add({ id: 'redirects', cat: 'tech', severity: 'minor', title: 'Your homepage redirects several times', detail: `Reaching your homepage takes ${hops} redirects.`, why: 'Each redirect adds delay on phones.', fix: 'Redirect straight to the final address in one step.', service: 'hosting' });
    if (crawl.home.ms > 1800) add({ id: 'slow-server', cat: 'tech', severity: crawl.home.ms > 3500 ? 'important' : 'minor', title: 'Your server is slow to respond', detail: `Your homepage took ${fmtMs(crawl.home.ms)} to arrive from the server.`, why: 'Everything else waits for this. A slow server makes every page slow.', fix: 'Upgrade hosting or add caching and a CDN.', service: 'hosting' });
    const broken = crawl.links?.broken || [];
    if (broken.length) add({ id: 'broken-links', cat: 'tech', severity: broken.length >= 3 ? 'important' : 'minor', title: `We found ${plural(broken.length, 'broken link')}`, detail: `Of ${crawl.links.checked} links checked, these don't work: ${broken.slice(0, 4).map((b) => `${b.url} (${b.status})`).join(', ')}${broken.length > 4 ? '…' : ''}.`, why: 'Broken links frustrate visitors and waste Google\'s time on your site.', fix: 'Fix or remove each broken link, and redirect old pages to their replacements.', service: 'hosting', evidence: broken.map((b) => b.url) });
    else if (crawl.links?.checked) ok('tech', `No broken links in ${crawl.links.checked} checked`);
    if (crawl.images?.broken?.length) add({ id: 'broken-images', cat: 'tech', severity: 'important', title: 'Some images on your homepage are broken', detail: `${plural(crawl.images.broken.length, 'image')} failed to load, for example ${crawl.images.broken[0].url}.`, why: 'Broken images make the site look neglected.', fix: 'Re-upload or remove the missing images.', service: 'web', evidence: crawl.images.broken.map((b) => b.url) });
    if (crawl.soft404) add({ id: 'soft-404', cat: 'tech', severity: 'minor', title: 'Missing pages don\'t show an error', detail: 'A made-up address on your site returned a normal page instead of "not found".', why: 'Google can index junk pages, and visitors on dead links get no help.', fix: 'Return a real 404 page with links to your main services.', service: 'web' });
    const h = Object.fromEntries(Object.entries(crawl.home.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (crawl.https && !h['strict-transport-security']) add({ id: 'hsts', cat: 'tech', severity: 'minor', title: 'Basic security headers are missing', detail: `The site doesn't send ${['strict-transport-security', 'x-content-type-options', 'content-security-policy'].filter((k) => !h[k]).join(', ')}.`, why: 'These headers protect visitors from common attacks and are checked by security scanners.', fix: 'Turn on HSTS and standard security headers at your host or CDN.', service: 'hosting' });
    if (home && home.blockingScripts > 3) add({ id: 'blocking-scripts', cat: 'tech', severity: 'minor', title: 'Scripts delay your page from showing', detail: `${home.blockingScripts} scripts in the page header must download before anything appears.`, why: 'Visitors stare at a blank screen while these load, especially on phones.', fix: 'Load non-essential scripts with "defer" or "async", and remove unused plugins.', service: 'web' });
    if (crawl.images?.heavy?.length) add({ id: 'heavy-images', cat: 'tech', severity: 'minor', title: 'Some images are very large files', detail: `${plural(crawl.images.heavy.length, 'image')} on the homepage ${crawl.images.heavy.length === 1 ? 'is' : 'are'} over 500 KB, the largest ${Math.round(Math.max(...crawl.images.heavy.map((i) => i.bytes)) / 1024)} KB.`, why: 'Big images are the most common reason small business sites are slow on phones.', fix: 'Resize images to the size they display at and save them as WebP.', service: 'web' });
  }

  // ---------- Google Lighthouse (lab test) ----------
  if (mobile?.ok) {
    const s = mobile.scores;
    if (s.performance != null) {
      if (s.performance < 50) add({ id: 'psi-perf', cat: 'tech', severity: 'critical', title: 'Your site is slow on phones', detail: `Google's mobile speed score is ${s.performance} out of 100${mobile.lab.lcp ? `, and the main content takes ${fmtMs(mobile.lab.lcp)} to appear` : ''}.`, why: 'Over half of mobile visitors leave if a page takes more than 3 seconds. Google also uses speed in rankings.', fix: 'Compress images, remove unused scripts and plugins, and use faster hosting or a CDN.', service: 'web' });
      else if (s.performance < 80) add({ id: 'psi-perf', cat: 'tech', severity: 'important', title: 'Your site could load faster on phones', detail: `Google's mobile speed score is ${s.performance} out of 100${mobile.lab.lcp ? `; the main content appears after ${fmtMs(mobile.lab.lcp)}` : ''}.`, why: 'Faster pages keep more visitors and rank better.', fix: 'Optimize images and scripts to get under 2.5 seconds.', service: 'web' });
      else ok('tech', `Google mobile speed score ${s.performance}`);
    }
    if (s.accessibility != null && s.accessibility < 85) add({ id: 'psi-a11y', cat: 'ux', severity: s.accessibility < 70 ? 'important' : 'minor', title: 'Some visitors will struggle to use your site', detail: `Google's accessibility score is ${s.accessibility} out of 100.`, why: 'Low-contrast text, small buttons and unlabeled links make the site hard to use for many people, and can create ADA complaints.', fix: 'Fix contrast, labels and button sizes (details below).', service: 'accessibility' });
    else if (s.accessibility != null) ok('ux', `Google accessibility score ${s.accessibility}`);
    if (mobile.field?.overall === 'SLOW') add({ id: 'field-slow', cat: 'tech', severity: 'important', title: 'Real visitors experience a slow site', detail: 'Google\'s data from real Chrome users rates your site\'s experience as poor.', why: 'This is the data Google uses for its page experience ranking signal.', fix: 'Address the speed issues above, starting with images and scripts.', service: 'web' });
    for (const [id, a] of Object.entries(mobile.audits)) {
      if (a.score >= 0.9 || ['largest-contentful-paint', 'total-blocking-time'].includes(id)) continue;
      add({ id: `lh-${id}`, cat: LIGHTHOUSE_PICKS[id], severity: 'minor', title: a.title, detail: a.value ? `Google measured: ${a.value}.` : a.items ? `Google flagged ${plural(a.items, 'item')} on the mobile homepage.` : 'Flagged by Google\'s Lighthouse test on the mobile homepage.', why: LH_WHY[id] || 'Flagged by Google\'s Lighthouse test.', fix: LH_FIX[id] || 'Your web developer can see the exact items in Google PageSpeed Insights.', service: ['color-contrast', 'image-alt', 'link-name', 'button-name', 'label', 'target-size', 'font-size'].includes(id) ? 'accessibility' : id === 'link-text' || id === 'document-title' || id === 'is-crawlable' ? 'seo' : 'web', source: 'lighthouse' });
    }
  }

  // Avoid saying the same thing twice when Lighthouse and our own check agree.
  const seen = new Set(findings.map((f) => f.id));
  const dropIf = { 'lh-image-alt': 'img-alt', 'lh-document-title': 'title-missing', 'lh-render-blocking-resources': 'blocking-scripts' };
  const unique = findings.filter((f) => !(dropIf[f.id] && seen.has(dropIf[f.id])));
  unique.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || CATEGORIES.findIndex((c) => c.id === a.cat) - CATEGORIES.findIndex((c) => c.id === b.cat));

  const scores = {};
  for (const c of CATEGORIES) {
    const penalty = unique.filter((f) => f.cat === c.id).reduce((s, f) => s + WEIGHT[f.severity], 0);
    let score = Math.max(0, 100 - penalty);
    if (mobile?.ok) {
      const lh = c.id === 'tech' ? avg([mobile.scores.performance, mobile.scores.bestPractices]) : c.id === 'ux' ? mobile.scores.accessibility : c.id === 'seo' ? mobile.scores.seo : null;
      if (lh != null) score = Math.round(score * 0.6 + lh * 0.4);
    }
    if (!crawl.reachable && c.id !== 'local') score = c.id === 'tech' ? 0 : null;
    scores[c.id] = score;
  }
  if (!crawl.reachable && !gbp?.ok) scores.local = null;
  const present = Object.values(scores).filter((v) => v != null);
  const overall = present.length ? Math.round(present.reduce((s, v) => s + v, 0) / present.length) : 0;

  return {
    overall,
    grade: overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 55 ? 'D' : 'F',
    scores,
    findings: unique,
    passed,
    counts: { critical: unique.filter((f) => f.severity === 'critical').length, important: unique.filter((f) => f.severity === 'important').length, minor: unique.filter((f) => f.severity === 'minor').length },
    coverage,
  };
}

const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const clientPhone = (c) => { const d = digits10(c.phone); return d.length === 10 ? d : null; };

function competitorLine(competitors, kind) {
  const list = (competitors || []).filter((c) => c.reviews != null);
  if (!list.length) return '';
  if (kind === 'reviews') {
    const top = [...list].sort((a, b) => b.reviews - a.reviews)[0];
    return ` Nearby, ${top.name} has ${plural(top.reviews, 'review')}.`;
  }
  const rated = list.filter((c) => c.rating);
  if (!rated.length) return '';
  return ` Top nearby competitors average ${(rated.reduce((s, c) => s + c.rating, 0) / rated.length).toFixed(1)}.`;
}

const LH_WHY = {
  'cumulative-layout-shift': 'Content jumps around while loading, which causes mis-taps and frustration.',
  'render-blocking-resources': 'Files that must load first delay the page from appearing.',
  'uses-optimized-images': 'Uncompressed images waste data and slow the page on phones.',
  'modern-image-formats': 'Older image formats are much larger than WebP or AVIF.',
  'uses-responsive-images': 'Phones are downloading images far larger than they display.',
  'unused-javascript': 'Visitors download code the page never uses, which slows it down.',
  'errors-in-console': 'The page has JavaScript errors, which can break forms, menus or tracking.',
  'color-contrast': 'Some text is hard to read against its background, especially outdoors on a phone.',
  'font-size': 'Text is too small to read on a phone without zooming.',
  'target-size': 'Buttons or links are too small or too close together to tap accurately.',
  'image-alt': 'Images lack descriptions for screen readers and Google.',
  'link-name': 'Some links have no readable name, so screen readers announce them as "link".',
  'button-name': 'Some buttons have no readable name for screen readers.',
  'label': 'Form fields have no labels, which makes forms hard to fill in.',
  'document-title': 'The page has no title.',
  'is-crawlable': 'Google is blocked from indexing this page.',
  'link-text': 'Links like "click here" don\'t tell Google or visitors where they go.',
};
const LH_FIX = {
  'cumulative-layout-shift': 'Set width and height on images, embeds and ads so space is reserved.',
  'uses-optimized-images': 'Compress images before uploading, or use an image optimization plugin.',
  'modern-image-formats': 'Serve images as WebP or AVIF.',
  'uses-responsive-images': 'Serve smaller image sizes to phones (srcset).',
  'unused-javascript': 'Remove unused plugins and load scripts only on pages that need them.',
  'errors-in-console': 'Have your developer fix the errors shown in the browser console.',
  'color-contrast': 'Darken text or lighten backgrounds to a 4.5:1 contrast ratio.',
  'font-size': 'Use at least 16px body text on mobile.',
  'target-size': 'Make tap targets at least 48 pixels with space between them.',
  'link-text': 'Use descriptive link text such as "See our drain cleaning services".',
};
