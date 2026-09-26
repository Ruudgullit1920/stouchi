/* Error tracking in /api/aam (spec §8.7): Sentry when SENTRY_DSN is set,
 * scrubbed like the browser's (§8.5). A serverless function may be frozen as
 * soon as it answers, so each report is flushed first; a tracker that fails
 * never changes the answer. */
import { scrub, type ReportEvent } from '../shared/scrub';

export interface Tracker {
  init(options: {
    dsn: string;
    release?: string;
    sendDefaultPii: boolean;
    tracesSampleRate: number;
    beforeSend: (event: ReportEvent) => ReportEvent | null;
  }): void;
  captureException(error: unknown): void;
  flush(timeoutMs: number): Promise<boolean>;
}

export function serverReporter(
  env: Record<string, string | undefined>,
  load: () => Promise<Tracker> = () => import('@sentry/node') as unknown as Promise<Tracker>,
): (error: unknown) => Promise<void> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return () => Promise.resolve();
  let ready: Promise<Tracker> | null = null;
  return async (error) => {
    try {
      ready ??= load().then((sentry) => {
        sentry.init({
          dsn,
          release: env.VERCEL_GIT_COMMIT_SHA,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          beforeSend: (event) => scrub(event),
        });
        return sentry;
      });
      const sentry = await ready;
      sentry.captureException(error);
      await sentry.flush(2000);
    } catch {
      /* the tracker is down: the user still gets their answer */
    }
  };
}
