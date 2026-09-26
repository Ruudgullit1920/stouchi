/* Keeps the device's copy and the server in step: push the outbox, then pull
 * what changed since the last cursor. Last write wins per row; the server's
 * updated_at is the truth, except for rows with a write still waiting here. */
import { loadCouple, syncCouple } from './couple';
import { TABLES, rowKey, type LocalDb, type Row } from './localdb';
import { clearMirror } from './mirror';
import { flush, pendingFor } from './outbox';
import { RemoteError, type Remote } from './remote';
import type { Notification } from '../shared/schemas';
import { applyRows, clearRows, setNotifications, type Store } from './store';

export async function refreshSyncState(db: LocalDb, store: Store): Promise<void> {
  const userId = store.userId.value;
  const entries = userId ? await pendingFor(db, userId) : [];
  store.sync.value = {
    ...store.sync.value,
    /* a read mark waiting to go out is not an unsent write (sign-out doesn't warn) */
    pending: entries.filter((e) => e.status === 'pending' && e.op !== 'patch').length,
    failed: entries.filter((e) => e.status === 'failed'),
  };
}

/** Switch the device to `userId`. Another user's rows and chat leave the device;
 * their unsent writes stay in the outbox, keyed to them, until they come back. */
export async function useUser(
  db: LocalDb,
  store: Store,
  userId: string,
  { onNewOwner }: { onNewOwner?: () => Promise<void> } = {},
): Promise<void> {
  if ((await db.get('meta', 'owner')) !== userId) {
    await onNewOwner?.();
    await clearMirror(db, TABLES, { also: ['chat', 'notifications'], owner: userId });
  }
  clearRows(store);
  store.userId.value = userId;
  for (const t of TABLES) applyRows(store, t, (await db.getAll(t)) as Row[]);
  setNotifications(store, (await db.getAll('notifications')) as Notification[]);
  store.actedOn.value =
    ((await db.get('meta', `acted:${userId}`)) as Record<string, string> | undefined) ?? {};
  store.household.value = await loadCouple(db, userId);
  store.sync.value = { ...store.sync.value, load: store.profile.value ? 'ready' : 'loading' };
  await refreshSyncState(db, store);
}

/** Sign-out on purpose: the device stops opening as this user, and their chat
 * and notifications leave it. Unsent writes stay in the outbox, keyed to them. */
export async function forgetDevice(db: LocalDb, store: Store): Promise<void> {
  const tx = db.transaction(['chat', 'notifications', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('meta').delete(`acted:${store.userId.value}`),
    tx.objectStore('chat').clear(),
    tx.objectStore('notifications').clear(),
    tx.objectStore('meta').delete('owner'),
    tx.done,
  ]);
  store.notifications.value = [];
  store.actedOn.value = {};
}

export const NOTIFY_WINDOW_DAYS = 60;
export const NOTIFY_MAX_ROWS = 200;

/** The notifications window replaces the device's copy (older rows drop out),
 * except that a read_at still waiting in the outbox is kept. */
