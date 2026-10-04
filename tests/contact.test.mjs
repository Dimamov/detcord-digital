import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactAPI} from '../contact-api.js';
import {GoatArchive} from '../goat-archive.js';
import {DatabaseSync} from 'node:sqlite';
const fields={name:'Deployment test',email:'test@example.com',primary_goal:'New website',contact_by_email:'Yes',consent:'Yes'};
const req=(overrides={},headers={})=>new Request('https://www.detcorddigital.com/api/contact',{method:'POST',headers:{Origin:'https://www.detcorddigital.com',Accept:'application/json',...headers},body:new URLSearchParams({...fields,...overrides})});
const env={RESEND_API_KEY:'test-only',GOAT_ARCHIVE:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({allowed:true})})}};
test('validation rejects unsupported origins, missing consent, bad email and missing SMS permission before delivery',async()=>{
 for(const [request,status] of [[req({}, {Origin:'https://other.example'}),403],[req({consent:''}),400],[req({email:'bad'}),400],[req({contact_by_text:'Yes',phone:'2485550100'}),400],[req({contact_by_call:'Yes',phone:''}),400],[req({_honey:'bot'}),400]]) assert.equal((await contactAPI(request,env)).status,status);
});
test('configuration and limiter errors fail closed',async()=>{
 assert.equal((await contactAPI(req(),{})).status,503);
 assert.equal((await contactAPI(req(),{...env,GOAT_ARCHIVE:{...env.GOAT_ARCHIVE,get:()=>({fetch:async()=>new Response(null,{status:429})})}})).status,429);
});
test('mail acceptance, native redirects and provider failure use correct responses without real delivery',async()=>{
 const original=globalThis.fetch;let payload;
 try {
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');payload=JSON.parse(options.body);return Response.json({id:'mock'});};
  assert.equal((await contactAPI(req({message:'<script>alert(1)</script>'}),env)).status,200);
  assert.equal(payload.reply_to,'test@example.com');assert.deepEqual(payload.to,['info@detcorddigital.com']);assert.ok(!payload.html.includes('<script>'));
  const native=await contactAPI(req({}, {Accept:'text/html'}),env);assert.equal(native.status,303);assert.equal(native.headers.get('Location'),'/thanks');
  globalThis.fetch=async()=>new Response(null,{status:500});assert.equal((await contactAPI(req(),env)).status,502);
 } finally {globalThis.fetch=original;}
});
test('durable limiter allows five attempts, rejects sixth and expires',async()=>{
 const db=new DatabaseSync(':memory:');
 const storage={sql:{exec(query,...args){const statement=db.prepare(query);if(/^\s*SELECT/i.test(query))return {toArray:()=>statement.all(...args)};statement.run(...args);return {toArray:()=>[]};}},transactionSync(fn){fn();}};
 const archive=new GoatArchive({storage},{}),key='a'.repeat(64);
 const request=()=>new Request('https://archive/contact-limit',{method:'POST',body:JSON.stringify({key})});
 for(let i=0;i<5;i++)assert.equal((await archive.fetch(request())).status,200);
 assert.equal((await archive.fetch(request())).status,429);
 db.prepare('UPDATE contact_limits SET expires=0').run();assert.equal((await archive.fetch(request())).status,200);db.close();
});
