// Industry add-ons: asked after the master interview's business section when an industry is chosen.
// Each has industry-specific questions, what to listen for, the services that usually fit first,
// and Michigan-specific angles. No statistics are claimed here; reps should look up live data.
import { q, opts } from './schema.js';

const yn = (id, text, extra) => q(id, text, 'yesno', extra);
const job = (id, text) => q(id, text, 'long');

export const INDUSTRY_GROUPS = [
  { id: 'home', name: 'Home services' },
  { id: 'health', name: 'Health and wellness' },
  { id: 'pro', name: 'Professional services' },
  { id: 'local', name: 'Retail, auto and hospitality' },
];

// Questions that most home-service trades share, reused below.
const trade = (p) => [
  q(`${p}_emergency`, 'What share of your work is emergency vs planned?', 'single', { options: opts('mostly-emergency|Mostly emergency', 'mixed|Mixed', 'mostly-planned|Mostly planned') }),
  q(`${p}_res_comm`, 'Residential, commercial, or both?', 'single', { options: opts('res|Residential', 'comm|Commercial', 'both|Both') }),
  q(`${p}_trucks`, 'How many trucks or crews are running?', 'number'),
  q(`${p}_fsm`, 'Which field-service software do you use?', 'single', { options: opts('servicetitan|ServiceTitan', 'jobber|Jobber', 'housecall|Housecall Pro', 'fieldedge|FieldEdge', 'other|Other', 'none|None / paper') }),
  yn(`${p}_financing`, 'Do you offer financing on bigger jobs?'),
  yn(`${p}_membership`, 'Do you sell maintenance plans or memberships?'),
];

