// Detcord service agreement: approved clause language and the document renderer.
// Language comes from the live portal's contract-template.js (Michigan law). Service terms
// marked `review: true` are new for services added to the catalog on 2026-10-08 and need
// legal review before they are relied on; the editor flags them to staff.

export const SERVICE_TERMS = {
  seo: 'Technical audit, agreed fixes, keyword mapping, on-page work and useful content for the pages and quantities specified below. Rankings, indexing and lead volumes are not guaranteed.',
  gbp: 'Management of eligible profiles and locations, listing consistency, approved posts, photos and Q&A at the agreed cadence. Fabricated reviews and deceptive locations are prohibited. Map placement is not guaranteed.',
  'ai-search': 'Content structure, entity consistency and discoverability improvements for the agreed pages and topics. Inclusion in AI answers or search results is not guaranteed.',
  ppc: 'Keyword and audience research, campaign setup, approved tracking, ad copy and static creative, testing and optimization within the approved budget, for the platforms and campaign quantities listed below. Client-owned ad accounts are preferred. Client approves messaging, targeting and budget; budget increases require written approval. Advertising spend is separate unless expressly included. Platform approvals, sales and acquisition costs are not guaranteed.',
  social: 'Content calendar, static posts, publishing and engagement coverage for the platforms, quantities and response coverage listed below. Paid advertising is separately scoped.',
  pr: 'Messaging, announcements, media research and outreach as specified. Earned publication, editorial wording and placements are outside Provider control.',
  competitive: 'Publicly available market and competitor research. Estimates are identified as estimates. Access to competitors’ private accounts is excluded.',
  web: 'Responsive website with the pages, forms, CMS, integrations, revision rounds and launch milestones listed below, plus any agreed funnel analysis and conversion tests. Domains should be registered in Client’s name. Additional pages, redesigns and new features require an approved change order. Experiments depend on sufficient traffic and reliable tracking; conversion increases are not guaranteed. Accessibility targets and testing must be expressly scoped; no blanket certification is promised.',
  'mobile-app': 'PWA, iOS or Android features, supported devices, roles, integrations and deployment channels are limited to the scope below. Client supplies required developer accounts. Store approval and review timing are outside Provider control. Maintenance and new features are separately defined; regulated data requires a separately approved security scope.',
  ecommerce: 'Product feed, shopping campaigns, merchandising recommendations and lifecycle campaigns for the store and products identified below. Third-party store, payment and advertising costs are separate unless included.',
  content: 'Articles, guides, case studies, landing pages and static assets in the quantities, formats and revision rounds listed below. Client verifies claims, permissions and testimonials before publication. Video production and animation are excluded.',
  'custom-crm': 'Modules, roles, workflows, integrations, migration volumes, training and acceptance tests are defined below. Client supplies authorized access and usable data. New functionality is separately scoped. Sensitive or regulated data requires an approved security and compliance addendum.',
  automation: 'Agreed workflows, knowledge sources, escalation rules, integrations, testing and documentation. AI output can be incorrect. Sensitive decisions, commitments and exceptional actions follow Client-approved human-review rules. API and usage costs are separate.',
  analytics: 'Agreed tracking, conversion definitions, attribution configuration and dashboards, with portal reports covering agreed performance measures, work completed and next actions at the stated frequency. Measurement depends on consent, integrations, platform restrictions and data quality. Reports identify material missing data and attribution limitations.',
  hosting: 'Hosting, SSL administration, backups, updates, monitoring and support only at the frequencies, retention periods and response targets listed below. Third-party uninterrupted availability is not guaranteed. Cancellation includes a coordinated export and migration plan.',
  'email-sms': 'Approved campaigns, sequences, segmentation and templates at the volumes listed below. Client supplies necessary permissions for contact lists. Agreed suppression and opt-out controls must be configured. Purchased lists and unapproved outreach are excluded.',
  reputation: 'Review requests, monitoring and responses at the agreed cadence, with escalation of disputed or sensitive reviews. Neither party will fabricate reviews or selectively prevent dissatisfied customers from accessing public review opportunities.',
  referral: 'Agreed referral programs and reactivation audiences, campaigns and incentives. Contact permissions, opt-outs, legal requirements and platform policies apply.',
  'multi-location': 'Coordination for the locations specifically identified below. Location-specific search, reputation, advertising and reporting tasks are assigned expressly and overlapping deliverables are not billed twice.',
  branding: 'Positioning, messaging, copy, logo concepts, visual identity and guidelines in the concept counts, revisions and file formats listed below. Trademark clearance and legal opinions are excluded; Client obtains clearance before adopting a name or mark.',
  'lead-response': 'Agreed channels, qualification, routing, scheduling, missed-inquiry recovery and follow-up sequences. Client approves automation authority and escalation rules; required permissions and usage costs are identified separately.',
  strategy: 'Assessment, roadmap, budget recommendations and vendor coordination at the meeting and hour limits below. Recommendations do not authorize contracts or spending beyond Client-approved limits.',
  'ai-enablement': 'Agreed tools, workflows, training sessions, staff guides and support coverage. People remain responsible for checking AI output. Approved vendors, data handling, human escalation and usage costs are documented. Call recording, voice transcription and regulated decisions are excluded unless separately scoped and legally reviewed.',
};

