/* Error tracking in the browser (spec §8.7): Sentry, loaded after the first
 * paint so it isn't part of the first-load budget (§8.4), and only when
 * VITE_SENTRY_DSN is set — dev, E2E and CI send nothing. Every event goes
 * through scrub(): nothing the user typed leaves the phone (§8.5). */
import { setSyncFailureReporter } from '../data/report';
import { scrub, type ReportEvent } from '../shared/scrub';

export interface Tracker {
  init(options: {
    dsn: string;
    release?: string;
    sendDefaultPii: boolean;
    tracesSampleRate: number;
    beforeSend: (event: ReportEvent) => ReportEvent | null;
    beforeBreadcrumb: (crumb: { category?: string }) => { category?: string } | null;
  }): void;
  captureMessage(message: string, options: { level: 'warning'; tags: Record<string, string> }): void;
}

export async function initMonitoring(
  dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN as string | undefined,
  load: () => Promise<Tracker> = () => import('@sentry/browser') as unknown as Promise<Tracker>,
): Promise<boolean> {
  if (!dsn) return false;
  const sentry = await load();
  sentry.init({
    dsn,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (crumb) => ({ category: crumb.category }),
  });
  setSyncFailureReporter(({ table, kind, code }) =>
    sentry.captureMessage('sync_failed', { level: 'warning', tags: { table, kind, code } }),
  );
  return true;
}
