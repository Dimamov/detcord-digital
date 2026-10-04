import { brandedEmail } from './email-template.js';
const DAY = 86400000;
const IDLE = 5 * 60000;
const RETENTION = 30 * DAY;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const json = (value, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export function emailConfigured(env) {
 return !!(env.RESEND_API_KEY && env.GOAT_EMAIL_FROM && env.GOAT_EMAIL_TO);
}
export function emailText(session, turns, full=false) {
 const lines = ['Chat with The GOAT', 'Started: '+new Date(session.created).toISOString(), 'Page: '+session.page, '', 'QUESTIONS ASKED'];
 turns.forEach((turn,index) => lines.push((index+1)+'. '+turn.question+(turn.failed?' [reply failed]':'')));
 if(full) {
  lines.push('', 'FULL TRANSCRIPT');
  turns.forEach(turn => lines.push('', 'Visitor: '+turn.question, 'The GOAT: '+turn.answer));
 }
 lines.push('', 'Review full conversations privately: https://www.detcorddigital.com/goat-review.html', 'A chat is considered finished after five minutes without a new message.');
 return lines.join('\n');
}
export class GoatArchive {
 constructor(ctx,env) {
  this.ctx=ctx;this.env=env;this.sql=ctx.storage.sql;
  this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, page TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, expires INTEGER NOT NULL, email_state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, email_payload TEXT, email_id TEXT)");
  this.sql.exec("CREATE TABLE IF NOT EXISTS turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, created INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, failed INTEGER NOT NULL DEFAULT 0)");
  this.sql.exec("CREATE INDEX IF NOT EXISTS turns_session ON turns(session_id,seq)");
  this.sql.exec("CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated)");
  this.sql.exec("CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)");
 }
 rows(query,...values) {return this.sql.exec(query,...values).toArray();}
 cleanup(now=Date.now()) {
  this.sql.exec("DELETE FROM turns WHERE session_id IN (SELECT id FROM sessions WHERE expires<=?)",now);
  this.sql.exec("DELETE FROM sessions WHERE expires<=?",now);
 }
 async schedule() {
  const expiry=this.rows("SELECT MIN(expires) AS at FROM sessions")[0]?.at;
  let next=expiry;
  if(emailConfigured(this.env)) {
   const due=this.rows("SELECT MIN(MAX(updated+?,next_attempt)) AS at FROM sessions WHERE email_state IN ('pending','retry') AND attempts<3",IDLE)[0]?.at;
   if(due!=null) next=next==null?due:Math.min(next,due);
  }
  if(next!=null) await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,next));
  else await this.ctx.storage.deleteAlarm();
 }
 async fetch(request) {
  const url=new URL(request.url);this.cleanup();
  if(url.pathname==='/contact-limit' && request.method==='POST') {
   const {key}=await request.json();
   if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return json({error:'Invalid key'},400);
   this.sql.exec('CREATE TABLE IF NOT EXISTS contact_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)');
   const now=Date.now();
   this.sql.exec('DELETE FROM contact_limits WHERE expires<=?',now);
   let allowed=false;
   this.ctx.storage.transactionSync(()=>{
    const row=this.rows('SELECT attempts FROM contact_limits WHERE key=?',key)[0];
    if(row?.attempts>=5)return;
    this.sql.exec('INSERT INTO contact_limits(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1',key,now+3600000);
    allowed=true;
   });
   return json({allowed},allowed?200:429);
  }
  if(url.pathname==='/record' && request.method==='POST') {
   const data=await request.json();
   if(!uuid(data.conversationId)||!uuid(data.turnId)||typeof data.question!=='string'||typeof data.answer!=='string')return json({error:'Invalid turn'},400);
   const now=Date.now();
   const page=typeof data.page==='string'&&/^\/[a-z0-9/_.-]*$/i.test(data.page)?data.page.slice(0,200):'/';
   let saved=false;
   this.ctx.storage.transactionSync(()=>{
    const duplicate=this.rows("SELECT id FROM turns WHERE id=?",data.turnId);
    if(duplicate.length){saved=true;return;}
    const count=this.rows("SELECT COUNT(*) AS total FROM turns WHERE session_id=?",data.conversationId)[0].total;
    if(count>=100)return;
    this.sql.exec("INSERT INTO sessions(id,page,created,updated,expires) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, expires=excluded.expires",data.conversationId,page,now,now,now+RETENTION);
    this.sql.exec("INSERT INTO turns(id,session_id,created,question,answer,failed) VALUES(?,?,?,?,?,?)",data.turnId,data.conversationId,now,data.question.slice(0,1200),data.answer.slice(0,12000),data.failed?1:0);
    saved=true;
   });
   await this.schedule();return json({saved});
  }
  if(url.pathname==='/status') {
   await this.schedule();
   const totals=this.rows("SELECT COUNT(*) AS chats FROM sessions")[0];
   const turns=this.rows("SELECT COUNT(*) AS questions, COALESCE(SUM(failed),0) AS failed FROM turns")[0];
   return json({...totals,...turns,emailConfigured:emailConfigured(this.env),recipient:this.env.GOAT_EMAIL_TO||null,retentionDays:30,idleMinutes:5});
  }
  if(url.pathname==='/sessions') {
   const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
   const query=(url.searchParams.get('q')||'').slice(0,150);
   const rows=this.rows("SELECT s.id,s.page,s.created,s.updated,s.email_state,s.attempts,COUNT(t.id) AS questions,SUM(t.failed) AS failed,(SELECT question FROM turns WHERE session_id=s.id ORDER BY seq LIMIT 1) AS first_question FROM sessions s JOIN turns t ON t.session_id=s.id WHERE (?='' OR EXISTS (SELECT 1 FROM turns z WHERE z.session_id=s.id AND z.question LIKE ?)) GROUP BY s.id ORDER BY s.updated DESC,s.id LIMIT 101 OFFSET ?",query,'%'+query+'%',offset);
   return json({sessions:rows.slice(0,100),nextOffset:rows.length>100?offset+100:null});
  }
  const id=url.pathname.split('/')[2];
  if(url.pathname.startsWith('/sessions/')&&uuid(id)) {
   const session=this.rows("SELECT id,page,created,updated,email_state,attempts FROM sessions WHERE id=?",id)[0];
   if(!session)return json({error:'Conversation not found'},404);
   return json({session,turns:this.rows("SELECT created,question,answer,failed FROM turns WHERE session_id=? ORDER BY seq",id)});
  }
  return json({error:'Not found'},404);
 }
 async alarm() {
  this.cleanup();
  if(emailConfigured(this.env)) {
   const now=Date.now();
   const pending=this.rows("SELECT * FROM sessions WHERE email_state IN ('pending','retry') AND attempts<3 AND updated<=? AND next_attempt<=? ORDER BY updated LIMIT 10",now-IDLE,now);
   for(const session of pending) {
    const turns=this.rows("SELECT question,answer,failed FROM turns WHERE session_id=? ORDER BY seq",session.id);
    const payload=session.email_payload || JSON.stringify({from:this.env.GOAT_EMAIL_FROM,to:[this.env.GOAT_EMAIL_TO],subject:'GOAT chat: '+turns.length+' question'+(turns.length===1?'':'s')+' · '+new Date(session.created).toISOString().slice(0,10),text:emailText(session,turns,this.env.GOAT_EMAIL_MODE==='transcript')});
    // Persist the exact request so retries use the same idempotency key and payload.
    this.sql.exec("UPDATE sessions SET email_payload=? WHERE id=?",payload,session.id);
    let sent=false,emailId=null;
    try {
     const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+this.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'goat-chat/'+session.id},body:JSON.stringify(brandedEmail(JSON.parse(payload))),signal:AbortSignal.timeout(15000)});
     if(response.ok){const result=await response.json();sent=!!result.id;emailId=result.id||null;}
    } catch {}
    if(sent)this.sql.exec("UPDATE sessions SET email_state='sent',email_id=?,email_payload=NULL WHERE id=?",emailId,session.id);
    else this.sql.exec("UPDATE sessions SET attempts=attempts+1,email_state=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'retry' END,next_attempt=? WHERE id=?",Date.now()+(session.attempts?3600000:900000),session.id);
   }
  }
  await this.schedule();
 }
}
export function archiveStub(env) {return env.GOAT_ARCHIVE.get(env.GOAT_ARCHIVE.idFromName('detcord-goat-archive'));}
export async function saveTurn(env,turn) {
 if(!env.GOAT_ARCHIVE)return false;
 try {const response=await archiveStub(env).fetch('https://archive/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(turn)});return response.ok && (await response.json()).saved===true;}
 catch {console.error('GOAT transcript save failed');return false;}
}
export async function reviewAPI(request,env) {
 const expected=env.GOAT_REVIEW_KEY;
 if(!expected||expected.length<20)return json({error:'Set GOAT_REVIEW_KEY as a runtime Secret with at least 20 characters to enable private review.'},503);
 const supplied=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const a=await digest(expected),b=await digest(supplied);let difference=0;
 for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 if(difference)return json({error:'Review key not accepted.'},401);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(!env.GOAT_ARCHIVE)return json({error:'Chat storage is not connected.'},503);
 const url=new URL(request.url),path=url.pathname.replace('/api/goat-review','');
 if(!/^\/(status|sessions(?:\/[0-9a-f-]{36})?)$/i.test(path))return json({error:'Not found'},404);
 const response=await archiveStub(env).fetch('https://archive'+path+url.search);
 return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}
