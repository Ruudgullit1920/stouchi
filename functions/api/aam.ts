/* Cloudflare Pages Function for Aam Salah: the same thin adapter as api/aam.ts
 * (Vercel), over the same src/server/aam. Secrets (Pages → Settings → Variables):
 * SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY; optional POSTHOG_API_KEY,
 * POSTHOG_HOST. */
import { handleAam, SAFE } from '../../lib/aam-salah/index.js';
import { serveAam } from '../../src/server/aam/http';

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
  );
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
