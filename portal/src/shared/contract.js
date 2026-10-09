// Detcord service agreement: approved clause language and the document renderer.
// Language comes from the live portal's contract-template.js (Michigan law). Service terms
// in REVIEW_TERMS are for services added to the catalog on 2026-10-08; they were reviewed with the
// 2026-10 terms, and the editor flags them to staff on version 1 agreements.
//
// Terms versions: every agreement stores `termsVersion` in its data. Version 1 (also when the field is
// missing) is the language every agreement sent before 2026-10 references, so its text below must never change.
// '2026-10' is the revision researched against Michigan and federal law (agreement-review-michigan.md in the
// project files) and the version every new agreement uses. A draft can be moved between versions in the editor.

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

// Wording for catalog additions after version 1. Flagged to staff on version 1 agreements.
export const REVIEW_TERMS = {
  citations: 'Submission and cleanup of business name, address and phone details on the directories listed below. Directory acceptance, removal of third-party data and listing timing are outside Provider control. Paid directory fees are separate unless expressly included.',
  lsa: 'Setup and management of Google Local Services Ads for the service categories and areas listed below, including profile content, budget pacing and lead dispute requests. Google verification, background checks, badge approval and dispute outcomes are decided by Google. Lead charges are paid to Google and are separate unless expressly included.',
  booking: 'Configuration of the scheduling tool, services, availability rules, reminders and website or profile placements listed below. Client keeps its calendar accurate and honors confirmed bookings. Scheduling software subscriptions are separate unless expressly included.',
  accessibility: 'Accessibility review and remediation of the pages, templates and components listed below against the agreed WCAG level. Remediation reduces barriers but is not a legal opinion or a guarantee against claims; no blanket compliance certification is promised. Content and third-party tools added later may need new review.',
};

export const termsFor = (serviceId, version = TERMS_V1) => (version === TERMS_2026_10
  ? SERVICE_TERMS_2026_10[serviceId] || SERVICE_TERMS[serviceId] || REVIEW_TERMS_2026_10[serviceId] || REVIEW_TERMS[serviceId]
  : SERVICE_TERMS[serviceId] || REVIEW_TERMS[serviceId]) || null;
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

// ---- terms versions -----------------------------------------------------------

export const TERMS_V1 = '1';
export const TERMS_2026_10 = '2026-10';
export const TERMS_VERSIONS = { [TERMS_V1]: 'Version 1 (original)', [TERMS_2026_10]: 'Version 2026-10 (current)' };
export const TERMS_FOR_NEW = TERMS_2026_10;
export const termsVersionOf = (d) => (d?.termsVersion === TERMS_2026_10 ? TERMS_2026_10 : TERMS_V1);

// Contract length for monthly services. 0 = month to month (the version 1 behavior).
export const TERM_MONTHS = [0, 3, 6, 9, 12];
export const MAX_TERM_DISCOUNT = 50;
const termMonthsOf = (d) => (TERM_MONTHS.includes(Number(d.termMonths)) ? Number(d.termMonths) : 0);

// Early termination of a fixed term: an admin setting. The owner chose 50% of the remaining monthly fees
// as the default (2026-10); the other options stay selectable. Wording appears only in the 2026-10
// terms and only for fixed terms; the setting is frozen into the agreement when sent.
export const DEFAULT_EARLY_TERMINATION = 'half-remaining';
export const EARLY_TERMINATION = {
  'repay-discount': {
    label: 'No fee, repay discount received',
    text: 'Client may end a fixed-term monthly service before the term ends with 30 days’ written notice. No early termination fee applies, but Client repays any term discount it received on that service through the end of the notice period.',
  },
  'half-remaining': {
    label: '50% of remaining monthly fees',
    text: 'Client may end a fixed-term monthly service before the term ends with 30 days’ written notice. Client pays that service’s monthly fees during the notice period and an early termination payment equal to 50% of its remaining monthly fees, after any term discount, for the rest of the term. The parties agree this payment is a reasonable estimate of Provider’s losses from reserved staff time and discounted pricing, which are difficult to calculate, and is not a penalty.',
  },
  'all-remaining': {
    label: 'All remaining monthly fees',
    text: 'Client may end a fixed-term monthly service before the term ends with 30 days’ written notice and payment of that service’s monthly fees, after any term discount, for the rest of the term. The parties agree this payment is a reasonable estimate of Provider’s losses from reserved staff time and discounted pricing, which are difficult to calculate, and is not a penalty.',
  },
  'notice-only': {
    label: 'Notice only, no fee',
    text: 'Client may end a fixed-term monthly service before the term ends with 30 days’ written notice. No early termination fee applies and no term discount is repaid.',
  },
};
const earlyTerminationOf = (d) => EARLY_TERMINATION[d.earlyTermination] || EARLY_TERMINATION[DEFAULT_EARLY_TERMINATION];

