/* The browser's Supabase client: the public URL and publishable key only,
 * from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. RLS does the guarding. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  /* PKCE: the OAuth return carries ?code=, never a #token that the hash router would eat. */
  client = createClient(url, key, { auth: { flowType: 'pkce' } });
  return client;
}
