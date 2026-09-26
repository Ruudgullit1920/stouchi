/* Signing in and out (spec §4.2). Every Supabase refusal becomes a French
 * message key; the screens never show the server's own wording. */
import type { User } from '@supabase/supabase-js';
import type { StringKey } from '../shared/i18n/t';
import { supabase } from './supabase';

export type AuthResult = { ok: true } | { ok: false; key: StringKey };
export type SignUpResult = { ok: true; confirm: boolean } | { ok: false; key: StringKey };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MIN_PASSWORD = 6;

export function validateCredentials(
  email: string,
  password: string,
): { field: 'email' | 'password'; key: StringKey } | null {
  if (!EMAIL.test(email.trim())) return { field: 'email', key: 'auth.email.invalid' };
  if (password.length < MIN_PASSWORD) return { field: 'password', key: 'auth.password.short' };
  return null;
}

const BY_CODE: Record<string, StringKey> = {
  invalid_credentials: 'auth.error.credentials',
  email_not_confirmed: 'auth.error.unconfirmed',
  user_already_exists: 'auth.error.exists',
  email_exists: 'auth.error.exists',
  weak_password: 'auth.error.weak',
  email_address_invalid: 'auth.email.invalid',
  over_request_rate_limit: 'auth.error.rate',
  over_email_send_rate_limit: 'auth.error.rate',
};

export function authErrorKey(err: { code?: string; status?: number; name?: string }): StringKey {
  if (err.code && err.code in BY_CODE) return BY_CODE[err.code];
  if (err.status === 429) return 'auth.error.rate';
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || err instanceof TypeError)
    return 'auth.error.network';
  return 'auth.error.generic';
}

const refused = (err: unknown) => ({ ok: false as const, key: authErrorKey(err as { code?: string }) });

export async function signIn(email: string, password: string, client = supabase()): Promise<AuthResult> {
  try {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? refused(error) : { ok: true };
  } catch (err) {
    return refused(err);
  }
}

/** With e-mail confirmation on, Supabase answers without a session: the user
 * must open the link first. */
export async function signUp(email: string, password: string, client = supabase()): Promise<SignUpResult> {
  try {
    const { data, error } = await client.auth.signUp({ email: email.trim(), password });
    return error ? refused(error) : { ok: true, confirm: !data.session };
  } catch (err) {
    return refused(err);
  }
}

/** Leaves for Google and comes back to this page (PKCE: the code arrives in
 * the query string, so it never collides with the hash router). */
export async function signInWithGoogle(
  client = supabase(),
  redirectTo = `${location.origin}${location.pathname}`,
): Promise<void> {
  await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
}

/** The signed-in user's first name from Google, or '' (e-mail accounts, offline). */
export async function currentFirstName(client = supabase()): Promise<string> {
  try {
    const { data } = await client.auth.getSession();
    return googleFirstName(data.session?.user);
  } catch {
    return '';
  }
}

/** The first name Google hands over, to pre-fill setup's first question. */
export function googleFirstName(user: Pick<User, 'user_metadata'> | null | undefined): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const given = typeof meta.given_name === 'string' ? meta.given_name : '';
  if (given.trim()) return given.trim();
  const full = [meta.full_name, meta.name].find((x): x is string => typeof x === 'string' && x.trim() !== '');
  return full ? full.trim().split(/\s+/)[0] : '';
}
