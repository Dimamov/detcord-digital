import { sendRepInvitation } from './portal-invitations.js';
import { accessIntake, createAccessRequest, accessRequestActions } from './portal-access-api.js';
import { SERVICES, renderContract, signingProblems, SIGNING_STATEMENT } from './contract-template.js';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',...headers}});
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
 this.sql.exec('CREATE TABLE IF NOT EXISTS staff(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,salt TEXT,password TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS assignments(staff TEXT,client TEXT,PRIMARY KEY(staff,client))');
 this.sql.exec('CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,salt TEXT,password TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,client TEXT,expires INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,count INTEGER,expires INTEGER)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,client TEXT,kind TEXT,title TEXT,created INTEGER,data TEXT)');
 this.sql.exec('CREATE TABLE IF NOT EXISTS chunks(id TEXT,seq INTEGER,body BLOB,PRIMARY KEY(id,seq))');
 }
 rows(q,...p){return this.sql.exec(q,...p).toArray();}
 async fetch(req){try{return await this.handle(req);}catch(e){console.error('Portal request failed');return json({error:'Unable to complete this request. Please try again.'},500);}}
 async handle(req){
 const url=new URL(req.url),route=url.pathname.replace('/api/portal',''),now=Date.now();
 this.sql.exec('DELETE FROM sessions WHERE expires<?',now);this.sql.exec('DELETE FROM attempts WHERE expires<?',now);
 if(route==='/access-intake')return accessIntake(this,req,url,now);
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
 if(!client)return json({error:email==='admin'?'The password does not match the deployed administrator key. Check PORTAL_ADMIN_KEY in Cloudflare.':'Sign-in details not accepted.'},401);
 this.sql.exec('DELETE FROM attempts WHERE id=?',attemptId);const token=crypto.randomUUID()+crypto.randomUUID();this.sql.exec('INSERT INTO sessions VALUES(?,?,?)',await hash(token),client,now+28800000);
 return json({ok:true},200,{'Set-Cookie':'detcord_portal='+token+'; Path=/api/portal; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'});
 }
 const token=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)detcord_portal=([^;]+)/)?.[1];const session=token&&this.rows('SELECT client FROM sessions WHERE token=?',await hash(token))[0];
 if(!session)return json({error:'Please sign in.'},401);
 if(route==='/logout'&&req.method==='POST'){this.sql.exec('DELETE FROM sessions WHERE token=?',await hash(token));return json({ok:true},200,{'Set-Cookie':'detcord_portal=; Path=/api/portal; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});}
 const owner=session.client==='admin',rep=session.client.startsWith('staff:'),repId=rep?session.client.slice(6):null,admin=owner||rep;
 if(route==='/me')return json({admin,role:owner?'admin':rep?'sales':'client',client:owner?{name:'Detcord admin'}:rep?this.rows('SELECT id,email,name FROM staff WHERE id=?',repId)[0]:this.rows('SELECT id,email,name FROM clients WHERE id=?',session.client)[0]});

 const accountDelete=route.match(/^\/(clients|staff)\/([0-9a-f-]{36})$/);
 if(accountDelete&&req.method==='DELETE'){if(!owner)return json({error:'Only an administrator can delete accounts.'},403);const table=accountDelete[1],id=accountDelete[2];if(!this.rows('SELECT id FROM '+table+' WHERE id=?',id).length)return json({error:'Account not found.'},404);this.ctx.storage.transactionSync(()=>{this.sql.exec('INSERT OR REPLACE INTO archived_accounts VALUES(?,?,?)',id,table,now);this.sql.exec('DELETE FROM sessions WHERE client=?',table==='staff'?'staff:'+id:id);this.sql.exec('DELETE FROM assignments WHERE '+(table==='staff'?'staff':'client')+'=?',id);});return json({ok:true});}
 const inviteMatch=route.match(/^\/staff\/([0-9a-f-]{36})\/invite$/);
 if(inviteMatch&&req.method==='POST'){if(!owner)return json({error:'Only an administrator can send rep invitations.'},403);const invitation=await sendRepInvitation(this,inviteMatch[1],url.origin);return json({invitation,error:invitation.error},invitation.accepted?200:400);}
 if(route==='/staff'){
 if(!owner)return json({error:'Access denied.'},403);
 if(req.method==='GET')return json({staff:this.rows('SELECT id,email,name FROM staff WHERE id NOT IN (SELECT id FROM archived_accounts) ORDER BY name').map(r=>({...r,invitation:this.rows('SELECT at,status,error FROM staff_invites WHERE id=?',r.id)[0]||null,clients:this.rows('SELECT client FROM assignments WHERE staff=?',r.id).map(a=>a.client)}))});
 if(req.method==='POST'){const d=await req.json(),email=String(d.email||'').trim().toLowerCase(),p=String(d.password||'');if(!d.name||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||p.length<12||p.length>256)return json({error:'Enter a name, valid email and password of at least 12 characters.'},400);if(this.rows('SELECT id FROM clients WHERE email=?',email).length||this.rows('SELECT id FROM staff WHERE email=?',email).length)return json({error:'This email already has an account.'},409);const id=crypto.randomUUID(),salt=crypto.randomUUID();this.sql.exec('INSERT INTO staff VALUES(?,?,?,?,?)',id,email,String(d.name).slice(0,150),salt,await password(p,salt));const invitation=await sendRepInvitation(this,id,url.origin);return json({id,invitation},201);}
 }
 if(route==='/assignment'&&req.method==='POST'){
 if(!owner)return json({error:'Access denied.'},403);const d=await req.json();if(!this.rows('SELECT id FROM staff WHERE id=?',d.staff).length||!this.rows('SELECT id FROM clients WHERE id=?',d.client).length)return json({error:'Select a rep and a client.'},400);if(d.assigned===true)this.sql.exec('INSERT OR IGNORE INTO assignments VALUES(?,?)',d.staff,d.client);else this.sql.exec('DELETE FROM assignments WHERE staff=? AND client=?',d.staff,d.client);return json({ok:true});
 }

 if(route==='/clients'){
 if(!admin)return json({error:'Access denied.'},403);
 if(req.method==='GET')return json({clients:owner?this.rows('SELECT id,email,name FROM clients WHERE id NOT IN (SELECT id FROM archived_accounts) ORDER BY name'):this.rows('SELECT c.id,c.email,c.name FROM clients c JOIN assignments a ON a.client=c.id WHERE a.staff=? ORDER BY c.name',repId)});
 if(req.method==='POST'){

 const d=await req.json(),email=String(d.email||'').trim().toLowerCase(),p=String(d.password||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!d.name||p.length<12||p.length>256)return json({error:'Enter a name, valid email and password of at least 12 characters.'},400);
 if(this.rows('SELECT id FROM clients WHERE email=?',email).length||this.rows('SELECT id FROM staff WHERE email=?',email).length)return json({error:'That client email already exists.'},409);
 const salt=crypto.randomUUID(),id=crypto.randomUUID();this.sql.exec('INSERT INTO clients VALUES(?,?,?,?,?)',id,email,String(d.name).slice(0,150),salt,await password(p,salt));if(rep)this.sql.exec('INSERT INTO assignments VALUES(?,?)',repId,id);return json({id},201);
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
 if(route==='/items'&&req.method==='GET')return json({items:this.rows('SELECT * FROM items WHERE client=? ORDER BY created DESC',client).map(r=>({...r,data:JSON.parse(r.data)}))});
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
