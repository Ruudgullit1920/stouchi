/* The app's one store and repositories, wired to this device and the server. */
import { deleteDB } from 'idb';
import { periodsBack, todayTunis } from '../shared/dates';
import type { ExportInput, ExportRange } from '../shared/exportCsv';
import { coupleApi, type CoupleApi } from './couple';
import { createExpensesRepo, type ExpensesRepo } from './expenses';
import { fetchExportRows } from './exportRows';
import { openLocal, type LocalDb, type Row, type Table } from './localdb';
import { discard, discardHeld, retry } from './outbox';
import { startPayday } from './payday';
import { supabaseRemote, type Remote } from './remote';
import { markAllRead, markRead } from './notifications';
import {
  disablePush,
  dropDevicePush,
  enablePush,
  isPushOn,
  pushTable,
  readPushEnv,
  retryPushDelete,
  type PushApi,
  type PushDeps,
} from './push';
import { createStore, removeRow } from './store';
import { supabase, type Db } from './supabase';
import { forgetDevice, pushOnce, refreshSyncState, startSync, syncOnce, useUser } from './sync';
import { writeRow } from './write';

/** How many pay periods the device keeps and Historique shows. */
export const PERIODS_KEPT = 12;

export const store = createStore();
export const data: { db: LocalDb | null; remote: Remote | null; expenses: ExpensesRepo | null } = {
  db: null,
  remote: null,
  expenses: null,
};

const oldestKept = () => {
  const periods = periodsBack(todayTunis(), store.profile.value?.payday ?? 1, PERIODS_KEPT);
  return periods[periods.length - 1].start;
};

/** Opens the device's copy and starts syncing. With no live session (offline
 * and the token expired) the device still opens for the user who last used it
 * and did not sign out: their rows and unsent writes stay visible, and sync
 * waits until they log in again (spec §8.3). */
export async function boot(
  client: Db = supabase(),
  open: () => Promise<LocalDb> = openLocal,
): Promise<'signed-in' | 'signed-out'> {
  const { data: auth } = await client.auth.getSession();
  const db = await open();
  const userId = auth.session?.user.id ?? ((await db.get('meta', 'owner')) as string | undefined);
  if (!userId) {
    db.close();
    return 'signed-out';
  }
  /* a different user than last time: the device's push subscription isn't theirs */
  await useUser(db, store, userId, { onNewOwner: () => dropDevicePush(devicePushManager) });
  if (!auth.session) store.sync.value = { ...store.sync.value, authLost: true };
  store.email.value = auth.session?.user.email ?? null;
  data.db = db;
  data.remote = supabaseRemote(client, oldestKept);
  data.expenses = createExpensesRepo(db, store);
  /* Another tab signed someone else in: start over as them. */
  client.auth.onAuthStateChange((_event, session) => {
    if (session && session.user.id !== store.userId.value) location.reload();
  });
  startSync(db, data.remote, store);
  startPayday(db, store);
  if (auth.session) void retryPushDelete(pushTable(client), userId);
  return 'signed-in';
}

/** null where no service worker is registered (dev, tests, or not yet) */
const devicePushManager = async (): Promise<PushManager | null> =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? ((await navigator.serviceWorker.getRegistration())?.pushManager ?? null)
    : null;

const pushDeps = (userId: string, vapidKey = ''): PushDeps => ({
  userId,
  vapidKey,
  pushManager: devicePushManager,
  requestPermission: () => Notification.requestPermission(),
  table: pushTable(supabase()),
});

/** Push on this device for the signed-in user; null where it can't be set up. */
export function pushApi(): PushApi | null {
  const userId = store.userId.value;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!userId || !vapidKey || typeof navigator === 'undefined') return null;
  const deps = pushDeps(userId, vapidKey);
  return {
    env: () => readPushEnv(store.profile.value?.onboarded_at ?? null),
    isOn: () => isPushOn(deps),
    enable: () => enablePush(deps),
    disable: () => disablePush(deps),
  };
}

