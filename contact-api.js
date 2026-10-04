import { brandedEmail } from './email-template.js';
const reply = (request, data, status = 200) => {
 const headers = {'Cache-Control':'no-store'};
 if (request.headers.get('Accept')?.includes('application/json')) return Response.json(data,{status,headers});
 if (status === 200) return new Response(null,{status:303,headers:{...headers,Location:'/thanks'}});
 return new Response((data.error || 'Request failed.')+' Return to the contact page or email info@detcorddigital.com.',{status,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
};
export async function contactAPI(request, env) {
 if (request.method !== 'POST') return reply(request,{error:'Method not allowed.'},405);
 const origin = new URL(request.url).origin;
 if (request.headers.get('Origin') !== origin) return reply(request,{error:'Please send your request from our contact page.'},403);
 if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(request.headers.get('Content-Type') || '')) return reply(request,{error:'Invalid form format.'},415);
 try {
  if (Number(request.headers.get('Content-Length') || 0) > 16384) return reply(request,{error:'Your request is too long.'},413);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 16384) return reply(request,{error:'Your request is too long.'},413);
  const form = await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')},body}).formData();
  const field = name => typeof form.get(name) === 'string' ? form.get(name).trim() : '';
  const name=field('name'), email=field('email'), phone=field('phone'), goal=field('primary_goal'), company=field('company'), message=field('message');
  const methods=['email','call','text'].filter(method => field('contact_by_'+method)==='Yes');
  const goals=['More qualified leads','Improve SEO visibility','Paid advertising','New website','Custom CRM / automation','AI help / training / setup','Full growth strategy','Brand strategy / identity','Lead intake / follow-up','Marketing leadership','Analytics / client reporting'];
  if (field('_honey') || !name || name.length>120 || /[\r\n]/.test(name) || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !goals.includes(goal) || company.length>160 || message.length>3000 || phone.length>40 || !methods.length || field('consent')!=='Yes') return reply(request,{error:'Please check your name, email, goal and contact permissions.'},400);
  if (methods.some(method => method==='call'||method==='text') && !/^[+()\d\s.-]{7,40}$/.test(phone)) return reply(request,{error:'Please provide a phone number for calls or texts.'},400);
  if (methods.includes('text') && field('sms_consent')!=='Yes') return reply(request,{error:'Please confirm text-message permission or choose another contact method.'},400);
  if (!env.RESEND_API_KEY || !env.GOAT_ARCHIVE) return reply(request,{error:'Online requests are temporarily unavailable. Please email info@detcorddigital.com.'},503);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode((request.headers.get('CF-Connecting-IP')||'unknown')+'|'+new Date().toISOString().slice(0,10)));
  const key=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  const limiter=env.GOAT_ARCHIVE.get(env.GOAT_ARCHIVE.idFromName('contact-limits'));
  const limited=await limiter.fetch('https://archive/contact-limit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
  if (!limited.ok) return reply(request,{error:'Too many requests. Please try again later or email info@detcorddigital.com.'},429);
  const text=['New website consultation request','Name: '+name,'Email: '+email,'Phone: '+(phone||'Not provided'),'Company: '+(company||'Not provided'),'Goal: '+goal,'Preferred contact: '+methods.join(', '),'Response permission: Yes','Text permission: '+(methods.includes('text')?'Yes':'Not requested'),'','Additional context:',message||'Not provided'].join('\n');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(brandedEmail({from:env.PORTAL_EMAIL_FROM||env.GOAT_EMAIL_FROM||'Detcord Digital <info@detcorddigital.com>',to:['info@detcorddigital.com'],reply_to:email,subject:'Website consultation request',text})),signal:AbortSignal.timeout(15000)});
  if (!response.ok) return reply(request,{error:'Your request could not be sent. Please try again or email info@detcorddigital.com.'},502);
  return reply(request,{accepted:true});
 } catch {
  return reply(request,{error:'We could not confirm your request. Please email info@detcorddigital.com.'},503);
 }
}
