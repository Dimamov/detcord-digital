import { brandedEmail } from './email-template.js';
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function sendAccountInvitation(portal,kind,id,origin){
 const table=kind==='staff'?'staff':'clients',account=portal.rows('SELECT id,email,name FROM '+table+' WHERE id=?',id)[0];
 if(!account)return {accepted:false,error:'Account not found.'};
 if(!portal.env.RESEND_API_KEY)return {accepted:false,error:'Email is not configured. Add RESEND_API_KEY as a Production runtime secret in Cloudflare.'};
 const now=Date.now(),token=crypto.randomUUID()+crypto.randomUUID();
 portal.sql.exec('INSERT OR REPLACE INTO account_setup VALUES(?,?,?,?,?)',id,kind,await sha(token),now+86400000,now);
 const link=new URL('/client-portal.html',origin);link.searchParams.set('setup',id);link.hash=token;
 const label=kind==='staff'?'sales rep':'client';
 const payload=brandedEmail({from:portal.env.PORTAL_EMAIL_FROM||portal.env.GOAT_EMAIL_FROM||'Detcord Digital <info@detcorddigital.com>',to:[account.email],reply_to:'info@detcorddigital.com',subject:'Set up your Detcord Digital portal password',text:'Hello '+account.name+',\n\nYour Detcord Digital '+label+' portal account is ready.\n\nCreate your own password here:\n'+link.href+'\n\nThis secure setup link expires in 24 hours and can only be used once.\n\nIf you did not expect this invitation, you can ignore this email.\n\nDetcord Digital\ninfo@detcorddigital.com'});
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+portal.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'account-setup/'+kind+'/'+id+'/'+now},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const result=response.ok?{accepted:true}:{accepted:false,error:response.status===401?'Resend rejected the API key.':response.status===403?'Resend rejected the sender or recipient.':'Resend did not accept the invitation. Check the Resend email logs.'};
  if(kind==='staff')portal.sql.exec('INSERT OR REPLACE INTO staff_invites VALUES(?,?,?,?)',id,now,result.accepted?'accepted':'failed',result.error||null);
  return result;
 }catch{return {accepted:false,error:'Invitation delivery could not be confirmed. Check Resend logs before retrying.'};}
}
export const sendRepInvitation=(portal,id,origin)=>sendAccountInvitation(portal,'staff',id,origin);
