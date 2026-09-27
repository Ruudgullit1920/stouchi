/* Error tracking in /api/aam (spec §8.7): off without POSTHOG_API_KEY and
 * POSTHOG_HOST; with them, one scrubbed "$exception" per error, sent with a
 * plain fetch (it runs as a Cloudflare Pages Function). A tracker that fails
 * never changes the answer. */
import { describe, expect, it, vi } from 'vitest';
import { serverReporter } from '../../../src/server/monitoring';

const env = { POSTHOG_API_KEY: 'phc_key', POSTHOG_HOST: 'https://eu.i.posthog.com/' };

type Sent = {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: { $exception_list: { type: string; value: string }[]; route: string };
};
const sentBody = (send: ReturnType<typeof vi.fn<typeof fetch>>): Sent =>
  JSON.parse(send.mock.calls[0][1]?.body as string) as Sent;

describe('serverReporter', () => {
  it('without the PostHog settings reports nothing', async () => {
    const send = vi.fn<typeof fetch>();
    await serverReporter({}, send)(new Error('x'));
    await serverReporter({ POSTHOG_API_KEY: 'k' }, send)(new Error('x'));
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one scrubbed $exception to the capture endpoint', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    await serverReporter(env, send)(new TypeError('refused 45000 for a@b.tn'));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe('https://eu.i.posthog.com/i/v0/e/');
    const body = sentBody(send);
    expect(body.api_key).toBe('phc_key');
    expect(body.event).toBe('$exception');
    expect(body.distinct_id).toBe('aam-server');
    expect(body.properties.route).toBe('/api/aam');
    expect(body.properties.$exception_list[0].type).toBe('TypeError');
    expect(JSON.stringify(body)).not.toMatch(/45000|a@b\.tn/);
  });

  it('a non-Error is reported as an Error', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    await serverReporter(env, send)('boom');
    expect(sentBody(send).properties.$exception_list[0]).toMatchObject({ type: 'Error', value: 'boom' });
  });

  it('a tracker that fails never breaks the answer', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new Error('down')));
    await expect(serverReporter(env, send)(new Error('x'))).resolves.toBeUndefined();
  });
});
