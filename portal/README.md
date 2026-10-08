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
| production | `detcord-portal` | `detcord-portal` | portal.detcorddigital.com |

The GitHub Action `.github/workflows/portal-staging.yml` tests every change. On pushes to any branch other than `main`, it also
deploys staging and applies migrations. It skips the deploy until the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets exist. Wrangler creates the D1 database on the first deploy.

`.github/workflows/portal-production.yml` deploys production when portal changes land on `main` (or when run by
hand). It tests, applies migrations to `detcord-portal`, then deploys the Worker and its custom domain. Production
secrets are set separately on the `detcord-portal` Worker; it never shares staging's database, files or keys.

## Secrets (Worker secrets, never in the repo)

| Secret | Needed for | Without it |
| --- | --- | --- |
| `BOOTSTRAP_TOKEN` | creating the first admin | bootstrap returns 404 |
| `RESEND_API_KEY` | invite, reset, agreement, invoice and receipt emails | admins get a link to share by hand; no receipts |
| `CLOVER_MERCHANT_ID`, `CLOVER_PRIVATE_TOKEN`, `CLOVER_WEBHOOK_SECRET` | online invoice payments (Clover Hosted Checkout) | invoices show "online payment not set up"; admins can record manual payments |
| `GOOGLE_API_KEY` | website checks: Google PageSpeed and the Google Business Profile lookup (Places API (New)) | the speed test runs only within Google's shared quota; the Google profile check is skipped and the report says so |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_MESSAGING_SERVICE_SID` | texting website check reports and GOAT replies | Text says texting isn't set up; staff get the portal link to pass on |
| `TWILIO_AUTH_TOKEN` | verifying incoming GOAT texts (Twilio signs webhooks with the auth token) | the text webhook answers 503 and no texts are accepted |
| `ANTHROPIC_API_KEY` | Claude drafts a plan for each GOAT request | staff write every plan by hand |
| `DEEPGRAM_API_KEY` | Transcribes recorded sales meetings (Claude then drafts the notes) | recordings are kept but not transcribed |

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

## GOAT Command

Clients ask for work in the portal (**Ask the GOAT**), by email to the GOAT address, or by text. All three become the
same request: original message, attachments, sender, channel and times are kept.

1. Claude drafts a plan (when `ANTHROPIC_API_KEY` is set), or staff write one. The client sees exactly what will be done.
2. The client approves that plan in the portal, or replies YES by text when exactly one plan is waiting. Approval is bound
   to a hash of the plan; if staff change it afterwards, it goes back to the client for approval.
3. The Detcord team does the work and marks it done with a note, link or screenshots, or explains why it can't be done.
   Nothing is applied to a client's website, Google profile or social accounts automatically yet, and the UI says so.

Senders are matched only to client portal logins and client contacts. Unknown numbers are asked once for their name and
business; the answer is stored as a claim, and an admin confirms the sender (which saves them as a contact) before
anything happens. Emails that fail DMARC are held the same way. Twilio retries and repeated emails are deduplicated by
message ID.

Setup: texts need the Twilio number's incoming-message webhook set to `https://<portal>/api/webhooks/twilio`. Email needs
a Cloudflare Email Routing rule that sends the GOAT address to this Worker (`Send to a Worker` → `detcord-portal`).

## Recorded meetings

Staff record an in-person sales meeting from a client record (**Meetings** tab) in the browser, or upload a recording.
Recording can't start until the rep ticks that everyone agreed to be recorded; the rep and the time are saved with it.
Michigan legal review: the consent wording on that checkbox and whether to also mention recording in agreements.

1. The audio is streamed into R2 (`meetings/<client>/<id>`, up to 95 MB) and sent to Deepgram (nova-3, speaker labels).
   Deepgram posts the transcript back to `/api/webhooks/deepgram/<id>` with a one-time token; nothing else is accepted.
2. Claude drafts a summary, pain points, goals, budget, timeline, objections, next steps, recommended services,
   discovery answers (with quotes) and a follow-up email draft. It is told not to invent anything that wasn't said.
3. The rep ticks what to keep and presses **Save to CRM**: an internal note, tasks, and a discovery prefilled with the
   chosen answers. Nothing is saved or sent before that, and the follow-up email is only a draft to copy.

Meetings are staff only. The recording can be deleted on its own (the transcript stays) or with the whole meeting.

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


## Email delivery alerts (staging)

New sends appear in the admin dashboard as Accepted until Resend confirms delivery.
The dashboard records delivered, delayed, bounced, failed and suppressed outcomes,
including the rejection reason. Failure alerts go to EMAIL_ALERT_TO (staging:
dmitriymovsesyan@gmail.com). Alert emails are plain text and do not alert on their
own failures. Bodies and account setup links are never stored in delivery logs.

To activate delivery events, create a webhook in the business Resend account:
- Endpoint: https://detcord-portal-staging.dmitriymovsesyan.workers.dev/api/webhooks/resend
- Events: email.sent, email.delivered, email.delivery_delayed, email.bounced,
  email.failed, email.suppressed
- Copy its signing secret directly to the staging Worker secret RESEND_WEBHOOK_SECRET.
  Never put it in Git, chat or email.

Webhook signatures are verified before use, with a five-minute timestamp window.
Duplicate events and late accepted events do not duplicate alerts or overwrite
terminal delivery states. Resend retries the webhook if the admin alert cannot be
accepted. Delivery means accepted by the recipient server, not necessarily inbox
placement. Historical sends before tracking was installed are not backfilled.

Admins can select “Send without header image (delivery test)” in a report email
send dialog. This removes the image only; normal emails retain the logo.
