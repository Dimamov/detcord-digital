# GOAT transcript review and email setup
Chats are stored privately in Cloudflare for 30 days after their last message. The review page requires a runtime secret; nothing is publicly readable.

Cloudflare → Workers & Pages → detcord-digital → Settings → Runtime variables and secrets (Production):
- GOAT_REVIEW_KEY: Secret, a new random password of at least 20 characters. Use this to unlock https://www.detcorddigital.com/goat-review.html. Do not use an API key as the review password.
- RESEND_API_KEY: Secret from your Resend account.
- GOAT_EMAIL_FROM: Variable containing a sender on a domain verified in Resend, e.g. GOAT <goat@your-verified-domain>.
- GOAT_EMAIL_TO: Variable containing your chosen receiving email address.
- GOAT_EMAIL_MODE: optional Variable. Default questions only; set transcript to include full replies.
Save/deploy runtime settings. Never place secrets in wrangler vars, GitHub or screenshots. Keep OPENAI_API_KEY a runtime Secret.

Verify your sending domain in Resend before enabling emails. Open the review page after changing settings; status schedules any pending chats. Start a test chat, wait five minutes without another message, check inbox and the conversation's email status. Resend acceptance means sent; check Resend delivery logs/spam if absent.

A server alarm sends one email after five minutes of inactivity, even if the browser closes. A chat resumed after five minutes becomes a new conversation. Failed sends retry at 15 minutes and one hour (three total attempts), with duplicate protection. Chats continue working if email is unconfigured. Email copies are not removed by the 30-day archive deletion. Review key stays only in page memory; Lock review clears displayed transcripts. No IP addresses are archived. AI errors after validation are saved as failed replies.

Infrastructure: SQLite Durable Object GOAT_ARCHIVE / GoatArchive, provisioned by wrangler migration goat-transcripts-v1. The module and this guide are excluded from static assets.