export async function pullNotifications(
  db: LocalDb,
  remote: Remote,
  store: Store,
  now: Date = new Date(),
): Promise<void> {
  const userId = store.userId.value;
  if (!userId) return;
  const since = new Date(now.getTime() - NOTIFY_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = (await remote.pullNotifications(since, NOTIFY_MAX_ROWS)) as Notification[];
  /* read_at only ever goes from null to set: keep whichever side has it, so
     neither a patch still waiting nor one that settled while this pull was on
     the network is undone */
  const tx = db.transaction('notifications', 'readwrite');
  const local = new Map(((await tx.store.getAll()) as Notification[]).map((n) => [n.id, n]));
  const kept = rows
    .filter((r) => r.user_id === userId)
    .map((r) => ({ ...r, read_at: r.read_at ?? local.get(r.id)?.read_at ?? null }));
  await Promise.all([tx.store.clear(), ...kept.map((r) => tx.store.put(r, r.id)), tx.done]);
  setNotifications(store, kept);
}
/** Rows are re-read from a little before the cursor: updated_at is a
 * transaction's start time, so a write can commit after a pull that already
 * moved past it. Rows are put by key, so reading one twice is harmless. */
const OVERLAP_MS = 30_000;

export async function pull(db: LocalDb, remote: Remote, store: Store): Promise<void> {
  const userId = store.userId.value;
  if (!userId) return;
  for (const t of TABLES) {
    const cursor = ((await db.get('meta', `cursor:${t}`)) as string | undefined) ?? null;
    const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
    const res = await remote.pullSince(t, since);
    const next = cursor && (!res.cursor || res.cursor < cursor) ? cursor : res.cursor;
    /* A row with a write still waiting here keeps the local version. The check
       runs in the same transaction as the put, so a write that lands while the
       pull was on the network is seen. The waiting keys are read once and the
       puts are queued together: one await per row kept this transaction (which
       also locks outbox and meta) open for seconds on a large first pull, and
       every write on the device waited behind it. */
    const tx = db.transaction([t, 'meta', 'outbox'], 'readwrite');
    const prefix = `${userId}:${t}:`;
    const waiting = new Set(
      (await tx.objectStore('outbox').getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`))).map(String),
    );
    const fresh = res.rows.filter((r) => !waiting.has(prefix + rowKey(t, r)));
    await Promise.all([
      ...fresh.map((r) => tx.objectStore(t).put(r, rowKey(t, r))),
      tx.objectStore('meta').put(next, `cursor:${t}`),
      tx.done,
    ]);
    applyRows(store, t, fresh);
  }
}

/** Push only, no pull: what an Aam Salah turn waits for, so the server's
 * carnet holds what was just logged without paying for a full round. */
export async function pushOnce(db: LocalDb, remote: Remote, store: Store): Promise<void> {
  const userId = store.userId.value;
  if (!userId || (await remote.currentUser()) !== userId) return;
  await syncCouple(db, remote, store);
  const { authLost } = await flush(db, remote, userId);
  if (authLost) store.sync.value = { ...store.sync.value, authLost };
  await refreshSyncState(db, store);
}

/** One round: push, then pull. Network trouble only flips `online`.
 * Resolves to whether the notifications were pulled (when asked for). */
export async function syncOnce(
  db: LocalDb,
  remote: Remote,
  store: Store,
  { notifications = false } = {},
): Promise<boolean> {
  const userId = store.userId.value;
  if (!userId) return false;
  /* Another tab may have signed someone else in, or the session may be gone:
     never push or pull this user's rows under a session that isn't theirs. */
  if ((await remote.currentUser()) !== userId) {
    store.sync.value = { ...store.sync.value, authLost: true };
    await refreshSyncState(db, store);
    return false;
  }
  /* before the push: a write made before a join or a leave goes out re-stamped */
  await syncCouple(db, remote, store);
  const { authLost } = await flush(db, remote, userId);
  let gotNotifications = false;
  let online = true;
  let load = store.sync.value.load;
  let pulled = store.sync.value.pulled;
  if (!authLost) {
    try {
      await pull(db, remote, store);
      if (notifications) {
        await pullNotifications(db, remote, store);
        gotNotifications = true;
      }
      load = 'ready';
      pulled = true;
    } catch (err) {
      if (!(err instanceof RemoteError)) throw err;
      online = err.kind !== 'network';
      if (load !== 'ready') load = 'error';
    }
  }
  store.sync.value = { ...store.sync.value, authLost, online, load, pulled };
  await refreshSyncState(db, store);
  return gotNotifications;
}

/** Posted on the window when the service worker says a push arrived. */
export const NOTIFY_EVENT = 'stouchi:notify';

interface SyncWindow extends EventTarget {
  navigator: { onLine: boolean };
}

/** Runs the sync loop in the page: on start, after every local write, when
 * the connection comes back, on focus, every `everyMs`, and when a backed-off
 * write is due again. Notifications are pulled on start, on focus and when a
 * push arrives (NOTIFY_EVENT), not on every round. Returns a stop function. */
export function startSync(
  db: LocalDb,
  remote: Remote,
  store: Store,
  win: SyncWindow = window,
  { everyMs = 60_000 } = {},
): () => void {
  let running: Promise<void> | null = null;
  let again = false;
  let notifications = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRetry = async () => {
    clearTimeout(retryTimer);
    const userId = store.userId.value;
    if (!userId) return;
    const due = (await pendingFor(db, userId))
      .filter((e) => e.status === 'pending' && e.nextAt > Date.now())
      .map((e) => e.nextAt);
    if (due.length) retryTimer = setTimeout(run, Math.min(...due) - Date.now());
  };

  function run(): void {
    if (running) {
      again = true;
      return;
    }
    if (!win.navigator.onLine) {
      store.sync.value = { ...store.sync.value, online: false };
      return;
    }
    const withNotifications = notifications;
    notifications = false;
    running = syncOnce(db, remote, store, { notifications: withNotifications })
      .then((got) => {
        /* not pulled (offline, error): the next round tries again */
        if (withNotifications && !got) notifications = true;
        return scheduleRetry();
      })
      .catch(() => {
        if (withNotifications) notifications = true;
      })
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          run();
        }
      });
  }

  const fresh = () => {
    notifications = true;
    run();
  };
  const offline = () => (store.sync.value = { ...store.sync.value, online: false });
  let lastPending = store.sync.value.pending;
  let lastWrites = store.sync.value.writes;
  const unsubscribe = store.sync.subscribe((s) => {
    if (s.pending > lastPending || s.writes !== lastWrites) run();
    lastPending = s.pending;
    lastWrites = s.writes;
  });
  win.addEventListener('online', run);
  win.addEventListener('offline', offline);
  win.addEventListener('focus', fresh);
  win.addEventListener(NOTIFY_EVENT, fresh);
  const timer = setInterval(run, everyMs);
  run();

  return () => {
    unsubscribe();
    clearInterval(timer);
    clearTimeout(retryTimer);
    win.removeEventListener('online', run);
    win.removeEventListener('offline', offline);
    win.removeEventListener('focus', fresh);
    win.removeEventListener(NOTIFY_EVENT, fresh);
  };
}
