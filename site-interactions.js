(() => {
const goals={
 leads:{label:'DEMAND',title:'Better-fit buyers. Clearer next steps.',body:'Start with your audience and offer, then connect targeted ads to a focused landing page. Measure qualified conversations, not just clicks.',links:[['Explore paid search','/google-ads.html'],['Explore conversion optimization','/cro.html']],form:'More qualified leads'},
 website:{label:'CONVERSION',title:'Make the next step feel obvious.',body:'Give visitors a clear reason to choose you, show the proof they need, and remove friction from the path to a call, form or purchase.',links:[['Explore web design','/web-design.html'],['Explore conversion optimization','/cro.html']],form:'New website'},
 search:{label:'VISIBILITY',title:'Show up where intent starts.',body:'Build useful pages around what your customers search for. Connect technical foundations, relevant content and local visibility into one search strategy.',links:[['Explore SEO','/seo.html'],['Explore local SEO','/local-seo.html']],form:'Improve SEO visibility'},
 systems:{label:'FOLLOW-UP',title:'Give every opportunity a next step.',body:'Connect lead capture, your CRM and follow-up. Spend less time moving information between tools and more time having useful customer conversations.',links:[['Explore automation','/marketing-automation.html'],['Explore custom CRM','/custom-crm-development.html']],form:'Custom CRM / automation'}
};
const result=document.getElementById('goal-result');
document.querySelectorAll('[data-goal]').forEach(button=>button.addEventListener('click',()=>{
 const id=button.dataset.goal,g=goals[id];if(!g||!result)return;
 document.querySelectorAll('[data-goal]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 result.querySelector('.eyebrow').textContent='THE EXPERIMENT / '+g.label;
 result.querySelector('h3').textContent=g.title;result.querySelector('p').textContent=g.body;
 const links=result.querySelectorAll('a');g.links.forEach(([text,url],i)=>{links[i].textContent=text+' ↗';links[i].href=url;});links[2].href='/contact.html?goal='+id;
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