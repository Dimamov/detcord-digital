import { sendRepInvitation, sendAccountInvitation } from './portal-invitations.js';
import { accessIntake, createAccessRequest, accessRequestActions } from './portal-access-api.js';
import { SERVICES, renderContract, signingProblems, SIGNING_STATEMENT } from './contract-template.js';
const json=(data,status=200,headers={})=>{const h=new Headers({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});for(const [key,value] of Object.entries(headers)){if(Array.isArray(value))value.forEach(v=>h.append(key,v));else h.set(key,value);}return Response.json(data,{status,headers:h});};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const password=async(p,s)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(s),iterations:100000,hash:'SHA-256'},key,256))).map(v=>v.toString(16).padStart(2,'0')).join('');};
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['buy.stripe.com','checkout.stripe.com','invoice.stripe.com','invoicing.stripe.com','www.paypal.com','paypal.com','square.link','checkout.square.site'].includes(u.hostname)?u.href:null;}catch{return null;}};
export async function portalAPI(request,env){
 if(!env.CLIENT_PORTAL)return json({error:'Client portal storage is not connected yet.'},503);
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'Request origin rejected.'},403);
 return env.CLIENT_PORTAL.get(env.CLIENT_PORTAL.idFromName('detcord-client-portal')).fetch(request);
}
export class ClientPortal{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.sql=ctx.storage.sql;
 this.sql.exec('CREATE TABLE IF NOT EXISTS archived_accounts(id TEXT PRIMARY KEY,kind TEXT,at INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS staff_invites(id TEXT PRIMARY KEY,at INTEGER,status TEXT,error TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS account_setup(id TEXT PRIMARY KEY,kind TEXT,token_hash TEXT,expires INTEGER,created INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS staff(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,salt TEXT,password TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS assignments(staff TEXT,client TEXT,PRIMARY KEY(staff,client))');
 this.sql.exec('CREATE TABLE IF NOT EXISTS admin_assignments(client TEXT PRIMARY KEY)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS client_integrations(client TEXT,provider TEXT,account_id TEXT,label TEXT,status TEXT,updated INTEGER,data TEXT,PRIMARY KEY(client,provider,account_id))');
 this.sql.exec('CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,salt TEXT,password TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,client TEXT,expires INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,count INTEGER,expires INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,client TEXT,kind TEXT,title TEXT,created INTEGER,data TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS chunks(id TEXT,seq INTEGER,body BLOB,PRIMARY KEY(id,seq))');
 }
 rows(q,...p){return this.sql.exec(q,...p).toArray();}
 async fetch(req){try{return await this.handle(req);}catch(e){console.error('Portal request failed',e?.stack||e);const p=new URL(req.url).pathname;if(p.endsWith('/report-generate'))return json({error:'Report generation failed: '+String(e?.message||e||'unknown error').slice(0,300)},500);return json({error:'Unable to complete this request. Please try again.'},500);}}
 async handle(req){
 const url=new URL(req.url),route=url.pathname.replace('/api/portal',''),now=Date.now();
 this.sql.exec('DELETE FROM sessions WHERE expires<?',now);this.sql.exec('DELETE FROM attempts WHERE expires<?',now);
 if(route==='/access-intake')return accessIntake(this,req,url,now);
 if(route==='/activate'&&req.method==='POST'){const d=await req.json(),id=String(d.id||''),token=String(d.token||''),p=String(d.password||'');if(p.length<12||p.length>256)return json({error:'Use a password of at least 12 characters.'},400);const setup=this.rows('SELECT * FROM account_setup WHERE id=?',id)[0];if(!setup||setup.expires<now||await hash(token)!==setup.token_hash)return json({error:'This setup link is invalid or expired. Ask Detcord for a new invitation.'},400);const table=setup.kind==='staff'?'staff':'clients',salt=crypto.randomUUID();this.sql.exec('UPDATE '+table+' SET salt=?,password=? WHERE id=?',salt,await password(p,salt),id);this.sql.exec('DELETE FROM account_setup WHERE id=?',id);return json({ok:true});}
 if(route==='/setup'&&req.method==='GET'){
 const key=this.env.PORTAL_ADMIN_KEY;
 return json({adminKeyPresent:!!key,minimumLengthMet:!!key&&key.length>=12,extraEdgeSpaces:!!key&&key!==key.trim(),minimumLength:12});
 }
 if(route==='/login'&&req.method==='POST'){
 const ip=req.headers.get('CF-Connecting-IP')||'unknown';const attemptId=await hash(ip);
 const count=this.rows('SELECT count FROM attempts WHERE id=?',attemptId)[0]?.count||0;if(count>=10)return json({error:'Too many sign-in attempts. Try again in 15 minutes.'},429);
 this.sql.exec('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',attemptId,now+900000);
 const d=await req.json();const email=String(d.email||'').trim().toLowerCase(),p=String(d.password||'');if(p.length>256)return json({error:'Sign-in details not accepted.'},401);
 let client;
 if(email==='admin'){
 const secret=this.env.PORTAL_ADMIN_KEY||this.env.GOAT_REVIEW_KEY;
 if(!secret||secret.length<12)return json({error:'Administrator access needs to be configured before client accounts can be created.'},503);
 if(await hash(p)===await hash(secret))client='admin';
 }else{const rep=this.rows('SELECT * FROM staff WHERE email=?',email)[0],row=rep||this.rows('SELECT * FROM clients WHERE email=?',email)[0];if(row&&await password(p,row.salt)===row.password)client=rep?'staff:'+row.id:row.id;}
 if(client&&this.rows('SELECT id FROM archived_accounts WHERE id=?',client.startsWith('staff:')?client.slice(6):client).length)client=null;
 if(!client)return json({error:'Sign-in details not accepted.'},401);
 this.sql.exec('DELETE FROM attempts WHERE id=?',attemptId);const token=crypto.randomUUID()+crypto.randomUUID();this.sql.exec('INSERT INTO sessions VALUES(?,?,?)',await hash(token),client,now+28800000);
 return json({ok:true},200,{'Set-Cookie':['detcord_portal='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800','detcord_portal=; Path=/api/portal; Secure; HttpOnly; SameSite=Strict; Max-Age=0']});
 }
 const token=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)detcord_portal=([^;]+)/)?.[1];const session=token&&this.rows('SELECT client FROM sessions WHERE token=?',await hash(token))[0];
 if(!session)return json({error:'Please sign in.'},401);
 if(route==='/logout'&&req.method==='POST'){this.sql.exec('DELETE FROM sessions WHERE token=?',await hash(token));return json({ok:true},200,{'Set-Cookie':['detcord_portal=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0','detcord_portal=; Path=/api/portal; Secure; HttpOnly; SameSite=Strict; Max-Age=0']});}
 const owner=session.client==='admin',rep=session.client.startsWith('staff:'),repId=rep?session.client.slice(6):null,admin=owner||rep;
 if(owner){for(const a of this.rows('SELECT id,kind FROM archived_accounts')){const table=a.kind==='staff'?'staff':'clients';this.sql.exec('DELETE FROM sessions WHERE client=?',table==='staff'?'staff:'+a.id:a.id);this.sql.exec('DELETE FROM assignments WHERE '+(table==='staff'?'staff':'client')+'=?',a.id);this.sql.exec('DELETE FROM account_setup WHERE id=?',a.id);if(table==='staff')this.sql.exec('DELETE FROM staff_invites WHERE id=?',a.id);this.sql.exec('DELETE FROM '+table+' WHERE id=?',a.id);}this.sql.exec('DELETE FROM archived_accounts');}
 if(route==='/me')return json({admin,role:owner?'admin':rep?'sales':'client',client:owner?{name:'Detcord admin'}:rep?this.rows('SELECT id,email,name FROM staff WHERE id=?',repId)[0]:this.rows('SELECT id,email,name FROM clients WHERE id=?',session.client)[0]},200,{'Set-Cookie':['detcord_portal='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800','detcord_portal=; Path=/api/portal; Secure; HttpOnly; SameSite=Strict; Max-Age=0']});

 const accountDelete=route.match(/^\/(clients|staff)\/([0-9a-f-]{36})$/);
 if(accountDelete&&req.method==='DELETE'){if(!owner)return json({error:'Only an administrator can delete accounts.'},403);const table=accountDelete[1],id=accountDelete[2],row=this.rows('SELECT id,email FROM '+table+' WHERE id=?',id)[0];if(!row)return json({error:'Account not found.'},404);this.ctx.storage.transactionSync(()=>{this.sql.exec('DELETE FROM sessions WHERE client=?',table==='staff'?'staff:'+id:id);this.sql.exec('DELETE FROM assignments WHERE '+(table==='staff'?'staff':'client')+'=?',id);this.sql.exec('DELETE FROM account_setup WHERE id=?',id);if(table==='staff'){this.sql.exec('DELETE FROM staff_invites WHERE id=?',id);}else{this.sql.exec("UPDATE items SET data=replace(data,?,'[deleted]') WHERE client=?",row.email,id);}this.sql.exec('DELETE FROM '+table+' WHERE id=?',id);this.sql.exec('DELETE FROM archived_accounts WHERE id=?',id);});return json({ok:true});}
 const inviteMatch=route.match(/^\/staff\/([0-9a-f-]{36})\/invite$/);
 if(inviteMatch&&req.method==='POST'){if(!owner)return json({error:'Only an administrator can send rep invitations.'},403);const invitation=await sendRepInvitation(this,inviteMatch[1],url.origin);return json({invitation,error:invitation.error},invitation.accepted?200:400);}
 if(route==='/staff'){
 if(!owner)return json({error:'Access denied.'},403);
 if(req.method==='GET')return json({staff:this.rows('SELECT id,email,name FROM staff WHERE id NOT IN (SELECT id FROM archived_accounts) ORDER BY name').map(r=>({...r,invitation:this.rows('SELECT at,status,error FROM staff_invites WHERE id=?',r.id)[0]||null,clients:this.rows('SELECT client FROM assignments WHERE staff=?',r.id).map(a=>a.client)}))});
 if(req.method==='POST'){const d=await req.json(),email=String(d.email||'').trim().toLowerCase();if(!d.name||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a name and valid email.'},400);if(this.rows('SELECT id FROM clients WHERE email=?',email).length||this.rows('SELECT id FROM staff WHERE email=?',email).length)return json({error:'This email already has an account.'},409);const id=crypto.randomUUID();this.sql.exec('INSERT INTO staff VALUES(?,?,?,?,?)',id,email,String(d.name).slice(0,150),'','');const invitation=await sendRepInvitation(this,id,url.origin);return json({id,invitation},201);}
 }
 if(route==='/admin-assignment'&&req.method==='POST'){
 if(!owner)return json({error:'Access denied.'},403);const d=await req.json();if(!this.rows('SELECT id FROM clients WHERE id=?',d.client).length)return json({error:'Select a client.'},400);
 if(d.assigned===true)this.sql.exec('INSERT OR IGNORE INTO admin_assignments VALUES(?)',d.client);else this.sql.exec('DELETE FROM admin_assignments WHERE client=?',d.client);return json({ok:true});
 }
 if(route==='/admin-assignments'&&req.method==='GET'){if(!owner)return json({error:'Access denied.'},403);return json({name:'Dmitriy Movsesyan',clients:this.rows('SELECT client FROM admin_assignments').map(r=>r.client)});}
 if(route==='/assignment'&&req.method==='POST'){
 if(!owner)return json({error:'Access denied.'},403);const d=await req.json();if(!this.rows('SELECT id FROM staff WHERE id=?',d.staff).length||!this.rows('SELECT id FROM clients WHERE id=?',d.client).length)return json({error:'Select a rep and a client.'},400);if(d.assigned===true)this.sql.exec('INSERT OR IGNORE INTO assignments VALUES(?,?)',d.staff,d.client);else this.sql.exec('DELETE FROM assignments WHERE staff=? AND client=?',d.staff,d.client);return json({ok:true});
 }

 if(route==='/clients'){
 if(!admin)return json({error:'Access denied.'},403);
 if(req.method==='GET')return json({clients:owner?this.rows('SELECT id,email,name FROM clients WHERE id NOT IN (SELECT id FROM archived_accounts) ORDER BY name'):this.rows('SELECT c.id,c.email,c.name FROM clients c JOIN assignments a ON a.client=c.id WHERE a.staff=? ORDER BY c.name',repId)});
 if(req.method==='POST'){

 const d=await req.json(),email=String(d.email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!d.name)return json({error:'Enter a name and valid email.'},400);
 if(this.rows('SELECT id FROM clients WHERE email=?',email).length||this.rows('SELECT id FROM staff WHERE email=?',email).length)return json({error:'That client email already exists.'},409);
 const id=crypto.randomUUID();this.sql.exec('INSERT INTO clients VALUES(?,?,?,?,?)',id,email,String(d.name).slice(0,150),'','');if(rep)this.sql.exec('INSERT INTO assignments VALUES(?,?)',repId,id);const invitation=await sendAccountInvitation(this,'client',id,url.origin);return json({id,invitation},201);
 }
 }
 if(route==='/password'&&req.method==='POST'){
 const d=await req.json(),id=owner?d.client:rep?repId:session.client,p=String(d.password||'');if(p.length<12||p.length>256)return json({error:'Use at least 12 characters.'},400);
 const table=rep?'staff':'clients';const row=this.rows('SELECT * FROM '+table+' WHERE id=?',id)[0];if(!row)return json({error:'Client not found.'},404);
 if(!owner&&await password(String(d.current||''),row.salt)!==row.password)return json({error:'Current password is incorrect.'},401);
 const salt=crypto.randomUUID();this.sql.exec('UPDATE '+table+' SET salt=?,password=? WHERE id=?',salt,await password(p,salt),id);this.sql.exec('DELETE FROM sessions WHERE client=?',rep?'staff:'+id:id);return json({ok:true});
 }
 const client=admin?url.searchParams.get('client'):session.client;
 if(rep&&!this.rows('SELECT client FROM assignments WHERE staff=? AND client=?',repId,client).length)return json({error:'This client is not assigned to your account.'},403);
 if(this.rows('SELECT id FROM archived_accounts WHERE id=?',client||'').length&&!owner)return json({error:'Account deleted.'},403);
 if(!client||!this.rows('SELECT id FROM clients WHERE id=?',client).length)return json({error:'Select a client.'},400);
 if(route==='/access-request'&&req.method==='POST'){if(!admin)return json({error:'Access denied.'},403);return createAccessRequest(this,req,url,client,now);}
 const accessMatch=route.match(/^\/access-request\/([0-9a-f-]{36})\/(send|complete)$/);
 if(accessMatch&&req.method==='POST'){if(!admin)return json({error:'Access denied.'},403);return accessRequestActions(this,req,url,client,accessMatch[1],accessMatch[2],now);}
 if(route==='/integrations'&&req.method==='GET'){
 if(!admin)return json({error:'Access denied.'},403);return json({integrations:this.rows('SELECT provider,account_id,label,status,updated FROM client_integrations WHERE client=? ORDER BY provider,label',client)});
 }
 if(route==='/integrations'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);const d=await req.json(),provider=String(d.provider||'');if(!['ga4','google-ads','search-console'].includes(provider))return json({error:'Unsupported data source.'},400);
 const accountId=String(d.accountId||'').trim().slice(0,300),label=String(d.label||'').trim().slice(0,200);if(!accountId)return json({error:'Choose an account or property.'},400);
 this.sql.exec('INSERT INTO client_integrations VALUES(?,?,?,?,?,?,?) ON CONFLICT(client,provider,account_id) DO UPDATE SET label=excluded.label,status=excluded.status,updated=excluded.updated,data=excluded.data',client,provider,accountId,label,'connected',now,JSON.stringify({connectedBy:owner?'Dmitriy Movsesyan':repId}));return json({ok:true});
 }
 if(route==='/report-generate'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);if(!this.env.OPENAI_API_KEY)return json({error:'GOAT report generation is not configured.'},503);
 const d=await req.json(),draftId=String(d.draftId||''),item=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='report-draft'",draftId,client)[0];if(!item)return json({error:'Report draft not found.'},404);
 const draft=JSON.parse(item.data),parts=[];if(draft.raw)parts.push({type:'input_text',text:'Manual data:\n'+draft.raw});
 for(const doc of draft.documents||[]){const src=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='report-source'",doc.id,client)[0];if(!src)continue;const meta=JSON.parse(src.data),bytes=new Uint8Array(meta.size);let offset=0;for(const row of this.rows('SELECT body FROM chunks WHERE id=? ORDER BY seq',src.id)){const chunk=new Uint8Array(row.body);bytes.set(chunk,offset);offset+=chunk.length;}const b64=btoa(String.fromCharCode(...bytes));if(meta.type==='application/pdf')parts.push({type:'input_file',filename:meta.name,file_data:'data:application/pdf;base64,'+b64});else if(meta.type.startsWith('image/'))parts.push({type:'input_image',image_url:'data:'+meta.type+';base64,'+b64});else if(meta.type.startsWith('text/')||/\.(csv|txt)$/i.test(meta.name))parts.push({type:'input_text',text:'Source '+meta.name+':\n'+new TextDecoder().decode(bytes).slice(0,60000)});}
 if(!parts.length)return json({error:'Add readable report data, a PDF, image, CSV or TXT source.'},400);
 const prompt='Create a factual Detcord marketing report from only the supplied source material. Return JSON only with keys executiveSummary, biggestWin, biggestOpportunity, whatChanged, needsAttention, gamePlan, slides. executiveSummary should be a substantive 2 to 4 paragraph client-ready overview. The four insight fields should each be 2 to 4 sentences with evidence and business meaning. gamePlan is an array of 4 to 7 concise actions. slides is an array of 6 to 12 objects, each with title, subtitle, and bullets (an array of 3 to 6 concise strings). Build a thorough presentation: executive overview, key findings, performance/results where supported, what changed, strengths/wins, weaknesses/risks, opportunities, recommendations, and next steps. Avoid filler and do not invent unsupported facts. Never invent metrics or results. If the source is descriptive project/business information rather than period metrics, summarize the strongest supported outcome/value as biggestWin, identify the clearest supported next opportunity, set whatChanged to what the source says changed or was built, and use needsAttention for caveats/risks explicitly present in the source. Do not fail merely because comparison-period metrics are absent. Reporting period: '+draft.periodStart+' to '+draft.periodEnd+'. Comparison: '+draft.comparison+'. User instructions: '+(draft.instructions||'none');
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+this.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(50000),body:JSON.stringify({model:this.env.OPENAI_MODEL||'gpt-5.4-mini',store:false,max_output_tokens:5000,instructions:prompt+' Output one complete valid JSON object only. No markdown fences or extra text. Keep each slide concise enough to fit one 16:9 presentation slide.',input:[{role:'user',content:parts}]})});
 if(!response.ok){const detail=await response.text();console.error('GOAT report generation failed',response.status,detail.slice(0,1000));return json({error:'GOAT could not analyze the report sources. OpenAI returned '+response.status+'.'},502);}const out=await response.json(),txt=(out.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');let report;try{report=JSON.parse(txt.replace(/^\x60\x60\x60(?:json)?|\x60\x60\x60$/g,'').trim());}catch{return json({error:'GOAT returned an invalid report. Try again.'},502);}
 const data={...draft,status:'generated',generatedAt:now,report};this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),item.id);return json({id:item.id,report});
 }
if(route==='/report-publish'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);const d=await req.json(),id=String(d.id||''),item=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='report-draft'",id,client)[0];if(!item)return json({error:'Saved report not found.'},404);const data=JSON.parse(item.data);if(!data.report)return json({error:'Generate the report before publishing it.'},409);data.published=true;data.publishedAt=now;this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),id);return json({ok:true});
 }
 if(route==='/report-unpublish'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);const d=await req.json(),id=String(d.id||''),item=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='report-draft'",id,client)[0];if(!item)return json({error:'Saved report not found.'},404);const data=JSON.parse(item.data);data.published=false;delete data.publishedAt;this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),id);return json({ok:true});
 }
if(route==='/report-draft'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);const d=await req.json(),title=String(d.title||'').trim().slice(0,200),raw=String(d.data||'').trim().slice(0,60000),instructions=String(d.instructions||'').trim().slice(0,10000);
 if(!title)return json({error:'Add a report title.'},400);
 const periodStart=String(d.periodStart||''),periodEnd=String(d.periodEnd||''),comparison=String(d.comparison||'previous'),compareStart=String(d.compareStart||''),compareEnd=String(d.compareEnd||''),sources=Array.isArray(d.sources)?d.sources.slice(0,10):[],documents=Array.isArray(d.documents)?d.documents.slice(0,20).filter(x=>x&&typeof x.id==='string'&&this.rows("SELECT id FROM items WHERE id=? AND client=? AND kind='report-source'",x.id,client).length):[];if(!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodStart>periodEnd)return json({error:'Choose a valid reporting date range.'},400);if(comparison==='custom'&&(!/^\d{4}-\d{2}-\d{2}$/.test(compareStart)||!/^\d{4}-\d{2}-\d{2}$/.test(compareEnd)||compareStart>compareEnd))return json({error:'Choose valid custom comparison dates.'},400);if(!raw&&!sources.length&&!documents.length)return json({error:'Add data, upload documents, or select a connected source.'},400);const id=crypto.randomUUID();this.sql.exec('INSERT INTO items VALUES(?,?,?,?,?,?)',id,client,'report-draft',title,now,JSON.stringify({title,raw,instructions,periodStart,periodEnd,comparison,compareStart,compareEnd,sources,documents,includeComparison:d.includeComparison!==false,author:owner?'Dmitriy Movsesyan':this.rows('SELECT name FROM staff WHERE id=?',repId)[0]?.name||'Detcord',status:'draft'}));return json({id},201);
 }
 if(route==='/items'&&req.method==='GET'){let rows=this.rows('SELECT * FROM items WHERE client=? ORDER BY created DESC',client).map(r=>({...r,data:JSON.parse(r.data)}));if(!admin)rows=rows.filter(r=>r.kind!=='report-draft'||r.data?.published===true);return json({items:rows});}
 if(route==='/catalog'&&req.method==='GET')return json({services:SERVICES});
 if(route==='/contract'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);
 const d=await req.json();if(!Array.isArray(d.services)||!d.services.length||d.services.length>26)return json({error:'Select at least one service.'},400);
 const selected=new Set(),services=[];
 for(const entry of d.services){const service=SERVICES.find(s=>s.id===entry.id);if(!service||selected.has(entry.id))return json({error:'Invalid service selection.'},400);selected.add(entry.id);
 for(const k of ['setup','monthly'])if(entry[k]!==null&&(!Number.isSafeInteger(entry[k])||entry[k]<0||entry[k]>100000000))return json({error:'Enter valid prices or leave them blank.'},400);
 services.push({...service,setup:entry.setup,monthly:entry.monthly,scope:String(entry.scope||'').slice(0,5000)});}
 const customer=this.rows('SELECT id,email,name FROM clients WHERE id=?',client)[0];const id=crypto.randomUUID();
 const contract={id,title:String(d.title||'Services Agreement').slice(0,200),created:now,services,clientName:String(d.clientName||customer.name).slice(0,200),clientEmail:customer.email,logo:new URL('/detcord-logo-transparent.png',url.origin).href,ready:false};
 contract.depositCollected=d.depositCollected===true;contract.depositAmount=contract.depositCollected?d.depositAmount:0;if(contract.depositCollected&&(!Number.isSafeInteger(contract.depositAmount)||contract.depositAmount<=0||contract.depositAmount>100000000))return json({error:'Enter the deposit amount collected.'},400);contract.depositNotes=String(d.depositNotes||'').slice(0,1000);
 for(const key of ['provider','providerAddress','providerSigner','clientAddress','thirdParty','paymentTerms','monthlyStart','additional'])contract[key]=String(d[key]||'').slice(0,10000);
 contract.providerEmail=String(d.providerEmail||'info@detcorddigital.com').slice(0,200);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contract.providerEmail))return json({error:'Enter a valid Provider notice email.'},400);
 for(const k of ['paymentDays','feedbackDays']){contract[k]=Number(d[k]|| (k==='paymentDays'?15:10));if(!Number.isInteger(contract[k])||contract[k]<1||contract[k]>90)return json({error:'Payment and feedback deadlines must be 1–90 days.'},400);}
 if(d.ready){const errors=signingProblems(contract);if(errors.length||d.providerConsent!==true)return json({error:'Before signing, complete: '+errors.join(', ')+' and confirm Provider signing consent.'},400);contract.ready=true;contract.issuedAt=now;}
 const html=renderContract(contract),documentHash=await hash(html);const data={contract,html,documentHash,status:contract.ready?'awaiting-signature':'draft'};
 this.sql.exec('INSERT INTO items VALUES(?,?,?,?,?,?)',id,client,'contract',contract.title,now,JSON.stringify(data));return json({id},201);
 }
 const contractMatch=route.match(/^\/contract\/([0-9a-f-]{36})(?:\/(download|sign|issue))?$/);
 if(contractMatch){
 const id=contractMatch[1],action=contractMatch[2],item=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='contract'",id,client)[0];if(!item)return json({error:'Contract not found.'},404);
 const data=JSON.parse(item.data);
 if(req.method==='GET'&&action==='download')return new Response(data.html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="Detcord-Agreement-'+id+'.html"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(req.method==='GET'&&!action)return json({id,...data});
 if(req.method==='POST'&&action==='issue'){
 if(!admin)return json({error:'Access denied.'},403);if(data.status!=='draft')return json({error:'This agreement has already been issued.'},409);
 const d=await req.json(),errors=signingProblems(data.contract);if(errors.length||d.consent!==true)return json({error:'Complete the contract fields before issuing: '+errors.join(', ')},400);
 data.contract.ready=true;data.contract.issuedAt=now;data.status='awaiting-signature';data.html=renderContract(data.contract);data.documentHash=await hash(data.html);this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),id);return json({ok:true});
 }
 if(req.method==='POST'&&action==='sign'){
 if(admin)return json({error:'Client must sign from their own account.'},403);if(data.status!=='awaiting-signature')return json({error:'This contract is not awaiting a signature.'},409);
 const d=await req.json();if(d.documentHash!==data.documentHash)return json({error:'Contract version changed. Reopen and review it before signing.'},409);
 if(d.consent!==true||typeof d.name!=='string'||d.name.trim().length<2||!String(d.title||'').trim())return json({error:'Enter your full name and title, and confirm consent and signing authority.'},400);
 const row=this.rows('SELECT * FROM clients WHERE id=?',client)[0];if(await password(String(d.password||''),row.salt)!==row.password)return json({error:'Confirm your account password to sign.'},403);
 data.signature={id:crypto.randomUUID(),name:d.name.trim().slice(0,200),title:String(d.title).slice(0,200),email:row.email,clientId:client,at:now,consent:SIGNING_STATEMENT,documentHash:data.documentHash,ip:req.headers.get('CF-Connecting-IP')||null,userAgent:(req.headers.get('User-Agent')||'').slice(0,500)};
 const signed=renderContract(data.contract,data.signature),marker='<div class="signature"><strong>CLIENT</strong>';const originalAt=data.html.lastIndexOf(marker),signedAt=signed.lastIndexOf(marker);if(originalAt<0||signedAt<0)return json({error:'Contract document cannot be signed.'},409);data.status='signed';data.html=data.html.slice(0,originalAt)+signed.slice(signedAt);data.executedHash=await hash(data.html);
 let saved=false;this.ctx.storage.transactionSync(()=>{const current=JSON.parse(this.rows('SELECT data FROM items WHERE id=?',id)[0].data);if(current.status!=='awaiting-signature'||current.documentHash!==d.documentHash)return;this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),id);saved=true;});if(!saved)return json({error:'Contract was already signed or changed. Refresh the page.'},409);return json({ok:true});
 }
 }
 if(route==='/invoice'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);const d=await req.json();const pay=d.payment?safeLink(d.payment):null;
 if(!d.title||!Number.isSafeInteger(d.amount)||d.amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(d.due)||!['unpaid','paid'].includes(d.status)||d.payment&&!pay)return json({error:'Check invoice fields. Use a Stripe, PayPal or Square HTTPS payment link.'},400);
 const id=crypto.randomUUID();this.sql.exec('INSERT INTO items VALUES(?,?,?,?,?,?)',id,client,'invoice',String(d.title).slice(0,200),now,JSON.stringify({amount:d.amount,due:d.due,status:d.status,payment:pay}));return json({id},201);
 }
 const invoiceMatch=route.match(/^\/invoice\/([0-9a-f-]{36})$/);
 if(invoiceMatch&&req.method==='PATCH'){
 if(!admin)return json({error:'Access denied.'},403);
 const item=this.rows("SELECT * FROM items WHERE id=? AND client=? AND kind='invoice'",invoiceMatch[1],client)[0];if(!item)return json({error:'Invoice not found.'},404);
 const d=await req.json();if(!['paid','unpaid'].includes(d.status))return json({error:'Invalid status.'},400);
 const data=JSON.parse(item.data);data.status=d.status;this.sql.exec('UPDATE items SET data=? WHERE id=?',JSON.stringify(data),item.id);return json({ok:true});
 }
 if(route==='/report-source-upload'&&req.method==='POST'){
 if(!admin)return json({error:'Access denied.'},403);
 const length=Number(req.headers.get('Content-Length'));if(length>10500000)return json({error:'Maximum source file size is 10 MB.'},413);
 const form=await req.formData(),file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>10000000)return json({error:'Choose a source document up to 10 MB.'},400);
 const name=String(file.name||'source').slice(0,200),ext=name.toLowerCase().split('.').pop(),allowed=['pdf','doc','docx','xls','xlsx','csv','txt','jpg','jpeg','png','webp'];if(!allowed.includes(ext))return json({error:'Use PDF, Word, Excel, CSV, TXT, JPG, PNG or WebP.'},400);
 const bytes=new Uint8Array(await file.arrayBuffer()),id=crypto.randomUUID(),type=String(file.type||'application/octet-stream').slice(0,120);
 const quota=this.rows("SELECT COALESCE(SUM(json_extract(data,'$.size')),0) AS n FROM items WHERE client=?",client)[0].n;if(quota+file.size>100000000)return json({error:'This account has reached its 100 MB upload limit.'},413);
 this.ctx.storage.transactionSync(()=>{this.sql.exec('INSERT INTO items VALUES(?,?,?,?,?,?)',id,client,'report-source',name,now,JSON.stringify({type,size:file.size,name}));for(let i=0;i<bytes.length;i+=64000)this.sql.exec('INSERT INTO chunks VALUES(?,?,?)',id,i/64000,bytes.slice(i,i+64000));});return json({id,name,type,size:file.size},201);
 }
 if(route==='/upload'&&req.method==='POST'){
 const length=Number(req.headers.get('Content-Length'));if(length>5500000)return json({error:'Maximum file size is 5 MB.'},413);
 const form=await req.formData(),file=form.get('file'),kind=form.get('kind');
 if(!file||typeof file.arrayBuffer!=='function'||file.size>5000000||!file.size)return json({error:'Choose a file up to 5 MB.'},400);
 if(kind!=='photo'&&!(admin&&kind==='report'))return json({error:'Access denied.'},403);
 const bytes=new Uint8Array(await file.arrayBuffer());const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,webp=new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP',pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 const type=jpeg?'image/jpeg':png?'image/png':webp?'image/webp':pdf&&kind==='report'?'application/pdf':null;
 if(!type)return json({error:kind==='report'?'Use a PDF, JPG, PNG or WebP file.':'Use a JPG, PNG or WebP photo.'},400);
 const quota=this.rows("SELECT COALESCE(SUM(json_extract(data,'$.size')),0) AS n FROM items WHERE client=?",client)[0].n;if(quota+file.size>100000000)return json({error:'This account has reached its 100 MB upload limit. Contact Detcord.'},413);
 const contractId=form.get('contractId')||null;if(contractId&&(!admin||!this.rows("SELECT id FROM items WHERE id=? AND client=? AND kind='contract'",contractId,client).length))return json({error:'Contract not found.'},400);const id=crypto.randomUUID(),title=String(form.get('title')||file.name).slice(0,200);this.ctx.storage.transactionSync(()=>{this.sql.exec('INSERT INTO items VALUES(?,?,?,?,?,?)',id,client,kind,title,now,JSON.stringify({type,size:file.size,name:file.name.slice(0,200),contractId}));for(let i=0;i<bytes.length;i+=64000)this.sql.exec('INSERT INTO chunks VALUES(?,?,?)',id,i/64000,bytes.slice(i,i+64000));});return json({id},201);
 }
 const match=route.match(/^\/file\/([0-9a-f-]{36})$/);
 if(match&&req.method==='GET'){
 const item=this.rows('SELECT * FROM items WHERE id=? AND client=?',match[1],client)[0];if(!item||item.kind==='invoice')return json({error:'File not found.'},404);
 const data=JSON.parse(item.data),bytes=new Uint8Array(data.size);let offset=0;for(const c of this.rows('SELECT body FROM chunks WHERE id=? ORDER BY seq',item.id)){const chunk=new Uint8Array(c.body);bytes.set(chunk,offset);offset+=chunk.length;}
 return new Response(bytes,{headers:{'Content-Type':data.type,'Content-Disposition':'attachment; filename="'+data.name.replace(/[^a-zA-Z0-9._ -]/g,'_')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}});
 }
 if(route.startsWith('/items/')&&req.method==='DELETE'){
 const id=route.split('/')[2],item=this.rows('SELECT * FROM items WHERE id=? AND client=?',id,client)[0];if(!item)return json({error:'Not found.'},404);if(item.kind==='contract'&&JSON.parse(item.data).status==='signed')return json({error:'Signed agreements are retained and cannot be deleted.'},409);if(!admin&&item.kind!=='photo')return json({error:'Access denied.'},403);
 this.ctx.storage.transactionSync(()=>{this.sql.exec('DELETE FROM chunks WHERE id=?',id);this.sql.exec('DELETE FROM items WHERE id=?',id);});return json({ok:true});
 }
 return json({error:'Not found.'},404);
 }
}
