import { describe, it, expect } from 'vitest';
import { as } from './helpers.js';

describe('Dashboard layouts', () => {
  it('saves a cleaned layout per person and page', async () => {
    const a = await as('rep');
    const b = await as('rep');
    expect(await (await a.call('GET', '/api/me/layouts/staff-home')).json()).toEqual({ layout: null });
    const res = await a.call('PUT', '/api/me/layouts/staff-home', { top: ['stats'], main: ['stale', 'tasks', 'stale', 'BAD ID', 7], side: ['pipeline', 'tasks'], hidden: ['activity'] });
    expect(res.status).toBe(200);
    const want = { top: ['stats'], main: ['stale', 'tasks'], side: ['pipeline'], hidden: ['activity'] };
    expect((await res.json()).layout).toEqual(want);
    expect((await (await a.call('GET', '/api/me/layouts/staff-home')).json()).layout).toEqual(want);
    // Someone else's layout is untouched, and unknown pages are refused.
    expect((await (await b.call('GET', '/api/me/layouts/staff-home')).json()).layout).toBeNull();
    expect((await a.call('PUT', '/api/me/layouts/other', {})).status).toBe(404);
    expect((await a.call('DELETE', '/api/me/layouts/staff-home')).status).toBe(200);
    expect((await (await a.call('GET', '/api/me/layouts/staff-home')).json()).layout).toBeNull();
  });

  it('needs a login', async () => {
    const { api } = await import('./helpers.js');
    expect((await api('GET', '/api/me/layouts/staff-home')).status).toBe(401);
  });
});
