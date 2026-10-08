// Client files in R2. Every list, preview and download checks the client scope on the server,
// and internal files are invisible to client logins (same 404 as a missing file).
import { Hono } from 'hono';
import { fail, now, newId, text, oneOf, readJson, logActivity } from '../lib/util.js';
import { requireClient, isStaff } from '../lib/auth.js';

const r = new Hono();
const MAX_BYTES = 25 * 1024 * 1024;
const PURPOSES = ['logo', 'photo', 'flyer', 'document', 'report', 'contract', 'website', 'social', 'other'];

// Allowed types. Images and PDFs are shown inline; everything else downloads.
export const TYPES = {
  'image/png': 'inline', 'image/jpeg': 'inline', 'image/webp': 'inline', 'image/gif': 'inline', 'image/heic': 'attachment', 'image/heif': 'attachment',
  'application/pdf': 'inline',
  'application/msword': 'attachment', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'attachment',
  'application/vnd.ms-excel': 'attachment', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'attachment',
  'application/vnd.ms-powerpoint': 'attachment', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'attachment',
  'text/csv': 'attachment', 'text/plain': 'attachment',
  'application/zip': 'attachment', 'application/postscript': 'attachment', 'application/illustrator': 'attachment', 'image/vnd.adobe.photoshop': 'attachment',
  'video/mp4': 'attachment', 'video/quicktime': 'attachment',
};
export const EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', eps: 'application/postscript', ai: 'application/illustrator', psd: 'image/vnd.adobe.photoshop', mp4: 'video/mp4', mov: 'video/quicktime' };

// Check the first bytes for types a browser would render, so a renamed file cannot pose as an image or PDF.
export function sniff(bytes, type) {
  const b = (i) => bytes[i];
  const at = (i, s) => [...s].every((ch, k) => b(i + k) === ch.charCodeAt(0));
  switch (type) {
    case 'image/png': return b(0) === 0x89 && at(1, 'PNG');
    case 'image/jpeg': return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
    case 'image/gif': return at(0, 'GIF8');
    case 'image/webp': return at(0, 'RIFF') && at(8, 'WEBP');
    case 'application/pdf': return at(0, '%PDF-');
    default: return true;
  }
}

