import { contactAPI } from './contact-api.js';
import { portalAPI } from './portal-api.js';
export { ClientPortal } from './portal-api.js';
import { onRequestPost, onRequestGet } from './functions/api/chat.js';
import { reviewAPI } from './goat-archive.js';
export { GoatArchive } from './goat-archive.js';
import { portalPage } from './portal-shell.js';
import { portalScripts } from './portal-private.js';
export default {
 async fetch(request,env) {
  const response = await route(request,env);
  const secured = new Response(response.body,response);
  secured.headers.set("X-Content-Type-Options","nosniff");
  secured.headers.set("X-Frame-Options","SAMEORIGIN");
  secured.headers.set("Referrer-Policy","strict-origin-when-cross-origin");
  secured.headers.set("Strict-Transport-Security","max-age=31536000");
  return secured;
 }
};
async function route(request,env) {
  const url=new URL(request.url);
  if(['/client-portal','/client-portal/','/client-portal.html'].includes(url.pathname))return portalPage(request,env,portalAPI);
  if(Object.hasOwn(portalScripts,url.pathname)){const session=await portalAPI(new Request(url.origin+'/api/portal/me',{headers:request.headers}),env);if(session.status!==200)return new Response('Sign in required',{status:401,headers:{'Cache-Control':'no-store'}});return new Response(request.method==='HEAD'?null:portalScripts[url.pathname],{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie'}});}
  if(url.pathname==='/api/contact')return contactAPI(request,env);
  if(url.pathname.startsWith('/api/portal/'))return portalAPI(request,env);
  if(url.pathname.startsWith('/api/goat-review/'))return reviewAPI(request,env);
  if(url.pathname==='/api/chat') {
   if(request.method==='POST')return onRequestPost({request,env});
   if(request.method==='GET')return onRequestGet();
   return new Response('Method not allowed',{status:405});
  }
  return env.ASSETS.fetch(request);
}
