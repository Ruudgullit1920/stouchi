/* The browser's error tracking (spec §8.7): PostHog, off without a key, loaded
 * lazily with one, locked down so it records nothing the user typed, and every
 * event goes through scrubCapture(). */
import { describe, expect, it, vi } from 'vitest';
import { initMonitoring, type Analytics } from '../../../src/app/monitoring';
import { reportSyncFailure } from '../../../src/data/report';

const fakePosthog = () => ({
  init: vi.fn<Analytics['init']>(),
  capture: vi.fn<Analytics['capture']>(),
  register: vi.fn<Analytics['register']>(),
});

const options = (ph: ReturnType<typeof fakePosthog>) => ph.init.mock.calls[0][1];

describe('initMonitoring', () => {
  it('without a key (dev, E2E, CI) loads nothing and sends nothing', async () => {
    const load = vi.fn();
    expect(await initMonitoring(undefined, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('captures exceptions, and never autocapture, replay or page text', async () => {
    const ph = fakePosthog();
    expect(await initMonitoring('phc_key', () => Promise.resolve(ph))).toBe(true);
    expect(ph.init.mock.calls[0][0]).toBe('phc_key');
    expect(options(ph)).toMatchObject({
      capture_exceptions: true,
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_surveys: true,
      person_profiles: 'identified_only',
    });
  });

  it('every event goes through scrubCapture before it leaves', async () => {
    const ph = fakePosthog();
    await initMonitoring('phc_key', () => Promise.resolve(ph));
    const beforeSend = options(ph).before_send as (e: unknown) => unknown;
    const sent = JSON.stringify(
      beforeSend({
        event: '$exception',
        properties: { $exception_list: [{ type: 'Error', value: 'refused 45000 a@b.tn' }] },
      }),
    );
    expect(sent).not.toMatch(/45000|a@b\.tn/);
    expect(beforeSend(null)).toBeNull();
  });

  it('tags every event with the release', async () => {
    const ph = fakePosthog();
    await initMonitoring('phc_key', () => Promise.resolve(ph), 'abc123');
    expect(ph.register).toHaveBeenCalledWith({ release: 'abc123' });
  });

  it('turns a refused write into one "sync_failed" event, tags only, never an empty code', async () => {
    const ph = fakePosthog();
    await initMonitoring('phc_key', () => Promise.resolve(ph));
    reportSyncFailure({ table: 'expenses', kind: 'invalid', code: '23514' });
    reportSyncFailure({ table: 'incomes', kind: 'invalid', code: '' });
    expect(ph.capture).toHaveBeenCalledWith('sync_failed', {
      table: 'expenses',
      kind: 'invalid',
      code: '23514',
    });
    expect(ph.capture).toHaveBeenCalledWith('sync_failed', {
      table: 'incomes',
      kind: 'invalid',
      code: 'unknown',
    });
  });
});
