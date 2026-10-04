(() => {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/goat-chat.css?v=collision-20261004'; document.head.append(style);
  const root = document.createElement('div'); root.id = 'goat-chat';
  root.innerHTML = `<button class="goat-launch" aria-label="Chat with The GOAT" aria-expanded="false" aria-controls="goat-panel"><img class="goat-launch-avatar" src="/goat-96.webp" width="96" height="96" alt=""> <span class="goat-launch-label">Chat with The GOAT</span><span class="goat-launch-short" aria-hidden="true">Ask GOAT</span></button><section id="goat-panel" class="goat-panel" role="dialog" aria-label="Chat with The GOAT" hidden><div class="goat-head"><div class="goat-identity"><img class="goat-avatar" src="/goat-96.webp" width="96" height="96" alt="The Digital GOAT"><div><strong>The GOAT</strong><small>Mad Scientist of Marketing · AI</small></div></div><button class="goat-close" aria-label="Close chat">×</button></div><div class="goat-messages" role="log" aria-live="polite" aria-relevant="additions"></div><div class="goat-options"><button>More leads</button><button>A better website</button><button>Review my website</button><button>Marketing advice</button></div><form class="goat-form"><label for="goat-question" class="goat-sr">Your message</label><input id="goat-question" maxlength="1200" placeholder="Ask the GOAT…" autocomplete="off" required><button type="submit">Send</button></form><div class="goat-foot"><a href="/contact">Talk to a person</a><span>Chats saved for 30 days. <a href="/privacy">Privacy</a></span></div></section>`;
  document.body.append(root);
  const panel = root.querySelector('.goat-panel'), launch = root.querySelector('.goat-launch'), input = root.querySelector('input'), form = root.querySelector('form'), log = root.querySelector('.goat-messages'), send = form.querySelector('button');
  let history = [], busy = false, conversationId = crypto.randomUUID(), lastActivity = 0;
  function message(text, who) { const el = document.createElement('div'); el.className = `goat-message goat-${who}`; el.textContent = text; log.append(el); log.scrollTop = log.scrollHeight; return el; }
  message('Welcome to the lab. I’m the GOAT. What are we dissecting today—your ads, your website, or your next growth experiment?','assistant');
  const mobile = () => window.matchMedia('(max-width: 600px)').matches;
  let bodyStyles = null, scrollBeforeChat = 0;
  function viewport() {
    const v = window.visualViewport;
    root.style.setProperty('--goat-height', (v ? v.height : window.innerHeight) + 'px');
    root.style.setProperty('--goat-top', (v ? v.offsetTop : 0) + 'px');
    root.classList.toggle('goat-compact', mobile() && (v ? v.height : window.innerHeight) < 480);
  }
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  viewport();
  // Move the closed launcher out of the way while a form or calculator is on screen.
  const protectedRegions = [...document.querySelectorAll('#contact-form, .lab-calculator, .lab-result')];
  if (protectedRegions.length) {
   const visible = new Set();
   const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
    root.classList.toggle('goat-clear-controls', visible.size > 0);
   });
   protectedRegions.forEach(region => observer.observe(region));
  }
  function toggle(open) {
    panel.hidden = !open; launch.setAttribute('aria-expanded', String(open));
    root.classList.toggle('goat-open', open);
    if (open) {
      window.detcordMeasure?.('chat_open');
      if (mobile()) {
        scrollBeforeChat=window.scrollY;
        bodyStyles={position:document.body.style.position,top:document.body.style.top,width:document.body.style.width,overflow:document.body.style.overflow};
        Object.assign(document.body.style,{position:'fixed',top:-scrollBeforeChat+'px',width:'100%',overflow:'hidden'});
        panel.setAttribute('aria-modal','true');
        root.querySelector('.goat-close').focus({preventScroll:true});
      } else input.focus();
      viewport();
    } else {
      input.blur();
      if(bodyStyles){Object.assign(document.body.style,bodyStyles);bodyStyles=null;window.scrollTo({top:scrollBeforeChat,behavior:'instant'});}
      panel.removeAttribute('aria-modal');launch.focus({preventScroll:true});
    }
  }
  launch.onclick = () => toggle(panel.hidden); root.querySelector('.goat-close').onclick = () => toggle(false);
  root.addEventListener('keydown', e => {
    if(e.key==='Escape'){toggle(false);return;}
    if(e.key==='Tab'&&!panel.hidden&&panel.getAttribute('aria-modal')==='true'){
      const focusable=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  async function ask(text) {
    if (busy || !text.trim()) return;
    if(lastActivity && Date.now()-lastActivity>=300000){conversationId=crypto.randomUUID();history=[];}
    lastActivity=Date.now();
    busy = true; send.disabled = true; input.disabled = true; root.querySelector('.goat-options').hidden = true;
    message(text,'user'); input.value = ''; const pending = message('The GOAT is working the problem…','assistant');
    const messages = [...history.slice(-10), { role:'user', content:text }];
    try {
      const response = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages,conversationId,turnId:crypto.randomUUID(),page:location.pathname}), signal:AbortSignal.timeout(55000) });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.error || 'The GOAT is unavailable. Please use our contact form.');
      lastActivity=Date.now();
      pending.textContent = data.reply;
      if(data.saved === false) message('This conversation could not be saved for review.','assistant');
      if (Array.isArray(data.sources)) {
        const seen = new Set();
        for (const source of data.sources) {
          try { const url = new URL(source.url); if (!['https:','http:'].includes(url.protocol) || seen.has(url.href)) continue; seen.add(url.href);
            const link = document.createElement('a'); link.href = url.href; link.textContent = source.title || url.hostname; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'goat-source'; pending.append(document.createElement('br'), link);
          } catch {}
        }
      }
      window.detcordMeasure?.('chat_reply_received');
      history = [...messages, {role:'assistant',content:data.reply.slice(0,1200)}];
    } catch (error) { pending.textContent = error.name === 'TimeoutError' ? 'That took too long. Please try again or use our contact form.' : (error.message || 'Please try again or use our contact form.'); }
    finally { busy = false; send.disabled = false; input.disabled = false; log.scrollTop = log.scrollHeight; if (!panel.hidden && !mobile()) input.focus(); }
  }
  form.onsubmit = e => {e.preventDefault(); ask(input.value.trim());};
  root.querySelectorAll('.goat-options button').forEach(button => { button.onclick = () => ask(button.textContent); });
})();
