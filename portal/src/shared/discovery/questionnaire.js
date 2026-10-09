// The client questionnaire: the discovery questions a business owner can answer on their own, in the portal.
// Rep-only questions (who is on the call, budget probing, competing quotes, contract terms, what the rep looks up
// live, next steps and notes) are left out by design: this is an allowlist, so new master questions stay rep-only
// until they are added here. Talk-track hints are never shown to clients.
import { MASTER } from './master.js';
import { industryById } from './industries.js';

export const QUESTIONNAIRE_INTRO = 'Please be as thorough and honest as you can. There are no wrong answers, and the more we know about how things really are today, the better our recommendations will be. Your answers save as you go, so you can stop and come back any time.';

// Section → question ids, with client-facing titles. Optional rewording where the rep's version reads like a script.
const SECTIONS = [
  { id: 'business', title: 'Your business', ids: ['years', 'team_size', 'locations', 'service_area', 'top_services', 'want_more_of', 'avg_ticket', 'repeat_value', 'capacity', 'seasonality'] },
  { id: 'goals', title: 'Your goals', ids: ['trigger', 'goal_12mo', 'goal_type', 'goal_why'] },
  { id: 'customers', title: 'Your customers', ids: ['ideal_customer', 'lead_sources', 'leads_per_month', 'close_rate', 'know_source', 'paid_leads'] },
  { id: 'marketing', title: 'Your marketing today', ids: ['doing_now', 'monthly_spend', 'who_manages', 'agency_experience', 'what_worked'] },
  { id: 'online', title: 'Online', ids: ['website_status', 'gbp_claimed', 'reviews_process', 'social_status', 'ai_check'] },
  { id: 'sales', title: 'Calls and follow-up', ids: ['who_answers', 'missed_calls', 'after_hours', 'speed_to_lead', 'quote_followup', 'crm', 'customer_list'] },
  { id: 'challenges', title: 'Challenges', ids: ['biggest_problem', 'pain_level', 'tried_before', 'competitors', 'competitor_edge'] },
  { id: 'timing', title: 'Timing', ids: ['timeline', 'success_measure'] },
];

const WORDING = {
  trigger: 'What made you reach out to us now?',
  pain_level: 'How much is that biggest challenge costing you? (1 = minor annoyance, 5 = keeping me up at night)',
  capacity: 'If your leads doubled next month, could you handle the work?',
  agency_experience: 'Have you worked with a marketing agency or freelancer before? How did it go?',
  close_rate: 'Out of 10 new leads, about how many become customers?',
};

const masterById = Object.fromEntries(MASTER.sections.flatMap((s) => s.questions.map((qu) => [qu.id, qu])));

// Strips rep-only fields and applies client wording. Every question is optional for the client.
const forClient = (qu) => ({ id: qu.id, q: WORDING[qu.id] || qu.q, type: qu.type, options: qu.options, placeholder: qu.placeholder || (qu.type === 'long' ? 'Your answer, in your own words…' : undefined), showIf: qu.showIf, optional: true });

export function questionnaireSections(industryId) {
  const out = SECTIONS.map((s) => ({ id: s.id, title: s.title, questions: s.ids.map((id) => masterById[id]).filter(Boolean).map(forClient) }));
  const ind = industryById[industryId];
  // Industry questions go right after "Your business", as in the call.
  if (ind) out.splice(1, 0, { id: `industry:${ind.id}`, title: 'About your work', questions: ind.questions.map(forClient) });
  return out;
}

export const questionnaireIds = (industryId) => new Set(questionnaireSections(industryId).flatMap((s) => s.questions.map((qu) => qu.id)));