const pctText = (n) => `${Number(n)}%`;
const termSentence = (d) => {
  const months = termMonthsOf(d);
  const pct = Number(d.termDiscountPct) || 0;
  return `${months} months starting on the monthly billing start date${pct ? `, at monthly fees that include the ${pctText(pct)} term discount shown in the fee schedule` : ''}`;
};

// Version 1 has no term section of its own: a fixed term is added as additional scope that names the
// section it changes, as version 1's "Entire agreement" section requires. It adds no early termination fee.
export function v1TermClause(d) {
  if (!termMonthsOf(d)) return '';
  return `Change to “Term and cancellation”: the monthly services in this agreement have a minimum term of ${termSentence(d)}. After the minimum term, monthly services continue month to month and either party may cancel a monthly service with 30 days’ written notice. This agreement does not renew into a new fixed term.`;
}

// Version 2026-10: the sources for each change are in agreement-review-michigan.md.
export const SERVICE_TERMS_2026_10 = {
  ppc: 'Keyword and audience research, campaign setup, approved tracking, ad copy and static creative, testing and optimization within the approved budget, for the platforms and campaign quantities listed below. Client-owned ad accounts are preferred; Client is the advertiser of record and accepts each platform’s advertising terms. Client approves messaging, targeting and budget; budget increases require written approval. Advertising spend is separate unless expressly included and is handled under “Advertising spend and third-party platforms”. Platform approvals, sales and acquisition costs are not guaranteed.',
  web: 'Responsive website with the pages, forms, CMS, integrations, revision rounds and launch milestones listed below, plus any agreed funnel analysis and conversion tests. Domains should be registered in Client’s name. Additional pages, redesigns and new features require an approved change order. Experiments depend on sufficient traffic and reliable tracking; conversion increases are not guaranteed. Accessibility work is included only where the scope names it and is handled under “Accessibility”.',
  content: 'Articles, guides, case studies, landing pages and static assets in the quantities, formats and revision rounds listed below. AI-assisted drafts are reviewed by a person before delivery, as described under “AI tools and generated content”. Client verifies claims, permissions and testimonials before publication. Video production and animation are excluded.',
  automation: 'Agreed workflows, knowledge sources, escalation rules, integrations, testing and documentation. AI output can be incorrect and is handled under “AI tools and generated content”. Customer-facing assistants say they are automated when asked and wherever the law requires. Sensitive decisions, commitments and exceptional actions follow Client-approved human-review rules. API and usage costs are separate.',
  'email-sms': 'Approved campaigns, sequences, segmentation and templates at the volumes listed below, sent under “Email, text message and phone marketing”. Client supplies contact lists with the permissions the law requires and keeps the consent records. Opt-out and suppression controls are configured before the first send. Purchased, rented or scraped lists and unapproved outreach are excluded.',
  reputation: 'Review requests, monitoring and responses at the agreed cadence, with escalation of disputed or sensitive reviews. Neither party will write, buy or reward fake reviews or reviews conditioned on a positive rating, post undisclosed reviews by owners or staff, or selectively prevent dissatisfied customers from accessing public review opportunities. Review responses do not reveal customers’ private information.',
};
export const REVIEW_TERMS_2026_10 = {
  accessibility: 'Accessibility review and remediation of the pages, templates and components listed below against the agreed WCAG version and level, handled under “Accessibility”. Remediation reduces barriers but is not a legal opinion or a guarantee against claims; no compliance certification is promised. Content and third-party tools added later may need new review.',
};

