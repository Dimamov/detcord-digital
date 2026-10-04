import { portalAPI } from './portal-api.js';
export { ClientPortal } from './portal-api.js';
import { onRequestPost, onRequestGet } from './functions/api/chat.js';
import { reviewAPI } from './goat-archive.js';
export { GoatArchive } from './goat-archive.js';
import { portalPage } from './portal-shell.js';
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(['/client-portal','/client-portal/','/client-portal.html'].includes(url.pathname))return portalPage(request,env,portalAPI);
  if(['/portal.js','/portal-contracts.js','/portal-access.js'].includes(url.pathname)){const session=await portalAPI(new Request(url.origin+'/api/portal/me',{headers:request.headers}),env);if(session.status!==200)return new Response('Sign in required',{status:401,headers:{'Cache-Control':'no-store'}});return env.ASSETS.fetch(request);}
  if(url.pathname.startsWith('/api/portal/'))return portalAPI(request,env);
  if(url.pathname.startsWith('/api/goat-review/'))return reviewAPI(request,env);
  if(url.pathname==='/api/chat') {
   if(request.method==='POST')return onRequestPost({request,env});
   if(request.method==='GET')return onRequestGet();
   return new Response('Method not allowed',{status:405});
  }
  return env.ASSETS.fetch(request);
 }
};
