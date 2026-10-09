// Proposals: staff check services and generate a draft, edit it, then share it. The client reads it in
// their portal and accepts or asks a question. Accepting starts a draft agreement with the proposal's
// services and prices; the rep sets term and deposit and sends it. Nothing is signed or billed. Clients see only shared or accepted proposals of their own business,
// with the same 404 for "not yours", "not shared" and "missing".
import { Hono } from 'hono';
import { fail, now, newId, readJson, logActivity, text } from '../lib/util.js';
import { requireUser, requireClient, isStaff, clientScopeSql } from '../lib/auth.js';
import { aiReady, originFor } from '../lib/goat.js';
import { sendEmail, renderEmail } from '../lib/email.js';
import { getSettings } from '../lib/settings.js';
import { cleanServices, builderServices, cleanContent, clientContent, investment, generateProposal, saveVersion, repsFor, TASK_DUE } from '../lib/proposals.js';
import { startAgreement } from './contracts.js';

const r = new Hono();
const json = (s) => (s ? JSON.parse(s) : null);
const STATUS = { draft: 'Draft', shared: 'Shared', accepted: 'Accepted' };
const VISIBLE = ['shared', 'accepted'];

async function loadProposal(c, id, { staffOnly = false } = {}) {
  const user = requireUser(c);
  if (staffOnly && !isStaff(user)) fail(403, 'You do not have access to this.');
  const p = await c.env.DB.prepare('SELECT * FROM proposals WHERE id=?').bind(id).first();
  if (!p || (!isStaff(user) && !VISIBLE.includes(p.status))) fail(404, 'Proposal not found.');
  let client;
  try {
    ({ client } = await requireClient(c, p.client_id));
  } catch {
    fail(404, 'Proposal not found.');
  }
  return { user, client, p };
}

