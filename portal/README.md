# Detcord Digital portal

The client and sales portal, planned for portal.detcorddigital.com. It runs as its own Cloudflare Worker
(`detcord-portal`), separate from the public website, so working on it never touches the live site.

- **API:** Hono on Workers (`src/worker`), with D1 for data (`migrations`).
- **App:** Preact + Vite single-page app (`src/app`), served as static assets by the same Worker.
- **Shared:** the service catalog and the discovery engine (`src/shared`), used by both the API and the app.

## Run it locally

```sh
cd portal
npm install --legacy-peer-deps
npx wrangler d1 migrations apply detcord-portal --local
echo "BOOTSTRAP_TOKEN=$(openssl rand -hex 24)" > .dev.vars
npm run dev                      # builds the app, serves on http://localhost:8787
npm test                         # API and permission tests
```

## Create the first admin

There is no sign-up page. The first admin is created once per environment with a secret bootstrap token,
which must be at least 24 characters long.

```sh
npx wrangler secret put BOOTSTRAP_TOKEN --env staging      # paste a long random value
curl -X POST https://<worker-host>/api/auth/bootstrap \
  -H "Authorization: Bearer <that value>" -H "Content-Type: application/json" \
  -d '{"email":"info@detcorddigital.com","name":"Your name"}'
```

The response includes a one-time `setupUrl`, valid for 24 hours, to set the password. Once an admin exists,
the endpoint refuses to run again. After that, every other user is invited from **Team**.

## Environments

| Environment | Worker | Database | URL |
| --- | --- | --- | --- |
| staging | `detcord-portal-staging` | `detcord-portal-staging` | workers.dev |
| production (later) | `detcord-portal` | `detcord-portal` | portal.detcorddigital.com, after DNS is approved |

The GitHub Action `.github/workflows/portal-staging.yml` tests every change. On pushes to `portal-v2`, it also
deploys staging and applies migrations. It skips the deploy until the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets exist. Wrangler creates the D1 database on the first deploy.

## Secrets (Worker secrets, never in the repo)

| Secret | Needed for | Without it |
| --- | --- | --- |
| `BOOTSTRAP_TOKEN` | creating the first admin | bootstrap returns 404 |
| `RESEND_API_KEY` | invite, reset, agreement, invoice and receipt emails | admins get a link to share by hand; no receipts |
| `CLOVER_MERCHANT_ID`, `CLOVER_PRIVATE_TOKEN`, `CLOVER_WEBHOOK_SECRET` | online invoice payments (Clover Hosted Checkout) | invoices show "online payment not set up"; admins can record manual payments |
| `GOOGLE_API_KEY` | website checks: Google PageSpeed and the Google Business Profile lookup (Places API (New)) | the speed test runs only within Google's shared quota; the Google profile check is skipped and the report says so |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_MESSAGING_SERVICE_SID` | texting website check reports | Text says texting isn't set up; staff get the portal link to pass on |

Add them in Cloudflare under **Workers & Pages → (worker) → Settings → Variables and Secrets** (type Secret).
`CLOVER_API_BASE` is a plain var: sandbox on staging, `https://api.clover.com` in production. Clover's webhook
URL is `<portal URL>/api/webhooks/clover`. **Settings → Payments** shows the Clover state and has a
**Test connection** button. Clover only shows as connected after that test succeeds.

Files are stored in R2 (`MEDIA` binding: `detcord-portal-media-staging` / `detcord-portal-media`). Wrangler
creates the bucket on the first deploy. Later phases add Anthropic, Google OAuth and Zernio secrets.

## Website checks

From a client's **Website check** tab (or "Create client and run check" on the new client form), staff run a check that
crawls the homepage and up to six key pages, robots.txt, the sitemap and a sample of links and images, runs Google
PageSpeed on mobile and desktop, and looks up the Google Business Profile and the top nearby competitors. It produces
scored findings in four areas (search visibility, local search and Google profile, mobile and customer experience, speed
security and site health), each with what was found, why it matters, how to fix it, and the matching Detcord service.

Staff can hide findings and add a note, then press **Email** or **Text**. The message carries a link into the
customer's portal: the first time, a one-time password setup link (7 days) that creates their client login and opens the
report; after that, a sign-in link to `/reports/<id>`. Customers only see checks that were sent to them. Texting requires
confirming the customer agreed to it. If email or texting isn't connected, nothing is claimed as sent and staff get the
link to pass on. The check stays within the free plan's 50 subrequests per request. For local testing against a site on your machine, run
`npx wrangler dev --env staging --var AUDIT_ALLOW_PRIVATE:1 --var AUDIT_SKIP_GOOGLE:1`; production refuses private addresses.

## Security rules the code enforces

- Every API route checks the role and the client scope on the server. A rep sees only assigned clients,
  and a client sees only its own record and shared notes. "Not yours" and "missing" both return 404.
- The session cookie is `__Host-`, Secure, HttpOnly and SameSite=Lax. Requests that change data must come
  from the same origin.
- Invite and reset links are single-use and hashed at rest. Sending a new link cancels the old one.
- API responses are `no-store` and `noindex`.
- Clients only see agreements after they are sent, and only see invoices after they are issued. Files marked
  internal are invisible to clients, and they get the same 404 as a missing file.
- Sending an agreement freezes the document and stores its SHA-256. A signature must match that hash, and a
  database trigger blocks any change to a signed agreement.
- Invoices are marked paid only by Clover's signed webhook (HMAC-SHA256, `Clover-Signature`) or by an admin
  recording a manual payment. Repeated webhooks are recorded once.
