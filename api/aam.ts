/* Vercel function for Aam Salah v2: a thin adapter over src/server/aam.
 * Needs SUPABASE_URL, SUPABASE_ANON_KEY and GEMINI_API_KEY in the project's
 * environment. The legacy app keeps /api/chat until Phase 7. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAam, SAFE } from '../lib/aam-salah/index.js';
import { serveAam } from '../src/server/aam/http';
import { serverReporter } from '../src/server/monitoring';

/* once per cold start; a no-op without SENTRY_DSN */
const report = serverReporter(process.env);

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const out = await serveAam(
    { method: req.method, authorization: req.headers.authorization, body: req.body ?? '' },
    process.env,
    { handleAam, safe: SAFE },
    report,
  );
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out.body));
}
