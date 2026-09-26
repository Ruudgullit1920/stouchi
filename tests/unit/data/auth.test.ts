import 'fake-indexeddb/auto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  authErrorKey,
  googleFirstName,
  signIn,
  signInWithGoogle,
  signUp,
  validateCredentials,
} from '../../../src/data/auth';
import { openLocal } from '../../../src/data/localdb';
import { pendingFor } from '../../../src/data/outbox';
import { createStore } from '../../../src/data/store';
import { syncOnce, useUser } from '../../../src/data/sync';
import { writeRow } from '../../../src/data/write';
import { expense, USER } from '../fixtures';
import { FakeRemote } from './fakeRemote';

const OTHER = '00000000-0000-4000-8000-0000000000b2';

describe('validateCredentials', () => {
  it('asks for a complete e-mail first, then an 8-character password', () => {
    expect(validateCredentials('sofien@', 'secret1')).toEqual({ field: 'email', key: 'auth.email.invalid' });
    expect(validateCredentials(' sofien@exemple.tn ', '1234567')).toEqual({
      field: 'password',
      key: 'auth.password.short',
    });
    expect(validateCredentials(' sofien@exemple.tn ', '12345678')).toBeNull();
  });
});

describe('authErrorKey', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'auth.error.credentials'],
    [{ code: 'email_not_confirmed', status: 400 }, 'auth.error.unconfirmed'],
    [{ code: 'user_already_exists', status: 422 }, 'auth.error.exists'],
    [{ code: 'email_exists', status: 422 }, 'auth.error.exists'],
    [{ code: 'weak_password', status: 422 }, 'auth.error.weak'],
    [{ code: 'email_address_invalid', status: 400 }, 'auth.email.invalid'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'auth.error.rate'],
    [{ status: 429 }, 'auth.error.rate'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'auth.error.network'],
    [{ code: 'unexpected_failure', status: 500 }, 'auth.error.generic'],
  ])('%j → %s', (err, key) => {
    expect(authErrorKey(err)).toBe(key);
  });
});

const fakeAuth = (auth: Record<string, unknown>) => ({ auth }) as unknown as SupabaseClient;

describe('signIn / signUp / Google', () => {
  it('trims the e-mail and maps a refusal to a message key', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: 'invalid_credentials', status: 400 },
    });
    const res = await signIn(' a@b.tn ', 'secret1', fakeAuth({ signInWithPassword }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.tn', password: 'secret1' });
    expect(res).toEqual({ ok: false, key: 'auth.error.credentials' });
  });

  it('succeeds when the server returns a session', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: {} }, error: null });
    expect(await signIn('a@b.tn', 'secret1', fakeAuth({ signInWithPassword }))).toEqual({ ok: true });
  });

  it('turns a network failure into the network message', async () => {
    const signInWithPassword = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await signIn('a@b.tn', 'secret1', fakeAuth({ signInWithPassword }))).toEqual({
      ok: false,
      key: 'auth.error.network',
    });
  });

  it('says when sign-up waits for an e-mail confirmation', async () => {
    const waiting = vi.fn().mockResolvedValue({ data: { user: { id: USER }, session: null }, error: null });
    expect(await signUp('a@b.tn', 'secret1', fakeAuth({ signUp: waiting }))).toEqual({
      ok: true,
      confirm: true,
    });
    const live = vi.fn().mockResolvedValue({ data: { user: { id: USER }, session: {} }, error: null });
    expect(await signUp('a@b.tn', 'secret1', fakeAuth({ signUp: live }))).toEqual({
      ok: true,
      confirm: false,
    });
  });

  it('sends Google back to this page', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
    await signInWithGoogle(fakeAuth({ signInWithOAuth }), 'https://stouchi.app/');
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://stouchi.app/' },
    });
  });

  it('pre-fills the first name Google gives', () => {
    const user = (meta: Record<string, unknown>) => ({ user_metadata: meta }) as unknown as User;
    expect(googleFirstName(user({ given_name: 'Sofiene', full_name: 'Sofiene M' }))).toBe('Sofiene');
    expect(googleFirstName(user({ full_name: 'Amel Ben Salah' }))).toBe('Amel');
    expect(googleFirstName(user({}))).toBe('');
    expect(googleFirstName(null)).toBe('');
  });
});

describe('another user signs in on this device (Review Focus 3)', () => {
  it('leaves the first user’s unsent writes untouched and never pushes them', async () => {
    const db = await openLocal('auth-switch');
    const store = createStore();
    await useUser(db, store, USER);
    await writeRow(db, USER, 'expenses', expense({ label: 'A, unsent' }), store);

    await useUser(db, store, OTHER);
    const remote = new FakeRemote();
    remote.whoAmI = OTHER;
    await syncOnce(db, remote, store);

    expect(remote.calls).toEqual([]);
    expect(store.expenses.value).toEqual([]);
    expect((await pendingFor(db, USER)).map((e) => e.row.label)).toEqual(['A, unsent']);
  });
});
