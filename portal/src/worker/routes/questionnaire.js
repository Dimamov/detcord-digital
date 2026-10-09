// The client questionnaire: staff invite a client into their portal to review their website check and answer the
// business questions themselves. Answers land in the rep's open discovery, marked as client-entered.
import { Hono } from 'hono';
import { fail, now, newId, text, oneOf, readJson, logActivity, cleanEmail } from '../lib/util.js';
import { requireClient, isStaff } from '../lib/auth.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { sendSms, toE164, twilioConfig } from '../lib/sms.js';
import { portalLink, peopleFor } from './audits.js';
import { cleanAnswers } from './discovery.js';
import { openDiscovery, createDiscovery, mutateDiscovery } from '../lib/discovery.js';
import { applyClientAnswers } from '../../shared/discovery/prefill.js';
import { questionnaireSections, questionnaireIds, QUESTIONNAIRE_INTRO } from '../../shared/discovery/questionnaire.js';

const r = new Hono();
const originOf = (c) => c.env.PUBLIC_URL || new URL(c.req.url).origin;
const pathFor = (clientId) => `/questionnaire/${clientId}`;

// The rep who should hear about it: the discovery's rep, else everyone assigned to the client.
async function repsFor(db, clientId, d) {
  const assigned = (await db.prepare('SELECT u.id, u.name, u.email FROM assignments a JOIN users u ON u.id=a.user_id WHERE a.client_id=? AND u.status=\'active\'').bind(clientId).all()).results;
  if (d?.rep_id) {
    const rep = await db.prepare("SELECT id, name, email FROM users WHERE id=? AND status='active'").bind(d.rep_id).first();
    if (rep) return [rep];
  }
  return assigned;
}

// The open discovery, or a new one run by the assigned rep when there is none.
async function ensureDiscovery(db, client, actorId, summary) {
  const open = await openDiscovery(db, client.id);
  if (open) return open;
  const rep = (await repsFor(db, client.id, null))[0];
  const { id } = await createDiscovery(db, { client, repId: rep?.id, actorId, industry: client.industry, summary });
  return openDiscovery(db, client.id).then((d) => d || fail(500, `Discovery ${id} was not saved.`));
}

const latestReport = (db, clientId, { sharedOnly }) => db.prepare(`SELECT id, score, shared_at FROM audits WHERE client_id=? AND status='done' ${sharedOnly ? 'AND shared_at IS NOT NULL' : ''} ORDER BY finished_at DESC LIMIT 1`).bind(clientId).first();

// ---------- Staff: status and invite ----------

r.get('/clients/:id/questionnaire', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const [d, report, logins, contacts] = await Promise.all([
    openDiscovery(db, client.id),
    latestReport(db, client.id, { sharedOnly: false }),
    db.prepare('SELECT u.name, u.email, u.phone, u.status FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? ORDER BY u.name').bind(client.id).all(),
    db.prepare('SELECT name, email, phone FROM contacts WHERE client_id=? ORDER BY is_primary DESC, name').bind(client.id).all(),
  ]);
  return c.json({
    discovery: d && { id: d.id, invitedAt: d.client_invited_at, submittedAt: d.client_submitted_at, clientAnswered: Object.keys(d.client_answers).length },
    report: report && { id: report.id, score: report.score, shared: !!report.shared_at },
    people: peopleFor(client, logins.results, contacts.results),
    channels: { email: !!c.env.RESEND_API_KEY, sms: twilioConfig(c.env).ready },
  });
});

// One invite = one message to one person: a portal link (password setup the first time) that opens the
// questionnaire, with the latest website check shared into their portal alongside it.
r.post('/clients/:id/questionnaire/invite', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const body = await readJson(c);
  const channel = oneOf(body.channel, ['email', 'sms'], 'Channel');
  const name = text(body.name, { max: 120, required: true, label: 'Name' });
  const email = cleanEmail(body.email);
  let to = email;
  if (channel === 'sms') {
    // Texting a customer requires their permission (TCPA). Staff confirm it for every send.
    to = toE164(body.phone);
    if (!to) fail(400, 'Enter a valid US mobile number.');
    if (body.consent !== true) fail(400, 'Confirm the customer agreed to receive this by text.');
  }
  const report = await latestReport(db, client.id, { sharedOnly: false });
  const link = await portalLink(c, client, report?.id, { name, email, phone: channel === 'sms' ? to : text(body.phone, { max: 40 }) }, { next: pathFor(client.id), purpose: 'answer the business questionnaire' });
  const d = await ensureDiscovery(db, client, user.id, 'Started a discovery from the client questionnaire invite');
  // Whoever sends the invite hears back when the client finishes, unless a rep already runs this discovery.
  await db.prepare('UPDATE discoveries SET client_invited_at=COALESCE(client_invited_at, ?), rep_id=COALESCE(rep_id, ?) WHERE id=?').bind(now(), user.id, d.id).run();
  if (report && !report.shared_at) await db.prepare('UPDATE audits SET shared_at=? WHERE id=?').bind(now(), report.id).run();

  const first = name.split(/\s+/)[0];
  const invite = link.kind === 'invite';
  const honest = 'Please be as thorough and honest as you can: there are no wrong answers, and the better we understand how things really are today, the better our recommendations will be.';
  let sent;
  if (channel === 'email') {
    const mail = renderEmail({
      origin: originOf(c),
      heading: `Your ${client.name} questionnaire`,
      paragraphs: [
        `Hi ${first}, ${user.name} from Detcord Digital here.`,
        report
          ? `Your Detcord portal now has your website and Google check (${report.score}/100) for you to review, and a short questionnaire about the business: your customers, goals, marketing and what's getting in the way.`
          : 'Your Detcord portal has a short questionnaire about the business: your customers, goals, marketing and what\'s getting in the way.',
        honest,
        'It takes about 10 minutes, saves as you go, and you can stop and come back any time.',
        invite ? 'Create a password to open it; you can sign in any time after that.' : 'Sign in to your portal to open it.',
      ],
      button: { label: invite ? 'Open my portal' : 'Answer the questions', url: link.url },
      footnote: invite ? `This setup link works once and expires in 7 days. After that, sign in at ${originOf(c)}. Questions? Just reply to this email.` : 'Questions? Just reply to this email.',
    });
    sent = await sendEmail(c.env, { to: email, subject: `${client.name}: ${report ? 'your website report and ' : ''}a few questions before we make recommendations`, ...mail, idempotencyKey: `questionnaire/${client.id}/${email}/${Math.floor(now() / 60000)}` });
  } else {
    const msg = `Hi ${first}, ${report ? 'your website report and ' : ''}a short business questionnaire for ${client.name} are in your Detcord portal. Thorough, honest answers get you the best recommendations: ${link.url} Reply STOP to opt out.`;
    sent = await sendSms(c.env, { to, body: msg });
  }
  // The report's "Sent" list shows this message too.
  if (report) {
    await db.prepare('INSERT INTO audit_deliveries (id, audit_id, channel, recipient, user_id, link_kind, status, error, provider_id, sent_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(newId(), report.id, channel, to, link.user.id, link.kind, sent.status, sent.error || null, sent.id || null, user.id, now()).run();
  }
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'questionnaire', summary: sent.status === 'sent'
    ? `Invited ${name} (${to}) by ${channel === 'sms' ? 'text' : 'email'} to review the website report and answer the questionnaire`
    : `Created a questionnaire link for ${name}; ${channel === 'sms' ? 'texting' : 'email'} is not set up, so it was not sent` });
  return c.json({
    status: sent.status, error: sent.error || null, linkKind: link.kind, discoveryId: d.id,
    // When nothing was delivered, staff get the link to pass on themselves.
    manualLink: sent.status === 'sent' ? null : link.url,
  }, sent.status === 'sent' ? 200 : sent.status === 'not_configured' ? 503 : 502);
});

