/* The notify-run HTTP entry (Supabase Edge Function, called by pg_cron every
 * 15 minutes). Deployed with verify_jwt off: the only accepted caller is the
 * one holding NOTIFY_CRON_SECRET, compared in constant time. Errors answer
 * without detail — the service key and user data never reach a response. */
import { errorKind, runNotify, type RunDeps } from './run';

export interface HandlerEnv {
  secret: string | undefined;
  /** builds the service-key client, the writer and the push sender */
  makeDeps: () => RunDeps;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Same time whatever the input, as long as the lengths match; different lengths fail after a full pass. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

export async function handleNotify(req: Request, env: HandlerEnv): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!env.secret) return json(503, { error: 'not configured' });
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!sameSecret(token, env.secret)) return json(401, { error: 'unauthorized' });
  let deps: RunDeps | undefined;
  try {
    deps = env.makeDeps();
    return json(200, await runNotify(deps));
  } catch (e) {
    /* the kind of error only (class and table), never its text */
    deps?.log('notify_run_failed', errorKind(e));
    return json(500, { error: 'run failed' });
  }
}
