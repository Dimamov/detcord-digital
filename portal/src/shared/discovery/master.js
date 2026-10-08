// Master discovery interview: the first call with a business owner (about 45 minutes).
// Written for sales reps: each section has a talk track, the questions, and what to listen for.
import { q, opts } from './schema.js';

export const MASTER = {
  id: 'master',
  name: 'Discovery call',
  minutes: 45,
  sections: [
    {
      id: 'open',
      title: 'Open the call',
      minutes: 3,
      script: [
        "Thanks for making time. Here's how I'd like to use the next 40 minutes: I'll ask about your business, where your customers come from, and what's getting in the way. Then, if it looks like we can help, I'll tell you what I'd do. If we're not a fit, I'll tell you that too. Sound good?",
        "Before we start, is there anything specific that made you take this call today?",
      ],
      questions: [
        q('trigger', 'What made you take this call now?', 'long', { hint: 'The trigger event is the real reason they are talking to you. Write it in their words; you will repeat it back at the close.' }),
        q('attendees_dm', 'Is everyone who would make a decision about marketing on this call?', 'single', {
          options: opts('yes|Yes, the decision maker is here', 'partner|A partner or spouse also decides', 'other|Someone else decides'),
          hint: 'If not, ask: "Who else would want to weigh in, and should we include them in the next conversation?"',
        }),
      ],
    },
    {
      id: 'business',
      title: 'The business',
      minutes: 7,
      script: ["Tell me about the business. How did it start and what does a typical week look like?"],
      questions: [
        q('years', 'How long have you been in business?', 'single', { options: opts('lt1|Less than 1 year', '1-3|1–3 years', '3-10|3–10 years', '10+|More than 10 years') }),
        q('team_size', 'How many people work in the business (including you)?', 'single', { options: opts('1|Just me', '2-5|2–5', '6-15|6–15', '16-50|16–50', '50+|More than 50') }),
        q('locations', 'How many locations do you operate?', 'number', { placeholder: '1' }),
        q('service_area', 'What area do you serve? Which towns or counties matter most?', 'long', { hint: 'Listen for towns they want more of. These become location pages, ad targeting and Google Business Profile service areas.' }),
        q('top_services', 'Which services or products bring in the most money?', 'long', { hint: 'Ask for the top 2–3 by profit, not volume. These are what we market first.' }),
        q('want_more_of', 'Which of those do you want MORE of in the next 12 months?', 'long'),
        q('avg_ticket', 'What is an average sale or job worth?', 'money', { hint: 'If they don’t know, ask for a typical small job and a typical big job.' }),
        q('repeat_value', 'Roughly what is a customer worth over their lifetime (repeat visits, referrals)?', 'money', { optional: true }),
        q('capacity', 'If we doubled your leads next month, could you handle the work?', 'single', {
          options: opts('yes|Yes, we have room', 'some|Some room, we could hire', 'no|No, we are at capacity'),
          hint: 'At capacity is a red flag for lead-gen services. Pivot to pricing power, better-fit customers, reviews or efficiency.',
        }),
        q('seasonality', 'Which months are busiest and which are slowest?', 'text', { hint: 'Slow months are where marketing pays back fastest. Plan campaigns 4–6 weeks ahead of them.' }),
      ],
    },
    {
      id: 'goals',
      title: 'Goals',
      minutes: 5,
      script: ["Let's fast-forward 12 months. If this year went great, what would be different?"],
      questions: [
        q('goal_12mo', 'What does a great year look like in numbers?', 'long', { hint: 'Push for a number: revenue, jobs per week, new patients per month, new locations.' }),
        q('goal_type', 'What matters most right now?', 'multi', {
          options: opts('more-leads|More leads or calls', 'better-leads|Better quality customers', 'higher-prices|Charge more / higher-value jobs', 'repeat|More repeat business and referrals', 'new-service|Launch a new service or location', 'hire|Recruit staff', 'time|Get time back (less owner involvement)', 'brand|Look more professional than competitors', 'exit|Grow value to sell the business'),
        }),
        q('goal_why', 'Why does that matter to you personally?', 'long', { hint: 'The personal reason (time with family, retiring, proving something) is what gets the deal signed. Do not skip it.' }),
      ],
    },
    {
      id: 'customers',
      title: 'Customers and lead flow',
      minutes: 6,
      questions: [
        q('ideal_customer', 'Describe your best customer. Who do you wish you had ten more of?', 'long'),
        q('lead_sources', 'Where do new customers come from today?', 'multi', {
          options: opts('referral|Referrals and word of mouth', 'google-organic|Google search (not ads)', 'google-maps|Google Maps / Business Profile', 'google-ads|Google Ads', 'lsa|Google Local Services Ads', 'facebook-ig|Facebook / Instagram', 'social-ads|Social media ads', 'directories|Yelp, Angi, Thumbtack, HomeAdvisor', 'repeat|Repeat customers', 'signs-trucks|Signs, trucks, walk-ins', 'print|Mailers, print, radio, TV', 'partners|Partners or other businesses', 'ai|ChatGPT or AI assistants', 'unknown|Not sure'),
          hint: 'If "not sure" or mostly referrals: they cannot scale what they cannot measure. That is an analytics + lead-tracking opening.',
        }),
        q('leads_per_month', 'About how many new leads or inquiries do you get a month?', 'number'),
        q('close_rate', 'Out of 10 leads, how many become customers?', 'number', { placeholder: '0–10', hint: 'Under 3 out of 10 usually means a lead-handling or lead-quality problem, not a traffic problem.' }),
        q('know_source', 'Do you know which marketing produced each customer?', 'single', { options: opts('yes|Yes, we track it', 'roughly|Roughly', 'no|No') }),
        q('paid_leads', 'Do you buy leads from Angi, Thumbtack, HomeAdvisor, Yelp or similar?', 'single', {
          options: opts('yes-happy|Yes, and they work', 'yes-unhappy|Yes, but they are expensive or low quality', 'no|No'),
          showIf: { id: 'lead_sources', in: ['directories'] },
        }),
      ],
    },
    {
      id: 'marketing',
      title: 'Marketing today',
      minutes: 6,
      questions: [
        q('doing_now', 'What marketing are you doing right now?', 'multi', {
          options: opts('website|Website', 'seo|SEO', 'gbp|Google Business Profile updates', 'google-ads|Google Ads', 'lsa|Local Services Ads', 'social-organic|Posting on social', 'social-ads|Social ads', 'email|Email newsletters', 'sms|Text message marketing', 'reviews|Asking for reviews', 'print|Print / mailers', 'nothing|Nothing consistent'),
        }),
        q('monthly_spend', 'Roughly what do you spend on marketing per month today (ads plus help)?', 'single', {
          options: opts('0|Nothing', 'lt500|Under $500', '500-1500|$500–$1,500', '1500-3000|$1,500–$3,000', '3000-7500|$3,000–$7,500', '7500+|More than $7,500'),
        }),
        q('who_manages', 'Who handles marketing today?', 'single', { options: opts('owner|Me', 'staff|Someone on staff', 'agency|An agency or freelancer', 'nobody|Nobody really') }),
        q('agency_experience', 'Have you worked with a marketing agency before? How did it go?', 'long', {
          showIf: { id: 'who_manages', in: ['agency', 'owner', 'staff', 'nobody'] },
          hint: 'Bad past agency = trust objection later. Ask what specifically went wrong (no reporting? long contracts? no results?) and make sure your proposal answers it.',
        }),
        q('what_worked', 'What has worked best so far? What was a waste of money?', 'long'),
      ],
    },
    {
      id: 'online',
      title: 'Online presence',
      minutes: 6,
      script: ["While we talk, I'm going to pull up your website and Google listing so I can see what your customers see."],
      questions: [
        q('website_status', 'How do you feel about your website?', 'single', {
          options: opts('none|We don’t have one', 'embarrassed|Embarrassed by it', 'ok|It’s OK', 'good|It works well'),
        }),
        q('website_age', 'When was the website built or last redesigned, and who can update it?', 'text', { showIf: { id: 'website_status', notIn: ['none'] } }),
        q('gbp_claimed', 'Do you control your Google Business Profile?', 'single', { options: opts('yes|Yes', 'not-sure|Not sure who has access', 'no|No / don’t have one') }),
        q('reviews_count', 'How many Google reviews do you have, and what is the rating?', 'text', { hint: 'Look it up live. Compare with the top 3 competitors in the map pack.' }),
        q('reviews_process', 'Do you have a system for asking happy customers for reviews?', 'single', { options: opts('auto|Yes, automated', 'manual|We ask sometimes', 'no|No') }),
        q('rank_check', 'When someone searches "[your main service] near me" in your town, where do you show up?', 'single', {
          options: opts('top3|Top 3 on the map', 'page1|Page 1 but not top 3', 'not-found|Can’t find us', 'unknown|Don’t know'),
          hint: 'Search it live on the call (use an incognito window). Showing them is more powerful than telling them.',
        }),
        q('ai_check', 'Have you checked whether ChatGPT or Google’s AI answers recommend you?', 'single', { options: opts('yes-shown|Yes, we show up', 'yes-not|Yes, we don’t show up', 'no|Haven’t checked') }),
        q('social_status', 'How active are you on social media?', 'single', { options: opts('active|Post weekly or more', 'sometimes|Every now and then', 'dead|Accounts exist but quiet', 'none|Not on social') }),
      ],
    },
    {
      id: 'sales',
      title: 'Lead handling and sales',
      minutes: 5,
      script: ['This is where most businesses lose money without realizing it, so bear with me for a few questions.'],
      questions: [
        q('who_answers', 'When a new lead calls, who answers?', 'single', { options: opts('owner|Me', 'office|Office staff', 'service|Answering service', 'voicemail|Often goes to voicemail') }),
        q('missed_calls', 'How many calls do you think go unanswered in a week?', 'single', { options: opts('none|Almost none', 'few|A few', 'many|A lot', 'unknown|No idea') }),
        q('after_hours', 'What happens to calls, forms and messages after hours?', 'single', { options: opts('answered|Someone answers', 'next-day|We get back next day', 'lost|Honestly, some get lost') }),
        q('speed_to_lead', 'How fast do you usually respond to a web form or message?', 'single', { options: opts('5min|Within 5 minutes', '1hr|Within an hour', 'same-day|Same day', 'next-day|Next day or later') }),
        q('quote_followup', 'When you give a quote or estimate and they don’t book, what happens?', 'single', { options: opts('system|Automatic follow-up', 'manual|We call when we remember', 'none|Nothing') }),
        q('crm', 'What software runs the business (CRM, scheduling, invoicing)?', 'text', { placeholder: 'e.g. ServiceTitan, Jobber, Housecall Pro, Dentrix, Clio, spreadsheets', hint: 'Integration matters. Note the exact tool name.' }),
        q('customer_list', 'Do you have a list of past customers with emails or phone numbers? About how many?', 'single', { options: opts('none|No list', 'lt500|Under 500', '500-2000|500–2,000', '2000+|Over 2,000') }),
      ],
    },
    {
      id: 'challenges',
      title: 'Challenges and competition',
      minutes: 5,
      questions: [
        q('biggest_problem', 'If you could wave a magic wand and fix one thing about getting customers, what would it be?', 'long', { hint: 'This is the headline of your proposal. Capture it word for word.' }),
        q('pain_level', 'How much is that costing you? (1 = minor annoyance, 5 = keeping me up at night)', 'scale'),
        q('tried_before', 'What have you already tried to fix it?', 'long'),
        q('competitors', 'Who are the 2–3 competitors you run into most?', 'long', { hint: 'Look them up after the call. Their reviews, ads and rankings go into the proposal.' }),
        q('competitor_edge', 'What do they do better than you? What do you do better than them?', 'long'),
      ],
    },
    {
      id: 'decision',
      title: 'Budget, timing and decision',
      minutes: 5,
      script: [
        "Based on what you've told me, I think we can help with [repeat their biggest problem]. Before I put a plan together, a few practical questions so I don't waste your time with something that doesn't fit.",
      ],
      questions: [
        q('budget', 'If we could show a clear return, what monthly investment would you be comfortable with to start?', 'single', {
          options: opts('lt750|Under $750', '750-1500|$750–$1,500', '1500-3000|$1,500–$3,000', '3000-6000|$3,000–$6,000', '6000+|$6,000+', 'unsure|Not sure yet'),
          hint: 'Ad spend is separate from management fees. Say so. If "not sure", offer ranges: "Most businesses like yours invest between X and Y."',
        }),
        q('timeline', 'When would you want to get started?', 'single', { options: opts('now|Right away', '30|Within 30 days', '90|In 1–3 months', 'later|Just researching') }),
        q('decision_process', 'Walk me through how you’ll make this decision. Who else is involved?', 'long'),
        q('other_options', 'Are you talking to other agencies or considering doing it in-house?', 'single', { options: opts('no|No', 'agencies|Other agencies', 'inhouse|Thinking about in-house', 'diy|Doing it ourselves') }),
        q('contract_pref', 'How do you feel about contracts and commitment length?', 'single', { options: opts('monthly|Month-to-month only', '3-6|3–6 months is fine', '12|12 months is fine if the price is right', 'unsure|Depends') }),
        q('success_measure', 'Six months from now, what would make you say "that was worth it"?', 'long'),
      ],
    },
    {
      id: 'close',
      title: 'Close and next step',
      minutes: 2,
      script: [
        'Summarize: "So the big thing is [biggest problem], it\'s costing you [their words], and a great year looks like [goal]. Did I get that right?"',
        'Book the next step on the call: "I\'ll put together a plan with what I\'d do first, the cost, and how we\'d measure it. Can we look at it together on [day] at [time]?"',
        'Ask for access early: "To make the plan specific, could you give me read-only access to Google Analytics and your Google Business Profile? It takes two minutes and you can remove it anytime."',
      ],
      questions: [
        q('next_step', 'Next step agreed', 'single', { options: opts('proposal-meeting|Proposal meeting booked', 'send-proposal|Send proposal by email', 'follow-up|Follow up later', 'not-fit|Not a fit') }),
        q('next_step_date', 'Date and time of next step', 'text', { showIf: { id: 'next_step', in: ['proposal-meeting', 'follow-up', 'send-proposal'] }, placeholder: 'e.g. Tue Oct 14, 2pm' }),
        q('access_requested', 'Access requested', 'multi', { options: opts('ga4|Google Analytics', 'gbp|Google Business Profile', 'ads|Google Ads', 'gsc|Search Console', 'social|Social accounts', 'website|Website login') }),
        q('rep_notes', 'Anything else the team should know?', 'long', { optional: true }),
      ],
    },
  ],
};
