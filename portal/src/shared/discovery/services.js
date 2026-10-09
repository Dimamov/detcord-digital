// Follow-up questionnaires, one per service. Used after the discovery call (or on it, when a
// service clearly fits) to scope the work for a proposal. Keys match service ids in ../services.js.
import { q, opts } from './schema.js';

const yn = (id, text, extra) => q(id, text, 'yesno', extra);

export const SERVICE_MODULES = {
  seo: {
    intro: 'Goal: know which searches make them money, where they stand today, and what is holding the site back.',
    questions: [
      q('seo_keywords', 'What would a customer type into Google to find you? List the top 5 searches.', 'long'),
      q('seo_towns', 'Which towns or neighborhoods should you rank in, in priority order?', 'long'),
      q('seo_pages', 'Does the site have a separate page for each main service and each main town?', 'single', { options: opts('yes|Yes', 'some|Some', 'no|No') }),
      yn('seo_gsc', 'Is Google Search Console set up, and can we get access?'),
      q('seo_history', 'Any past SEO work, penalties, site moves or domain changes?', 'long'),
      q('seo_content_help', 'Can someone on your team review content for accuracy (about 30 minutes a month)?', 'yesno'),
      q('seo_tech', 'What is the site built on (WordPress, Wix, Squarespace, custom) and who hosts it?', 'text'),
      q('seo_expect', 'How soon do you expect to see results? (Set expectations: 3–6 months for real movement.)', 'single', { options: opts('1|Within a month', '3|Within 3 months', '6|6 months is fine', '12|Long-term play') }),
    ],
  },
  gbp: {
    intro: 'Goal: make the Google Business Profile complete, active and winning the map pack.',
    questions: [
      q('gbp_access', 'Who owns the Google Business Profile today? Can you add us as a manager?', 'single', { options: opts('owner|Owner can add us', 'lost|Lost access', 'none|No profile yet', 'multiple|Multiple or duplicate profiles') }),
      q('gbp_type', 'Do customers come to you, or do you go to them?', 'single', { options: opts('storefront|They come to us', 'sab|We go to them', 'both|Both') }),
      q('gbp_categories', 'What primary category is set, and which services should be listed?', 'long'),
      yn('gbp_photos', 'Do you have recent real photos of the team, work, vehicles and location?'),
      q('gbp_posting', 'Should we post offers, updates and project photos weekly?', 'yesno'),
      q('gbp_qa', 'What are the 5 questions customers always ask before buying?', 'long', { hint: 'These become Q&A entries, posts and FAQ content.' }),
      q('gbp_locations', 'How many locations need profiles?', 'number'),
    ],
  },
  citations: {
    intro: 'Goal: consistent business info everywhere so Google trusts the address and phone.',
    questions: [
      q('cit_nap', 'Exact business name, address and phone as you want them shown everywhere', 'long'),
      yn('cit_moved', 'Have you ever changed name, address or phone number?'),
      q('cit_old', 'List any old names, addresses or phone numbers', 'long', { showIf: { id: 'cit_moved', in: [true] } }),
      q('cit_industry_dirs', 'Which industry directories matter in your field (e.g. Angi, Healthgrades, Avvo, Houzz)?', 'long'),
      yn('cit_bbb', 'Are you BBB accredited or members of a chamber of commerce?'),
    ],
  },
  'ai-search': {
    intro: 'Goal: get recommended when customers ask ChatGPT, Google AI Overviews, Gemini or Perplexity.',
    questions: [
      q('ai_prompts', 'What would a customer ask an AI assistant to find a business like yours?', 'long', { placeholder: 'e.g. "best emergency plumber in Troy MI"' }),
      q('ai_current', 'When we asked those questions live, who did the AI recommend?', 'long', { hint: 'Run 3 prompts in ChatGPT and Google before the call; paste results here.' }),
      q('ai_proof', 'What proof can we publish: awards, certifications, years, guarantees, case studies, press?', 'long'),
      yn('ai_faq', 'Is there an FAQ page with detailed answers on the site?'),
      yn('ai_reviews_detail', 'Do your reviews mention specific services and towns?'),
    ],
  },
  ppc: {
    intro: 'Goal: know the target cost per lead, which platforms fit, and how leads will be tracked.',
    questions: [
      q('ppc_platforms', 'Which platforms are you running or interested in?', 'multi', { options: opts('google|Google Search', 'youtube|YouTube', 'meta|Facebook / Instagram', 'tiktok|TikTok', 'linkedin|LinkedIn', 'retargeting|Retargeting') }),
      q('ppc_current_spend', 'Current monthly ad spend (not counting management)', 'money'),
      q('ppc_budget', 'Monthly ad budget you are comfortable testing with', 'money', { hint: 'Ad spend is paid to Google/Meta directly. Management is separate.' }),
      q('ppc_target_cpl', 'What could you afford to pay for one lead and still be happy?', 'money', { hint: 'Work it out together: average job × profit margin × close rate.' }),
      yn('ppc_account_access', 'Do you own your ad accounts (not the old agency)?'),
      q('ppc_offers', 'What offers or promotions can we advertise?', 'long'),
      q('ppc_landing', 'Where should ads send people: homepage, a landing page, a booking page, or a call?', 'single', { options: opts('home|Homepage', 'landing|Dedicated landing page', 'booking|Booking page', 'call|Call-only') }),
      yn('ppc_conversion_tracking', 'Are calls and form fills tracked as conversions today?'),
      q('ppc_exclusions', 'Any services, towns or customer types you do NOT want to pay for?', 'long'),
    ],
  },
  lsa: {
    intro: 'Goal: get Google Guaranteed / Google Screened and manage leads and disputes.',
    questions: [
      yn('lsa_eligible', 'Is your business category eligible for Local Services Ads in your area?', { hint: 'Check in the LSA sign-up flow before the call.' }),
      yn('lsa_running', 'Are you running Local Services Ads now?'),
      q('lsa_docs', 'Do you have license and insurance documents ready for verification?', 'single', { options: opts('yes|Yes', 'partial|Some', 'no|No') }),
      q('lsa_budget', 'Weekly lead budget for LSA', 'money'),
      q('lsa_job_types', 'Which job types do you want leads for, and which should be turned off?', 'long'),
      yn('lsa_answer', 'Can someone answer LSA calls live during business hours? (It affects ranking.)'),
    ],
  },
  social: {
    intro: 'Goal: consistent, on-brand posting the owner does not have to think about.',
    questions: [
      q('social_platforms', 'Which platforms matter to your customers?', 'multi', { options: opts('facebook|Facebook', 'instagram|Instagram', 'x|X', 'tiktok|TikTok', 'linkedin|LinkedIn', 'youtube|YouTube', 'nextdoor|Nextdoor', 'gbp|Google posts') }),
      q('social_frequency', 'How often should we post?', 'single', { options: opts('2wk|2 times a week', '3wk|3 times a week', '5wk|5 times a week', 'daily|Daily') }),
      q('social_content_source', 'Can your team send photos or videos from jobs?', 'single', { options: opts('yes|Yes, regularly', 'sometimes|Sometimes', 'no|No, we need content created') }),
      yn('social_engagement', 'Should we reply to comments and messages on your behalf?'),
      q('social_voice', 'How should the brand sound? (e.g. friendly, expert, funny, no-nonsense)', 'text'),
      q('social_off_limits', 'Anything off-limits (topics, competitors, politics)?', 'long'),
      yn('social_approval', 'Do you want to approve every post before it goes out?', { hint: 'Portal approval flow: client approves in one tap.' }),
    ],
  },
  content: {
    intro: 'Goal: content that answers buyer questions and ranks, written in the owner’s voice.',
    questions: [
      q('content_questions', 'What questions do customers ask before they buy?', 'long'),
      q('content_types', 'What content would help most?', 'multi', { options: opts('service-pages|Service pages', 'location-pages|Town pages', 'blog|Blog articles', 'guides|Buying guides', 'faq|FAQs', 'case-studies|Project stories / case studies', 'newsletter|Newsletter') }),
      q('content_volume', 'How many pieces a month?', 'single', { options: opts('2|2', '4|4', '8|8', 'custom|Custom') }),
      q('content_expert', 'Who can we interview for 20 minutes a month to capture expertise?', 'text'),
      q('content_compliance', 'Any compliance rules on what you can claim (medical, legal, financial)?', 'long'),
    ],
  },
  email: {
    intro: 'Goal: turn the existing customer and lead list into repeat jobs and referrals by email.',
    questions: [
      q('em_list_size', 'How many customer and lead email addresses do you have?', 'text'),
      q('em_list_source', 'Where does the list live?', 'text', { placeholder: 'e.g. Jobber, QuickBooks, Dentrix, spreadsheet' }),
      q('em_campaigns', 'What would you send?', 'multi', { options: opts('newsletter|Newsletter', 'promos|Seasonal promotions', 'reminders|Maintenance or appointment reminders', 'reviews|Review requests', 'winback|Win-back for inactive customers', 'referral|Referral asks', 'birthday|Birthday / anniversary') }),
      q('em_frequency', 'How often?', 'single', { options: opts('weekly|Weekly', 'biweekly|Every 2 weeks', 'monthly|Monthly') }),
      q('em_tool', 'Do you use an email tool already (Mailchimp, Constant Contact...)?', 'text'),
    ],
  },
  sms: {
    intro: 'Goal: reach opted-in customers by text for reminders, offers and win-backs, with consent on record.',
    questions: [
      q('sms_list_size', 'How many customer mobile numbers do you have?', 'text'),
      yn('em_consent', 'Did customers agree to receive marketing texts? (Required for SMS marketing.)'),
      q('sms_campaigns', 'What would you text?', 'multi', { options: opts('reminders|Appointment or service reminders', 'promos|Offers and promotions', 'reviews|Review requests', 'winback|Win-back for inactive customers', 'alerts|Weather or schedule alerts') }),
      q('sms_tool', 'Do you text customers from any tool today (Podium, your booking software, a cell phone)?', 'text'),
    ],
  },
  'lead-response': {
    intro: 'Goal: stop losing leads to voicemail and slow follow-up.',
    questions: [
      q('lr_call_volume', 'About how many inbound calls a week?', 'number'),
      q('lr_phone_system', 'What phone system do you use?', 'text', { placeholder: 'e.g. cell phone, RingCentral, Google Voice, office line' }),
      yn('lr_call_tracking', 'Do you track which ad or page each call came from?'),
      q('lr_features', 'Which would help most?', 'multi', { options: opts('tracking|Call tracking by source', 'textback|Missed-call text-back', 'recording|Call recording and scoring', 'ai-receptionist|AI receptionist after hours', 'chat|Website chat that books', 'routing|Route calls to the right person') }),
      q('lr_hours', 'What hours should a live person or AI answer?', 'text'),
      q('lr_booking_rules', 'What should an AI receptionist be allowed to do: answer questions, take details, book appointments?', 'multi', { options: opts('answer|Answer common questions', 'capture|Capture contact details', 'book|Book appointments', 'quote|Give price ranges', 'transfer|Transfer urgent calls') }),
    ],
  },
  booking: {
    intro: 'Goal: let customers book or request a quote without a phone call.',
    questions: [
      q('bk_current', 'How do customers book today?', 'single', { options: opts('phone|Phone only', 'form|Web form', 'online|Online booking', 'mixed|Mix') }),
      q('bk_software', 'Does your scheduling software have online booking we can connect?', 'text'),
      q('bk_rules', 'Rules for bookings (service area, job types, deposits, lead time)?', 'long'),
      q('bk_where', 'Where should booking show up?', 'multi', { options: opts('website|Website', 'gbp|Google Business Profile', 'facebook|Facebook / Instagram', 'ads|Ads') }),
      yn('bk_deposit', 'Do you want to collect a deposit at booking?'),
    ],
  },
  referral: {
    intro: 'Goal: systematic referrals and reactivation of past customers.',
    questions: [
      q('ref_share', 'What share of new business comes from referrals today?', 'single', { options: opts('lt20|Under 20%', '20-50|20–50%', '50+|Over 50%', 'unknown|Not sure') }),
      q('ref_incentive', 'Would you offer a referral reward? What kind?', 'text'),
      q('ref_dormant', 'How many past customers haven’t bought in 12+ months?', 'text'),
      q('ref_partners', 'Which other businesses send you work, or could?', 'long', { hint: 'e.g. realtors for inspectors, dentists for orthodontists, contractors for each other.' }),
      q('ref_offer', 'What offer would bring a past customer back?', 'long'),
    ],
  },
  web: {
    intro: 'Goal: scope the site, its job (calls, bookings, quotes), and who supplies what.',
    questions: [
      q('web_type', 'What do you need?', 'single', { options: opts('new|New website', 'redesign|Redesign', 'landing|Landing pages only', 'fixes|Fixes and conversion improvements') }),
      q('web_goal', 'What is the #1 action a visitor should take?', 'single', { options: opts('call|Call', 'quote|Request a quote', 'book|Book online', 'buy|Buy online', 'visit|Visit the location') }),
      q('web_pages', 'Pages needed (services, towns, about, reviews, financing, careers, gallery)?', 'long'),
      q('web_examples', 'Websites you like (any industry) and why', 'long'),
      q('web_assets', 'Do you have a logo, photos, and written content ready?', 'multi', { options: opts('logo|Logo', 'photos|Professional photos', 'content|Written content', 'none|None of these') }),
      q('web_integrations', 'Integrations needed (booking, CRM, payments, chat, financing)?', 'long'),
      q('web_domain', 'Who owns the domain and hosting login?', 'text'),
      q('web_deadline', 'Is there a date it must be live by?', 'text'),
      q('web_cro_issues', 'What do you think stops visitors from contacting you today?', 'long', { showIf: { id: 'web_type', in: ['redesign', 'fixes'] } }),
    ],
  },
  hosting: {
    intro: 'Goal: someone keeps the website safe, fast and updated.',
    questions: [
      q('host_platform', 'Platform and current host', 'text'),
      q('host_issues', 'Any downtime, hacks, slowness or broken features lately?', 'long'),
      yn('host_backups', 'Are there backups you could restore from today?'),
      q('host_edits', 'How many small edits per month do you expect?', 'single', { options: opts('few|1–2', 'some|3–5', 'many|More than 5') }),
      q('host_access', 'Who has admin logins today?', 'text'),
    ],
  },
  accessibility: {
    intro: 'Goal: make the site usable for everyone and reduce ADA demand-letter risk.',
    questions: [
      yn('acc_letter', 'Have you received a demand letter or complaint about website accessibility?'),
      q('acc_platform', 'Website platform and number of pages', 'text'),
      yn('acc_forms', 'Does the site have forms, booking, or checkout?'),
      yn('acc_pdf', 'Do you publish PDFs (menus, forms, brochures)?'),
      q('acc_audience', 'Do you serve many older or disabled customers (healthcare, senior services)?', 'yesno'),
    ],
  },
  'mobile-app': {
    intro: 'Goal: confirm an app is the right tool and scope version 1.',
    questions: [
      q('app_users', 'Who uses the app: customers, staff, or both?', 'single', { options: opts('customers|Customers', 'staff|Staff', 'both|Both') }),
      q('app_jobs', 'What are the 3 things it must do on day one?', 'long'),
      q('app_why', 'Why an app rather than a mobile website?', 'long', { hint: 'If there is no repeat use (weekly or more), a mobile site is usually better value. Say so.' }),
      q('app_platforms', 'Platforms', 'multi', { options: opts('ios|iPhone', 'android|Android', 'web|Web') }),
      q('app_integrations', 'Systems it must connect to', 'long'),
      q('app_budget_time', 'Budget range and launch date', 'text'),
    ],
  },
  'custom-crm': {
    intro: 'Goal: understand the workflow well enough to decide custom vs off-the-shelf.',
    questions: [
      q('crm_current', 'What do you use today to track customers and jobs?', 'text'),
      q('crm_pain', 'What does your current system make hard?', 'long'),
      q('crm_workflow', 'Walk me through a customer from first call to paid invoice', 'long'),
      q('crm_users', 'How many people would use it, and in what roles?', 'text'),
      q('crm_integrations', 'Must connect to (accounting, phone, email, scheduling, payments)', 'long'),
      q('crm_reports', 'What numbers do you wish you could see every Monday morning?', 'long'),
      q('crm_why_custom', 'Have you tried off-the-shelf CRMs? Why didn’t they fit?', 'long', { hint: 'Custom only wins when the workflow is unusual or per-seat costs are high. Be honest.' }),
    ],
  },
  ecommerce: {
    intro: 'Goal: scope the store, product feed and paid shopping campaigns.',
    questions: [
      q('ec_platform', 'Store platform', 'single', { options: opts('shopify|Shopify', 'woo|WooCommerce', 'square|Square Online', 'bigcommerce|BigCommerce', 'none|No store yet', 'other|Other') }),
      q('ec_products', 'How many products, and which are best sellers by profit?', 'long'),
      q('ec_aov', 'Average order value', 'money'),
      q('ec_margin', 'Typical gross margin', 'text'),
      q('ec_channels', 'Selling channels', 'multi', { options: opts('site|Own site', 'amazon|Amazon', 'etsy|Etsy', 'retail|Retail store', 'wholesale|Wholesale') }),
      yn('ec_abandon', 'Is abandoned-cart email set up?'),
      q('ec_shipping', 'Shipping area and any restrictions', 'text'),
    ],
  },
  branding: {
    intro: 'Goal: scope identity and messaging work.',
    questions: [
      q('br_need', 'What do you need?', 'multi', { options: opts('logo|New logo', 'refresh|Refresh existing logo', 'guide|Brand guidelines', 'messaging|Messaging and tagline', 'copy|Website or ad copy', 'print|Business cards, trucks, signs') }),
      q('br_why', 'Why now? What feels wrong about the current brand?', 'long'),
      q('br_customers', 'Three words customers should feel about you', 'text'),
      q('br_like', 'Brands you admire (any industry)', 'long'),
      q('br_keep', 'Anything that must stay (colors, name, mascot)?', 'long'),
      q('br_applications', 'Where will it be used (trucks, uniforms, signs, website, social)?', 'long'),
    ],
  },
  reputation: {
    intro: 'Goal: more 5-star reviews, faster replies, and a plan for negative reviews.',
    questions: [
      q('rep_platforms', 'Where do customers leave reviews?', 'multi', { options: opts('google|Google', 'facebook|Facebook', 'yelp|Yelp', 'bbb|BBB', 'industry|Industry sites', 'other|Other') }),
      q('rep_volume', 'How many customers do you serve per month?', 'number', { hint: 'Review goal is roughly 10–20% of monthly customers.' }),
      q('rep_negative', 'Any negative reviews or a past incident hurting you?', 'long'),
      yn('rep_reply', 'Should we draft replies to every review for your approval?'),
      q('rep_ask_moment', 'When is the customer happiest (best moment to ask)?', 'text'),
      q('rep_contact_data', 'Do you capture a mobile number for every customer?', 'yesno'),
    ],
  },
  pr: {
    intro: 'Goal: find stories worth telling and the outlets that matter locally.',
    questions: [
      q('pr_goal', 'What do you want PR to achieve?', 'multi', { options: opts('trust|Credibility and trust', 'seo|Links and SEO', 'recruit|Recruiting', 'launch|Launch something', 'crisis|Handle a problem') }),
      q('pr_stories', 'Milestones, community work, unusual projects, or expert opinions you could share', 'long'),
      q('pr_spokesperson', 'Who can speak to reporters?', 'text'),
      q('pr_outlets', 'Local outlets, podcasts or associations you’d love to be in', 'long'),
      q('pr_awards', 'Awards you could apply for', 'long'),
    ],
  },
  analytics: {
    intro: 'Goal: know which marketing produces revenue.',
    questions: [
      q('an_tools', 'What tracking exists today?', 'multi', { options: opts('ga4|Google Analytics 4', 'gtm|Tag Manager', 'calltracking|Call tracking', 'crm|CRM with source field', 'none|Nothing') }),
      q('an_questions', 'What questions do you want answered every month?', 'long'),
      q('an_revenue', 'Can we connect leads to actual revenue (CRM or invoicing system)?', 'text'),
      q('an_report_freq', 'How often do you want a report?', 'single', { options: opts('weekly|Weekly', 'monthly|Monthly', 'quarterly|Quarterly') }),
      q('an_audience', 'Who reads the report?', 'text'),
    ],
  },
  automation: {
    intro: 'Goal: automate follow-ups, reminders and handoffs.',
    questions: [
      q('au_repetitive', 'What tasks does your team repeat every day or week?', 'long'),
      q('au_followups', 'Which follow-ups get forgotten most?', 'multi', { options: opts('new-leads|New leads', 'quotes|Unsold quotes', 'reviews|Review requests', 'reminders|Appointment reminders', 'invoices|Unpaid invoices', 'rebook|Rebooking / maintenance') }),
      q('au_systems', 'Systems involved (CRM, email, calendar, accounting, forms)', 'long'),
      q('au_owner', 'Who will own the automations on your side?', 'text'),
    ],
  },
  strategy: {
    intro: 'Goal: scope a senior marketing lead (fractional CMO) engagement.',
    questions: [
      q('st_scope', 'What do you need from a marketing leader?', 'multi', { options: opts('plan|Annual plan and budget', 'manage|Manage vendors and staff', 'launch|Launch a product, service or location', 'pricing|Positioning and pricing', 'board|Report to partners or investors') }),
      q('st_team', 'Who is on the marketing team today (staff, freelancers, agencies)?', 'long'),
      q('st_cadence', 'How often should we meet?', 'single', { options: opts('weekly|Weekly', 'biweekly|Every 2 weeks', 'monthly|Monthly') }),
      q('st_revenue', 'Annual revenue range (helps size the plan)', 'single', { options: opts('lt500k|Under $500k', '500k-2m|$500k–$2M', '2m-10m|$2M–$10M', '10m+|Over $10M') }),
      q('st_decision', 'What big decision is coming in the next 6 months?', 'long'),
    ],
  },
  'multi-location': {
    intro: 'Goal: consistent marketing with local performance per location.',
    questions: [
      q('ml_count', 'How many locations, and how many are planned?', 'text'),
      q('ml_control', 'Who controls marketing: corporate, each location, or both?', 'single', { options: opts('central|Central', 'local|Each location', 'both|Both') }),
      q('ml_gbp', 'Does every location have its own Google profile, page and phone number?', 'single', { options: opts('yes|Yes', 'some|Some', 'no|No') }),
      q('ml_reporting', 'Do you need a report per location?', 'yesno'),
      q('ml_differences', 'Do services, hours or pricing differ by location?', 'long'),
    ],
  },
  competitive: {
    intro: 'Goal: pick the competitors to track and what to watch.',
    questions: [
      q('ci_competitors', 'Top competitors to track (names and websites)', 'long'),
      q('ci_watch', 'What do you want to know?', 'multi', { options: opts('rank|Where they rank', 'ads|Their ads and offers', 'reviews|Their reviews', 'pricing|Pricing', 'hiring|Hiring / growth', 'social|Social activity') }),
      q('ci_freq', 'How often?', 'single', { options: opts('monthly|Monthly', 'quarterly|Quarterly') }),
    ],
  },
  'ai-enablement': {
    intro: 'Goal: find where AI saves the office real hours, safely.',
    questions: [
      q('aie_tasks', 'Which office tasks take the most time?', 'multi', { options: opts('replies|Replying to emails and messages', 'quotes|Writing quotes and estimates', 'scheduling|Scheduling', 'content|Writing marketing content', 'reviews|Responding to reviews', 'docs|Documents and SOPs', 'phone|Answering the phone') }),
      q('aie_tools', 'Is anyone using ChatGPT, Claude or Copilot already?', 'text'),
      q('aie_people', 'How many people would be trained?', 'number'),
      q('aie_data', 'Any sensitive data rules (patient, legal, financial)?', 'long'),
    ],
  },
};
