// Google PageSpeed Insights (Lighthouse lab test plus real-visitor data) and Google Places (the Business Profile).
// Both use GOOGLE_API_KEY when set. PageSpeed also works without a key, within Google's small shared quota.

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PLACES = 'https://places.googleapis.com/v1/places:searchText';

// Lighthouse audits worth showing a business owner, with the check category they belong to.
export const LIGHTHOUSE_PICKS = {
  'largest-contentful-paint': 'tech',
  'cumulative-layout-shift': 'ux',
  'total-blocking-time': 'tech',
  'render-blocking-resources': 'tech',
  'uses-optimized-images': 'tech',
  'modern-image-formats': 'tech',
  'uses-responsive-images': 'tech',
  'unused-javascript': 'tech',
  'errors-in-console': 'tech',
  'color-contrast': 'ux',
  'font-size': 'ux',
  'target-size': 'ux',
  'image-alt': 'ux',
  'link-name': 'ux',
  'button-name': 'ux',
  'label': 'ux',
  'document-title': 'seo',
  'is-crawlable': 'seo',
  'link-text': 'seo',
};

export async function pageSpeed(env, url, strategy) {
  const p = new URLSearchParams({ url, strategy });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) p.append('category', c);
  if (env.GOOGLE_API_KEY) p.set('key', env.GOOGLE_API_KEY);
  let res;
  try {
    res = await fetch(`${PSI}?${p}`, { signal: AbortSignal.timeout(75000) });
  } catch {
    return { ok: false, reason: 'Google PageSpeed did not answer in time.' };
  }
  if (!res.ok) {
    const reason = res.status === 429 ? (env.GOOGLE_API_KEY ? 'Google PageSpeed daily limit reached.' : 'Google PageSpeed shared limit reached. Add a GOOGLE_API_KEY to run this every time.')
      : res.status === 400 ? 'Google PageSpeed could not load the page.'
      : res.status === 403 ? 'The Google API key was rejected for PageSpeed.'
      : `Google PageSpeed returned ${res.status}.`;
    return { ok: false, reason, status: res.status };
  }
  const data = await res.json();
  const lh = data.lighthouseResult;
  if (!lh?.categories) return { ok: false, reason: 'Google PageSpeed returned no results.' };
  const score = (k) => lh.categories[k]?.score == null ? null : Math.round(lh.categories[k].score * 100);
  const audits = {};
  for (const id of Object.keys(LIGHTHOUSE_PICKS)) {
    const a = lh.audits?.[id];
    if (!a || a.score == null || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'manual') continue;
    audits[id] = { score: a.score, title: a.title, value: a.displayValue || null, items: (a.details?.items || []).length };
  }
  const field = data.loadingExperience?.metrics && data.loadingExperience.origin_fallback !== true ? data.loadingExperience : data.originLoadingExperience;
  const metric = (k) => field?.metrics?.[k] ? { p75: field.metrics[k].percentile, category: field.metrics[k].category } : null;
  return {
    ok: true,
    strategy,
    scores: { performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo') },
    lab: {
      lcp: lh.audits?.['largest-contentful-paint']?.numericValue ?? null,
      cls: lh.audits?.['cumulative-layout-shift']?.numericValue ?? null,
      tbt: lh.audits?.['total-blocking-time']?.numericValue ?? null,
      fcp: lh.audits?.['first-contentful-paint']?.numericValue ?? null,
      speedIndex: lh.audits?.['speed-index']?.numericValue ?? null,
      weight: lh.audits?.['total-byte-weight']?.numericValue ?? null,
    },
    field: field?.metrics ? { lcp: metric('LARGEST_CONTENTFUL_PAINT_MS'), inp: metric('INTERACTION_TO_NEXT_PAINT'), cls: metric('CUMULATIVE_LAYOUT_SHIFT_SCORE'), overall: field.overall_category || null } : null,
    audits,
    screenshot: lh.audits?.['final-screenshot']?.details?.data || null,
  };
}

const FIELDS = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri', 'rating', 'userRatingCount', 'regularOpeningHours.weekdayDescriptions',
  'businessStatus', 'primaryType', 'primaryTypeDisplayName', 'photos', 'googleMapsUri', 'location'];

async function searchText(env, body) {
  const res = await fetch(PLACES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_API_KEY, 'X-Goog-FieldMask': FIELDS.map((f) => `places.${f}`).join(',') },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const reason = res.status === 403 ? 'The Google API key is not allowed to use the Places API (New).' : res.status === 429 ? 'Google Places limit reached.' : `Google Places returned ${res.status}.`;
    const err = new Error(reason);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).places || [];
}

const slim = (p) => ({
  id: p.id,
  name: p.displayName?.text || null,
  address: p.formattedAddress || null,
  phone: p.nationalPhoneNumber || null,
  website: p.websiteUri || null,
  rating: p.rating ?? null,
  reviews: p.userRatingCount ?? 0,
  hours: p.regularOpeningHours?.weekdayDescriptions || null,
  status: p.businessStatus || null,
  type: p.primaryTypeDisplayName?.text || null,
  typeId: p.primaryType || null,
  photos: (p.photos || []).length,
  mapsUrl: p.googleMapsUri || null,
  location: p.location || null,
});

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// Finds the business's Google profile and the top local competitors for its main category.
export async function businessProfile(env, client, siteUrl) {
  if (!env.GOOGLE_API_KEY) return { ok: false, notConfigured: true, reason: 'Google Business Profile check needs a GOOGLE_API_KEY with the Places API (New) enabled.' };
  const where = [client.city, client.state || 'MI'].filter(Boolean).join(', ');
  try {
    const found = (await searchText(env, { textQuery: [client.name, client.address, where].filter(Boolean).join(' '), pageSize: 5, regionCode: 'US' })).map(slim);
    const siteHost = host(siteUrl);
    const phone = String(client.phone || '').replace(/\D/g, '').slice(-10);
    const match = found.find((p) => siteHost && host(p.website) === siteHost)
      || found.find((p) => phone && String(p.phone || '').replace(/\D/g, '').slice(-10) === phone)
      || found.find((p) => norm(p.name) === norm(client.name))
      || found.find((p) => norm(p.name).includes(norm(client.name)) || norm(client.name).includes(norm(p.name)));
    let competitors = [];
    const category = match?.type;
    if (category && where) {
      const body = { textQuery: `${category} in ${where}`, pageSize: 8, regionCode: 'US' };
      if (match.location) body.locationBias = { circle: { center: match.location, radius: 25000 } };
      competitors = (await searchText(env, body)).map(slim).filter((p) => p.id !== match.id && p.status !== 'CLOSED_PERMANENTLY').slice(0, 5)
        .map(({ name, rating, reviews, mapsUrl, website }) => ({ name, rating, reviews, mapsUrl, website }));
    }
    return { ok: true, profile: match || null, candidates: match ? [] : found.slice(0, 3).map((p) => p.name), competitors, query: where };
  } catch (e) {
    return { ok: false, reason: e.message || 'Google Places check failed.', status: e.status };
  }
}
