import { useEffect, useState, useCallback } from 'preact/hooks';
import { signal } from '@preact/signals';

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the portal. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    session.value = { user: null, clients: [] };
    navigate('/login');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong.');
  return data;
}

// Loads data for a page with loading/error states and a reload function.
export function useLoad(path, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: !s.data, error: null }));
    try {
      setState({ loading: false, data: await api('GET', path), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e.message });
    }
  }, [path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { ...state, reload: load };
}

// ---------- Session ----------
export const session = signal(undefined); // undefined = loading; { user: null } = signed out

export async function refreshSession() {
  try {
    session.value = await api('GET', '/auth/me');
  } catch {
    session.value = { user: null, clients: [] };
  }
}

// ---------- Router ----------
export const route = signal(location.pathname + location.search + location.hash);

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  route.value = to;
  window.scrollTo(0, 0);
}
addEventListener('popstate', () => { route.value = location.pathname + location.search + location.hash; });

// Intercepts same-origin <a> clicks for client-side navigation.
addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

export function match(pattern, path) {
  const p = path.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$');
  const m = p.match(re);
  return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null;
}

export const query = () => Object.fromEntries(new URLSearchParams(location.search));

// ---------- Toasts ----------
export const toasts = signal([]);
export function toast(message, tone = 'good') {
  const id = Math.random();
  toasts.value = [...toasts.value, { id, message, tone }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 4500);
}

// ---------- Formatting ----------
const TZ = 'America/Detroit';
export const money = (cents) => cents === null || cents === undefined ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 });
export const dollars = (cents) => cents === null || cents === undefined ? '' : String(cents / 100);
export const date = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, timeZone: TZ }) : '';
export const dateTime = (ms) => ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '';
export function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date(ms);
}
export function due(ms) {
  if (!ms) return { text: 'No due date', tone: '' };
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).setHours(0, 0, 0, 0);
  const d = new Date(new Date(ms).toLocaleString('en-US', { timeZone: TZ })).setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days overdue`, tone: 'overdue' };
  if (days === 0) return { text: 'Today', tone: '' };
  if (days === 1) return { text: 'Tomorrow', tone: '' };
  return { text: date(ms), tone: '' };
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
export const toInputDate = (ms) => ms ? new Date(ms).toISOString().slice(0, 10) : '';
// Due dates picked in a date input mean 5pm Detroit time that day.
export const fromInputDate = (s) => s ? new Date(`${s}T17:00:00-04:00`).getTime() : null;

export const STATUS_LABEL = { lead: 'Lead', prospect: 'Prospect', active: 'Active client', paused: 'Paused', former: 'Former client' };
export const STATUS_TONE = { lead: 'info', prospect: 'warn', active: 'good', paused: '', former: '' };
