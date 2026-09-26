/* The browser's thin Supabase client (Phase 7 Task 2): auth-js + postgrest-js
 * instead of supabase-js, with supabase-js's exact behaviour where the app
 * relies on it — above all the same storage key, so nobody is signed out by
 * the deploy (plan Review Focus 5). */
import { describe, expect, it } from 'vitest';
import { createDb } from '../../../src/data/supabase';

const URL_ = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_test';
/* supabase-js's default: sb-<project ref>-auth-token */
const STORAGE_KEY = 'sb-abcdefgh-auth-token';

const memory = (seed: Record<string, string> = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const session = (token: string) =>
  JSON.stringify({
    access_token: token,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  });

type Call = { url: string; headers: Headers };
const recording = (body: unknown = [], status = 200) => {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  };
  return { calls, fetch };
};

describe('createDb', () => {
  it('reads the session supabase-js stored, under the same key, and sends its JWT with the apikey', async () => {
    const net = recording();
    const db = createDb(URL_, KEY, {
      storage: memory({ [STORAGE_KEY]: session('jwt-1') }),
      fetch: net.fetch,
    });
    await db.from('expenses').select('*');
    const rest = net.calls.find((c) => c.url.startsWith(`${URL_}/rest/v1/expenses`));
    expect(rest?.headers.get('Authorization')).toBe('Bearer jwt-1');
    expect(rest?.headers.get('apikey')).toBe(KEY);
  });

  it('without a session, sends the publishable key as the bearer', async () => {
    const net = recording();
    const db = createDb(URL_, KEY, { storage: memory(), fetch: net.fetch });
    await db.from('expenses').select('*');
    expect(net.calls.at(-1)?.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
  });

  it('a refreshed token is used by the next call', async () => {
    const net = recording();
    const storage = memory({ [STORAGE_KEY]: session('jwt-1') });
    const db = createDb(URL_, KEY, { storage, fetch: net.fetch });
    await db.from('expenses').select('*');
    storage.setItem(STORAGE_KEY, session('jwt-2'));
    await db.from('expenses').select('*');
    expect(net.calls.at(-1)?.headers.get('Authorization')).toBe('Bearer jwt-2');
  });

  it('rpc() errors keep the { code, message } shape the callers read', async () => {
    const net = recording({ code: 'P0001', message: 'couple.err.full', details: null, hint: null }, 400);
    const db = createDb(URL_, KEY, { storage: memory(), fetch: net.fetch });
    const res = await db.rpc('couple_join', { p_code: 'STC-ABCDEF' });
    expect(net.calls.at(-1)?.url).toBe(`${URL_}/rest/v1/rpc/couple_join`);
    expect(res.data).toBeNull();
    expect(res.error).toMatchObject({ code: 'P0001', message: 'couple.err.full' });
  });

  it('signs in against /auth/v1 with the publishable key', async () => {
    const net = recording({
      access_token: 'jwt-3',
      refresh_token: 'r',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'u1' },
    });
    const storage = memory();
    const db = createDb(URL_, KEY, { storage, fetch: net.fetch });
    await db.auth.signInWithPassword({ email: 'a@b.tn', password: 'secret1' });
    const auth = net.calls.find((c) => c.url.startsWith(`${URL_}/auth/v1/token`));
    expect(auth?.headers.get('apikey')).toBe(KEY);
    expect(storage.getItem(STORAGE_KEY)).toContain('jwt-3');
  });
});
