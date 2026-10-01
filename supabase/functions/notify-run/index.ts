/* notify-run — Supabase Edge Function (Deno), called by pg_cron every 15 min
 * (supabase/sql/notify-schedule.sql). Deploy with verify_jwt = false: the
 * handler accepts only the cron secret, which lives in Vault (the database
 * made it) and is read back with public.notify_cron_secret().
 *
 * All logic is in core.js, built from src/server/notify by
 * `npm run build:notify` (run it before every deploy). This file only wires in
 * the service-key client (built into the function's environment, never in
 * Cloudflare or .env), the Gemini writer and web-push.
 *
 * Secrets (supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT (mailto:…), GEMINI_API_KEY, POSTHOG_API_KEY, POSTHOG_HOST;
 * optional NOTIFY_MODEL. */
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { geminiCaller, handleNotify, supabaseNotifyDb } from './core.js';

const env = (name: string): string | undefined => Deno.env.get(name) || undefined;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** a day: a phone that was off gets it when it wakes, later than that it's stale */
const PUSH_TTL_S = 86_400;
/** a push service that never answers must not hold the run past its limit */
const PUSH_TIMEOUT_MS = 10_000;
const SECRET_CACHE_MS = 5 * 60_000;

async function captureGeneration({
  context,
  model,
  input,
  output,
  usage,
  latency,
  httpStatus,
  isError,
}: {
  context?: { distinctId: string; sessionId: string | null; traceId: string };
  model: string;
  input: { role: 'user'; content: string }[];
  output?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latency: number;
  httpStatus?: number;
  isError: boolean;
}): Promise<void> {
  const apiKey = env('POSTHOG_API_KEY');
  const host = env('POSTHOG_HOST');
  if (!apiKey || !host || !context) return;
  /* Prompts and replies hold household budget data: sent only on opt-in. */
  const content = env('POSTHOG_CAPTURE_CONTENT') === '1';
  try {
    const send = fetch(`${host.replace(/\/$/, '')}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: '$ai_generation',
        properties: {
          distinct_id: context.distinctId,
          $ai_trace_id: context.traceId,
          $ai_session_id: context.sessionId,
          $ai_model: model,
          $ai_provider: 'gemini',
          $ai_input: content ? input : undefined,
          $ai_input_tokens: usage?.prompt_tokens,
          $ai_output_choices: content && output ? [{ role: 'assistant', content: output }] : undefined,
          $ai_output_tokens: usage?.completion_tokens,
          $ai_latency: latency,
          $ai_http_status: httpStatus,
          $ai_is_error: isError,
        },
      }),
      signal: AbortSignal.timeout(2_000),
    });
    send.catch(() => {});
    /* Let the runtime finish the send after the response, without holding the notification. */
    (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(send);
  } catch {
    /* Observability must not interrupt notification delivery. */
  }
}

type Service = ReturnType<typeof createClient>;
let service: Service | undefined;
function serviceClient(): Service | undefined {
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return undefined;
  service ??= createClient(url, serviceKey, { auth: { persistSession: false } });
  return service;
}

/** The cron secret from Vault, cached a few minutes (the cron calls every 15). */
let secret: { value: string | undefined; at: number } | undefined;
async function cronSecret(sb: Service | undefined): Promise<string | undefined> {
  if (!sb) return undefined;
  if (secret && Date.now() - secret.at < SECRET_CACHE_MS) return secret.value;
  const { data, error } = await sb.rpc('notify_cron_secret');
  secret = { value: !error && typeof data === 'string' && data ? data : undefined, at: Date.now() };
  return secret.value;
}

Deno.serve(async (req: Request) => {
  const sb = serviceClient();
  return handleNotify(req, {
    secret: await cronSecret(sb),
    makeDeps: () => {
      const vapidPublic = env('VAPID_PUBLIC_KEY');
      const vapidPrivate = env('VAPID_PRIVATE_KEY');
      const vapidSubject = env('VAPID_SUBJECT');
      if (!sb || !vapidPublic || !vapidPrivate || !vapidSubject)
        throw new Error('notify-run is missing a secret');
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      const geminiKey = env('GEMINI_API_KEY');
      return {
        db: supabaseNotifyDb(sb),
        now: new Date(),
        callModel: geminiKey
          ? geminiCaller({
              key: geminiKey,
              model: env('NOTIFY_MODEL') ?? DEFAULT_MODEL,
              captureGeneration,
            })
          : undefined,
        sendPush: async (sub: { endpoint: string; p256dh: string; auth: string }, payload: string) => {
          try {
            const res = await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
              { TTL: PUSH_TTL_S, timeout: PUSH_TIMEOUT_MS },
            );
            return res.statusCode;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (typeof status === 'number') return status;
            throw e;
          }
        },
        log: (event: string, data: Record<string, number | boolean>) =>
          console.log(JSON.stringify({ event, ...data })),
      };
    },
  });
});
