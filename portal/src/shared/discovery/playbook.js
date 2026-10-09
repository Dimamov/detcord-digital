// Lead scorecard, answer-to-service recommendations, objection guide and the pre-call intake form.
import { q, opts } from './schema.js';

// ---------- Lead scorecard ----------
// Five dimensions, each scored 0–4 from discovery answers. Total out of 20 → grade.
export const SCORECARD = [
  {
    id: 'need', name: 'Need', help: 'How painful is the problem we solve?',
    score: (a) => {
      const pain = Number(a.pain_level) || 0;
      let s = pain >= 5 ? 4 : pain >= 4 ? 3 : pain >= 3 ? 2 : pain >= 1 ? 1 : 0;
      if (['not-found', 'unknown'].includes(a.rank_check) || a.missed_calls === 'many') s = Math.max(s, 3);
      return s;
    },
  },
  {
    id: 'urgency', name: 'Urgency', help: 'How soon will they act?',
    score: (a) => ({ now: 4, 30: 3, 90: 2, later: 0 })[a.timeline] ?? 1,
  },
  {
    id: 'budget', name: 'Budget', help: 'Can they afford a meaningful engagement?',
    score: (a) => ({ lt750: 1, '750-1500': 2, '1500-3000': 3, '3000-6000': 4, '6000+': 4, unsure: 1 })[a.budget] ?? 0,
  },
  {
    id: 'authority', name: 'Authority', help: 'Is the decision maker engaged?',
    score: (a) => ({ yes: 4, partner: 2, other: 1 })[a.attendees_dm] ?? 0,
  },
  {
    id: 'fit', name: 'Fit', help: 'Can we get them results?',
    score: (a, ctx) => {
      let s = 2;
      if (ctx.targetIndustry) s += 1;
      if (a.capacity === 'yes' || a.capacity === 'some') s += 1;
      if (a.capacity === 'no') s -= 2;
      if (Number(a.avg_ticket) >= 500 || Number(a.repeat_value) >= 2000) s += 1;
      return Math.max(0, Math.min(4, s));
    },
  },
];

export function grade(total) {
  if (total >= 15) return { grade: 'A', label: 'Hot: move fast', action: 'Book the proposal meeting within 48 hours and send the plan the same day.' };
  if (total >= 10) return { grade: 'B', label: 'Warm: nurture to close', action: 'Send the plan, address the weakest score, and schedule a follow-up within a week.' };
  return { grade: 'C', label: 'Cold or not ready', action: 'Add to monthly nurture. Offer a small starting project or the free Lab tools.' };
}

export const RED_FLAGS = [
  { when: { id: 'capacity', in: ['no'] }, text: 'At capacity: more leads won’t help. Sell pricing, higher-value jobs, efficiency or recruiting instead.' },
  { when: { id: 'timeline', in: ['later'] }, text: 'Just researching: no near-term decision.' },
  { when: { id: 'attendees_dm', in: ['other'] }, text: 'Decision maker was not on the call.' },
  { when: { id: 'budget', in: ['lt750'] }, text: 'Budget is below most packages. Lead with one focused service.' },
  { when: { id: 'contract_pref', in: ['monthly'] }, text: 'Wants month-to-month only. Price for it or offer a short pilot.' },
  { when: { id: 'ppc_account_access', in: [false] }, text: 'Ad accounts owned by a previous agency. Plan for account recovery.' },
];

