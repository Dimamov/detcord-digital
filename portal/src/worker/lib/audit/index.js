// Runs one audit end to end: crawl, Google PageSpeed (mobile and desktop) and the Google profile, in parallel.
import { crawl, checkTarget, Budget } from './crawl.js';
import { pageSpeed, businessProfile } from './google.js';
import { evaluate, CATEGORIES } from './checks.js';
import { now } from '../util.js';

export { CATEGORIES, checkTarget };

// Free Workers plans allow 50 subrequests per request; Google calls use 4 of them.
const CRAWL_BUDGET = 40;

export async function runAudit(env, { auditId, client, url }) {
  const allowPrivate = env.AUDIT_ALLOW_PRIVATE === '1';
  const target = checkTarget(url, { allowPrivate });
  try {
    if (target.error) throw new Error(target.error);
    const [site, mobile, desktop, gbp] = await Promise.all([
      crawl(target.url, { allowPrivate, budget: new Budget(CRAWL_BUDGET) }),
      allowPrivate && env.AUDIT_SKIP_GOOGLE === '1' ? { ok: false, reason: 'Skipped in local development.' } : pageSpeed(env, target.url.href, 'mobile'),
      allowPrivate && env.AUDIT_SKIP_GOOGLE === '1' ? { ok: false, reason: 'Skipped in local development.' } : pageSpeed(env, target.url.href, 'desktop'),
      businessProfile(env, client, target.url.href),
    ]);
    const report = evaluate({ client, crawl: site, mobile, desktop, gbp });
    const shots = {};
    for (const [name, r] of [['mobile', mobile], ['desktop', desktop]]) {
      const m = r?.ok && /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(r.screenshot || '');
      if (!m || !env.MEDIA) continue;
      const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
      await env.MEDIA.put(`audits/${auditId}/${name}`, bytes, { httpMetadata: { contentType: `image/${m[1]}` } });
      shots[name] = true;
    }
    const result = {
      ...report,
      url: site.home?.url || target.url.href,
      checkedAt: now(),
      pagesChecked: 1 + (site.pages || []).filter((p) => p.parsed).length,
      speed: {
        mobile: mobile?.ok ? { scores: mobile.scores, lab: mobile.lab, field: mobile.field } : null,
        desktop: desktop?.ok ? { scores: desktop.scores, lab: desktop.lab } : null,
      },
      google: gbp?.ok ? { profile: gbp.profile, competitors: gbp.competitors } : null,
      shots,
      facts: site.reachable ? {
        title: site.home.parsed.title, description: site.home.parsed.description, h1: site.home.parsed.headings.h1.slice(0, 3),
        words: site.home.parsed.words, https: site.https, sitemap: site.sitemap, responseMs: site.home.ms, linksChecked: site.links?.checked || 0,
        schema: site.home.parsed.schemaTypes,
      } : null,
    };
    await env.DB.prepare("UPDATE audits SET status='done', score=?, result=?, url=?, finished_at=? WHERE id=?")
      .bind(report.overall, JSON.stringify(result), result.url, now(), auditId).run();
    return { ok: true };
  } catch (e) {
    console.error('Audit failed', auditId, e?.stack || e);
    await env.DB.prepare("UPDATE audits SET status='failed', error=?, finished_at=? WHERE id=?")
      .bind(String(e?.message || 'The audit could not finish.').slice(0, 300), now(), auditId).run();
    return { ok: false };
  }
}
