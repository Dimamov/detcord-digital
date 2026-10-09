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
| `ANTHROPIC_API_KEY` | Claude drafts a plan for each GOAT request and the monthly client reports | staff write every plan and report by hand |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN` (`GOOGLE_ADS_DEVELOPER_TOKEN` optional; Google now grants access to the Cloud project) | link requests from Detcord's manager account (MCC 448-262-6468, override with `GOOGLE_ADS_MANAGER_ID`) to client Google Ads accounts; the refresh token belongs to a Google user who can manage the MCC | customer IDs are saved as "Waiting for Google Ads setup"; Settings sends them all once the keys are in |
| `DEEPGRAM_API_KEY` | Transcribes recorded sales meetings (Claude then drafts the notes) | recordings are kept but not transcribed |
| `ZERNIO_API_KEY` | social posting through Zernio: connecting client accounts and publishing approved posts | Social says posting isn't set up; posts can be written and approved but not published |

Add them in Cloudflare under **Workers & Pages → (worker) → Settings → Variables and Secrets** (type Secret).
`CLOVER_API_BASE` is a plain var: sandbox on staging, `https://api.clover.com` in production. Clover's webhook
URL is `<portal URL>/api/webhooks/clover`. **Settings → Payments** shows the Clover state and has a
**Test connection** button. Clover only shows as connected after that test succeeds.

Files are stored in R2 (`MEDIA` binding: `detcord-portal-media-staging` / `detcord-portal-media`). Wrangler
creates the bucket on the first deploy. Later phases add Google OAuth secrets.

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

## Discovery calls

The rep runs the call from a client's **Discovery** tab with the guided script. Answers autosave one request at a time,
and the server merges each save onto the latest stored answers, so overlapping saves never drop an answer.

- **Prefilled answers.** A new discovery (and every reopen, so later forms and checks still land) fills empty questions
  from the client record (name, website, city, industry), the latest submitted intake form, and the latest website
  check (mobile and desktop speed scores, mobile setup, whether a Google profile was found, review count and rating).
  Each shows "Prefilled from …" until the rep confirms or edits it. A prefill never replaces an answer the rep typed or cleared.
- **Recap.** The last step, and a collapsible live panel on wide screens, lists every answer by section as the rep
  types, with "Still to ask", the score preview and likely services. Any answer opens its question. **Copy recap** gives
  plain text; **Send recap to client** drafts an email to copy (nothing is sent). The completed summary includes the recap.
- **Client questionnaire.** **Invite client: report + questionnaire** (Discovery tab, or next to Email/Text on a website
  check) emails or texts the client a portal link (password setup the first time) to `/questionnaire/<client>`, and
  shares the latest website check with them. The questionnaire is an allowlist of client-appropriate questions
  (`src/shared/discovery/questionnaire.js`); rep-only ones such as budget, competing quotes and contract terms are never
  asked or writable there. Client answers fill the open discovery marked "Entered by the client"; once the rep has typed or
  confirmed an answer, a different client answer only shows as a suggestion. Sending the answers gives the rep a task
  and an email. The public pre-call intake link still works for prospects without a portal login.

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

## Social posting

Staff write a post from a client record (**Social** tab): the text (optionally started from a short brief with
**Draft with Claude**, labelled as a Claude draft), photos or videos from the client's shared files, the connected
accounts to post to, and publish now or a scheduled time (Detroit time). A post can be linked to a GOAT request; the
request's timeline then shows what Zernio reported, with links.

1. **Send for approval** shows the client exactly what will go out: text, media, each account and when. Clients approve or
   ask for changes with a note on their **Social** page. An admin can record an approval given outside the portal, only
   with a note ("approved by phone on ..."), which is stored and shown.
2. Approval is bound to a SHA-256 hash of the text, media, accounts and time. If staff change any of them afterwards, the
   approval is cleared and the client approves again.
3. **Publish** (or **Schedule**) checks the hash again on the server, checks with Zernio that the accounts are still
   connected to this client, copies the media to Zernio and creates the post with an `Idempotency-Key` of the post id and
   approved hash, so a retry can't post twice. The status shown is what Zernio reports (publishing, scheduled, published,
   partly published, failed) with per-platform links and errors. It is refreshed when someone opens the post or presses
   **Check status**, at most every 30 seconds. There is no Zernio webhook yet.

