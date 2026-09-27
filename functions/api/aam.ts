/* Cloudflare Pages Function for Aam Salah v2: a thin adapter over
 * src/server/aam. Variables (Pages → Settings → Variables): SUPABASE_URL,
 * SUPABASE_ANON_KEY, GEMINI_API_KEY, MISTRAL_API_KEY; optional AAM_MODELS,
 * AAM_DEADLINE_MS, TOKENROUTER_API_KEY, and POSTHOG_API_KEY + POSTHOG_HOST
 * (metrics, logs and error reports). Never the service key. */
import { handleAam, SAFE } from '../../lib/aam-salah/index.js';
import { serveAam } from '../../src/server/aam/http';
import { serverReporter } from '../../src/server/monitoring';

type Env = Record<string, string | undefined>;

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const out = await serveAam(
    {
      method: request.method,
      authorization: request.headers.get('authorization') ?? undefined,
      body: await request.text(),
    },
    env,
    { handleAam, safe: SAFE },
    serverReporter(env),
  );
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