// New wording for catalog additions without approved language. Flagged for legal review.
export const REVIEW_TERMS = {
  citations: 'Submission and cleanup of business name, address and phone details on the directories listed below. Directory acceptance, removal of third-party data and listing timing are outside Provider control. Paid directory fees are separate unless expressly included.',
  lsa: 'Setup and management of Google Local Services Ads for the service categories and areas listed below, including profile content, budget pacing and lead dispute requests. Google verification, background checks, badge approval and dispute outcomes are decided by Google. Lead charges are paid to Google and are separate unless expressly included.',
  booking: 'Configuration of the scheduling tool, services, availability rules, reminders and website or profile placements listed below. Client keeps its calendar accurate and honors confirmed bookings. Scheduling software subscriptions are separate unless expressly included.',
  accessibility: 'Accessibility review and remediation of the pages, templates and components listed below against the agreed WCAG level. Remediation reduces barriers but is not a legal opinion or a guarantee against claims; no blanket compliance certification is promised. Content and third-party tools added later may need new review.',
};

export const termsFor = (serviceId) => SERVICE_TERMS[serviceId] || REVIEW_TERMS[serviceId] || null;
export const needsReview = (serviceId) => !SERVICE_TERMS[serviceId];

export const GENERAL_TERMS = [
  ['Delivery, approvals and changes', 'Client supplies access, content and feedback within the period specified in this agreement. Client delays and dependencies may move delivery dates; Provider explains material changes. Client has the stated feedback period after a project milestone delivery to approve it or identify specific material departures from scope. Silence alone does not approve a milestone. Provider corrects in-scope departures and resubmits. Extra work requires a written change order describing deliverables, price and schedule impact. Material requiring Client approval will not be published without it.'],
  ['Payment and authority', 'Client pays agreed fees and approved third-party costs by the stated deadline. Ad spend, software, API, messaging, call tracking, app-store and licensed-asset charges are separate unless expressly included. Monthly invoicing does not authorize automatic card or bank charges; separate authorization is required. No unspecified late fee applies. Invoice disputes should identify the disputed amount; undisputed amounts remain payable. Provider may suspend affected services after written notice and 10 days to cure nonpayment, without obstructing Client-owned accounts or data. Any consequences of a pause will be stated before suspension.'],
  ['Term and cancellation', 'One-time projects continue through completion unless terminated. Monthly services run month to month from the stated start date. Either party may cancel an individual monthly service with 30 days’ written notice; unrelated services remain active. No minimum term or early termination fee applies unless expressly stated. Project cancellation requires payment for documented completed work at agreed milestone values or an agreed rate, plus approved noncancelable commitments. Unearned prepaid amounts are refunded within 30 days after reconciliation; deposits are credited against earned fees, not automatically forfeited. Advertising may be paused sooner by written instruction; management fees during notice remain payable only as agreed. Hosting migration is coordinated before shutdown. Either party may terminate a material breach not cured within 15 days after written notice, or immediately to stop unlawful activity or a serious security threat.'],
  ['Ownership, accounts and handoff', 'Client retains its existing materials, domains, data and accounts. After payment for completed custom deliverables, Provider assigns transferable rights in those deliverables. Provider retains preexisting tools, reusable libraries and methods and grants a perpetual license sufficient to use incorporated Provider materials with paid deliverables. Third-party and open-source licenses remain applicable. Within 15 business days after completion or termination, Provider supplies the agreed deliverables, data exports and account-access handoff. Client-owned data and accounts are not withheld over an unrelated fee dispute. Extra migration assistance requires an approved scope. Portfolio use requires Client’s written permission.'],
  ['Confidentiality, privacy and security', 'Each party protects the other’s nonpublic information with reasonable care and uses it only for this engagement, except information lawfully public, independently developed or lawfully received without restrictions. Required disclosure is limited to the legal necessity. Provider processes personal data only for agreed purposes, applies access controls appropriate to scope and promptly notifies Client of a confirmed incident affecting Client data. Approved vendors, retention, exports, deletion and incident contacts are defined in the additional scope. Required data-processing or regulated-data addenda must be completed before collection. Each party remains responsible for its own legal obligations.'],
  ['Performance and responsibility', 'Provider performs with reasonable professional care. Revenue, rankings, leads, AI accuracy and uninterrupted third-party services are not guaranteed. Each party is responsible for its supplied materials, controlled permissions and unlawful or negligent conduct. Except fraud, willful misconduct, confidentiality or data-protection breaches and infringement of the other party’s intellectual-property rights, aggregate liability is limited to fees paid or payable for affected services during the 12 months before the event. Subject to those exceptions and applicable law, indirect and consequential damages are excluded. Earned fees remain payable. These limits are agreed business terms and remain subject to applicable law.'],
  ['Michigan law and disputes', 'Michigan law governs, subject to mandatory applicable law. Parties first attempt good-faith resolution within 30 days after written dispute notice. Unresolved claims may be brought in state or federal courts having jurisdiction in Michigan unless the parties agree to mediation. Urgent relief and nonwaivable rights remain available.'],
  ['Electronic execution and records', 'Each party chooses whether to conduct this transaction electronically. Signers confirm authority and intent to execute the exact presented version. The complete agreement can be reviewed and downloaded before signing and the executed copy remains available afterward. A paper-signing alternative is available on request. Consent to this transaction does not require consent to future electronic transactions. The system records the account, typed signature, consent, timestamp and document hash. Amendments require a new agreement; a signed agreement cannot be silently changed.'],
  ['Entire agreement and notices', 'This agreement, its service schedule and additional scope contain the entire agreement for the selected services. Amendments require both parties’ written approval. Additional scope changes general terms only when expressly identifying the section changed. If a provision is unenforceable, remaining provisions continue as permitted by law. Notices are sent to the designated notice email addresses.'],
];

