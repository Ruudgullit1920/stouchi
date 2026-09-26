/* The browser's Supabase client: the public URL and publishable key only,
 * from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. RLS does the guarding.
 *
 * Built from auth-js + postgrest-js rather than supabase-js, whose realtime,
 * storage and functions clients the app never uses (~30 kB gzipped of the
 * 150 kB first-load budget, spec §8.4). It keeps supabase-js's behaviour where
 * the app relies on it: the same storage key (nobody is signed out by the
 * switch), and every REST call carries the apikey and the user's JWT, or the
 * publishable key when signed out. The server keeps supabase-js (src/server). */
import { AuthClient, type GoTrueClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

type Rest = PostgrestClient;

/** What the app uses of a Supabase client. */
export interface Db {
  auth: GoTrueClient;
  from: Rest['from'];
  rpc: Rest['rpc'];
}

interface Options {
  /** tests only: a memory storage instead of localStorage */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetch?: typeof fetch;
}

export function createDb(url: string, key: string, options: Options = {}): Db {
  const base = new URL(url.endsWith('/') ? url : `${url}/`);
  const baseFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const auth = new AuthClient({
    url: new URL('auth/v1', base).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    /* supabase-js's default key: sessions stored before the switch still load */
    storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    /* PKCE: the OAuth return carries ?code=, never a #token that the hash router would eat. */
    flowType: 'pkce',
    ...(options.storage ? { storage: options.storage } : {}),
    fetch: baseFetch,
  });
  const authedFetch: typeof fetch = async (input, init) => {
    const { data } = await auth.getSession();
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) headers.set('apikey', key);
    if (!headers.has('Authorization'))
      headers.set('Authorization', `Bearer ${data.session?.access_token ?? key}`);
    return baseFetch(input, { ...init, headers });
  };
  const rest: Rest = new PostgrestClient(new URL('rest/v1', base).href, { fetch: authedFetch });
  return { auth, from: rest.from.bind(rest), rpc: rest.rpc.bind(rest) };
}

let client: Db | null = null;

export function supabase(): Db {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  client = createDb(url, key);
  return client;
}