export const SIGNING_STATEMENT_2026_10 = 'I have reviewed this Agreement, including its fee schedule, service schedule and general terms. I agree to sign it electronically, confirm that I am authorized to bind the business named as Client, and intend my typed signature to sign this exact Agreement.';
export const signingStatementFor = (d) => (termsVersionOf(d) === TERMS_2026_10 ? SIGNING_STATEMENT_2026_10 : SIGNING_STATEMENT);

// Sections whose wording depends on the agreement are functions of its data.
export const GENERAL_TERMS_2026_10 = [
  ['Delivery, approvals and changes', 'Client supplies access, content and feedback within the feedback period stated in the fee schedule. Client delays and missing dependencies move delivery dates by a reasonable amount; Provider explains material schedule changes in writing. After each project milestone delivery, Client has the feedback period to approve it or identify specific material departures from the agreed scope. Silence alone does not approve a milestone, but publishing or using a deliverable in Client’s business approves it. Provider corrects in-scope departures and resubmits. Extra work requires a written change order describing deliverables, price and schedule impact. Material requiring Client approval is not published without it.'],
  ['Fees, invoices, late payment and taxes', 'Client pays agreed fees and approved third-party costs by the invoice due date stated in the fee schedule. Monthly fees are invoiced in advance unless the payment schedule says otherwise. Monthly invoicing does not authorize automatic card or bank charges; that needs a separate written authorization. If Client disputes an invoice in good faith, Client identifies the disputed amount and the reason in writing before the due date and pays the undisputed amount, and the parties work to resolve the dispute within 30 days. Undisputed amounts not paid within 15 days after the due date accrue simple interest at 7% per year, or the highest rate the law allows if that is lower, from the due date until paid. No other late fee applies. Provider may suspend affected services after written notice and 10 days to cure nonpayment, without blocking access to Client-owned accounts or data, and states the consequences of the pause before it starts. Fees do not include sales, use or similar taxes. If any part of the work is taxable, for example prewritten software or licenses resold to Client, Provider lists the tax separately on the invoice and Client pays it. Each party pays its own income and payroll taxes.'],
  ['Advertising spend and third-party platforms', 'Advertising spend, software, API, messaging, call tracking, app-store, domain and licensed-asset charges are separate from Provider’s fees unless the fee schedule expressly includes them. Where possible, ad spend is charged by the platform directly to Client’s payment method in a Client-owned account. Provider pays third-party costs for Client only with written approval and is reimbursed at cost unless a markup is stated. Provider does not exceed an approved budget without Client’s written approval; normal platform pacing can cause small daily variations, and Provider corrects material overspend promptly. Client is the advertiser of record and accepts each platform’s terms and policies. Platforms decide ad approvals, account suspensions, pricing, reporting and policy changes; Provider is not responsible for those decisions but helps Client respond to them. Credits and refunds that platforms issue for ad spend belong to Client.'],
  ['Term, renewal and cancellation', (d) => `${termMonthsOf(d)
    ? `Monthly services have an initial term of ${termSentence(d)}. ${earlyTerminationOf(d).text} Early termination amounts do not apply when Client ends a service for Provider’s uncured material breach or under “Force majeure”. After the initial term, monthly services continue month to month at the same monthly fees, and either party may cancel a monthly service with 30 days’ written notice. This agreement never renews into a new fixed term automatically; a new fixed term needs a new signed agreement.`
    : 'Monthly services run month to month from the monthly billing start date. Either party may cancel an individual monthly service with 30 days’ written notice; other services remain active. No minimum term or early termination fee applies.'} One-time projects continue through completion unless terminated. Project cancellation requires payment for documented completed work at agreed milestone values or an agreed rate, plus approved noncancelable commitments. Unearned prepaid amounts are refunded within 30 days after reconciliation; deposits are credited against earned fees, not automatically forfeited. Advertising may be paused sooner by written instruction; management fees during the notice period remain payable. Hosting migration is coordinated before shutdown. Either party may terminate this agreement or an affected service if the other party commits a material breach and does not cure it within 15 days after written notice, or immediately to stop unlawful activity or a serious security threat. Fees for work performed through the termination date remain payable.`],
  ['Ownership, licenses, accounts and handoff', 'Client keeps ownership of its existing materials, trademarks, domains, data and accounts (“Client Materials”) and lets Provider use them only to perform this agreement. Client confirms it has the rights needed for the Client Materials it supplies. When Client has paid for a custom deliverable, Provider assigns to Client its rights in that deliverable; before payment, Client may use delivered work under a temporary license that ends if this agreement ends for nonpayment. Provider keeps its preexisting tools, templates, code libraries, know-how and methods, and grants Client a perpetual, nonexclusive, royalty-free license to use any of them included in paid deliverables, as part of those deliverables. Stock assets, fonts, plugins, open-source code and other third-party materials remain subject to their own licenses, which Provider identifies on request. Within 15 business days after completion or termination, Provider supplies the agreed deliverables, data exports and account-access handoff. Client-owned data and accounts are not withheld over an unrelated fee dispute. Extra migration help requires an approved scope. Provider may show Client’s name or work in its portfolio only with Client’s written permission.'],
  ['AI tools and generated content', 'Provider may use artificial intelligence tools to help research, draft, edit, design, code or analyze. A person at Provider reviews AI-assisted work before it is delivered, and Client approves content before it is published. Provider does not enter Client’s confidential information or personal data into AI tools that may use it for training or that are not approved vendors. AI output can be inaccurate or resemble existing material, and copyright protection for content generated mainly by AI may be limited; Provider assigns whatever rights it has in that output but does not promise it is protected by copyright. Provider does not create fake reviews, testimonials, endorsements or people. Where a law or platform rule requires AI content to be labeled, such as Michigan’s disclosure rule for AI in paid political advertising, it is labeled as required; Client tells Provider about disclosure rules specific to its industry. Client may ask in writing that AI tools not be used for specific work.'],
  ['Email, text message and phone marketing', 'When Provider sends email, text or call campaigns for Client, Client is the sender and advertiser and is responsible for having the permissions the law requires for every contact Client supplies or collects, including prior express written consent for automated marketing texts and calls, and for keeping records of that consent. Purchased, rented or scraped lists are not used. Provider configures and honors unsubscribe, opt-out and suppression controls, includes the sender identification, accurate subject lines and postal address that commercial email requires, processes opt-outs it receives within 10 business days, and schedules marketing texts and calls only between 8 a.m. and 9 p.m. in the recipient’s time zone. Client promptly forwards opt-out and do-not-call requests it receives. Campaigns for products or services minors may not legally buy, such as alcohol, tobacco, cannabis or gambling, need a separate written plan for Michigan’s Children’s Protection Registry before any message is sent. Provider may pause or decline a send it reasonably believes would break the law, and tells Client why.'],
  ['Accessibility', 'Accessibility work covers only the pages, templates, components and WCAG version and level named in the scope. Provider tests with automated tools and manual checks as scoped. Accessibility work reduces barriers but is not a legal opinion or a certification and does not guarantee that no complaint or claim will be made. Content, plugins, widgets and third-party tools added after delivery may need new review. Accessibility overlay tools alone are not represented as making a site conformant. Client remains responsible for its own legal obligations, including any that apply to it as a public entity or government contractor.'],
  ['Confidentiality, data protection and security', 'Each party protects the other’s nonpublic information with at least reasonable care, uses it only for this agreement and shares it only with personnel and approved vendors who need it and are bound by similar duties. This does not cover information that is lawfully public, independently developed or lawfully received without restrictions. A party required by law to disclose information discloses only what is required and, where allowed, tells the other party first. These duties last during this agreement and for 3 years afterward, and for trade secrets for as long as they remain trade secrets. Client owns the personal data of its customers and contacts that Provider handles. Provider processes it only to perform this agreement and on Client’s documented instructions, protects it with reasonable administrative, technical and physical safeguards, including access controls and multi-factor sign-in on systems that hold it, and does not sell it. If Provider discovers a security breach affecting Client data, Provider notifies Client without unreasonable delay and within 72 hours after confirming it, shares what it knows, and cooperates with Client’s investigation and any notices Client must give. As the data owner, Client decides on and sends notices to affected individuals and agencies unless the parties agree otherwise in writing; Provider pays the reasonable cost of notices required because of its breach of this section. At the end of this agreement, or on request, Provider returns Client data and then destroys remaining copies so they cannot be read or reconstructed, except copies the law requires it to keep or that remain in routine backups until overwritten, which stay protected. Required data-processing, health-data or other regulated-data addenda are completed before such data is collected.'],
  ['Performance and warranties', 'Provider performs with reasonable professional care and skill consistent with industry practice. Revenue, rankings, traffic, leads, conversions, ad approvals, AI accuracy and uninterrupted third-party services are not guaranteed. If a deliverable does not meet the agreed scope, Client tells Provider within 30 days after delivery and Provider corrects it at no extra charge; if Provider cannot, Client receives a refund of the fees paid for that deliverable. Client is responsible for the accuracy and lawfulness of the claims, offers, prices, licenses and permissions it supplies or approves. Except as stated in this agreement, neither party gives any other warranty, express or implied, to the extent the law allows.'],
  ['Indemnities', 'Provider defends Client against third-party claims that a deliverable created by Provider infringes that third party’s U.S. intellectual-property rights, and pays resulting judgments and approved settlements. This does not cover Client Materials, third-party materials Client selected, changes made by others, or uses outside the agreed scope. Client defends Provider against third-party claims arising from Client Materials; Client’s products, services, offers and approved claims; Client’s contact lists and consent records; and Client instructions that Provider followed after raising a written concern, and pays resulting judgments and approved settlements. The party asking for defense gives prompt written notice, lets the other party control the defense and cooperates at the other party’s expense. Neither party settles a claim in a way that admits fault for, or imposes duties on, the other without its written consent.'],
  ['Limits of liability', 'Neither party is liable for lost profits, lost revenue, or indirect, special, incidental, consequential or punitive damages, even if told they were possible. Each party’s total liability under this agreement is limited to the fees paid or payable for the affected services in the 12 months before the event giving rise to the claim. For breach of “Confidentiality, data protection and security”, the limit is two times that amount. These limits do not apply to fraud, willful misconduct, a party’s defense obligations under “Indemnities”, or Client’s obligation to pay earned fees and approved costs. The parties agree these limits are a fair allocation of risk reflected in the fees, and they apply to the fullest extent the law allows.'],
  ['Michigan law, venue and disputes', (d) => `Michigan law governs this agreement, without regard to conflict-of-law rules. Before filing a claim, a party gives written notice of the dispute and the parties try in good faith to resolve it for 30 days; they may agree to nonbinding mediation in Michigan. Any lawsuit is brought only in the state courts for ${String(d.venueCounty || '').trim() || '[county not set]'} County, Michigan, or the United States District Court for the district that includes that county, and each party consents to those courts’ jurisdiction. Either party may ask a court for urgent relief to protect confidential information, intellectual property or data at any time. A claim arising from this agreement must be filed within 2 years after it accrues, unless the law does not allow that shorter period. In an action to collect undisputed overdue amounts, the court may award the prevailing party its reasonable attorney fees and costs.`],
  ['Force majeure', 'Neither party is responsible for a delay or failure caused by events beyond its reasonable control, such as natural disasters, severe weather, utility, internet or platform outages, cyberattacks that reasonable security would not have prevented, labor disputes not involving its own staff, war, epidemics or government action. The affected party notifies the other promptly and resumes performance as soon as practical. This does not excuse paying for work already performed. If an event stops a service for more than 30 days, either party may cancel that service by written notice without any early termination amount, and prepaid fees for the unperformed period are refunded.'],
  ['Independent contractor, subcontractors and assignment', 'Provider is an independent contractor and controls how, when and where it performs the work. This agreement creates no employment, partnership, joint-venture or agency relationship, and neither party may bind the other, except that Provider may spend approved budgets in Client’s advertising accounts. Each party is responsible for its own personnel, wages, benefits, taxes and insurance. Provider may use qualified subcontractors bound by confidentiality duties at least as protective as this agreement and remains responsible for their work; subcontractors who handle personal data are listed as approved vendors. Neither party may assign this agreement without the other’s written consent, which will not be unreasonably withheld, except to a successor in a merger or sale of substantially all of the related business, with written notice. Provider may assign its right to receive payment.'],
  ['Non-solicitation', 'During this agreement and for 12 months after it ends, neither party will directly solicit for employment or engagement any employee or individual contractor of the other party who worked on Client’s account, without the other party’s written consent. General job postings, and hiring someone who applies on their own, are not solicitation. This section does not limit any individual’s right to work where they choose, and no fee is owed for a hire.'],
  ['Electronic signatures and records', 'The parties agree to sign this agreement electronically under the Michigan Uniform Electronic Transactions Act and the federal E-SIGN Act. Each party chooses whether to conduct this transaction electronically, and a paper-signing alternative is available on request. Signers confirm their authority and intent to sign the exact presented version. The complete agreement can be reviewed and downloaded before signing, and the executed copy stays available in the portal; each party should keep its own copy. Agreeing to this transaction electronically does not require agreeing to other electronic transactions. The system records the account, typed signature, consent, timestamp, IP address and a fingerprint (hash) of the document. Provider keeps the executed agreement in a form that accurately reflects it and can be reproduced for at least 7 years after it ends. A signed agreement cannot be silently changed; amendments require a new signed agreement.'],
  ['Notices', 'Notices under this agreement are given in writing by email to the notice addresses in the Parties section, or by mail or courier to the party’s address. An emailed notice is effective when sent unless the sender receives a delivery failure, in which case it is sent again by mail. Notices of breach, termination or a legal claim are clearly marked as notices. Portal messages and chats are not formal notices. Either party may change its notice address by notice.'],
  ['Entire agreement, order of precedence and survival', 'This agreement, its fee schedule, service schedule and additional scope are the entire agreement for the selected services and replace earlier proposals and discussions about them. If they conflict, additional scope that expressly names the section it changes controls, then the service schedule, then these general terms. Amendments require both parties’ written approval. A waiver applies only if it is in writing. If a provision is unenforceable, it is limited to the extent necessary and the rest continues. Payment obligations, ownership and licenses, confidentiality and data duties, indemnities, limits of liability, disputes, non-solicitation and any other terms that by their nature should continue survive the end of this agreement.'],
];