export const SIGNING_STATEMENT = 'I have reviewed this Agreement and its completed service schedule, consent to electronic execution, confirm my authority to bind the identified business, and intend my typed signature to execute this exact Agreement.';

export function contractTotals(d) {
  const lines = d.services || [];
  const setup = lines.reduce((n, s) => n + (s.setupCents || 0), 0);
  const monthly = lines.reduce((n, s) => n + (s.monthlyCents || 0), 0);
  const deposit = d.depositCents || 0;
  return { setup, monthly, deposit, setupAfterDeposit: Math.max(0, setup - deposit) };
}

// What still blocks sending for signature. Empty array = ready.
export function signingProblems(d) {
  const p = [];
  const need = (v, label) => { if (!String(v ?? '').trim()) p.push(label); };
  need(d.providerName, 'Detcord’s legal business name (Settings → Company)');
  need(d.providerAddress, 'Detcord’s business address (Settings → Company)');
  need(d.providerSigner, 'Who signs for Detcord');
  need(d.clientLegalName, 'Client’s legal business name');
  need(d.clientAddress, 'Client’s address');
  need(d.clientEmail, 'Client’s notice email');
  if (!d.services?.length) p.push('At least one service');
  for (const s of d.services || []) {
    if (s.setupCents == null || s.monthlyCents == null) p.push(`Both prices for ${s.name} (use 0 for none)`);
    if (!String(s.scope || '').trim()) p.push(`Scope for ${s.name}`);
  }
  const t = contractTotals(d);
  if (t.monthly > 0 && !d.monthlyStart) p.push('When monthly billing starts');
  if (t.deposit > t.setup + t.monthly) p.push('Deposit is larger than the first invoice total');
  return p;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => (n == null ? 'Not entered' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100));