// ---------- Answer → service recommendations ----------
// Each rule adds weight to services; reasons are shown to the rep and reused in the proposal.
export const RECOMMENDATIONS = [
  { when: { id: 'rank_check', in: ['not-found', 'page1', 'unknown'] }, services: ['seo', 'gbp'], weight: 3, because: 'Not in the top 3 on Google Maps for their main service.' },
  { when: { id: 'gbp_claimed', in: ['not-sure', 'no'] }, services: ['gbp', 'citations'], weight: 3, because: 'They don’t control their Google Business Profile.' },
  { when: { id: 'gbp_exists', eq: false }, services: ['gbp', 'citations'], weight: 3, because: 'No Google Business Profile was found.' },
  { when: { id: 'mobile_friendly', eq: false }, services: ['web'], weight: 3, because: 'The website doesn’t work well on phones.' },
  { when: { id: 'speed_mobile', lte: 49 }, services: ['web'], weight: 2, because: 'Google rates the site slow on phones.' },
  { when: { id: 'ai_check', in: ['yes-not', 'no'] }, services: ['ai-search'], weight: 1, because: 'Not showing (or unchecked) in AI assistant recommendations.' },
  { when: { id: 'website_status', in: ['none', 'embarrassed'] }, services: ['web'], weight: 4, because: 'No website, or they are embarrassed by it.' },
  { when: { id: 'website_status', in: ['ok'] }, services: ['web'], weight: 1, because: 'Website is only “OK”; conversion improvements likely pay off.' },
  { when: { any: [{ id: 'missed_calls', in: ['many', 'unknown'] }, { id: 'who_answers', in: ['voicemail'] }, { id: 'after_hours', in: ['lost', 'next-day'] }] }, services: ['lead-response'], weight: 4, because: 'Calls and messages are being missed or answered late.' },
  { when: { id: 'speed_to_lead', in: ['same-day', 'next-day'] }, services: ['lead-response', 'automation'], weight: 3, because: 'Slow response to web leads.' },
  { when: { id: 'quote_followup', in: ['manual', 'none'] }, services: ['automation'], weight: 3, because: 'Unsold quotes are not followed up automatically.' },
  { when: { id: 'reviews_process', in: ['manual', 'no'] }, services: ['reputation'], weight: 3, because: 'No system for getting reviews.' },
  { when: { id: 'know_source', in: ['roughly', 'no'] }, services: ['analytics'], weight: 3, because: 'They don’t know which marketing produces customers.' },
  { when: { id: 'lead_sources', in: ['unknown'] }, services: ['analytics'], weight: 2, because: 'Lead sources unknown.' },
  { when: { id: 'customer_list', in: ['500-2000', '2000+'] }, services: ['email', 'referral'], weight: 3, because: 'Large past-customer list not being marketed to.' },
  { when: { id: 'goal_type', in: ['repeat'] }, services: ['email', 'sms', 'referral'], weight: 2, because: 'Goal: more repeat business and referrals.' },
  { when: { id: 'goal_type', in: ['more-leads'] }, services: ['ppc', 'seo'], weight: 2, because: 'Goal: more leads.' },
  { when: { id: 'goal_type', in: ['better-leads', 'higher-prices'] }, services: ['branding', 'web', 'content'], weight: 2, because: 'Goal: better customers and higher prices: positioning and proof.' },
  { when: { id: 'goal_type', in: ['brand'] }, services: ['branding', 'web', 'social'], weight: 2, because: 'Goal: look more professional than competitors.' },
  { when: { id: 'goal_type', in: ['new-service'] }, services: ['ppc', 'web', 'strategy'], weight: 2, because: 'Launching a new service or location.' },
  { when: { id: 'goal_type', in: ['time'] }, services: ['automation', 'ai-enablement'], weight: 2, because: 'Owner wants time back.' },
  { when: { id: 'paid_leads', in: ['yes-unhappy'] }, services: ['lsa', 'seo', 'ppc'], weight: 3, because: 'Unhappy with shared lead services; own the lead source instead.' },
  { when: { id: 'social_status', in: ['dead', 'none'] }, services: ['social'], weight: 1, because: 'Social accounts are inactive.' },
  { when: { id: 'who_manages', in: ['owner', 'nobody'] }, services: ['strategy'], weight: 1, because: 'Nobody owns marketing.' },
  { when: { id: 'monthly_spend', in: ['3000-7500', '7500+'] }, services: ['analytics', 'strategy'], weight: 2, because: 'Meaningful spend without clear tracking or ownership.' },
  { when: { id: 'locations', gte: 2 }, services: ['multi-location'], weight: 3, because: 'More than one location.' },
  { when: { id: 'capacity', in: ['no'] }, services: ['automation', 'branding'], weight: 2, because: 'At capacity: efficiency and higher-value positioning before more leads.' },
];

