(() => {
 'use strict';
 // No remote analytics is loaded. Connect a reviewed analytics destination separately.
 const allowed = new Set(['cta_click','email_click','goal_select','calculator_used','form_start','form_submit_attempt','inquiry_confirmation_view','chat_open','chat_reply_received']);
 window.dataLayer = window.dataLayer || [];
 window.detcordMeasure = (event, details = {}) => {
  if (!allowed.has(event)) return;
  const payload = {event, page_path: location.pathname};
  if (/^\/[a-z0-9/_.-]*$/i.test(details.destination || '')) payload.destination = details.destination;
  if (['leads','website','search','systems'].includes(details.goal)) payload.goal = details.goal;
  window.dataLayer.push(payload);
  if (window.dataLayer.length > 100) window.dataLayer.splice(0, window.dataLayer.length - 100);
 };
 document.addEventListener('click', e => {
  const goal = e.target.closest('[data-goal]');
  if (goal) window.detcordMeasure('goal_select', {goal:goal.dataset.goal});
  const link = e.target.closest('a[href]'); if (!link) return;
  if (link.getAttribute('href').startsWith('mailto:')) window.detcordMeasure('email_click');
  else if (link.matches('.btn,.cta,.mobile-fuse') && link.origin === location.origin) window.detcordMeasure('cta_click',{destination:link.pathname});
 });
 const form = document.getElementById('contact-form');
 if (form) {
  form.addEventListener('input', () => window.detcordMeasure('form_start'), {once:true});
  form.addEventListener('submit', () => {
   window.detcordMeasure('form_submit_attempt');
   try { sessionStorage.setItem('detcord-form-return', 'pending'); } catch (_) {}
  });
 }
 const calculator = document.querySelector('.lab-calculator');
 if (calculator) calculator.addEventListener('input', () => window.detcordMeasure('calculator_used'), {once:true});
 if (location.pathname === '/thanks.html' || location.pathname === '/thanks') {
  try { if (sessionStorage.getItem('detcord-form-return') === 'pending') {
   window.detcordMeasure('inquiry_confirmation_view'); sessionStorage.removeItem('detcord-form-return');
  }} catch (_) {}
 }
})();
