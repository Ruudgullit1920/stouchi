/* The browser's error tracking (spec §8.7): off without a DSN, loaded lazily
 * with one, and everything it sends goes through scrub(). */
import { describe, expect, it, vi } from 'vitest';
import { initMonitoring, type Tracker } from '../../../src/app/monitoring';
import { reportSyncFailure } from '../../../src/data/report';

const fakeSentry = () => {
  const init = vi.fn<Tracker['init']>();
  const captureMessage = vi.fn<Tracker['captureMessage']>();
  return { init, captureMessage };
};

describe('initMonitoring', () => {
  it('without a DSN (dev, E2E, CI) loads nothing and sends nothing', async () => {
    const load = vi.fn();
    expect(await initMonitoring(undefined, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('with a DSN, every event goes through scrub first', async () => {
    const sentry = fakeSentry();
    expect(await initMonitoring('https://k@o1.ingest.de.sentry.io/1', () => Promise.resolve(sentry))).toBe(
      true,
    );
    const { beforeSend, dsn } = sentry.init.mock.calls[0][0];
    expect(dsn).toContain('sentry.io');
    const sent = JSON.stringify(
      beforeSend({ message: 'refused 45000', user: { id: 'u1', email: 'a@b.tn' } }),
    );
    expect(sent).not.toContain('45000');
    expect(sent).not.toContain('a@b.tn');
  });

  it('turns a refused write into one "sync_failed" warning with tags only', async () => {
    const sentry = fakeSentry();
    await initMonitoring('https://k@o1.ingest.de.sentry.io/1', () => Promise.resolve(sentry));
    reportSyncFailure({ table: 'expenses', kind: 'invalid', code: '23514' });
    expect(sentry.captureMessage).toHaveBeenCalledWith('sync_failed', {
      level: 'warning',
      tags: { table: 'expenses', kind: 'invalid', code: '23514' },
    });
  });
});