// General terms as printed for an agreement: [heading, text] pairs.
export function generalTermsFor(d) {
  if (termsVersionOf(d) !== TERMS_2026_10) return GENERAL_TERMS;
  return GENERAL_TERMS_2026_10.map(([h, p]) => [h, typeof p === 'function' ? p(d) : p]);
}

// Monthly figures: `monthly` is the sum of listed monthly prices; the term discount applies only to fixed terms.
export function contractTotals(d) {
  const lines = d.services || [];
  const setup = lines.reduce((n, s) => n + (s.setupCents || 0), 0);
  const monthly = lines.reduce((n, s) => n + (s.monthlyCents || 0), 0);
  const deposit = d.depositCents || 0;
  const termMonths = termMonthsOf(d);
  const discountPct = termMonths ? Math.min(MAX_TERM_DISCOUNT, Math.max(0, Number(d.termDiscountPct) || 0)) : 0;
  const monthlyDiscount = Math.round((monthly * discountPct) / 100);
  const monthlyNet = monthly - monthlyDiscount;
  return {
    setup, monthly, deposit, setupAfterDeposit: Math.max(0, setup - deposit),
    termMonths, discountPct, monthlyDiscount, monthlyNet, termValue: termMonths ? setup + monthlyNet * termMonths : null,
  };
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
  if (t.deposit > t.setup + t.monthlyNet) p.push('Deposit is larger than the first invoice total');
  const months = Number(d.termMonths || 0);
  const pct = Number(d.termDiscountPct || 0);
  if (!TERM_MONTHS.includes(months)) p.push('Term: month to month, or 3, 6, 9 or 12 months');
  if (months && !t.monthly) p.push('A fixed term needs at least one monthly fee');
  if (!(pct >= 0 && pct <= MAX_TERM_DISCOUNT)) p.push(`Term discount between 0 and ${MAX_TERM_DISCOUNT}%`);
  else if (pct > 0 && !months) p.push('A term discount needs a fixed term');
  if (termsVersionOf(d) === TERMS_2026_10 && !String(d.venueCounty ?? '').trim()) p.push('Michigan county for disputes (Settings → Company)');
  return p;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => (n == null ? 'Not entered' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100));