const day = (ms) => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Detroit' });
const stamp = (ms) => `${new Date(ms).toLocaleString('en-US', { timeZone: 'America/Detroit', dateStyle: 'long', timeStyle: 'short' })} ET (${new Date(ms).toISOString()})`;

// c: { number, version, title, createdAt, issuedAt, status, data, origin }, signature optional.
// The presented document (no signature) is what gets hashed and frozen when sent.
export function renderContract(c, signature = null) {
  const d = c.data;
  const t = contractTotals(d);
  const banner = signature ? 'Signed agreement' : c.status === 'sent' ? 'Agreement for signature' : 'Draft for review, not ready for signature';
  const attachments = d.attachments || [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(c.title)} | Detcord Digital</title>
<style>
body{font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#17202b;max-width:880px;margin:0 auto;padding:32px 28px;background:#fff}
header{text-align:center;border-bottom:3px solid #f36c26;padding-bottom:18px;margin-bottom:8px}
header img{width:220px;max-width:70%;height:auto}
.banner{display:inline-block;margin:10px 0 0;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${signature ? '#e7f6ec;color:#17723a' : c.status === 'sent' ? '#fff1e8;color:#a43b08' : '#eef0f3;color:#5b6573'}}
h1{font-size:26px;line-height:1.2;margin:12px 0 4px}
.meta{color:#5b6573;font-size:13px}
h2{font-size:18px;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid #e3e7ec}
h3{font-size:16px;margin:18px 0 4px}
p{margin:6px 0;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{text-align:left;border-bottom:1px solid #d9dee5;padding:9px 10px;vertical-align:top}
th{background:#f3f5f8;font-size:13px}
td.n,th.n{text-align:right;white-space:nowrap}
tr.total td{font-weight:700;border-top:2px solid #17202b}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.box{border:1px solid #d9dee5;border-radius:8px;padding:14px 16px}
.att{display:flex;flex-wrap:wrap;gap:10px}.att figure{margin:0;width:160px}.att img{width:160px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #d9dee5}.att figcaption{font-size:12px;color:#5b6573;overflow-wrap:anywhere}
.sig{border:1px solid #b9c4ce;border-radius:8px;padding:14px 16px;margin:10px 0;overflow-wrap:anywhere}
.small{font-size:12px;color:#5b6573}
@media(max-width:620px){body{padding:18px}.parties{grid-template-columns:1fr}th,td{padding:7px}}
@media print{body{padding:0;max-width:none}h2,h3{break-after:avoid}tr,.sig,.box{break-inside:avoid}}
</style></head><body>
<header><img src="${esc(c.origin)}/detcord-logo-transparent.png" alt="Detcord Digital"><br><span class="banner">${banner}</span>
<h1>${esc(c.title)}</h1>
<div class="meta">Agreement ${esc(c.number)} · Version ${esc(c.version)} · Prepared ${esc(day(c.issuedAt || c.createdAt))}</div></header>

<h2>Parties</h2>
<div class="parties">
<div class="box"><strong>Provider</strong><p>${esc(d.providerName || 'Not entered')}, doing business as Detcord Digital
${esc(d.providerAddress || 'Address not entered')}
Notice email: ${esc(d.providerEmail || 'info@detcorddigital.com')}</p></div>
<div class="box"><strong>Client</strong><p>${esc(d.clientLegalName || 'Not entered')}
${esc(d.clientAddress || 'Address not entered')}
Notice email: ${esc(d.clientEmail || 'Not entered')}</p></div>
</div>
<p>The selected services and completed scope establish the work purchased. A blank fee is unresolved and does not mean free or unlimited service. The effective date is the date of the final signature.</p>

<h2>Fee schedule</h2>
<table><thead><tr><th>Service</th><th class="n">One-time</th><th class="n">Monthly</th></tr></thead><tbody>
${(d.services || []).map((s) => `<tr><td>${esc(s.name)}</td><td class="n">${money(s.setupCents)}</td><td class="n">${money(s.monthlyCents)}</td></tr>`).join('')}
<tr class="total"><td>Totals</td><td class="n">${money(t.setup)}</td><td class="n">${money(t.monthly)}/mo</td></tr>
</tbody></table>
<table><tbody>
<tr><td>Deposit due at signing</td><td class="n">${money(t.deposit)}</td></tr>
<tr><td>Remaining one-time balance after deposit</td><td class="n">${money(t.setupAfterDeposit)}</td></tr>
<tr><td>Monthly billing begins</td><td class="n">${esc(d.monthlyStart ? day(Date.parse(d.monthlyStart + 'T12:00:00Z')) : t.monthly ? 'Not entered' : 'No monthly services')}</td></tr>
</tbody></table>
<p>Currency: USD. Overlapping deliverables are assigned once and not billed twice. Deposits are credited against the one-time fees above.
Payment schedule and milestones: ${esc(d.paymentTerms || 'Deposit at signing; remaining one-time fees on completion; monthly fees invoiced each month in advance.')}
Advertising budget and third-party costs: ${esc(d.thirdParty || 'Not included; require written approval before any cost is incurred.')}
Invoices are due ${esc(d.paymentDays ?? 15)} days from the invoice date. Client feedback period: ${esc(d.feedbackDays ?? 10)} business days.</p>

<h2>Purchased services and scope</h2>
${(d.services || []).map((s) => `<h3>${esc(s.name)}</h3><p>${esc(termsFor(s.serviceId) || 'Service terms are set out in the agreed scope below.')}</p><p><strong>Agreed deliverables, quantities, milestones and recurring work:</strong>
${esc(s.scope || 'Not entered; to be agreed before signature.')}</p>`).join('')}

<h2>Additional scope and agreed exceptions</h2>
<p>${esc(d.additional || 'None.')}</p>
${attachments.length ? `<h2>Attached materials</h2><div class="att">${attachments.map((a) => `<figure>${/^image\//.test(a.contentType) ? `<img src="${esc(c.origin)}/api/media/${esc(a.id)}/file" alt="">` : ''}<figcaption>${esc(a.filename)}</figcaption></figure>`).join('')}</div><p class="small">Attached materials are provided for reference and form part of the scope only where the scope above says so.</p>` : ''}

${GENERAL_TERMS.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join('\n')}

<h2>Signatures</h2>
<div class="sig"><strong>DETCORD DIGITAL</strong><p>${c.issuedAt
    ? `Electronic signature: ${esc(d.providerSigner)}
Signed: ${esc(stamp(c.issuedAt))}
${esc(SIGNING_STATEMENT)}`
    : `Authorized representative: ${esc(d.providerSigner || 'Not entered')}
Provider has not signed this draft.`}</p></div>
<div class="sig"><strong>CLIENT</strong><p>${signature
    ? `Electronic signature: ${esc(signature.name)}
Title: ${esc(signature.title)}
Account: ${esc(signature.email)}
Signed: ${esc(stamp(signature.at))}
${esc(signature.consent)}`
    : 'Authorized signer: ____________________\nTitle: ____________________\nSignature: ____________________   Date: ____________'}</p></div>
${signature ? `<h2>Execution record</h2><p class="small">Presented agreement SHA-256: ${esc(signature.documentHash)}
Signature record: ${esc(signature.id)}
Signed from IP ${esc(signature.ip || 'unknown')} using ${esc((signature.userAgent || 'unknown').slice(0, 160))}</p>` : ''}
</body></html>`;
}
