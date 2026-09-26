/* The one call to the server's Aam Salah (/api/aam), with the session token and
 * a 16 s limit. Status 0 means the network or the time limit failed. */
import type { ServerAction } from './execute';

export interface AamRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nudgeSeen: string[];
  lastAction?: { type: string; ref: string; at: string };
}

export interface AamReply {
  reply: string;
  actions: ServerAction[];
  chips: string[];
  lang: 'fr' | 'en';
  nudgeKey: string | null;
}

export type ApiResult = { ok: true; body: AamReply } | { ok: false; status: number; error?: string };

export const TIMEOUT_MS = 16_000;

const isReply = (b: unknown): b is AamReply => {
  const r = b as Partial<AamReply> | null;
  return !!r && typeof r.reply === 'string' && Array.isArray(r.actions) && Array.isArray(r.chips);
};

export async function callAam(
  req: AamRequest,
  token: string,
  { fetchImpl = fetch, timeoutMs = TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ApiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/aam', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && isReply(body))
      return {
        ok: true,
        body: { ...body, nudgeKey: body.nudgeKey ?? null, lang: body.lang === 'en' ? 'en' : 'fr' },
      };
    const error = (body as { error?: unknown } | null)?.error;
    return { ok: false, status: res.ok ? 502 : res.status, ...(typeof error === 'string' && { error }) };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
