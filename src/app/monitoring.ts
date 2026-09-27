/* Error tracking in the browser (spec §8.7): PostHog, loaded after the page has
 * loaded and gone idle so it isn't part of the first-load budget (§8.4), and
 * only when VITE_POSTHOG_KEY is set — dev, E2E and CI send nothing. It captures
 * exceptions and our own events only: no autocapture, no session replay, no
 * page text. Every event goes through scrubCapture(): nothing the user typed
 * leaves the phone (§8.5). */
import { setSyncFailureReporter } from '../data/report';
import { scrubCapture, type CaptureEvent } from '../shared/scrub';

export interface Analytics {
  init(key: string, options: Record<string, unknown>): unknown;
  capture(event: string, properties: Record<string, string>): unknown;
  register(properties: Record<string, string>): unknown;
}

const loadPosthog = () => import('posthog-js').then((m) => m.default as unknown as Analytics);

export async function initMonitoring(
  key: string | undefined = import.meta.env.VITE_POSTHOG_KEY as string | undefined,
  load: () => Promise<Analytics> = loadPosthog,
  release: string = (import.meta.env.VITE_RELEASE as string | undefined) ?? 'dev',
): Promise<boolean> {
  if (!key) return false;
  const posthog = await load();
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    capture_exceptions: true,
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_surveys: true,
    before_send: (event: CaptureEvent | null) => (event ? scrubCapture(event) : null),
  });
  posthog.register({ release });
  setSyncFailureReporter(({ table, kind, code }) =>
    posthog.capture('sync_failed', { table, kind, code: code || 'unknown' }),
  );
  return true;
}