const day = (ms) => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Detroit' });
const stamp = (ms) => `${new Date(ms).toLocaleString('en-US', { timeZone: 'America/Detroit', dateStyle: 'long', timeStyle: 'short' })} ET (${new Date(ms).toISOString()})`;

// Term rows for the fee schedule. Empty for a month-to-month version 1 agreement, which keeps its
// document byte-identical to the one rendered before terms versions existed.
function termRows(d, t, revised) {
  if (!t.termMonths && !revised) return '';
  const rows = [['Term', t.termMonths ? `${t.termMonths} months from the monthly billing start date, then month to month` : 'Month to month']];
  if (t.monthlyDiscount) rows.push([`Term discount (${pctText(t.discountPct)} of monthly fees)`, `−${money(t.monthlyDiscount)}/mo`], ['Monthly fees after discount', `${money(t.monthlyNet)}/mo`]);
  if (t.termMonths) rows.push([`Contract value for the term (one-time fees plus ${t.termMonths} months of monthly fees)`, money(t.termValue)]);
  return rows.map(([k, v]) => `\n<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join('');
}

// c: { number, version, title, createdAt, issuedAt, status, data, origin }, signature optional.
// The presented document (no signature) is what gets hashed and frozen when sent.
export function renderContract(c, signature = null) {
  const d = c.data;
  const t = contractTotals(d);
  const version = termsVersionOf(d);
  const revised = version === TERMS_2026_10;
  const statement = signingStatementFor(d);
  const v1Term = revised ? '' : v1TermClause(d);
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
<div class="meta">Agreement ${esc(c.number)} · Version ${esc(c.version)}${revised ? ` · Terms ${esc(version)}` : ''} · Prepared ${esc(day(c.issuedAt || c.createdAt))}</div></header>

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
<tr><td>Monthly billing begins</td><td class="n">${esc(d.monthlyStart ? day(Date.parse(d.monthlyStart + 'T12:00:00Z')) : t.monthly ? 'Not entered' : 'No monthly services')}</td></tr>${termRows(d, t, revised)}
</tbody></table>
<p>Currency: USD. Overlapping deliverables are assigned once and not billed twice. Deposits are credited against the one-time fees above.
Payment schedule and milestones: ${esc(d.paymentTerms || 'Deposit at signing; remaining one-time fees on completion; monthly fees invoiced each month in advance.')}
Advertising budget and third-party costs: ${esc(d.thirdParty || 'Not included; require written approval before any cost is incurred.')}
Invoices are due ${esc(d.paymentDays ?? 15)} days from the invoice date. Client feedback period: ${esc(d.feedbackDays ?? 10)} business days.</p>

<h2>Purchased services and scope</h2>
${(d.services || []).map((s) => `<h3>${esc(s.name)}</h3><p>${esc(termsFor(s.serviceId, version) || 'Service terms are set out in the agreed scope below.')}</p><p><strong>Agreed deliverables, quantities, milestones and recurring work:</strong>
${esc(s.scope || 'Not entered; to be agreed before signature.')}</p>`).join('')}

<h2>Additional scope and agreed exceptions</h2>
${v1Term ? `<p>${esc(v1Term)}</p>${d.additional ? `\n<p>${esc(d.additional)}</p>` : ''}` : `<p>${esc(d.additional || 'None.')}</p>`}
${attachments.length ? `<h2>Attached materials</h2><div class="att">${attachments.map((a) => `<figure>${/^image\//.test(a.contentType) ? `<img src="${esc(c.origin)}/api/media/${esc(a.id)}/file" alt="">` : ''}<figcaption>${esc(a.filename)}</figcaption></figure>`).join('')}</div><p class="small">Attached materials are provided for reference and form part of the scope only where the scope above says so.</p>` : ''}

${generalTermsFor(d).map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join('\n')}

<h2>Signatures</h2>
<div class="sig"><strong>DETCORD DIGITAL</strong><p>${c.issuedAt
    ? `Electronic signature: ${esc(d.providerSigner)}
Signed: ${esc(stamp(c.issuedAt))}
${esc(statement)}`
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
