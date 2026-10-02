(() => {
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/goat-chat.css?v=goat-avatar-1'; document.head.append(style);
  const root = document.createElement('div'); root.id = 'goat-chat';
  root.innerHTML = `<button class="goat-launch" aria-expanded="false" aria-controls="goat-panel"><img class="goat-launch-avatar" src="/goat-chat-avatar.jpg" alt=""> <span>Chat with The GOAT</span></button><section id="goat-panel" class="goat-panel" role="dialog" aria-label="Chat with The GOAT" hidden><div class="goat-head"><div class="goat-identity"><img class="goat-avatar" src="/goat-chat-avatar.jpg" alt="The Digital GOAT"><div><strong>The GOAT</strong><small>Mad Scientist of Marketing · AI</small></div></div><button class="goat-close" aria-label="Close chat">×</button></div><div class="goat-messages" role="log" aria-live="polite" aria-relevant="additions"></div><div class="goat-options"><button>More leads</button><button>A better website</button><button>Review my website</button><button>Marketing advice</button></div><form class="goat-form"><label for="goat-question" class="goat-sr">Your message</label><input id="goat-question" maxlength="1200" placeholder="Ask the GOAT…" autocomplete="off" required><button type="submit">Send</button></form><div class="goat-foot"><a href="/contact.html">Talk to a person</a><span>AI can make mistakes. <a href="/privacy.html">Privacy</a></span></div></section>`;
  document.body.append(root);
  const panel = root.querySelector('.goat-panel'), launch = root.querySelector('.goat-launch'), input = root.querySelector('input'), form = root.querySelector('form'), log = root.querySelector('.goat-messages'), send = form.querySelector('button');
  let history = [], busy = false;
  function message(text, who) { const el = document.createElement('div'); el.className = `goat-message goat-${who}`; el.textContent = text; log.append(el); log.scrollTop = log.scrollHeight; return el; }
  message('Welcome to the lab. I’m the GOAT. What are we dissecting today—your ads, your website, or your next growth experiment?','assistant');
  function toggle(open) { panel.hidden = !open; launch.setAttribute('aria-expanded', String(open)); if (open) input.focus(); else launch.focus(); }
  launch.onclick = () => toggle(panel.hidden); root.querySelector('.goat-close').onclick = () => toggle(false);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true; send.disabled = true; input.disabled = true; root.querySelector('.goat-options').hidden = true;
    message(text,'user'); input.value = ''; const pending = message('The GOAT is working the problem…','assistant');
    const messages = [...history.slice(-10), { role:'user', content:text }];
    try {
      const response = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages}), signal:AbortSignal.timeout(55000) });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.error || 'The GOAT is unavailable. Please use our contact form.');
      pending.textContent = data.reply;
      if (Array.isArray(data.sources)) {
        const seen = new Set();
        for (const source of data.sources) {
          try { const url = new URL(source.url); if (!['https:','http:'].includes(url.protocol) || seen.has(url.href)) continue; seen.add(url.href);
            const link = document.createElement('a'); link.href = url.href; link.textContent = source.title || url.hostname; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'goat-source'; pending.append(document.createElement('br'), link);
          } catch {}
        }
      }
      history = [...messages, {role:'assistant',content:data.reply.slice(0,1200)}];
    } catch (error) { pending.textContent = error.name === 'TimeoutError' ? 'That took too long. Please try again or use our contact form.' : (error.message || 'Please try again or use our contact form.'); }
    finally { busy = false; send.disabled = false; input.disabled = false; log.scrollTop = log.scrollHeight; if (!panel.hidden) input.focus(); }
  }
  form.onsubmit = e => {e.preventDefault(); ask(input.value.trim());};
  root.querySelectorAll('.goat-options button').forEach(button => { button.onclick = () => ask(button.textContent); });
})();
