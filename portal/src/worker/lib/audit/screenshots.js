// Our own homepage screenshots (Cloudflare Browser Rendering), used when Google PageSpeed returns none,
// for example when its shared no-key limit is reached. Returns PageSpeed-shaped results so the rest of the
// check treats them the same: { mobile: { ok, screenshot }, desktop: { ok, screenshot } }. Never throws.
const VIEWS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1350, height: 940, deviceScaleFactor: 1 },
};
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// Kept on an object so tests can stand in for the browser.
export const launcher = { launch: async (binding) => (await import('@cloudflare/puppeteer')).default.launch(binding) };

export async function ownScreenshots(env, url, wanted = ['mobile', 'desktop']) {
  if (!env.BROWSER || !wanted.length) return { error: env.BROWSER ? null : 'Browser Rendering is not set up.' };
  let browser;
  const out = {};
  try {
    browser = await launcher.launch(env.BROWSER);
    for (const name of wanted) {
      const page = await browser.newPage();
      await page.setViewport(VIEWS[name]);
      if (name === 'mobile') await page.setUserAgent(MOBILE_UA);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
      const b64 = await page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64' });
      out[name] = { ok: true, own: true, screenshot: `data:image/jpeg;base64,${b64}` };
      await page.close();
    }
    return out;
  } catch (e) {
    return { ...out, error: `Our own screenshot failed (${String(e?.message || e).slice(0, 120)}).` };
  } finally {
    try { await browser?.close(); } catch {}
  }
}