export const INDUSTRIES = [
  // ---------------- Home services ----------------
  {
    id: 'plumbing', name: 'Plumbers', group: 'home',
    keyServices: ['lsa', 'gbp', 'seo', 'lead-response', 'ppc', 'reputation'],
    questions: [...trade('plb'), job('plb_jobs', 'Which jobs do you want more of: water heaters, drains, sewer lines, repipes, remodels?')],
    listenFor: ['Emergency calls missed after hours (biggest leak for plumbers).', 'Paying for Angi/HomeAdvisor leads that are shared with competitors.', 'Water heater and sewer replacements are the high-ticket jobs worth targeting.'],
    michigan: 'Frozen and burst pipes January–February and spring sump-pump failures drive emergency spikes; have campaigns and pages ready before the first deep freeze.',
  },
  {
    id: 'hvac', name: 'HVAC', group: 'home',
    keyServices: ['lsa', 'ppc', 'seo', 'email', 'lead-response', 'booking'],
    questions: [...trade('hvac'), job('hvac_jobs', 'Which do you want more of: furnace and AC replacements, repairs, tune-ups, ductless, commercial?'), yn('hvac_rebates', 'Do you promote utility rebates (DTE / Consumers Energy) or federal tax credits?')],
    listenFor: ['Replacement installs are the profit; tune-ups feed them. Ask how many tune-up customers become installs.', 'Maintenance plan members are the best email/SMS list.', 'Shoulder seasons (spring and fall) are slow; that is when to push tune-ups.'],
    michigan: 'Furnace no-heat calls peak with the first cold snap; AC peaks with summer heat waves. Utility rebate programs from DTE and Consumers Energy are strong ad hooks.',
  },
  {
    id: 'electrical', name: 'Electricians', group: 'home',
    keyServices: ['lsa', 'gbp', 'seo', 'ppc', 'reputation'],
    questions: [...trade('el'), job('el_jobs', 'Which jobs do you want more of: panel upgrades, EV chargers, generators, rewiring, commercial?'), yn('el_generators', 'Do you sell and install standby generators?')],
    listenFor: ['EV charger and generator installs are high-value and searchable.', 'Licensing and insurance are trust signals to feature.'],
    michigan: 'Storm outages drive generator demand; launch generator campaigns in early fall before ice-storm season.',
  },
  {
    id: 'roofing', name: 'Roofers', group: 'home',
    keyServices: ['seo', 'ppc', 'lsa', 'web', 'reputation', 'lead-response'],
    questions: [
      q('roof_mix', 'What share is insurance claims vs retail replacements vs repairs?', 'text'),
      q('roof_materials', 'Materials you install', 'multi', { options: opts('asphalt|Asphalt shingle', 'metal|Metal', 'flat|Flat / commercial', 'slate-tile|Slate / tile') }),
      q('roof_crews', 'How many crews and installs per week at capacity?', 'text'),
      yn('roof_certified', 'Are you manufacturer-certified (GAF, Owens Corning, CertainTeed)?'),
      yn('roof_financing', 'Do you offer financing?'),
      yn('roof_storm', 'Do you chase storm work, and do you want to?'),
    ],
    listenFor: ['Average roof replacement is a large ticket; even a few extra jobs pay for marketing.', 'Storm-chaser competition hurts trust; local reviews and certifications win.', 'Slow winter: pre-book spring jobs with fall inspections.'],
    michigan: 'Hail and wind events create sudden demand; winter limits installs, so fill the spring calendar from November onward.',
  },
  {
    id: 'general-contractor', name: 'General contractors and remodelers', group: 'home',
    keyServices: ['web', 'seo', 'social', 'reputation', 'content', 'ppc'],
    questions: [
      q('gc_projects', 'Which projects do you want more of?', 'multi', { options: opts('kitchen|Kitchens', 'bath|Bathrooms', 'basement|Basements', 'additions|Additions', 'whole-home|Whole-home remodels', 'new-build|New construction', 'commercial|Commercial build-outs') }),
      q('gc_min_project', 'Smallest project you’ll take', 'money'),
      q('gc_backlog', 'How many weeks out are you booked?', 'number'),
      yn('gc_portfolio', 'Do you have before/after photos of recent projects?'),
      yn('gc_design', 'Do you offer design services in-house?'),
      q('gc_lead_quality', 'What share of estimates are with tire-kickers or way under budget?', 'text'),
    ],
    listenFor: ['Lead quality matters more than volume: qualify on budget on the website.', 'Portfolio and reviews close remodel deals; a gallery and project stories are must-haves.'],
    michigan: 'Basement finishing is a strong Michigan niche; exterior work compresses into April–November.',
  },
  {
    id: 'landscaping', name: 'Landscaping and lawn care', group: 'home',
    keyServices: ['gbp', 'seo', 'email', 'social', 'booking', 'referral'],
    questions: [
      q('ls_services', 'What do you offer?', 'multi', { options: opts('maintenance|Lawn maintenance', 'design-build|Design / build', 'hardscape|Hardscape and patios', 'irrigation|Irrigation', 'lighting|Landscape lighting', 'snow|Snow removal') }),
      yn('ls_recurring', 'Are most customers on recurring contracts?'),
      q('ls_route', 'Which neighborhoods do you want to fill in to tighten routes?', 'long'),
      q('ls_crews', 'Crews and capacity', 'text'),
      yn('ls_commercial', 'Do you want commercial / HOA contracts?'),
    ],
    listenFor: ['Route density: marketing by neighborhood cuts drive time.', 'Hardscape and design-build are higher-margin than mowing.', 'Pair with snow removal for year-round revenue.'],
    michigan: 'Sell spring cleanups and season contracts in February–March; pitch snow contracts in August–September.',
  },
  {
    id: 'pest-control', name: 'Pest control', group: 'home',
    keyServices: ['lsa', 'ppc', 'seo', 'email', 'reputation'],
    questions: [
      q('pc_pests', 'Main pests and services', 'multi', { options: opts('general|General pests', 'termites|Termites', 'rodents|Rodents', 'bedbugs|Bed bugs', 'mosquito|Mosquito / tick', 'wildlife|Wildlife removal', 'commercial|Commercial accounts') }),
      yn('pc_recurring', 'Do you sell quarterly or monthly service plans?'),
      q('pc_conversion', 'What share of one-time treatments turn into recurring plans?', 'text'),
      q('pc_routes', 'Service area and routing priorities', 'long'),
    ],
    listenFor: ['Recurring plans are the business model; marketing should optimize for plan sign-ups, not one-time calls.'],
    michigan: 'Spring ant and wasp surges, fall rodent season as temperatures drop; mosquito services sell May–August.',
  },
  {
    id: 'garage-doors', name: 'Garage door companies', group: 'home',
    keyServices: ['lsa', 'gbp', 'ppc', 'reputation', 'lead-response'],
    questions: [
      q('gd_mix', 'Repairs vs new door installs vs openers', 'text'),
      yn('gd_same_day', 'Do you offer same-day service?'),
      yn('gd_commercial', 'Do you do commercial doors?'),
      q('gd_brands', 'Brands you install', 'text'),
    ],
    listenFor: ['Urgent "door won’t open" calls go to whoever answers first; speed and reviews win.', 'Watch for fake-listing competitors in the map pack; report them.'],
    michigan: 'Cold weather breaks springs and openers; winter is busy for repairs.',
  },
  {
    id: 'painting', name: 'Painters', group: 'home',
    keyServices: ['gbp', 'seo', 'social', 'reputation', 'ppc'],
    questions: [
      q('pt_mix', 'Interior vs exterior vs commercial vs cabinets', 'text'),
      q('pt_min', 'Minimum job size', 'money'),
      yn('pt_photos', 'Do you take before/after photos?'),
      q('pt_offseason', 'What fills winter?', 'text'),
    ],
    listenFor: ['Cabinet refinishing and exteriors are higher-ticket.', 'Before/after photos are the best content.'],
    michigan: 'Exterior season is roughly May–October; push interior and cabinet work in winter.',
  },
  {
    id: 'cleaning', name: 'Cleaning and janitorial', group: 'home',
    keyServices: ['gbp', 'seo', 'ppc', 'booking', 'reputation', 'referral'],
    questions: [
      q('cl_type', 'Residential, commercial, or both?', 'single', { options: opts('res|Residential', 'comm|Commercial / janitorial', 'both|Both') }),
      q('cl_services', 'Services', 'multi', { options: opts('recurring|Recurring house cleaning', 'deep|Deep cleaning', 'move|Move-in / move-out', 'office|Office cleaning', 'post-construction|Post-construction', 'carpet|Carpet / upholstery', 'windows|Windows') }),
      yn('cl_online_quote', 'Can customers get an instant price online?'),
      q('cl_staffing', 'Is hiring cleaners a bottleneck?', 'yesno'),
    ],
    listenFor: ['Recurring clients are the value; one-time jobs are the entry point.', 'Staffing limits growth: recruitment content may matter as much as leads.'],
    michigan: 'Spring cleaning and holiday deep cleans spike; commercial contracts often renew at fiscal year start.',
  },
  {
    id: 'pool-spa', name: 'Pool and spa', group: 'home',
    keyServices: ['seo', 'ppc', 'email', 'gbp', 'social'],
    questions: [
      q('pool_services', 'Services', 'multi', { options: opts('install|Pool / hot tub sales and installs', 'opening|Openings and closings', 'service|Weekly service', 'repair|Repairs', 'retail|Retail store / chemicals') }),
      yn('pool_showroom', 'Do you have a showroom?'),
      q('pool_booking', 'How do you schedule openings and closings?', 'text'),
    ],
    listenFor: ['Openings/closings are a booking rush; online booking and reminders save the office.', 'Hot tubs sell year-round in Michigan.'],
    michigan: 'Openings book March–May, closings August–October. Hot tub demand rises in fall and winter.',
  },
  {
    id: 'windows-siding', name: 'Windows and siding', group: 'home',
    keyServices: ['ppc', 'seo', 'web', 'reputation', 'lead-response'],
    questions: [
      q('ws_products', 'Products', 'multi', { options: opts('windows|Windows', 'doors|Doors', 'siding|Siding', 'gutters|Gutters', 'trim|Trim / soffit') }),
      yn('ws_in_home', 'Do you sell through in-home appointments?'),
      q('ws_appt_rate', 'What share of appointments close?', 'text'),
      yn('ws_financing', 'Do you offer financing?'),
    ],
    listenFor: ['In-home appointment cost is the key metric.', 'Energy savings and financing are strong hooks.'],
    michigan: 'Energy-efficiency messaging lands before winter; installs slow in deep cold.',
  },
  {
    id: 'moving', name: 'Moving companies', group: 'home',
    keyServices: ['seo', 'ppc', 'gbp', 'reputation', 'booking'],
    questions: [
      q('mv_type', 'Local, long-distance, commercial, storage?', 'multi', { options: opts('local|Local', 'long|Long-distance', 'commercial|Commercial', 'storage|Storage', 'junk|Junk removal') }),
      q('mv_quote', 'How do you quote: phone, in-home, video, online?', 'text'),
      q('mv_peak', 'How full is your calendar in summer vs winter?', 'text'),
    ],
    listenFor: ['Reviews are decisive in moving due to fear of scams.', 'Lead brokers resell leads; owning your own leads is a strong pitch.'],
    michigan: 'Peak May–September and around university move-in/out dates (Ann Arbor, East Lansing, Kalamazoo, Mount Pleasant).',
  },
  {
    id: 'waterproofing', name: 'Basement waterproofing and foundation repair', group: 'home',
    keyServices: ['seo', 'ppc', 'lsa', 'content', 'reputation', 'lead-response'],
    questions: [
      q('wp_services', 'Services', 'multi', { options: opts('interior|Interior drainage', 'exterior|Exterior waterproofing', 'sump|Sump pumps', 'crack|Crack repair', 'foundation|Foundation / wall bracing', 'crawl|Crawl space', 'mold|Mold remediation') }),
      yn('wp_free_inspection', 'Do you offer free inspections?'),
      q('wp_warranty', 'Warranty you offer', 'text'),
      yn('wp_financing', 'Do you offer financing?'),
      q('wp_inspect_close', 'What share of inspections become jobs?', 'text'),
    ],
    listenFor: ['High-ticket, fear-driven purchase: trust content (process, warranty, reviews) closes it.', 'Rain events create urgent spikes; be ready to raise ad budgets same day.'],
    michigan: 'Spring thaw and heavy rain flood basements statewide; clay soils in much of Southeast Michigan worsen water problems.',
  },
  {
    id: 'tree-service', name: 'Tree service', group: 'home',
    keyServices: ['lsa', 'gbp', 'seo', 'ppc', 'reputation'],
    questions: [
      q('tr_services', 'Services', 'multi', { options: opts('removal|Removal', 'trimming|Trimming', 'stump|Stump grinding', 'emergency|Storm / emergency', 'plant-health|Plant health care') }),
      yn('tr_arborist', 'Do you have an ISA-certified arborist?'),
      yn('tr_crane', 'Do you have crane or bucket truck capacity?'),
    ],
    listenFor: ['Emergency storm work needs fast response and after-hours answering.', 'Certification and insurance are trust signals.'],
    michigan: 'Summer thunderstorms and winter ice storms drive emergency work; dormant-season pruning in winter.',
  },
  {
    id: 'snow-removal', name: 'Snow removal and plowing', group: 'home',
    keyServices: ['seo', 'gbp', 'ppc', 'sms', 'automation'],
    questions: [
      q('sn_type', 'Residential, commercial, HOA?', 'multi', { options: opts('res|Residential', 'comm|Commercial lots', 'hoa|HOA / apartments', 'salt|Salting') }),
      q('sn_pricing', 'Per push, per season, or per event?', 'text'),
      q('sn_capacity', 'Trucks and routes available', 'text'),
      yn('sn_contracts', 'Do you need help selling contracts before the season?'),
    ],
    listenFor: ['Seasonal contracts must be sold before the first snow; timing is everything.', 'Commercial accounts want reliability proof and insurance.'],
    michigan: 'Sell contracts August–October; lake-effect areas on the west side see heavier, more frequent snow.',
  },
  {
    id: 'concrete-paving', name: 'Concrete, paving and sealcoating', group: 'home',
    keyServices: ['seo', 'gbp', 'ppc', 'web', 'reputation'],
    questions: [
      q('cp_services', 'Services', 'multi', { options: opts('driveways|Driveways', 'patios|Patios', 'flatwork|Flatwork', 'asphalt|Asphalt paving', 'sealcoat|Sealcoating', 'striping|Striping', 'repair|Repair / leveling') }),
      yn('cp_commercial', 'Do you want commercial parking lot work?'),
      q('cp_season', 'Season start and end', 'text'),
    ],
    listenFor: ['Short season: fill the calendar early with pre-booking discounts.'],
    michigan: 'Pour season roughly April–November; freeze-thaw damage creates spring repair demand.',
  },
  {
    id: 'fencing-decks', name: 'Fencing and decks', group: 'home',
    keyServices: ['seo', 'gbp', 'ppc', 'social', 'reputation'],
    questions: [
      q('fd_products', 'Products', 'multi', { options: opts('wood-fence|Wood fence', 'vinyl|Vinyl', 'aluminum|Aluminum', 'chain|Chain link', 'deck|Decks', 'pergola|Pergolas / outdoor living') }),
      q('fd_backlog', 'Weeks of backlog in spring', 'number'),
      yn('fd_financing', 'Do you offer financing?'),
    ],
    listenFor: ['Spring demand outstrips capacity; winter pre-sales smooth the year.'],
    michigan: 'Ground freeze limits post installs in winter; sell winter contracts for spring installation.',
  },
  {
    id: 'septic-well', name: 'Septic and well services', group: 'home',
    keyServices: ['gbp', 'lsa', 'seo', 'email', 'citations'],
    questions: [
      q('sw_services', 'Services', 'multi', { options: opts('pumping|Septic pumping', 'install|Septic install', 'inspection|Inspections (real estate)', 'well-drill|Well drilling', 'well-pump|Well pumps', 'water-treatment|Water treatment') }),
      yn('sw_reminders', 'Do you remind customers when pumping is due?'),
      q('sw_realtor', 'Do realtors send you inspection work?', 'yesno'),
    ],
    listenFor: ['Pumping reminders every few years are an easy recurring revenue win.', 'Realtor partnerships drive inspections.'],
    michigan: 'Large rural and lake-area markets rely on septic and wells; some Michigan counties require septic inspection at property sale.',
  },
  {
    id: 'property-management', name: 'Property management companies', group: 'home',
    keyServices: ['seo', 'ppc', 'web', 'content', 'reputation'],
    questions: [
      q('pm_type', 'What do you manage?', 'multi', { options: opts('sfr|Single-family rentals', 'multi|Multifamily', 'hoa|HOAs / condos', 'commercial|Commercial') }),
      q('pm_doors', 'Doors under management, and the goal', 'text'),
      q('pm_audience', 'Marketing to owners (new contracts), tenants (vacancies), or both?', 'single', { options: opts('owners|Property owners', 'tenants|Tenants', 'both|Both') }),
      q('pm_software', 'Software (AppFolio, Buildium, Rent Manager...)', 'text'),
    ],
    listenFor: ['Owner acquisition is the growth lever; tenant reviews hurt owner trust.'],
    michigan: 'University towns have August lease cycles; Detroit and Grand Rapids have active single-family rental investor markets.',
  },

  // ---------------- Health and wellness ----------------
  {
    id: 'dental', name: 'Dentists', group: 'health',
    keyServices: ['seo', 'gbp', 'ppc', 'reputation', 'email', 'booking'],
    questions: [
      q('dn_new_patients', 'New patients per month, and the goal', 'text'),
      q('dn_procedures', 'Procedures you want more of', 'multi', { options: opts('implants|Implants', 'invisalign|Clear aligners', 'cosmetic|Cosmetic / veneers', 'emergency|Emergency', 'family|Family / hygiene', 'sedation|Sedation') }),
      q('dn_insurance', 'In-network, out-of-network, or membership plan?', 'text'),
      q('dn_pms', 'Practice software', 'single', { options: opts('dentrix|Dentrix', 'eaglesoft|Eaglesoft', 'opendental|Open Dental', 'other|Other') }),
      yn('dn_online_booking', 'Can new patients book online?'),
      q('dn_hygiene_gaps', 'Are there open hygiene slots most weeks?', 'yesno'),
    ],
    listenFor: ['Implants and aligners are high value per case.', 'Recall reminders and reactivation fill hygiene schedules.', 'HIPAA: no patient info in marketing tools without agreements.'],
    michigan: 'Year-end insurance benefit use-it-or-lose-it campaigns (October–December) work well.',
  },
  {
    id: 'orthodontics', name: 'Orthodontists', group: 'health',
    keyServices: ['seo', 'ppc', 'social', 'referral', 'reputation'],
    questions: [
      q('or_starts', 'Case starts per month and goal', 'text'),
      q('or_mix', 'Kids vs adults', 'text'),
      q('or_referrals', 'What share of starts come from dentist referrals?', 'text'),
      yn('or_free_consult', 'Do you offer free consultations?'),
      q('or_consult_conversion', 'What share of consults start treatment?', 'text'),
    ],
    listenFor: ['Parents decide; Instagram and Facebook reach them.', 'Referring dentist relationships are a channel to nurture.'],
    michigan: 'Back-to-school (August) and summer are prime start seasons.',
  },
  {
    id: 'chiropractic', name: 'Chiropractors', group: 'health',
    keyServices: ['gbp', 'seo', 'reputation', 'email', 'ppc', 'booking'],
    questions: [
      q('ch_new_patients', 'New patients per month and goal', 'text'),
      q('ch_focus', 'Focus areas', 'multi', { options: opts('pain|Back / neck pain', 'auto|Auto injury', 'sports|Sports', 'prenatal|Prenatal / pediatric', 'wellness|Wellness care') }),
      q('ch_cash_ins', 'Cash, insurance, or both?', 'text'),
      q('ch_retention', 'How many visits does a typical patient complete?', 'text'),
    ],
    listenFor: ['Auto-injury (PIP) cases are high value.', 'Retention and reactivation are as important as new patients.'],
    michigan: 'Michigan’s no-fault auto insurance system makes auto-injury patients a meaningful niche; confirm current coverage rules with the practice.',
  },
  {
    id: 'physical-therapy', name: 'Physical therapy', group: 'health',
    keyServices: ['seo', 'gbp', 'referral', 'reputation', 'email'],
    questions: [
      q('pt_referral_mix', 'Physician referrals vs direct access', 'text'),
      q('pt_specialties', 'Specialties', 'multi', { options: opts('ortho|Orthopedic', 'sports|Sports', 'pelvic|Pelvic health', 'vestibular|Vestibular', 'neuro|Neuro') }),
      q('pt_dropoff', 'What share of patients finish their plan of care?', 'text'),
    ],
    listenFor: ['Direct-access messaging (no referral needed) opens a consumer channel.'],
    michigan: 'Michigan allows direct access to PT with limits; check current rules before advertising it.',
  },
  {
    id: 'med-spa', name: 'Med spas', group: 'health',
    keyServices: ['social', 'ppc', 'email', 'reputation', 'booking', 'seo'],
    questions: [
      q('ms_services', 'Top treatments', 'multi', { options: opts('injectables|Botox / fillers', 'laser|Laser', 'body|Body contouring', 'facials|Facials / peels', 'iv|IV therapy', 'weight|Weight loss') }),
      yn('ms_membership', 'Do you sell memberships or packages?'),
      q('ms_rebook', 'What share of clients rebook?', 'text'),
      yn('ms_before_after', 'Do you have consented before/after photos?'),
    ],
    listenFor: ['Rebooking and memberships drive value.', 'Platform ad policies restrict some treatments; compliance matters.'],
    michigan: 'Holiday gift cards and pre-summer body treatments are seasonal peaks.',
  },
  {
    id: 'optometry', name: 'Optometrists', group: 'health',
    keyServices: ['gbp', 'seo', 'email', 'booking', 'reputation'],
    questions: [
      q('op_services', 'Services to grow', 'multi', { options: opts('exams|Eye exams', 'contacts|Contacts', 'dry-eye|Dry eye', 'myopia|Myopia control', 'eyewear|Designer eyewear') }),
      q('op_recall', 'How do you remind patients of annual exams?', 'text'),
      q('op_optical', 'What share of exam patients buy glasses in-house?', 'text'),
    ],
    listenFor: ['Optical capture rate is the profit lever.', 'Medical eye care (dry eye) is a growth niche.'],
    michigan: 'Back-to-school exams in August; year-end insurance and FSA spending in December.',
  },
  {
    id: 'veterinary', name: 'Veterinarians', group: 'health',
    keyServices: ['gbp', 'seo', 'email', 'reputation', 'booking', 'social'],
    questions: [
      q('vt_type', 'General, emergency, specialty, mobile?', 'text'),
      yn('vt_new_clients', 'Are you accepting new clients right now?'),
      q('vt_species', 'Species', 'multi', { options: opts('dogs-cats|Dogs and cats', 'exotics|Exotics', 'equine|Equine', 'farm|Farm animals') }),
      yn('vt_wellness_plans', 'Do you offer wellness plans?'),
    ],
    listenFor: ['Many practices are at capacity: focus on retention, reminders and staff recruiting instead of more leads.'],
    michigan: 'Rural and farm-animal practices in mid and northern Michigan; tick season for preventive care in spring.',
  },
  {
    id: 'dermatology-plastic', name: 'Dermatology and plastic surgery', group: 'health',
    keyServices: ['seo', 'ppc', 'social', 'reputation', 'content', 'lead-response'],
    questions: [
      q('dp_mix', 'Medical vs cosmetic split', 'text'),
      q('dp_procedures', 'Procedures to grow', 'long'),
      q('dp_consult_rate', 'Consult to procedure conversion', 'text'),
      q('dp_financing', 'Patient financing offered (CareCredit, Cherry...)?', 'yesno'),
      yn('dp_wait', 'Is there a long wait for new medical dermatology patients?'),
    ],
    listenFor: ['Cosmetic is consumer marketing; medical is often capacity-limited.', 'Strict ad and testimonial rules for medical claims.'],
    michigan: 'Skin-check campaigns in spring; cosmetic procedures timed for recovery before summer and holidays.',
  },
  {
    id: 'audiology', name: 'Hearing and audiology clinics', group: 'health',
    keyServices: ['seo', 'gbp', 'ppc', 'email', 'reputation'],
    questions: [
      q('au_services', 'Services', 'multi', { options: opts('testing|Hearing tests', 'aids|Hearing aids', 'tinnitus|Tinnitus', 'pediatric|Pediatric') }),
      q('au_upgrade_cycle', 'How do you reach patients due for an upgrade?', 'text'),
      q('au_insurance', 'Insurance benefits accepted', 'text'),
    ],
    listenFor: ['Older audience: Facebook, direct mail and phone-first experiences.', 'Adult children often research for parents.'],
    michigan: 'Large retiree populations in northern Michigan and lakeshore communities.',
  },
  {
    id: 'counseling', name: 'Mental health and counseling practices', group: 'health',
    keyServices: ['seo', 'gbp', 'content', 'booking', 'web'],
    questions: [
      q('co_services', 'Services', 'multi', { options: opts('individual|Individual', 'couples|Couples', 'family|Family / child', 'group|Group', 'psychiatry|Psychiatry / med management', 'telehealth|Telehealth') }),
      q('co_capacity', 'Which clinicians have openings?', 'long'),
      q('co_payment', 'Insurance panels or private pay?', 'text'),
      yn('co_intake', 'Is intake handled online?'),
    ],
    listenFor: ['Privacy is paramount: no tracking pixels that leak health info.', 'Match marketing to clinician availability.'],
    michigan: 'Telehealth can serve clients statewide where licensed.',
  },

  // ---------------- Professional services ----------------
  {
    id: 'personal-injury-law', name: 'Personal injury law', group: 'pro',
    keyServices: ['seo', 'ppc', 'lsa', 'content', 'lead-response', 'reputation'],
    questions: [
      q('pi_cases', 'Case types', 'multi', { options: opts('auto|Auto accidents', 'truck|Trucking', 'slip|Premises / slip and fall', 'med-mal|Medical malpractice', 'workers-comp|Workers’ comp', 'dog-bite|Dog bites') }),
      q('pi_intake', 'Who handles intake and how fast?', 'text'),
      q('pi_signed', 'Signed cases per month and goal', 'text'),
      q('pi_case_value', 'Average fee per case', 'money'),
      q('pi_spanish', 'Do you serve Spanish or Arabic speakers?', 'text'),
    ],
    listenFor: ['Intake speed decides who signs the case.', 'Very competitive paid search; LSA and SEO are cheaper long-term.', 'State bar advertising rules apply.'],
    michigan: 'Michigan no-fault auto insurance rules shape auto-accident cases; Southeast Michigan has large Arabic-speaking communities (Dearborn).',
  },
  {
    id: 'family-estate-law', name: 'Family and estate law', group: 'pro',
    keyServices: ['seo', 'gbp', 'content', 'lsa', 'reputation', 'email'],
    questions: [
      q('fe_practice', 'Practice areas', 'multi', { options: opts('divorce|Divorce', 'custody|Custody', 'estate|Estate planning', 'probate|Probate', 'elder|Elder law', 'adoption|Adoption') }),
      yn('fe_flat_fee', 'Do you offer flat-fee services?'),
      yn('fe_seminars', 'Do you run seminars or workshops?'),
      q('fe_consult', 'Free or paid consultations?', 'text'),
    ],
    listenFor: ['Estate planning suits seminars and email nurture; divorce is urgent and search-driven.'],
    michigan: 'Practice by county court; mention the courts and counties served.',
  },
  {
    id: 'real-estate', name: 'Real estate agents and teams', group: 'pro',
    keyServices: ['seo', 'social', 'email', 'content', 'ppc', 'web'],
    questions: [
      q('re_focus', 'Buyers, sellers, investors, luxury, new construction?', 'multi', { options: opts('buyers|Buyers', 'sellers|Sellers / listings', 'investors|Investors', 'luxury|Luxury', 'new-construction|New construction', 'relocation|Relocation') }),
      q('re_database', 'Size of your contact database', 'text'),
      q('re_brokerage', 'Brokerage and any marketing they provide', 'text'),
      q('re_area', 'Neighborhoods and towns you specialize in', 'long'),
    ],
    listenFor: ['Seller leads are the most valuable; hyperlocal content attracts them.', 'Sphere-of-influence nurture often beats paid leads.'],
    michigan: 'Spring market is strongest; lake and vacation property markets up north have their own seasons.',
  },

  // ---------------- Retail, auto and hospitality ----------------
  {
    id: 'auto-repair', name: 'Auto repair and body shops', group: 'local',
    keyServices: ['gbp', 'seo', 'reputation', 'sms', 'ppc', 'booking'],
    questions: [
      q('ar_type', 'Mechanical, collision, or both?', 'single', { options: opts('mech|Mechanical', 'collision|Collision', 'both|Both') }),
      q('ar_specialty', 'Specialties (European, diesel, transmissions, EV, fleet)', 'text'),
      q('ar_bays', 'Bays and car count per day', 'text'),
      q('ar_software', 'Shop management software (Tekmetric, Mitchell, Shopmonkey...)', 'text'),
      yn('ar_drp', 'Are you on insurance direct-repair programs?'),
    ],
    listenFor: ['Trust is the purchase: reviews and transparency (photos, digital inspections) win.', 'Service reminders drive repeat visits.'],
    michigan: 'Pothole season (February–April) drives alignment and suspension work; winter tire changeovers in fall.',
  },
  {
    id: 'fitness', name: 'Gyms and fitness studios', group: 'local',
    keyServices: ['social', 'ppc', 'email', 'referral', 'gbp'],
    questions: [
      q('fit_type', 'Type', 'single', { options: opts('gym|Gym', 'boutique|Boutique studio', 'crossfit|CrossFit / functional', 'martial|Martial arts', 'pt|Personal training', 'yoga|Yoga / pilates') }),
      q('fit_members', 'Members today and goal', 'text'),
      q('fit_churn', 'Monthly cancellations', 'text'),
      q('fit_offer', 'Trial or intro offer', 'text'),
      q('fit_software', 'Membership software (Mindbody, Glofox, PushPress...)', 'text'),
    ],
    listenFor: ['Retention beats acquisition; churn is the hidden cost.', 'Intro offers plus fast follow-up convert.'],
    michigan: 'January resolutions and pre-summer are peak sign-up windows.',
  },
  {
    id: 'boat-rv-dealers', name: 'Boat, RV and powersports dealers', group: 'local',
    keyServices: ['ppc', 'seo', 'social', 'email', 'web', 'competitive'],
    questions: [
      q('br_units', 'What do you sell?', 'multi', { options: opts('boats|Boats', 'rv|RVs / campers', 'atv|ATVs / side-by-sides', 'snowmobiles|Snowmobiles', 'motorcycles|Motorcycles', 'pwc|Personal watercraft') }),
      q('br_inventory_feed', 'Where does inventory live (dealer website provider, DMS)?', 'text'),
      yn('br_service_dept', 'Do you have a service department and storage?'),
      q('br_shows', 'Which boat/RV shows do you attend?', 'long'),
      yn('br_financing', 'Do you promote financing?'),
    ],
    listenFor: ['Inventory ads (feed-based) and financing messages drive leads.', 'Service and winter storage are recurring revenue.'],
    michigan: 'Detroit, Novi and Grand Rapids boat and RV shows in winter start the selling season; storage and winterization sell in fall.',
  },
  {
    id: 'wedding-venues', name: 'Wedding and event venues', group: 'local',
    keyServices: ['seo', 'social', 'ppc', 'web', 'reputation', 'lead-response'],
    questions: [
      q('wv_capacity', 'Guest capacity and spaces', 'text'),
      q('wv_bookings', 'Weddings booked per year and goal', 'text'),
      q('wv_offpeak', 'Which dates are hardest to fill?', 'long'),
      q('wv_directories', 'Do you pay for The Knot or WeddingWire?', 'text'),
      q('wv_tour_rate', 'What share of tours book?', 'text'),
      yn('wv_corporate', 'Do you want corporate events too?'),
    ],
    listenFor: ['Speed to respond to inquiries decides bookings.', 'Off-peak dates (Fridays, Sundays, winter) are the opportunity.'],
    michigan: 'Peak season June–October; engagement season (December–February) is when couples search.',
  },
  {
    id: 'restaurants', name: 'Restaurants', group: 'local',
    keyServices: ['gbp', 'social', 'sms', 'reputation', 'web'],
    questions: [
      q('rs_type', 'Concept', 'text'),
      q('rs_channels', 'Revenue channels', 'multi', { options: opts('dine-in|Dine-in', 'takeout|Takeout', 'delivery-apps|Delivery apps', 'catering|Catering', 'events|Private events') }),
      yn('rs_online_ordering', 'Do you have commission-free online ordering?'),
      q('rs_slow', 'Slowest days and times', 'text'),
      q('rs_pos', 'POS system (Toast, Square, Clover...)', 'text'),
    ],
    listenFor: ['Delivery app commissions: direct ordering and loyalty pay back fast.', 'Catering and events are higher-margin.'],
    michigan: 'Patio season May–September; tourism towns swing hard by season.',
  },
  {
    id: 'salons', name: 'Salons and barbershops', group: 'local',
    keyServices: ['gbp', 'social', 'booking', 'reputation', 'sms'],
    questions: [
      q('sl_model', 'Commission, booth rental, or mix?', 'text'),
      q('sl_booking', 'Booking software (Vagaro, Square, Boulevard, Booksy...)', 'text'),
      q('sl_rebook', 'What share of clients rebook before leaving?', 'text'),
      yn('sl_hiring', 'Are you hiring stylists or barbers?'),
    ],
    listenFor: ['Booth-rental salons market the space to stylists, not only to clients.'],
    michigan: 'Prom, wedding and holiday seasons drive demand.',
  },
  {
    id: 'ecommerce', name: 'E-commerce brands', group: 'local',
    keyServices: ['ecommerce', 'ppc', 'email', 'social', 'analytics', 'web'],
    questions: [
      q('eb_revenue', 'Monthly online revenue', 'money'),
      q('eb_roas', 'Current return on ad spend', 'text'),
      q('eb_repeat', 'Repeat purchase rate', 'text'),
    ],
    listenFor: ['Margin and repeat rate decide what you can pay to acquire a customer.'],
    michigan: 'Made-in-Michigan positioning sells well regionally.',
  },
  {
    id: 'funeral-homes', name: 'Funeral homes', group: 'local',
    keyServices: ['gbp', 'seo', 'web', 'reputation', 'content'],
    questions: [
      q('fh_services', 'Services', 'multi', { options: opts('traditional|Traditional', 'cremation|Cremation', 'preplanning|Pre-planning', 'green|Green burial', 'celebrations|Celebration of life') }),
      yn('fh_obits', 'Are obituaries hosted on your website?'),
      yn('fh_preneed', 'Do you want more pre-need planning appointments?'),
      q('fh_ownership', 'Family-owned or corporate?', 'text'),
    ],
    listenFor: ['Obituary pages bring large traffic; make them convert to pre-planning interest respectfully.', 'Family-owned is a trust differentiator vs corporate chains.'],
    michigan: 'Strong community and church ties; local newspaper obituary costs push families online.',
  },
  {
    id: 'childcare', name: 'Childcare and daycare centers', group: 'local',
    keyServices: ['gbp', 'seo', 'web', 'reputation', 'social', 'booking'],
    questions: [
      q('cc_ages', 'Ages served', 'multi', { options: opts('infant|Infant', 'toddler|Toddler', 'preschool|Preschool', 'gsrp|GSRP / pre-K', 'school-age|Before/after school', 'summer|Summer camp') }),
      q('cc_openings', 'Current openings by age group', 'long'),
      q('cc_waitlist', 'Is there a waitlist?', 'yesno'),
      yn('cc_tours', 'Can parents book tours online?'),
      yn('cc_hiring', 'Is hiring teachers a constraint?'),
    ],
    listenFor: ['Openings vary by age group; market only what has space.', 'Staff recruiting may matter as much as enrollment.'],
    michigan: 'Great Start to Readiness Program (GSRP) state pre-K and Michigan licensing are trust signals; enrollment pushes before September.',
  },
];

export const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id);
export const industryById = Object.fromEntries(INDUSTRIES.map((i) => [i.id, i]));
