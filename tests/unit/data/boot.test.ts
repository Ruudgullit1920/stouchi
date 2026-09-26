// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { boot, store } from '../../../src/data/app';
import { openLocal } from '../../../src/data/localdb';
import { createStore } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { writeRow } from '../../../src/data/write';
import { expense, USER } from '../fixtures';

/* A Supabase client whose stored session has expired and can't be refreshed
   (offline): getSession() gives no session. */
const noSession = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
} as unknown as SupabaseClient;

let n = 0;

describe('boot', () => {
  it('is signed out on a device nobody has used', async () => {
    const name = `boot-${++n}`;
    expect(await boot(noSession, () => openLocal(name))).toBe('signed-out');
  });

  it('opens the device copy offline when the session expired, keeping unsent writes', async () => {
    const name = `boot-${++n}`;
    const db = await openLocal(name);
    const before = createStore();
    await useUser(db, before, USER);
    await writeRow(db, USER, 'expenses', expense({ label: 'offline, unsent' }), before);
    db.close();

    expect(await boot(noSession, () => openLocal(name))).toBe('signed-in');
    expect(store.expenses.value.map((e) => e.label)).toEqual(['offline, unsent']);
    expect(store.sync.value).toMatchObject({ authLost: true, pending: 1 });
  });
});
