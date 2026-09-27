// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRoute, route, routePath, startRouter } from '../../../src/app/router';

describe('parseRoute', () => {
  it('reads each place in the app from the hash', () => {
    expect(parseRoute('#/budget')).toEqual({ name: 'budget', params: {} });
    expect(parseRoute('#/history')).toEqual({ name: 'history', params: {} });
    expect(parseRoute('#/pot/needs')).toEqual({ name: 'pot', params: { pot: 'needs' } });
    expect(parseRoute('#/pot/wants')).toEqual({ name: 'pot', params: { pot: 'wants' } });
    expect(parseRoute('#/gallery')).toEqual({ name: 'gallery', params: {} });
    expect(parseRoute('#/notifications')).toEqual({ name: 'notifications', params: {} });
    expect(parseRoute('#/notifications/00000000-0000-4000-8000-000000000009')).toEqual({
      name: 'notifications',
      params: { read: '00000000-0000-4000-8000-000000000009' },
    });
    expect(parseRoute('#/history/resto')).toEqual({ name: 'history', params: { category: 'resto' } });
    for (const sub of ['split', 'bills', 'notifications', 'couple'])
      expect(parseRoute(`#/me/${sub}`)).toEqual({ name: 'me', params: { sub } });
  });

  it('falls back to Budget for an empty, unknown or malformed hash', () => {
    for (const h of [
      '',
      '#',
      '#/',
      '#/nope',
      '#/pot/savings',
      '#/pot',
      'budget',
      '#/history/nope',
      '#/notifications/nope',
      '#/me/nope',
      '#/me/split/x',
    ])
      expect(parseRoute(h)).toEqual({ name: 'budget', params: {} });
  });

  it('round-trips through routePath', () => {
    for (const h of [
      '#/budget',
      '#/history',
      '#/goal',
      '#/me',
      '#/pot/needs',
      '#/gallery',
      '#/notifications',
      '#/history/resto',
      '#/me/split',
      '#/me/bills',
      '#/me/notifications',
      '#/me/couple',
    ])
      expect(routePath(parseRoute(h))).toBe(h);
  });
});

describe('startRouter', () => {
  /* the route is read when the module loads and the listener attaches after the
     first render: a hash change in between (a tap, a test's goto while the app
     boots) was lost and the old screen stayed */
  it('picks up a hash that changed before it started listening', () => {
    location.hash = '#/gallery';
    route.value = parseRoute(location.hash);
    history.replaceState(null, '', '#/me/couple');
    const stop = startRouter();
    expect(route.value).toEqual({ name: 'me', params: { sub: 'couple' } });
    stop();
  });
});