// ---------- Objection guide ----------
export const OBJECTIONS = [
  {
    id: 'price', objection: '“It’s too expensive.”',
    response: 'Compared to what? Let’s look at what one extra customer is worth to you. At [avg ticket], we need [n] new customers a month to break even. Does that feel achievable from what you’ve told me?',
    next: 'Rebuild the ROI with their numbers. If still too much, start with the one service tied to their biggest problem.',
    when: { id: 'budget', in: ['lt750', 'unsure'] },
  },
  {
    id: 'burned', objection: '“We tried an agency before and it didn’t work.”',
    response: 'That’s common, and I’d be skeptical too. What specifically went wrong? [Listen.] Here’s how we handle that: you see every report, you own every account, and [month-to-month or a short pilot].',
    next: 'Put the fix for their specific bad experience in writing in the proposal.',
    when: { id: 'agency_experience', answered: true },
  },
  {
    id: 'think', objection: '“I need to think about it.”',
    response: 'Of course. Usually that means there’s one part that isn’t sitting right. Is it the price, the timing, or whether it’ll work?',
    next: 'Book a specific follow-up time before hanging up.',
  },
  {
    id: 'partner', objection: '“I need to talk to my partner/spouse.”',
    response: 'Makes sense. What do you think their first question will be? Would it help if the three of us went through the plan together for 20 minutes?',
    next: 'Book the meeting with both decision makers.',
    when: { id: 'attendees_dm', in: ['partner', 'other'] },
  },
  {
    id: 'referrals', objection: '“We get all our work from referrals.”',
    response: 'That’s a great sign: people love your work. The question is what happens when referrals slow down, and how many referred people Google you first and find a competitor with more reviews.',
    next: 'Pitch reputation, GBP and referral campaigns that amplify word of mouth.',
    when: { id: 'lead_sources', in: ['referral'] },
  },
  {
    id: 'busy', objection: '“We’re too busy right now.”',
    response: 'Good problem. Busy now is the best time to build the pipeline for your slow season, and to raise prices and pick better jobs.',
    next: 'Time campaigns to the slow months they named.',
    when: { id: 'capacity', in: ['no'] },
  },
  {
    id: 'contract', objection: '“I don’t want a long contract.”',
    response: 'Fair. We earn the next month every month. Some work, like SEO, takes 3–6 months to show results, so I’ll show you leading indicators every month so you can judge progress.',
    next: 'Offer month-to-month at a higher rate or a 90-day pilot with clear goals.',
    when: { id: 'contract_pref', in: ['monthly'] },
  },
  {
    id: 'diy', objection: '“My nephew / office manager does our marketing.”',
    response: 'That’s helpful, and we can work with them. How many hours a week do they spend on it, and how do you know what’s working?',
    next: 'Position as support and strategy for the in-house person.',
    when: { id: 'other_options', in: ['inhouse', 'diy'] },
  },
  {
    id: 'guarantee', objection: '“Can you guarantee #1 on Google?”',
    response: 'Nobody honest can guarantee a ranking; Google controls that. What we commit to is the work, the timeline and transparent reporting on calls and leads.',
    next: 'Never promise rankings. Promise activity and measurement.',
  },
  {
    id: 'shopping', objection: '“I’m talking to other agencies.”',
    response: 'You should. When you compare, ask each one: who owns the accounts, what exactly is in the monthly fee, and how they measure leads, not clicks.',
    next: 'Send a side-by-side of what’s included.',
    when: { id: 'other_options', in: ['agencies'] },
  },
];

// ---------- Pre-call intake form (public link, no login) ----------
// Each question id maps onto a master-interview answer so the call starts pre-filled.
export const INTAKE = {
  intro: 'A few quick questions so your Detcord strategist can come prepared. It takes about 3 minutes.',
  questions: [
    q('website', 'Your website', 'text', { placeholder: 'www.example.com', optional: true, mapTo: 'website' }),
    q('top_services', 'Which services or products bring in the most money?', 'long', { mapTo: 'top_services' }),
    q('service_area', 'What towns or areas do you serve?', 'long', { mapTo: 'service_area' }),
    q('lead_sources', 'Where do new customers come from today?', 'multi', {
      options: opts('referral|Referrals and word of mouth', 'google-organic|Google search', 'google-maps|Google Maps', 'google-ads|Google Ads', 'facebook-ig|Facebook / Instagram', 'directories|Yelp, Angi, Thumbtack, HomeAdvisor', 'repeat|Repeat customers', 'print|Mailers, print, radio, TV', 'unknown|Not sure'),
      mapTo: 'lead_sources',
    }),
    q('biggest_problem', 'What’s the biggest challenge in getting or keeping customers?', 'long', { mapTo: 'biggest_problem' }),
    q('goal_12mo', 'What would a great next 12 months look like?', 'long', { mapTo: 'goal_12mo' }),
    q('monthly_spend', 'Roughly what do you spend on marketing per month today?', 'single', {
      options: opts('0|Nothing', 'lt500|Under $500', '500-1500|$500–$1,500', '1500-3000|$1,500–$3,000', '3000-7500|$3,000–$7,500', '7500+|More than $7,500'),
      mapTo: 'monthly_spend',
    }),
    q('timeline', 'When would you like to get started?', 'single', { options: opts('now|Right away', '30|Within 30 days', '90|In 1–3 months', 'later|Just researching'), mapTo: 'timeline' }),
    q('decision_process', 'Who else is involved in decisions like this?', 'text', { optional: true, mapTo: 'decision_process' }),
    q('anything_else', 'Anything else we should know before the call?', 'long', { optional: true, mapTo: 'rep_notes' }),
  ],
};