async function names(db, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = (await db.prepare(`SELECT id, name FROM users WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list).all()).results;
  return Object.fromEntries(rows.map((u) => [u.id, u.name]));
}

function listRow(x) {
  return {
    id: x.id, client_id: x.client_id, client_name: x.client_name, title: x.title, status: x.status, status_label: STATUS[x.status],
    services: json(x.services).map((s) => s.name), investment: investment(json(x.services)), draft_source: x.draft_source, edited: !!x.edited, version: x.version,
    created_at: x.created_at, generated_at: x.generated_at, shared_at: x.shared_at, accepted_at: x.accepted_at, contract_id: x.contract_id,
  };
}

const questionsOf = async (db, id) => (await db.prepare('SELECT id, version, note, author_name, created_at FROM proposal_questions WHERE proposal_id=? ORDER BY created_at DESC').bind(id).all()).results;

async function staffView(c, p, client) {
  const db = c.env.DB;
  const versions = (await db.prepare('SELECT id, kind, version, content, services, created_by, created_at FROM proposal_versions WHERE proposal_id=? ORDER BY created_at DESC LIMIT 30').bind(p.id).all()).results;
  const who = await names(db, [p.generated_by, p.edited_by, p.shared_by, p.unshared_by, p.created_by, ...versions.map((v) => v.created_by)]);
  const contract = p.contract_id ? await db.prepare('SELECT id, number, status FROM contracts WHERE id=?').bind(p.contract_id).first() : null;
  return {
    ...listRow({ ...p, client_name: client.name }),
    services: json(p.services), content: json(p.content), facts: json(p.facts), draft: json(p.draft), error: p.error,
    generated_by: who[p.generated_by] || null, edited_by: who[p.edited_by] || null, edited_at: p.edited_at, shared_by: who[p.shared_by] || null,
    unshared_by: who[p.unshared_by] || null, unshared_at: p.unshared_at, created_by: who[p.created_by] || null, delivery: json(p.delivery),
    accepted_name: p.accepted_name, contract, questions: await questionsOf(db, p.id),
    versions: versions.map((v) => ({ id: v.id, kind: v.kind, version: v.version, by: who[v.created_by] || null, at: v.created_at, services: json(v.services).map((s) => s.name), investment: investment(json(v.services)), content: json(v.content) })),
    ready: { ai: aiReady(c.env), email: !!c.env.RESEND_API_KEY },
  };
}

const fresh = (db, id) => db.prepare('SELECT * FROM proposals WHERE id=?').bind(id).first();

// ---------- Staff: one client's proposals and the builder ----------

r.get('/clients/:id/proposals', async (c) => {
  const { client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const rows = (await c.env.DB.prepare('SELECT * FROM proposals WHERE client_id=? ORDER BY created_at DESC LIMIT 50').bind(client.id).all()).results;
  return c.json({
    proposals: rows.map((x) => listRow({ ...x, client_name: client.name })),
    services: await builderServices(c.env.DB, client.id),
    ready: { ai: aiReady(c.env), email: !!c.env.RESEND_API_KEY },
  });
});

// Creates a proposal from the checked services and drafts it straight away (Claude when set up).
r.post('/clients/:id/proposals', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'), { staffOnly: true });
  const db = c.env.DB;
  const b = await readJson(c);
  const services = await cleanServices(db, b.services);
  const title = text(b.title, { max: 160 }) || `Marketing proposal for ${client.name}`;
  const id = newId();
  const t = now();
  await db.prepare(`INSERT INTO proposals (id, client_id, title, status, services, content, created_by, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)`)
    .bind(id, client.id, title, JSON.stringify(services), JSON.stringify(cleanContent({}, services)), user.id, t, t).run();
  const out = await generateProposal(c.env, { proposal: await fresh(db, id), client, userId: user.id });
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'proposal', summary: `Started a proposal: ${services.map((s) => s.name).join(', ')}${out.source === 'ai' ? ' (drafted by Claude)' : ''}`.slice(0, 300) });
  return c.json({ proposal: await staffView(c, await fresh(db, id), client), error: out.error }, 201);
});

// ---------- Proposals list (clients: shared and accepted ones of their business; staff: their clients') ----------

r.get('/proposals', async (c) => {
  const user = requireUser(c);
  const scope = clientScopeSql(user);
  const rows = (await c.env.DB.prepare(`SELECT p.*, cl.name AS client_name FROM proposals p JOIN clients cl ON cl.id=p.client_id
    WHERE ${scope.sql}${isStaff(user) ? '' : " AND p.status IN ('shared','accepted')"} ORDER BY COALESCE(p.shared_at, p.created_at) DESC LIMIT 100`).bind(...scope.binds).all()).results;
  return c.json({ proposals: rows.map((x) => (isStaff(user) ? listRow(x) : { id: x.id, client_id: x.client_id, client_name: x.client_name, title: x.title, status: x.status, services: json(x.services).map((s) => s.name), shared_at: x.shared_at, accepted_at: x.accepted_at })) });
});

r.get('/proposals/:id', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'));
  if (isStaff(user)) return c.json({ staff: true, proposal: await staffView(c, p, client) });
  const company = await getSettings(c.env.DB, 'company.');
  return c.json({
    staff: false,
    proposal: {
      id: p.id, business: client.name, title: p.title, status: p.status, version: p.version, shared_at: p.shared_at,
      accepted_at: p.accepted_at, accepted_name: p.accepted_name, content: clientContent(json(p.content)), investment: investment(json(p.services)),
      questions: (await questionsOf(c.env.DB, p.id)).map(({ id, note, author_name, created_at }) => ({ id, note, author_name, created_at })),
    },
    contact: { email: company.email || 'info@detcorddigital.com', phone: company.phone || null },
  });
});

// ---------- Edit, generate, share, unshare ----------

r.patch('/proposals/:id', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  if (p.status !== 'draft') fail(409, 'This proposal is shared with the client. Unshare it before editing.');
  const db = c.env.DB;
  const b = await readJson(c);
  const services = b.services !== undefined ? await cleanServices(db, b.services) : json(p.services);
  const title = b.title !== undefined ? text(b.title, { max: 160, required: true, label: 'Title' }) : p.title;
  // Changing the checked services keeps what was written for the ones that stay.
  const content = JSON.stringify(cleanContent(b.content !== undefined ? b.content : json(p.content), services));
  const sets = ['title=?', 'services=?', 'updated_at=?'];
  const binds = [title, JSON.stringify(services), now()];
  if (content !== p.content) { sets.push('content=?', 'edited=1', 'edited_by=?', 'edited_at=?'); binds.push(content, user.id, now()); }
  const res = await db.prepare(`UPDATE proposals SET ${sets.join(', ')} WHERE id=? AND status='draft'`).bind(...binds, p.id).run();
  if (!res.meta.changes) fail(409, 'This proposal was shared while you were editing. Unshare it to make changes.');
  return c.json({ proposal: await staffView(c, await fresh(db, p.id), client) });
});

r.post('/proposals/:id/generate', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  const b = await readJson(c);
  let out;
  try {
    out = await generateProposal(c.env, { proposal: p, client, userId: user.id, overwrite: b.overwrite === true });
  } catch (e) {
    if (e.needsConfirm) return c.json({ error: e.message, needsConfirm: true }, 409);
    throw e;
  }
  if (!out.kept) await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'proposal', summary: `Regenerated the proposal "${p.title}"${out.source === 'ai' ? ' (drafted by Claude)' : ''}` });
  return c.json({ proposal: await staffView(c, await fresh(c.env.DB, p.id), client), error: out.error }, out.kept ? 502 : 200);
});

// Shares the proposal (a new numbered version) and optionally emails the client's portal logins a link.
// Without email set up, nothing is claimed as sent and staff get the link to pass on.
r.post('/proposals/:id/share', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  if (p.status !== 'draft') fail(409, 'This proposal is already shared.');
  const content = json(p.content);
  if (!content.intro || content.services.some((s) => !s.why)) fail(400, 'Write the introduction and why we chose each service before sharing.');
  const b = await readJson(c);
  const db = c.env.DB;
  const t = now();
  const version = p.version + 1;
  const res = await db.prepare("UPDATE proposals SET status='shared', version=?, shared_by=?, shared_at=?, updated_at=? WHERE id=? AND status='draft'").bind(version, user.id, t, t, p.id).run();
  if (!res.meta.changes) fail(409, 'This proposal is already shared.');
  await saveVersion(db, { id: p.id, kind: 'shared', version, services: json(p.services), content, userId: user.id });
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'proposal', internal: false, summary: `Shared the proposal "${p.title}" (version ${version})` });

  const origin = originFor(c.env, c.req.url);
  const link = `${origin}/proposals/${p.id}`;
  const delivery = [];
  if (b.email === true) {
    const people = (await db.prepare("SELECT u.name, u.email, u.status FROM client_members m JOIN users u ON u.id=m.user_id WHERE m.client_id=? AND u.role='client' AND u.status<>'disabled' ORDER BY u.name").bind(client.id).all()).results;
    for (const x of people) {
      if (x.status !== 'active') { delivery.push({ name: x.name, email: x.email, status: 'skipped', error: 'Hasn’t set up their portal password yet.' }); continue; }
      if (!c.env.RESEND_API_KEY) { delivery.push({ name: x.name, email: x.email, status: 'not_configured', error: 'Email sending is not set up (RESEND_API_KEY).' }); continue; }
      const mail = renderEmail({
        origin,
        heading: 'Your proposal from Detcord Digital',
        paragraphs: [`Hi ${x.name.split(/\s+/)[0]},`, `Your proposal for ${client.name} is ready in your Detcord portal. It covers the services we recommend, why we chose each one, and how they answer what you told us.`, 'You can ask us a question or accept it right there.'],
        button: { label: 'Read my proposal', url: link },
        footnote: 'Questions? Just reply to this email.',
      });
      const sent = await sendEmail(c.env, { to: x.email, subject: `${client.name}: your proposal from Detcord Digital`, ...mail, idempotencyKey: `proposal/${p.id}/${version}/${x.email}` });
      delivery.push({ name: x.name, email: x.email, status: sent.status, error: sent.error || null });
    }
    await db.prepare('UPDATE proposals SET delivery=? WHERE id=?').bind(JSON.stringify(delivery), p.id).run();
    const ok = delivery.filter((d) => d.status === 'sent');
    if (ok.length) await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'proposal', summary: `Emailed the proposal to ${ok.map((d) => d.email).join(', ')}` });
  }
  return c.json({ proposal: await staffView(c, await fresh(db, p.id), client), delivery, link, email: { configured: !!c.env.RESEND_API_KEY } });
});

// Takes a shared proposal back so it can be edited. An accepted proposal stays as the client accepted it.
r.post('/proposals/:id/unshare', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  if (p.status === 'accepted') fail(409, 'The client accepted this proposal. It can’t be changed; start a new one instead.');
  if (p.status !== 'shared') fail(409, 'This proposal is not shared.');
  const b = await readJson(c);
  const reason = text(b.reason, { max: 300 });
  const res = await c.env.DB.prepare("UPDATE proposals SET status='draft', unshared_by=?, unshared_at=?, updated_at=? WHERE id=? AND status='shared'").bind(user.id, now(), now(), p.id).run();
  if (!res.meta.changes) fail(409, 'This proposal changed. Reload and try again.');
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'proposal', summary: `Unshared the proposal "${p.title}" (version ${p.version})${reason ? `: ${reason}` : ''}` });
  return c.json({ proposal: await staffView(c, await fresh(c.env.DB, p.id), client) });
});

r.delete('/proposals/:id', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  if (p.status !== 'draft') fail(409, p.status === 'accepted' ? 'Accepted proposals are kept.' : 'Unshare this proposal before deleting it.');
  await c.env.DB.prepare("DELETE FROM proposals WHERE id=? AND status='draft'").bind(p.id).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'proposal', summary: `Deleted the proposal draft "${p.title}"` });
  return c.json({ ok: true });
});

// ---------- To agreement ----------

// Exactly the proposal's services, prices and scope lines, with current catalog names.
async function agreementServices(db, services) {
  const names = new Map((await db.prepare('SELECT id, name FROM services').all()).results.map((s) => [s.id, s.name]));
  return services.filter((s) => names.has(s.serviceId)).map((s) => ({
    serviceId: s.serviceId, name: names.get(s.serviceId), setupCents: s.setupCents ?? null, monthlyCents: s.monthlyCents ?? null, scope: s.scope || '',
  }));
}

// Starts the proposal's draft agreement once. `owner` is the staff member it is created for.
async function toAgreement(db, { p, client, owner }) {
  const services = await agreementServices(db, json(p.services));
  const { id, number } = await startAgreement(db, { user: owner, client, services, title: `${client.name} marketing services agreement` });
  const res = await db.prepare('UPDATE proposals SET contract_id=?, updated_at=? WHERE id=? AND contract_id IS NULL').bind(id, now(), p.id).run();
  if (!res.meta.changes) {
    await db.prepare("DELETE FROM contracts WHERE id=? AND status='draft'").bind(id).run();
    return null;
  }
  return { id, number };
}

// Staff can start the agreement by hand (for example when the client agreed by phone).
r.post('/proposals/:id/agreement', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'), { staffOnly: true });
  if (p.contract_id && await c.env.DB.prepare('SELECT 1 FROM contracts WHERE id=?').bind(p.contract_id).first()) {
    return c.json({ error: 'This proposal already has an agreement.', id: p.contract_id }, 409);
  }
  if (p.contract_id) await c.env.DB.prepare('UPDATE proposals SET contract_id=NULL WHERE id=?').bind(p.id).run();
  const made = await toAgreement(c.env.DB, { p: { ...p, contract_id: null }, client, owner: user });
  if (!made) fail(409, 'This proposal already has an agreement.');
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'contract', summary: `Started agreement ${made.number} from the proposal "${p.title}"` });
  return c.json(made, 201);
});

// ---------- Client response ----------

// The client accepts the shared version. Only that business's logins can, only while it is shared, and
// only once. It records who and when, starts a draft agreement with the accepted services and prices for
// the rep to finish (term, deposit) and send, and tells the reps. Nothing is signed, invoiced or switched on.
r.post('/proposals/:id/accept', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client can accept their proposal.');
  if (p.status === 'accepted') fail(409, 'This proposal was already accepted.');
  const db = c.env.DB;
  const t = now();
  const res = await db.prepare("UPDATE proposals SET status='accepted', accepted_by=?, accepted_name=?, accepted_at=?, updated_at=? WHERE id=? AND status='shared' AND accepted_at IS NULL")
    .bind(user.id, user.name, t, t, p.id).run();
  if (!res.meta.changes) fail(409, 'This proposal is no longer open. Reload the page.');
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'proposal', internal: false, summary: `${user.name} accepted the proposal "${p.title}" (version ${p.version})` });

  const reps = await repsFor(db, client.id);
  // The agreement belongs to whoever shared the proposal, else the first rep to be told.
  const ownerId = p.shared_by || p.created_by;
  const owner = (ownerId && await db.prepare("SELECT id, name FROM users WHERE id=? AND role IN ('admin','rep')").bind(ownerId).first()) || reps[0] || { id: null, name: '' };
  const made = p.contract_id ? null : await toAgreement(db, { p, client, owner });
  const agreement = made || (p.contract_id ? await db.prepare('SELECT id, number FROM contracts WHERE id=?').bind(p.contract_id).first() : null);
  if (made) await logActivity(db, { clientId: client.id, actorId: owner.id, kind: 'contract', summary: `Started draft agreement ${made.number} from the accepted proposal` });

  const origin = originFor(c.env, c.req.url);
  const url = agreement ? `${origin}/contracts/${agreement.id}` : `${origin}/proposals/${p.id}`;
  if (reps.length) {
    await db.batch(reps.map((s) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,NULL,?)')
      .bind(newId(), client.id, s.id, `${client.name} accepted the proposal: finish and send agreement${agreement ? ` ${agreement.number}` : ''}`.slice(0, 300), t + TASK_DUE, t)));
  }
  for (const s of reps) {
    const mail = renderEmail({
      origin,
      heading: `${client.name} accepted the proposal`,
      paragraphs: [`${user.name} accepted "${p.title}" in the portal.`, agreement ? `A draft agreement (${agreement.number}) is ready with the proposal’s services and prices. Set the term and deposit, check it, then send it for signature.` : 'Start the agreement from the proposal page.', 'Nothing has been signed or billed.'],
      button: { label: agreement ? 'Open the agreement' : 'Open the proposal', url },
    });
    await sendEmail(c.env, { to: s.email, subject: `Proposal accepted: ${client.name}`, ...mail, idempotencyKey: `proposal-accepted/${p.id}/${s.id}` });
  }
  return c.json({ ok: true, acceptedAt: t });
});

// The client asks a question or for changes. The note is kept on the proposal and the reps get a task
// and an email; the shared version stays as it is.
r.post('/proposals/:id/questions', async (c) => {
  const { user, client, p } = await loadProposal(c, c.req.param('id'));
  if (user.role !== 'client') fail(403, 'Only the client can ask about their proposal.');
  if (p.status !== 'shared') fail(409, 'This proposal is no longer open for questions. Write to your Detcord team instead.');
  const db = c.env.DB;
  const b = await readJson(c);
  const note = text(b.note, { max: 4000, required: true, label: 'Your question' });
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM proposal_questions WHERE proposal_id=? AND created_at>?').bind(p.id, now() - TASK_DUE).first();
  if (recent.n >= 20) fail(429, 'You’ve sent a lot of questions today. Your Detcord team will be in touch.');
  const id = newId();
  const t = now();
  const reps = await repsFor(db, client.id);
  await db.batch([
    db.prepare('INSERT INTO proposal_questions (id, proposal_id, version, note, author_id, author_name, created_at) VALUES (?,?,?,?,?,?,?)').bind(id, p.id, p.version, note, user.id, user.name, t),
    ...reps.map((s) => db.prepare('INSERT INTO tasks (id, client_id, owner_id, title, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), client.id, s.id, `Answer ${client.name}'s question on the proposal`.slice(0, 300), t + TASK_DUE, user.id, t)),
  ]);
  await logActivity(db, { clientId: client.id, actorId: user.id, kind: 'proposal', internal: false, summary: `${user.name} asked about the proposal "${p.title}"` });
  const origin = originFor(c.env, c.req.url);
  let emailed = 0;
  for (const s of reps) {
    const mail = renderEmail({
      origin,
      heading: `${client.name} has a question about the proposal`,
      paragraphs: [`${user.name} wrote:`, note, 'To change the proposal, unshare it, edit it and share it again.'],
      button: { label: 'Open the proposal', url: `${origin}/proposals/${p.id}` },
    });
    const res = await sendEmail(c.env, { to: s.email, subject: `Question on the proposal: ${client.name}`, ...mail, idempotencyKey: `proposal-question/${id}/${s.id}` });
    if (res.status === 'sent') emailed++;
  }
  return c.json({ ok: true, id, emailed }, 201);
});

export default r;