Each client gets one Zernio profile, created the first time someone connects an account. Clients connect Facebook,
Instagram, Google Business Profile, LinkedIn and X from their Social page; staff can do it from the client record or
copy a connect link to send. Zernio sends the browser back to the portal, which then reads the accounts from Zernio.
Clients only see posts sent to them, never drafts. **Settings → Integrations** has a Zernio card with **Test connection**;
it shows as connected only after that test passes.

## Monthly reports

Staff pick a month on a client record (**Reports** tab) and press Generate. The portal gathers what it recorded for that
client and month: GOAT requests received and finished (with their done notes and links), website checks and the score
change since the previous check, services started, active and ended, invoices issued and payments received, agreements
signed, meetings (titles and dates; summaries only if staff tick the box, transcripts never), tasks completed, updates
posted and files shared. Claude (when `ANTHROPIC_API_KEY` is set) writes a headline, summary, sections, next month's
focus and notes for the team, using only those facts. It is told that GA4, Search Console and Google Ads results aren't
connected, so traffic, rankings and ad performance never appear. Without Claude, the facts are written out as bullets
for staff to finish by hand. The facts snapshot, Claude's draft and the edited version are all kept.

1. Staff edit every field. Generating again replaces the draft, and asks first if someone edited it.
2. **Share** puts it in the client's portal under **Reports** (printable, "Save as PDF") and can email their portal
   logins a link. If email isn't set up, nothing is claimed as sent and staff get the link to pass on.
3. A shared report can't be edited or regenerated until staff **Unshare** it, which is logged. Clients only see shared
   reports; drafts and other businesses' reports get the same 404 as a missing one. Team notes and facts stay internal.

Admins can draft last month's report for every active client from **Settings → Monthly reports**. It runs a few
clients per request (two with Claude, ten without) to stay inside Workers limits, shows progress, skips clients that
already have a report for that month, and never shares anything.

## Agreements

A new agreement starts from the client's selected services (the default), from an agreement template, or blank.
Admins manage templates in **Settings → Agreement templates** (services, prices, scope, deposit and payment terms)
or with **Save as template** on a draft; templates never hold a client's parties or files, and archived ones can't
start new agreements. Staff can **Duplicate** any agreement into a new draft with a new number (signatures, frozen
documents and hashes are never copied). A client can **Ask for changes** on an agreement waiting for their signature:
the note is logged, shown to staff on the agreement, and emailed to the client's reps and admins when email is set
up. The sent document never changes; staff use **Void and redraft**, which voids it with "Changes requested" and
opens an editable copy. Reps can do that for sent agreements; voiding a signed one stays admin-only. The editor lists
everything that blocks sending, each linked to the field (or to Settings → Company) that fixes it.

## Client self-service

Clients have a **Business** page (`/business`). With access to more than one business, they pick which one at the top,
and every change applies only to that one.

- **Business details:** clients edit phone, public email, website and address. The business name, status and industry
  stay with staff ("ask your Detcord team"). Each change is logged with old and new values in the client's activity.
- **Team logins:** each business has owners (`client_members.is_owner`; migration 0014 made the earliest login of each
  business its owner, and the first login staff add to a business without one becomes its owner). Owners invite
  teammates by name and email (a new client login with the usual one-time setup link, or an existing client login added
  to this business), resend invites, remove teammates and make someone an owner. A business always keeps at least one
  owner. Emails that belong to staff or turned-off logins are refused with the same neutral message. Owners never see a
  setup link, even when email isn't configured; staff do. Invites and resends are limited to 20 a day per business.
  Other teammates see the list read-only. Staff set the owner flag from the client record's **Portal access** tab.
- **Services:** clients see their active services and can **Request a service** from the active catalog (names and
  descriptions only, never prices) with a note. That creates a service request (new, quoted, added, declined), a task
  and an email for each assigned rep (or every admin when nobody is assigned), and an activity entry. Staff update it
  from the **Service requests** card on the client's Overview; marking it added changes nothing else.
- **Agreements:** the agreements sent to the client, linking to the agreement page, with ones waiting for a signature
  highlighted.

On phones, a nav with more than six items shows the first five and a **More** sheet with the rest.

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