// ---------- The client's questionnaire (their portal; staff can preview) ----------

r.get('/questionnaire/:clientId', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('clientId'));
  const db = c.env.DB;
  const [d, report] = await Promise.all([openDiscovery(db, client.id), latestReport(db, client.id, { sharedOnly: true })]);
  const industry = d?.industry ?? client.industry;
  const sections = questionnaireSections(industry);
  const ids = questionnaireIds(industry);
  // The client sees what they entered, plus what they told us on the intake form. Never the rep's notes.
  const answers = {};
  for (const [id, v] of Object.entries(d?.answers || {})) if (ids.has(id) && d.marks[id]?.source === 'intake') answers[id] = v;
  Object.assign(answers, d?.client_answers || {});
  return c.json({
    preview: isStaff(user),
    clientId: client.id,
    business: client.name,
    intro: QUESTIONNAIRE_INTRO,
    sections,
    answers,
    invitedAt: d?.client_invited_at || null,
    submittedAt: d?.client_submitted_at || null,
    report: report && { id: report.id, score: report.score },
  });
});

// Client autosave. Only questionnaire questions are accepted; rep-only answers can't be written from here.
r.patch('/questionnaire/:clientId', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('clientId'));
  if (isStaff(user)) fail(403, 'This is the client\'s questionnaire. Edit answers in the discovery call instead.');
  const db = c.env.DB;
  const b = await readJson(c);
  const d = await ensureDiscovery(db, client, user.id, 'Client started the business questionnaire');
  const ids = questionnaireIds(d.industry);
  const raw = Object.fromEntries(Object.entries(b.answers || {}).filter(([k]) => ids.has(k)));
  const clean = cleanAnswers(raw, d.industry, d.modules);
  const { savedAt } = await mutateDiscovery(db, d.id, (s) => { applyClientAnswers(s, clean, now()); });
  return c.json({ ok: true, savedAt });
});

// Done: the rep gets a task and an email the first time; the client sees what happens next.
r.post('/questionnaire/:clientId/submit', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('clientId'));
  if (isStaff(user)) fail(403, 'Only the client can submit their questionnaire.');
  const db = c.env.DB;
  const d = await ensureDiscovery(db, client, user.id, 'Client started the business questionnaire');
  const first = await db.prepare('UPDATE discoveries SET client_submitted_at=? WHERE id=? AND client_submitted_at IS NULL').bind(now(), d.id).run();
  if (first.meta.changes) {
    const reps = await repsFor(db, client.id, d);
    const t = now();
    if (reps.length) {
      await db.batch(reps.map((rep) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), client.id, rep.id, `Review ${client.name}'s questionnaire answers`, t + 86400000, user.id, t)));
      const url = `${originOf(c)}/discovery/${d.id}`;
      const n = Object.keys(d.client_answers).length;
      for (const rep of reps) {
        const mail = renderEmail({
          origin: originOf(c),
          heading: `${client.name} answered the questionnaire`,
          paragraphs: [`Hi ${rep.name.split(/\s+/)[0]},`, `${user.name} finished the business questionnaire for ${client.name} (${n} answer${n === 1 ? '' : 's'}). Their answers are in the discovery, marked "Entered by the client" until you confirm them.`],
          button: { label: 'Open the discovery', url },
        });
        await sendEmail(c.env, { to: rep.email, subject: `${client.name} answered the questionnaire`, ...mail, idempotencyKey: `questionnaire-done/${d.id}/${rep.id}` });
      }
    }
    await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'questionnaire', summary: `${user.name} submitted the business questionnaire` });
  }
  return c.json({ ok: true, submittedAt: now() });
});

export default r;
