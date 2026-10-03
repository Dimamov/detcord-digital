export async function sendRepInvitation(portal,id,origin){
 const rep=portal.rows('SELECT id,email,name FROM staff WHERE id=?',id)[0];
 if(!rep||portal.rows('SELECT id FROM archived_accounts WHERE id=?',id).length)return {accepted:false,error:'Rep account not found.'};
 if(!portal.env.RESEND_API_KEY||!(portal.env.PORTAL_EMAIL_FROM||portal.env.GOAT_EMAIL_FROM))return {accepted:false,error:'Email is not configured. Add RESEND_API_KEY and PORTAL_EMAIL_FROM in Cloudflare.'};
 const now=Date.now(),previous=portal.rows('SELECT at FROM staff_invites WHERE id=?',id)[0];
 if(previous&&now-previous.at<30000)return {accepted:false,error:'Wait 30 seconds before sending another invitation.'};
 portal.sql.exec('INSERT OR REPLACE INTO staff_invites VALUES(?,?,?,?)',id,now,'sending',null);
 let result;
 try{
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+portal.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'rep-invite/'+id+'/'+now},body:JSON.stringify({from:portal.env.PORTAL_EMAIL_FROM||portal.env.GOAT_EMAIL_FROM,to:[rep.email],reply_to:'info@detcorddigital.com',subject:'You’re invited to the Detcord Digital sales portal',text:'Hello '+rep.name+',\n\nYour Detcord Digital sales rep account has been created.\n\nSign in here: '+new URL('/client-portal',origin).href+'\nLogin email: '+rep.email+'\n\nUse the initial password provided privately by your administrator. If you have not received it, contact your administrator. After signing in, you can change your password under Account.\n\nYour assigned clients, reports, photos, invoices and contracts will appear in your workspace.\n\nDetcord Digital\ninfo@detcorddigital.com'}),signal:AbortSignal.timeout(15000)});
 result=response.ok?{accepted:true}:{accepted:false,error:response.status===401?'Resend rejected the API key. Check RESEND_API_KEY.':response.status===403?'Resend rejected the sender or recipient. Verify detcorddigital.com and the key’s domain permission in Resend.':response.status===429?'Email sending limit reached. Try again later.':'Resend did not accept the invitation. Check the Resend email logs.'};
 }catch{result={accepted:false,error:'Invitation delivery could not be confirmed. Check Resend logs before retrying.'};}
 portal.sql.exec('UPDATE staff_invites SET status=?,error=? WHERE id=?',result.accepted?'accepted':'failed',result.error||null,id);
 return result;
}
