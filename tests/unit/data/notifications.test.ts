import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import { markAllRead, markRead } from '../../../src/data/notifications';
import { pendingFor } from '../../../src/data/outbox';
import { createStore, type Store } from '../../../src/data/store';
import {
  forgetDevice,
  NOTIFY_EVENT,
  pullNotifications,
  pushOnce,
  startSync,
  syncOnce,
  useUser,
} from '../../../src/data/sync';
import { patchRow, writeRow } from '../../../src/data/write';
import { expense, notification, USER, uuidN } from '../fixtures';
import { FakeRemote } from './fakeRemote';

const OTHER = uuidN(2);
const NOW = new Date('2026-09-24T10:00:00+01:00');
let db: LocalDb;
let remote: FakeRemote;
let store: Store;
let n = 0;

beforeEach(async () => {
  db = await openLocal(`notif-${++n}`);
  remote = new FakeRemote();
  store = createStore();
  await useUser(db, store, USER);
});
afterEach(() => db.close());

describe('the notifications mirror', () => {
  it('pulls the last 60 days, 200 rows at most, into the device and the signals', async () => {
    const a = notification();
    const b = notification({ read_at: '2026-09-21T08:00:00+01:00' });
    remote.serverNotify(a, b);
    await pullNotifications(db, remote, store, NOW);
    expect(remote.notifPulls).toEqual([{ since: '2026-07-26T09:00:00.000Z', limit: 200 }]);
    expect(store.notifications.value.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(store.unreadCount.value).toBe(1);
    expect(await db.get('notifications', a.id)).toEqual(a);
  });

  it('drops rows the server no longer returns (older than the window)', async () => {
    const old = notification();
    remote.serverNotify(old);
    await pullNotifications(db, remote, store, NOW);
    remote.notifications.clear();
    await pullNotifications(db, remote, store, NOW);
    expect(store.notifications.value).toEqual([]);
    expect(await db.getAll('notifications')).toEqual([]);
  });

  it('lists the newest first', async () => {
    const older = notification({ created_at: '2026-09-20T09:00:00+01:00' });
    const newer = notification({ created_at: '2026-09-23T09:00:00+01:00' });
    remote.serverNotify(older, newer);
    await pullNotifications(db, remote, store, NOW);
    expect(store.notifications.value.map((x) => x.id)).toEqual([newer.id, older.id]);
  });
});

describe('marking read (Review Focus 5)', () => {
  it('offline: sets read_at at once and queues a patch holding only read_at', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);

    expect(store.unreadCount.value).toBe(0);
    expect(((await db.get('notifications', a.id)) as { read_at: string }).read_at).not.toBeNull();
    const [entry] = await pendingFor(db, USER);
    expect(entry).toMatchObject({ op: 'patch', table: 'notifications', rowKey: a.id });
    expect(Object.keys(entry.row)).toEqual(['read_at']);
  });

  it('a pull before the patch goes out keeps the local read_at', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);
    await pullNotifications(db, remote, store, NOW);
    expect(store.unreadCount.value).toBe(0);
    expect(((await db.get('notifications', a.id)) as { read_at: string | null }).read_at).not.toBeNull();
  });

  it('a pull that fetched a row before its patch settled never makes it unread again', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);
    /* the patch goes out and settles (pushNow before a chat turn)… */
    await pushOnce(db, remote, store);
    expect(await pendingFor(db, USER)).toEqual([]);
    /* …while a pull had already fetched the row as unread */
    remote.notifications.set(a.id, { ...a, read_at: null });
    await pullNotifications(db, remote, store, NOW);
    expect(store.unreadCount.value).toBe(0);
  });

  it('on reconnect the request is an update with only read_at, never an upsert', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);
    await syncOnce(db, remote, store);

    expect(remote.calls.filter((c) => String(c.table) === 'notifications')).toEqual([]);
    expect(remote.patches).toHaveLength(1);
    expect(remote.patches[0].table).toBe('notifications');
    expect(remote.patches[0].id).toBe(a.id);
    expect(Object.keys(remote.patches[0].fields)).toEqual(['read_at']);
    expect(remote.notifications.get(a.id)?.read_at).not.toBeNull();
    expect(remote.notifications.get(a.id)?.title).toBe(a.title);
    expect(await pendingFor(db, USER)).toEqual([]);
  });

  it('a read mark isn’t an unsent write: not counted as pending, and dropped if refused', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);
    expect(store.sync.value.pending).toBe(0);
    remote.failNext('invalid', 1, '42501');
    await syncOnce(db, remote, store);
    expect(store.sync.value.failed).toEqual([]);
    expect(await pendingFor(db, USER)).toEqual([]);
  });

  it('skips a row that is already read', async () => {
    const a = notification({ read_at: '2026-09-21T08:00:00+01:00' });
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await markRead(db, store, [a.id]);
    expect(await pendingFor(db, USER)).toEqual([]);
  });

  it('markAllRead queues one patch per unread row', async () => {
    const rows = [notification(), notification(), notification({ read_at: '2026-09-21T08:00:00+01:00' })];
    remote.serverNotify(...rows);
    await pullNotifications(db, remote, store, NOW);
    await markAllRead(db, store);
    expect(store.unreadCount.value).toBe(0);
    expect((await pendingFor(db, USER)).map((e) => e.rowKey).sort()).toEqual([rows[0].id, rows[1].id].sort());
  });

  it('refuses a patch on a column outside the allow-list before queuing it', async () => {
    const a = notification();
    remote.serverNotify(a);
    await pullNotifications(db, remote, store, NOW);
    await expect(patchRow(db, USER, 'notifications', a.id, { title: 'x' }, store)).rejects.toThrow();
    await expect(
      patchRow(db, USER, 'notifications', a.id, { read_at: NOW.toISOString(), body: 'x' }, store),
    ).rejects.toThrow();
    expect(await pendingFor(db, USER)).toEqual([]);
  });
});