export const safeName = (name) => String(name || 'file').replace(/[\\/\u0000-\u001f"<>|:*?]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || 'file';

// Saves a file that arrived without a browser upload (an email or text attachment).
// Returns the media id, or null when the type is not allowed or the bytes don't match it.
export async function storeInboundFile(env, { clientId, filename, contentType, bytes, purpose = 'other', note = null }) {
  if (!env.MEDIA || !clientId) return null;
  const name = safeName(filename);
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const declared = String(contentType || '').split(';')[0].trim().toLowerCase();
  const type = TYPES[declared] ? declared : EXT[ext];
  if (!type || !bytes?.length || bytes.length > MAX_BYTES || !sniff(bytes, type)) return null;
  const id = newId();
  const key = `clients/${clientId}/${id}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { filename: name, clientId, uploader: 'inbound' } });
  await env.DB.prepare('INSERT INTO media (id, client_id, uploader_id, filename, content_type, size, r2_key, visibility, purpose, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, clientId, null, name, type, bytes.length, key, 'shared', purpose, note, now()).run();
  return id;
}

function bucket(c) {
  if (!c.env.MEDIA) fail(503, 'File storage is not set up yet.');
  return c.env.MEDIA;
}

r.get('/clients/:id/media', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const rows = (await c.env.DB.prepare(`SELECT m.id, m.filename, m.content_type, m.size, m.visibility, m.purpose, m.note, m.created_at, u.name AS uploader, u.role AS uploader_role
    FROM media m LEFT JOIN users u ON u.id=m.uploader_id WHERE m.client_id=? AND m.deleted_at IS NULL ${isStaff(user) ? '' : "AND m.visibility='shared'"}
    ORDER BY m.created_at DESC LIMIT 500`).bind(client.id).all()).results;
  return c.json({ media: rows, maxBytes: MAX_BYTES });
});

// Raw upload (the browser streams the file so it can show progress).
// Query: filename, visibility (staff only; clients always share), purpose, note.
r.put('/clients/:id/media', async (c) => {
  const { user, client } = await requireClient(c, c.req.param('id'));
  const store = bucket(c);
  const q = c.req.query();
  const filename = safeName(q.filename);
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  const declared = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const type = TYPES[declared] ? declared : EXT[ext];
  if (!type) fail(415, 'That file type is not supported. Use images, PDFs, Office documents, CSV, ZIP or design files.');
  if (!isStaff(user) && q.visibility === 'internal') fail(403, 'You do not have access to this.');
  // Staff must choose explicitly so nothing becomes visible to the client by accident.
  const visibility = isStaff(user) ? oneOf(q.visibility, ['shared', 'internal'], 'Who can see this file') : 'shared';
  const purpose = oneOf(q.purpose || 'other', PURPOSES, 'File type');
  const length = Number(c.req.header('Content-Length') || 0);
  if (length > MAX_BYTES) fail(413, 'Files can be up to 25 MB.');
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length) fail(400, 'The file is empty.');
  if (buf.length > MAX_BYTES) fail(413, 'Files can be up to 25 MB.');
  if (!sniff(buf, type)) fail(415, 'The file contents do not match its type. Re-export it and try again.');
  const id = newId();
  const key = `clients/${client.id}/${id}`;
  await store.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { filename, clientId: client.id, uploader: user.id } });
  await c.env.DB.prepare('INSERT INTO media (id, client_id, uploader_id, filename, content_type, size, r2_key, visibility, purpose, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, client.id, user.id, filename, type, buf.length, key, visibility, purpose, text(q.note, { max: 300 }), now()).run();
  await logActivity(c.env.DB, { clientId: client.id, actorId: user.id, kind: 'file', internal: visibility === 'internal', summary: `Uploaded ${filename}${visibility === 'internal' ? ' (internal)' : ''}` });
  return c.json({ id, filename, content_type: type, size: buf.length, visibility, purpose }, 201);
});

async function loadMedia(c, id, opts = {}) {
  const m = await c.env.DB.prepare('SELECT * FROM media WHERE id=? AND deleted_at IS NULL').bind(id).first();
  if (!m) fail(404, 'File not found.');
  const { user } = await requireClient(c, m.client_id, opts);
  if (m.visibility === 'internal' && !isStaff(user)) fail(404, 'File not found.');
  return { user, media: m };
}

r.get('/media/:id/file', async (c) => {
  const { media } = await loadMedia(c, c.req.param('id'));
  const obj = await bucket(c).get(media.r2_key);
  if (!obj) fail(404, 'File not found.');
  const disposition = c.req.query('download') === '1' ? 'attachment' : TYPES[media.content_type] || 'attachment';
  const encoded = encodeURIComponent(media.filename);
  return new Response(obj.body, {
    headers: {
      'Content-Type': disposition === 'inline' ? media.content_type : 'application/octet-stream',
      'Content-Length': String(media.size),
      'Content-Disposition': `${disposition}; filename="${media.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
});

r.patch('/media/:id', async (c) => {
  const { user, media } = await loadMedia(c, c.req.param('id'), { write: true });
  const body = await readJson(c);
  const visibility = body.visibility !== undefined ? oneOf(body.visibility, ['shared', 'internal'], 'Who can see this file') : media.visibility;
  const purpose = body.purpose !== undefined ? oneOf(body.purpose, PURPOSES, 'File type') : media.purpose;
  const filename = body.filename !== undefined ? safeName(body.filename) : media.filename;
  await c.env.DB.prepare('UPDATE media SET visibility=?, purpose=?, filename=?, note=? WHERE id=?')
    .bind(visibility, purpose, filename, body.note !== undefined ? text(body.note, { max: 300 }) : media.note, media.id).run();
  if (visibility !== media.visibility) await logActivity(c.env.DB, { clientId: media.client_id, actorId: user.id, kind: 'file', summary: `${filename} is now ${visibility === 'shared' ? 'shared with the client' : 'internal only'}` });
  return c.json({ ok: true });
});

// Staff can delete any file of their clients; clients can delete what they uploaded.
r.delete('/media/:id', async (c) => {
  const { user, media } = await loadMedia(c, c.req.param('id'));
  if (!isStaff(user) && media.uploader_id !== user.id) fail(403, 'Only Detcord or the person who uploaded this can delete it.');
  const inSigned = await c.env.DB.prepare("SELECT number FROM contracts WHERE client_id=? AND status IN ('sent','signed') AND data LIKE ?").bind(media.client_id, `%"id":"${media.id}"%`).first();
  if (inSigned) fail(409, `This file is attached to agreement ${inSigned.number} and is kept with it.`);
  await c.env.DB.prepare('UPDATE media SET deleted_at=? WHERE id=?').bind(now(), media.id).run();
  await bucket(c).delete(media.r2_key);
  await logActivity(c.env.DB, { clientId: media.client_id, actorId: user.id, kind: 'file', internal: media.visibility === 'internal', summary: `Deleted ${media.filename}` });
  return c.json({ ok: true });
});

export default r;
