/* The HTTP edge of /api/aam, shared by the Vercel function (api/aam.ts) and
 * the dev server (vite.config.mts): method, size cap, JSON, bearer token. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { t } from '../../shared/i18n/t';
import { runTurn, type TurnDeps, type TurnResult } from './turn';

export const MAX_BODY = 32 * 1024;

export interface AamRequest {
  method?: string;
  authorization?: string;
  /** the raw body, or what a framework already parsed */
  body: unknown;
}

export async function aamHttp(req: AamRequest, deps: TurnDeps): Promise<TurnResult> {
  if (req.method !== 'POST') return { status: 405, body: { error: t('aam.error.method') } };
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY)
    return { status: 413, body: { error: t('aam.error.tooLong') } };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: t('aam.error.badRequest') } };
  }
  const auth = req.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return runTurn(deps, token, body);
}

/** The Supabase project the function reads, with the caller's JWT. No silent
 * fallback to production (unlike the legacy chat): unset means unavailable. */
export function supabaseFor(
  env: Record<string, string | undefined>,
): ((token: string) => SupabaseClient) | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return (token) =>
    createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
}

/** The dev server's environment: /api/aam reads the same project as the app in
 * dev (VITE_SUPABASE_*, stouchi-test), never SUPABASE_URL, which .env may point
 * at production for the backfill. */
export function devEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...env, SUPABASE_URL: env.VITE_SUPABASE_URL, SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY };
}

/** Everything a turn needs from the environment. The pipeline is passed in:
 * it is CommonJS, which the Vite dev server can't load as a source module. */
export function turnDeps(
  env: Record<string, string | undefined>,
  pipeline: Pick<TurnDeps, 'handleAam' | 'safe'>,
): TurnDeps | null {
  const client = supabaseFor(env);
  if (!client) return null;
  return {
    client,
    handleAam: pipeline.handleAam,
    safe: pipeline.safe,
    env,
    now: () => new Date(),
    warn: (...args) => console.warn(...args),
  };
}

/** One request, start to finish; a missing configuration or a crash is a JSON error, never a stack. */
export async function serveAam(
  req: AamRequest,
  env: Record<string, string | undefined>,
  pipeline: Pick<TurnDeps, 'handleAam' | 'safe'>,
): Promise<TurnResult> {
  const deps = turnDeps(env, pipeline);
  if (!deps) {
    console.error('[aam] SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    return { status: 503, body: { error: t('aam.error.down') } };
  }
  try {
    return await aamHttp(req, deps);
  } catch (e) {
    console.error('[aam] unexpected', e);
    return { status: 500, body: { error: t('aam.error.down') } };
  }
}
