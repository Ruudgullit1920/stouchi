/* Error tracking in /api/aam (spec §8.7): off without SENTRY_DSN; with it,
 * scrubbed, and flushed before the function returns (a serverless function
 * may be frozen right after). */
import { describe, expect, it, vi } from 'vitest';
import { serverReporter, type Tracker } from '../../../src/server/monitoring';

const fakeSentry = () => ({
  init: vi.fn<Tracker['init']>(),
  captureException: vi.fn<Tracker['captureException']>(),
  flush: vi.fn<Tracker['flush']>(() => Promise.resolve(true)),
});

describe('serverReporter', () => {
  it('without SENTRY_DSN reports nothing and loads nothing', async () => {
    const load = vi.fn();
    const report = serverReporter({}, load);
    await report(new Error('x'));
    expect(load).not.toHaveBeenCalled();
  });

  it('with SENTRY_DSN: initialised once, scrubbed, captured, then flushed', async () => {
    const sentry = fakeSentry();
    const report = serverReporter({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1' }, () =>
      Promise.resolve(sentry),
    );
    await report(new Error('one'));
    await report(new Error('two'));
    expect(sentry.init).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    expect(sentry.flush).toHaveBeenCalledWith(2000);
    const scrubbed = JSON.stringify(sentry.init.mock.calls[0][0].beforeSend({ message: 'a@b.tn 45000' }));
    expect(scrubbed).not.toMatch(/a@b\.tn|45000/);
  });

  it('a tracker that fails never breaks the answer', async () => {
    const report = serverReporter({ SENTRY_DSN: 'https://k@o1/1' }, () => Promise.reject(new Error('down')));
    await expect(report(new Error('x'))).resolves.toBeUndefined();
  });
});
