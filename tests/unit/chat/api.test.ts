import { describe, expect, it } from 'vitest';
import { callAam } from '../../../src/features/chat/api';

const req = { messages: [{ role: 'user' as const, content: '50 courses' }], nudgeSeen: [] };
const respond = (status: number, body: unknown) =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

describe('callAam', () => {
  it('POSTs to /api/aam with the session token', async () => {
    let seen: [string, RequestInit] | null = null;
    const fetchImpl = ((url: string, init: RequestInit) => {
      seen = [url, init];
      return Promise.resolve(
        new Response(JSON.stringify({ reply: 'ok', actions: [], chips: [], lang: 'fr', nudgeKey: null })),
      );
    }) as unknown as typeof fetch;
    const res = await callAam(req, 'tok', { fetchImpl });
    expect(res).toEqual({
      ok: true,
      body: { reply: 'ok', actions: [], chips: [], lang: 'fr', nudgeKey: null },
    });
    expect(seen![0]).toBe('/api/aam');
    expect(seen![1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer tok' } });
    expect(JSON.parse(seen![1].body as string)).toEqual(req);
  });

  it('an error status keeps the server’s French line', async () => {
    expect(await callAam(req, 't', { fetchImpl: respond(429, { error: 'Doucement !' }) })).toEqual({
      ok: false,
      status: 429,
      error: 'Doucement !',
    });
  });

  it('a 200 that is not a reply is a server error', async () => {
    expect(await callAam(req, 't', { fetchImpl: respond(200, { nope: 1 }) })).toEqual({
      ok: false,
      status: 502,
    });
  });

  it('a network failure or the time limit gives status 0', async () => {
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await callAam(req, 't', { fetchImpl: down })).toEqual({ ok: false, status: 0 });
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as unknown as typeof fetch;
    expect(await callAam(req, 't', { fetchImpl: hang, timeoutMs: 10 })).toEqual({ ok: false, status: 0 });
  });
});
