(() => {
let key='',offset=0;
const $=id=>document.getElementById(id), date=value=>new Date(value).toLocaleString();
async function api(path){const r=await fetch('/api/goat-review/'+path,{headers:{Authorization:'Bearer '+key},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Review unavailable');return d;}
function text(parent,tag,value){const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;}
async function list(append=false){const d=await api('sessions?q='+encodeURIComponent($('query').value)+'&offset='+offset);if(!append)$('sessions').replaceChildren();if(!d.sessions.length&&!append)text($('sessions'),'p','No conversations found.');
for(const s of d.sessions){const b=text($('sessions'),'button',s.first_question+'\n'+date(s.updated)+' · '+s.questions+' questions · email '+s.email_state);b.className='session';b.onclick=async()=>{try{const d=await api('sessions/'+s.id);$('transcript').replaceChildren();text($('transcript'),'p',date(d.session.created)+' · '+d.session.page);for(const t of d.turns){text($('transcript'),'small',date(t.created)+(t.failed?' · reply failed':''));text($('transcript'),'h3','Visitor');text($('transcript'),'p',t.question);text($('transcript'),'h3','The GOAT');text($('transcript'),'p',t.answer);}}catch(e){$('status').textContent=e.message;}};}
offset=d.nextOffset;$('more').hidden=offset===null;
}
$('login').onsubmit=async e=>{e.preventDefault();key=$('key').value;$('key').value='';try{const d=await api('status');$('status').textContent=d.chats+' chats · '+d.questions+' questions · '+d.failed+' failed replies. '+(d.emailConfigured?'Email enabled for '+d.recipient+'.':'Email is not configured.');offset=0;await list();$('login').hidden=true;$('review').hidden=false;}catch(e){key='';$('status').textContent=e.message;}};
$('search').onsubmit=async e=>{e.preventDefault();offset=0;try{await list();}catch(e){$('status').textContent=e.message;}};
$('more').onclick=async()=>{try{await list(true);}catch(e){$('status').textContent=e.message;}};
$('logout').onclick=()=>{key='';$('sessions').replaceChildren();$('transcript').textContent='Choose a conversation.';$('status').textContent='';$('review').hidden=true;$('login').hidden=false;};
})();