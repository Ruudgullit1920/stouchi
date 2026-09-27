/* Error tracking in /api/aam (spec §8.7): PostHog when POSTHOG_API_KEY and
 * POSTHOG_HOST are set. It runs as a Cloudflare Pages Function, so a report is
 * one plain fetch to PostHog's capture endpoint, awaited (with a 2 s cap)
 * before the answer goes out. Only the error's type and its scrubbed message
 * are sent (§8.5); a tracker that fails never changes the answer. */
import { scrubText } from '../shared/scrub';

export function serverReporter(
  env: Record<string, string | undefined>,
  send: typeof fetch = (...args) => fetch(...args),
): (error: unknown) => Promise<void> {
  const key = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_HOST?.replace(/\/$/, '');
  if (!key || !host) return () => Promise.resolve();
  return async (error) => {
    const e = error instanceof Error ? error : new Error(String(error));
    try {
      await send(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          event: '$exception',
          distinct_id: 'aam-server',
          properties: {
            $exception_list: [
              { type: e.name, value: scrubText(e.message), mechanism: { handled: true, type: 'generic' } },
            ],
            route: '/api/aam',
            $process_person_profile: false,
          },
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      /* the tracker is down: the user still gets their answer */
    }
  };
}