describe('device hand-over', () => {
  it('sign-out empties the notifications on the device and in the store', async () => {
    remote.serverNotify(notification());
    await pullNotifications(db, remote, store, NOW);
    await forgetDevice(db, store);
    expect(store.notifications.value).toEqual([]);
    expect(store.unreadCount.value).toBe(0);
    expect(await db.getAll('notifications')).toEqual([]);
    expect(await db.get('meta', 'owner')).toBeUndefined();
  });

  it('user B signing in never sees user A’s rows', async () => {
    remote.serverNotify(notification());
    await pullNotifications(db, remote, store, NOW);
    const b = createStore();
    await useUser(db, b, OTHER);
    expect(b.notifications.value).toEqual([]);
    expect(await db.getAll('notifications')).toEqual([]);
  });

  it('a new owner is reported (so the device drops the last user’s push); the same user is not', async () => {
    const onNewOwner = vi.fn(() => Promise.resolve());
    await useUser(db, createStore(), USER, { onNewOwner });
    expect(onNewOwner).not.toHaveBeenCalled();
    await useUser(db, createStore(), OTHER, { onNewOwner });
    expect(onNewOwner).toHaveBeenCalledTimes(1);
  });

  it('the same user reopening the app sees their rows from the device', async () => {
    remote.serverNotify(notification());
    await pullNotifications(db, remote, store, NOW);
    const again = createStore();
    await useUser(db, again, USER);
    expect(again.notifications.value).toHaveLength(1);
  });
});

describe('local database v4 (Phase 4: notifications)', () => {
  it('upgrading a v3 database keeps its rows and a pending outbox entry', async () => {
    const name = 'upgrade-v3';
    const old = await openDB(name, 3, {
      upgrade(v3) {
        for (const t of [
          'profiles',
          'expenses',
          'bills',
          'bill_payments',
          'debts',
          'goals',
          'savings_moves',
          'reminders',
          'incomes',
          'meta',
          'chat',
        ])
          v3.createObjectStore(t);
        v3.createObjectStore('outbox', { keyPath: 'key' });
      },
    });
    const e = expense({ label: 'avant' });
    const entry = { key: `${USER}:expenses:${e.id}`, userId: USER, table: 'expenses', rowKey: e.id, row: e };
    await old.put('expenses', e, e.id);
    await old.put('outbox', entry);
    await old.put('chat', [{ role: 'user', text: 'salut' }], USER);
    old.close();

    const v4 = await openLocal(name);
    expect(v4.version).toBe(4);
    expect(await v4.get('expenses', e.id)).toEqual(e);
    expect(await v4.get('outbox', entry.key)).toEqual(entry);
    expect(await v4.get('chat', USER)).toEqual([{ role: 'user', text: 'salut' }]);
    expect(await v4.getAll('notifications')).toEqual([]);
    v4.close();
  });

  it('an open copy on an older version steps aside when a newer app upgrades', async () => {
    const name = 'blocking';
    const onBlocking = vi.fn();
    const old = await openLocal(name, { onBlocking });
    const next = await openDB(name, 99);
    expect(onBlocking).toHaveBeenCalledTimes(1);
    expect(next.version).toBe(99);
    next.close();
    old.close();
  });

  it('an outbox entry from before Phase 4 (no op) still goes out as an upsert', async () => {
    const e = expense();
    await db.put('outbox', {
      key: `${USER}:expenses:${e.id}`,
      seq: 1,
      rev: 1,
      userId: USER,
      table: 'expenses',
      rowKey: e.id,
      row: e,
      mode: 'merge',
      attempts: 0,
      nextAt: 0,
      status: 'pending',
    });
    await syncOnce(db, remote, store);
    expect(remote.table('expenses').get(e.id)).toMatchObject({ label: e.label });
  });
});

describe('when notifications are pulled', () => {
  it('a failed notifications pull is tried again on the next round, not only on focus', async () => {
    remote.failNotifications = 1;
    const win = new EventTarget() as EventTarget & { navigator: { onLine: boolean } };
    win.navigator = { onLine: true };
    const stop = startSync(db, remote, store, win, { everyMs: 40 });
    await vi.waitFor(() => expect(remote.notifPulls.length).toBeGreaterThanOrEqual(2));
    stop();
  });

  const fakeWindow = () => {
    const target = new EventTarget() as EventTarget & { navigator: { onLine: boolean } };
    target.navigator = { onLine: true };
    return target;
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('on start, on focus and on a service-worker notify — not after every local write', async () => {
    const win = fakeWindow();
    const stop = startSync(db, remote, store, win, { everyMs: 60_000 });
    await vi.waitFor(() => expect(remote.notifPulls).toHaveLength(1));

    await writeRow(db, USER, 'expenses', expense(), store);
    await vi.waitFor(() => expect(remote.table('expenses').size).toBe(1));
    await settle();
    expect(remote.notifPulls).toHaveLength(1);

    win.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(remote.notifPulls).toHaveLength(2));
    win.dispatchEvent(new Event(NOTIFY_EVENT));
    await vi.waitFor(() => expect(remote.notifPulls).toHaveLength(3));
    stop();
  });
});
