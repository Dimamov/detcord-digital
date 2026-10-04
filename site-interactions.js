(() => {
const goals={
 leads:{label:'DEMAND',title:'Better-fit buyers. Clearer next steps.',body:'Start with your audience and offer, then connect targeted ads to a focused landing page. Measure qualified conversations, not just clicks.',links:[['Explore paid search','/google-ads'],['Explore conversion optimization','/cro']],form:'More qualified leads'},
 website:{label:'CONVERSION',title:'Make the next step feel obvious.',body:'Give visitors a clear reason to choose you, show the proof they need, and remove friction from the path to a call, form or purchase.',links:[['Explore web design','/web-design'],['Explore conversion optimization','/cro']],form:'New website'},
 search:{label:'VISIBILITY',title:'Show up where intent starts.',body:'Build useful pages around what your customers search for. Connect technical foundations, relevant content and local visibility into one search strategy.',links:[['Explore SEO','/seo'],['Explore local SEO','/local-seo']],form:'Improve SEO visibility'},
 systems:{label:'FOLLOW-UP',title:'Give every opportunity a next step.',body:'Connect lead capture, your CRM and follow-up. Spend less time moving information between tools and more time having useful customer conversations.',links:[['Explore automation','/marketing-automation'],['Explore custom CRM','/custom-crm-development']],form:'Custom CRM / automation'}
};
const result=document.getElementById('goal-result');
document.querySelectorAll('[data-goal]').forEach(button=>button.addEventListener('click',()=>{
 const id=button.dataset.goal,g=goals[id];if(!g||!result)return;
 document.querySelectorAll('[data-goal]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 result.querySelector('.eyebrow').textContent='THE EXPERIMENT / '+g.label;
 result.querySelector('h3').textContent=g.title;result.querySelector('p').textContent=g.body;
 const links=result.querySelectorAll('a');g.links.forEach(([text,url],i)=>{links[i].textContent=text+' ↗';links[i].href=url;});links[2].href='/contact?goal='+id;
}));
const goal=new URLSearchParams(location.search).get('goal'),select=document.getElementById('contact-primary_goal');
if(select&&goals[goal])select.value=goals[goal].form;
const menu=document.querySelector('.mobile-menu');
if(menu){
 menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{menu.open=false;}));
 document.addEventListener('click',e=>{if(menu.open&&!menu.contains(e.target))menu.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
}
document.querySelectorAll('header .links a, .mobile-menu-panel a').forEach(a=>{
 const clean=p=>p.replace(/\.html$/,'').replace(/\/index$/,'/').replace(/\/$/,'');
 if(clean(new URL(a.href).pathname)===clean(location.pathname))a.setAttribute('aria-current','page');
});
})();
(() => {
 const form = document.getElementById('contact-form'); if (!form) return;
 const preferences = [...form.querySelectorAll('input[name^="contact_by_"]')];
 const phone = form.querySelector('[name="phone"]');
 function validatePreferences() {
  preferences[0].setCustomValidity(preferences.some(input => input.checked) ? '' : 'Choose at least one way we may contact you.');
  phone.required = preferences.some(input => input.checked && ['contact_by_call','contact_by_text'].includes(input.name));
  form.querySelector('[for="contact-phone"]').textContent = phone.required ? 'Phone (required for calls or texts)' : 'Phone (optional)';
 }
 form.addEventListener('change', validatePreferences); validatePreferences();
 form.addEventListener('submit', async event => {
  event.preventDefault();
  validatePreferences();
  if (!form.reportValidity()) return;
  const status = document.getElementById('form-status'), button = form.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true; status.textContent = 'Sending your request…';
  try {
   const response = await fetch(form.action, {method:'POST', body:new FormData(form), headers:{Accept:'application/json'}, signal:AbortSignal.timeout(25000)});
   const data = await response.json();
   if (!response.ok) throw new Error(data.error || 'Your request could not be sent. Please try again.');
   location.assign('/thanks');
  } catch(error) {
   status.textContent = error.name === 'TimeoutError' ? 'The confirmation timed out. Please email info@detcorddigital.com if you are unsure whether your request arrived.' : error.message;
   button.disabled = false;
  }
 });
})();

(() => {
 const sections=[...document.querySelectorAll('body:not(.site-home) section[id^="service-category-"]')];
 if(!sections.length)return;
 const narrow=matchMedia('(max-width:767px)');
 for(const section of sections){const grid=section.querySelector('.capability-grid');if(!grid)continue;const details=document.createElement('details');details.className='service-accordion';const summary=document.createElement('summary');summary.textContent='Explore '+section.querySelector('h2').textContent;details.append(summary);grid.before(details);details.append(grid);details.open=!narrow.matches;}
 const sync=()=>document.querySelectorAll('.service-accordion').forEach(d=>d.open=!narrow.matches);narrow.addEventListener('change',sync);
 const openTarget=()=>{const target=document.getElementById(location.hash.slice(1));target?.querySelector('.service-accordion')?.setAttribute('open','');};addEventListener('hashchange',openTarget);openTarget();
})();

(() => {
 const text=document.querySelector('[name="contact_by_text"]'),box=document.getElementById('sms-consent-wrap'),consent=document.getElementById('sms-consent');
 if(!text||!box||!consent)return;
 const sync=()=>{box.hidden=!text.checked;consent.required=text.checked;consent.disabled=!text.checked;if(!text.checked)consent.checked=false;};text.addEventListener('change',sync);sync();
})();