/** Write one of the signed-in user's rows (device first, then the outbox). */
export async function writeMine(table: Table, row: Row, opts?: { holdMs?: number }): Promise<void> {
  const userId = store.userId.value;
  if (!data.db || !userId) throw new Error('not signed in');
  await writeRow(data.db, userId, table, row, store, opts);
}

/** Undo a write made with `holdMs` while its window is open; false when too late. */
export async function undoHeld(table: Table, rowKey: string): Promise<boolean> {
  const userId = store.userId.value;
  if (!data.db || !userId) return false;
  const entry = await discardHeld(data.db, `${userId}:${table}:${rowKey}`);
  if (entry) removeRow(store, entry.table, entry.rowKey);
  await refreshSyncState(data.db, store);
  return Boolean(entry);
}

/** The rows an export needs, read from the server: it needs a connection. */
export function exportRows(range: ExportRange): Promise<ExportInput> {
  const userId = store.userId.value;
  if (!userId) return Promise.reject(new Error('not signed in'));
  return fetchExportRows(supabase(), userId, range);
}

/** Partager à deux (plan D8): the couple RPCs, once the device's data is open. */
export function coupleActions(): CoupleApi | null {
  return data.db && data.remote ? coupleApi(data.db, data.remote, store) : null;
}

/** Sync right now (the Réessayer on a failed first load). */
export async function syncNow(): Promise<void> {
  if (data.db && data.remote) await syncOnce(data.db, data.remote, store);
}

/** Send what waits in the outbox now, without pulling (before an Aam Salah turn). */
export async function pushNow(): Promise<void> {
  if (data.db && data.remote) await pushOnce(data.db, data.remote, store);
}

export async function retryWrite(key: string): Promise<void> {
  if (!data.db || !data.remote) return;
  await retry(data.db, key);
  await syncOnce(data.db, data.remote, store);
}

export async function discardWrite(key: string): Promise<void> {
  if (!data.db) return;
  const entry = await discard(data.db, key);
  if (entry) removeRow(store, entry.table, entry.rowKey);
  await refreshSyncState(data.db, store);
}

export async function readNotifications(ids: string[]): Promise<void> {
  if (data.db) await markRead(data.db, store, ids);
}

export async function readAllNotifications(): Promise<void> {
  if (data.db) await markAllRead(data.db, store);
}

/** Supprimer mon compte (plan D2): the server deletes the account first, and
 * every row cascades from it. Only then is this device wiped: its push
 * subscription, every IndexedDB store, local storage and the session. If the
 * server refuses, this throws and nothing on the device is touched. Once the
 * server has said yes it never throws: each wipe step is tried, and one that
 * fails doesn't stop the others (review I1). */
export async function deleteAccount(): Promise<void> {
  const client = supabase();
  const { error } = await client.rpc('delete_my_account');
  if (error) throw new Error(error.message);
  const attempt = (step: () => unknown) =>
    Promise.resolve()
      .then(step)
      .catch(() => undefined);
  await attempt(() => dropDevicePush(devicePushManager));
  const db = data.db;
  data.db = null;
  if (db)
    await attempt(async () => {
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names, 'readwrite');
      await Promise.all([...names.map((n) => tx.objectStore(n).clear()), tx.done]);
    });
  if (db) {
    db.close();
    /* best effort: another tab lets go on `blocking`; the stores are already empty */
    void deleteDB(db.name).catch(() => undefined);
  }
  await attempt(() => localStorage.clear());
  await attempt(() => client.auth.signOut({ scope: 'local' }));
}

/** Sign out on purpose: the device no longer opens as this user and their chat
 * and notifications are gone. Their unsent writes stay in the outbox until they
 * sign in again. */
export async function signOut(): Promise<void> {
  /* first, while the session still holds: the next user of this device must
     not get this user's pushes (Review Focus 5) */
  const userId = store.userId.value;
  if (userId) await disablePush(pushDeps(userId)).catch(() => undefined);
  if (data.db) await forgetDevice(data.db, store);
  await supabase().auth.signOut();
  location.hash = '#/budget';
  location.reload();
}
