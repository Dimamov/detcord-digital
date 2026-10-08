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

Add them in Cloudflare under **Workers & Pages → (worker) → Settings → Variables and Secrets** (type Secret).
`CLOVER_API_BASE` is a plain var: sandbox on staging, `https://api.clover.com` in production. Clover's webhook
URL is `<portal URL>/api/webhooks/clover`. **Settings → Payments** shows the Clover state and has a
**Test connection** button. Clover only shows as connected after that test succeeds.

Files are stored in R2 (`MEDIA` binding: `detcord-portal-media-staging` / `detcord-portal-media`). Wrangler
creates the bucket on the first deploy. Later phases add Twilio, Anthropic, Google and Zernio secrets.

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
