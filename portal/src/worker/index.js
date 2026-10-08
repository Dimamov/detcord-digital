import { Hono } from 'hono';
import { HttpError } from './lib/util.js';
import { loadUser } from './lib/auth.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import clients from './routes/clients.js';
import sales from './routes/sales.js';
import discovery from './routes/discovery.js';
import home from './routes/home.js';
import contracts from './routes/contracts.js';
import billing from './routes/billing.js';
import media from './routes/media.js';
import audits from './routes/audits.js';
import emailDelivery from './routes/email-delivery.js';
import goat from './routes/goat.js';
import inbound, { handleEmail } from './routes/inbound.js';
import meetings from './routes/meetings.js';
import layouts from './routes/layouts.js';
import googleAds from './routes/google-ads.js';
import industries from './routes/industries.js';

const app = new Hono();

app.use('/api/*', async (c, next) => {
  // Cross-site writes are rejected; the session cookie is also SameSite.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Request origin rejected.' }, 403);
    if (!origin && !c.req.path.startsWith('/api/auth/bootstrap')) {
      const site = c.req.header('Sec-Fetch-Site');
      if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: 'Request origin rejected.' }, 403);
    }
  }
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Vary', 'Cookie');
});
app.use('/api/*', loadUser);

app.route('/api', emailDelivery);
app.route('/api', inbound);
app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/clients', clients);
app.route('/api/sales', sales);
app.route('/api', discovery);
app.route('/api', home);
app.route('/api', contracts);
app.route('/api', billing);
app.route('/api', media);
app.route('/api', audits);
app.route('/api', goat);
app.route('/api', meetings);
app.route('/api', layouts);
app.route('/api', googleAds);
app.route('/api', industries);

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error('Unhandled portal error', err?.stack || err);
  return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500);
});

export default {
  async fetch(request, env, ctx) {
    const res = await app.fetch(request, env, ctx);
    const out = new Response(res.body, res);
    out.headers.set('X-Content-Type-Options', 'nosniff');
    // The contract viewer opts in to same-origin framing; everything else stays unframeable.
    if (!out.headers.has('X-Frame-Options')) out.headers.set('X-Frame-Options', 'DENY');
    out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    out.headers.set('Strict-Transport-Security', 'max-age=31536000');
    out.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    return out;
  },
  // GOAT requests sent by email, routed here by Cloudflare Email Routing.
  async email(message, env, ctx) {
    await handleEmail(message, env, ctx);
  },
};
