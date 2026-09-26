// @vitest-environment jsdom
/* Review Focus 5: the account goes on the server first; only then is the
 * device wiped (push, IndexedDB, session). A failed RPC wipes nothing. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocal } from '../../../src/data/localdb';
import { USER } from '../fixtures';

const steps: string[] = [];
let pushFails = false;
let rpcError: { message: string } | null = null;

vi.mock('../../../src/data/supabase', () => {
  const client = {
    rpc: (name: string) => {
      steps.push(`rpc ${name}`);
      return Promise.resolve({ error: rpcError });
    },
    auth: {
      signOut: (opts?: { scope?: string }) => {
        steps.push(`end session ${opts?.scope ?? 'global'}`);
        return Promise.resolve({ error: null });
      },
    },
  };
  return { supabase: () => client };
});

Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: {
    getRegistration: () =>
      Promise.resolve({
        pushManager: {
          getSubscription: () =>
            pushFails
              ? Promise.reject(new Error('no push'))
              : Promise.resolve({
                  unsubscribe: () => {
                    steps.push('unsubscribe');
                    return Promise.resolve(true);
                  },
                }),
        },
      }),
  },
});

const { data, deleteAccount, store } = await import('../../../src/data/app');

async function deviceWithRows() {
  const db = await openLocal('stouchi');
  await db.put('expenses', { id: 'e1' }, 'e1');
  await db.put('meta', USER, 'owner');
  data.db = db;
  store.userId.value = USER;
  localStorage.setItem('stouchi.hideAmounts', '1');
}
const rowsLeft = async () => {
  const db = await openLocal('stouchi');
  const n = (await db.count('expenses')) + (await db.count('meta'));
  db.close();
  return n;
};

beforeEach(() => {
  steps.length = 0;
  rpcError = null;
  pushFails = false;
});

describe('deleteAccount', () => {
  it('deletes on the server, then unsubscribes, wipes the device and ends the session', async () => {
    await deviceWithRows();
    await deleteAccount();
    expect(steps).toEqual(['rpc delete_my_account', 'unsubscribe', 'end session local']);
    expect(await rowsLeft()).toBe(0);
    expect(localStorage.getItem('stouchi.hideAmounts')).toBeNull();
    expect(data.db).toBeNull();
  });

  it('keeps everything when the server refuses', async () => {
    await deviceWithRows();
    rpcError = { message: 'boom' };
    await expect(deleteAccount()).rejects.toThrow('boom');
    expect(steps).toEqual(['rpc delete_my_account']);
    data.db?.close();
    expect(await rowsLeft()).toBe(2);
    expect(localStorage.getItem('stouchi.hideAmounts')).toBe('1');
  });

  it('once the server has deleted, a failing step does not stop the wipe (I1)', async () => {
    await deviceWithRows();
    pushFails = true;
    await deleteAccount();
    expect(steps).toEqual(['rpc delete_my_account', 'end session local']);
    expect(await rowsLeft()).toBe(0);
    expect(localStorage.getItem('stouchi.hideAmounts')).toBeNull();
  });
});
