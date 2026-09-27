import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import { pendingFor } from '../../../src/data/outbox';
import { createStore, type Store } from '../../../src/data/store';
import { PULL_BATCH, pull, pushOnce, startSync, syncOnce, useUser } from '../../../src/data/sync';
import { writeRow } from '../../../src/data/write';
import { expense, income, profile, reminder, USER, uuidN } from '../fixtures';
import { FakeRemote } from './fakeRemote';

let db: LocalDb;
let remote: FakeRemote;
let store: Store;
let n = 0;

beforeEach(async () => {
  db = await openLocal(`sync-${++n}`);
  remote = new FakeRemote();
  store = createStore();
  await useUser(db, store, USER);
});
afterEach(() => db.close());

describe('pull', () => {
  it('applies rows changed elsewhere — new, edited, soft-deleted — to the mirror and the signals', async () => {
    const a = expense({ label: 'a' });
    const b = expense({ label: 'b' });
    remote.serverWrite('expenses', a);
    remote.serverWrite('expenses', b);
    remote.serverWrite('profiles', profile());
    await pull(db, remote, store);
    expect(store.expenses.value.map((e) => e.label).sort()).toEqual(['a', 'b']);
    expect(store.profile.value?.first_name).toBe('Sofiene');

    remote.serverWrite('expenses', { ...a, label: 'a2' });
    remote.serverWrite('expenses', { ...b, deleted_at: '2026-09-10T12:00:00+01:00' });
    await pull(db, remote, store);
    const byId = new Map(store.expenses.value.map((e) => [e.id, e]));
    expect(byId.get(a.id)?.label).toBe('a2');
    expect(byId.get(b.id)?.deleted_at).not.toBeNull();
    expect(((await db.get('expenses', a.id)) as { label: string }).label).toBe('a2');
  });

  it('only asks for what changed since the last pull', async () => {
    remote.serverWrite('expenses', expense());
    await pull(db, remote, store);
    await pull(db, remote, store);
    const cursors = remote.pulls.filter((p) => p.table === 'expenses').map((p) => p.cursor);
    expect(cursors[0]).toBeNull();
    expect(cursors[1]).not.toBeNull();
  });

  it('does not overwrite a local write that is still waiting to go out', async () => {
    const e = expense({ label: 'server' });
    remote.serverWrite('expenses', e);
    await writeRow(db, USER, 'expenses', { ...e, label: 'mine, pending' }, store);
    await pull(db, remote, store);
    expect(store.expenses.value[0].label).toBe('mine, pending');
  });
});

describe('pull, racing local writes', () => {
  it('keeps a local write made while the pull was on the network', async () => {
    const e = expense({ label: 'server' });
    remote.serverWrite('expenses', e);
    remote.onPull = async (table) => {
      if (table !== 'expenses') return;
      remote.onPull = undefined;
      await writeRow(db, USER, 'expenses', { ...e, label: 'mine, typed during the pull' }, store);
    };
    await pull(db, remote, store);
    expect(store.expenses.value[0].label).toBe('mine, typed during the pull');
    expect(((await db.get('expenses', e.id)) as { label: string }).label).toBe('mine, typed during the pull');
  });

  /* A backfilled account's first open pulls years of rows; in one transaction
     (which also locks outbox and meta) every tap that writes waited seconds. */
  it('a large pull is written in batches, and a write typed during it waits for one batch, not the whole pull', async () => {
    for (let i = 0; i < 3 * PULL_BATCH; i++) remote.serverWrite('expenses', expense({ label: `s${i}` }));
    /* which transactions finish, in order: pull batches (expenses,meta,outbox)
       and the tap's write (expenses,outbox,meta), started as batch 1 opens */
    const done: string[] = [];
    let writing: Promise<unknown> | undefined;
    const open = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementation(((
      names: string[],
      mode: IDBTransactionMode,
    ) => {
      const tx = open(names as never, mode);
      const label = String(names);
      if (label === 'expenses,meta,outbox') {
        void tx.done.then(() => done.push('batch'));
        writing ??= writeRow(db, USER, 'expenses', expense({ label: 'typed during the pull' }), store);
      } else if (label === 'expenses,outbox,meta') void tx.done.then(() => done.push('write'));
      return tx;
    }) as typeof db.transaction);
    await pull(db, remote, store);
    await writing;
    spy.mockRestore();
    expect(done).toEqual(['batch', 'write', 'batch', 'batch']);
    expect(store.expenses.value).toHaveLength(3 * PULL_BATCH + 1);
  });

  it('a local write still waiting keeps its version in a later batch, and the cursor is saved at the end', async () => {
    const rows = Array.from({ length: 2 * PULL_BATCH + 1 }, (_, i) => expense({ label: `s${i}` }));
    for (const r of rows) remote.serverWrite('expenses', r);
    const last = rows[rows.length - 1];
    await writeRow(db, USER, 'expenses', { ...last, label: 'mine' }, store);
    await pull(db, remote, store);
    expect(store.expenses.value).toHaveLength(rows.length);
    expect(store.expenses.value.find((e) => e.id === last.id)?.label).toBe('mine');
    expect(await db.get('meta', 'cursor:expenses')).toBeTruthy();
  });

  it('a pull cut short (app closed, page reloaded) resumes after the last batch it wrote, not from scratch', async () => {
    for (let i = 0; i < 2 * PULL_BATCH; i++) remote.serverWrite('expenses', expense({ label: `s${i}` }));
    const oldestFirst = [...remote.table('expenses').values()].sort((x, y) =>
      String(x.updated_at).localeCompare(String(y.updated_at)),
    );
    const open = db.transaction.bind(db);
    let batches = 0;
    const spy = vi.spyOn(db, 'transaction').mockImplementation(((
      names: string[],
      mode: IDBTransactionMode,
    ) => {
      if (String(names) === 'expenses,meta,outbox' && ++batches === 2) throw new Error('page closed');
      return open(names as never, mode);
    }) as typeof db.transaction);
    await expect(pull(db, remote, store)).rejects.toThrow('page closed');
    spy.mockRestore();
    expect(await db.get('meta', 'cursor:expenses')).toBe(String(oldestFirst[PULL_BATCH - 1].updated_at));
  });

  it('"Hors ligne" clears as soon as the server answers, not after the whole pull', async () => {
    store.sync.value = { ...store.sync.value, online: false };
    let onlineDuringPull: boolean | undefined;
    remote.onPull = (table) => {
      if (table === 'expenses') onlineDuringPull = store.sync.value.online;
      return Promise.resolve();
    };
    await pull(db, remote, store);
    expect(onlineDuringPull).toBe(true);
  });

  it('an answer that lands after the browser went offline never clears "Hors ligne"', async () => {
    store.sync.value = { ...store.sync.value, online: false };
    vi.stubGlobal('navigator', { onLine: false });
    try {
      await pull(db, remote, store);
      expect(store.sync.value.online).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-reads a short window before the cursor, so a write that committed late is not missed', async () => {
    remote.serverWrite('expenses', expense({ label: 'first' }));
    await pull(db, remote, store);
    const cursor = String((await db.get('meta', 'cursor:expenses')) as string);
    const late = expense({ label: 'late commit' });
    remote.table('expenses').set(late.id, {
      ...late,
      updated_at: new Date(Date.parse(cursor) - 5_000).toISOString(),
    });
    await pull(db, remote, store);
    expect(store.expenses.value.map((x) => x.label)).toContain('late commit');
  });
});

describe('syncOnce', () => {
  it('does nothing under another user’s session and says the session is lost', async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'A' }), store);
    remote.whoAmI = uuidN(2);
    remote.serverWrite('expenses', expense({ label: 'B row' }));
    await syncOnce(db, remote, store);
    expect(remote.calls).toHaveLength(0);
    expect(remote.pulls).toHaveLength(0);
    expect(store.sync.value).toMatchObject({ authLost: true, pending: 1 });
    remote.whoAmI = null;
    await syncOnce(db, remote, store);
    expect(remote.calls).toHaveLength(0);
    remote.whoAmI = USER;
    await syncOnce(db, remote, store);
    expect(store.sync.value).toMatchObject({ authLost: false, pending: 0 });
  });

  it('pushes the outbox, then pulls, and reports the state', async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'offline' }), store);
    expect(store.sync.value.pending).toBe(1);
    await syncOnce(db, remote, store);
    expect(store.sync.value).toMatchObject({ pending: 0, failed: [], authLost: false });
    expect(remote.table('expenses').size).toBe(1);
  });

  it('surfaces a refused write in the sync state', async () => {
    await writeRow(db, USER, 'expenses', expense(), store);
    remote.failNext('invalid', 1, '23514');
    await syncOnce(db, remote, store);
    expect(store.sync.value.failed).toHaveLength(1);
    expect(store.sync.value.pending).toBe(0);
  });

  it('marks the session lost on a 401 and keeps the writes', async () => {
    await writeRow(db, USER, 'expenses', expense(), store);
    remote.failNext('auth');
    await syncOnce(db, remote, store);
    expect(store.sync.value).toMatchObject({ authLost: true, pending: 1 });
  });
});

describe('pushOnce (before an Aam Salah turn)', () => {
  it('sends the outbox without pulling, and says nothing is pending', async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'just logged' }), store);
    await pushOnce(db, remote, store);
    expect(remote.table('expenses').size).toBe(1);
    expect(remote.pulls).toHaveLength(0);
    expect(store.sync.value.pending).toBe(0);
  });

  it('pushes nothing under another user’s session', async () => {
    await writeRow(db, USER, 'expenses', expense(), store);
    remote.whoAmI = uuidN(2);
    await pushOnce(db, remote, store);
    expect(remote.calls).toHaveLength(0);
    expect(store.sync.value.pending).toBe(1);
  });
});

describe('useUser', () => {
  it("hides the previous user's rows but keeps their unsent writes", async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'A pending' }), store);
    const B = uuidN(2);
    await useUser(db, store, B);
    expect(store.expenses.value).toEqual([]);
    expect(await db.getAll('expenses')).toEqual([]);
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it('shows what is on the device when the same user comes back (offline reload)', async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'offline' }), store);
    const again = createStore();
    await useUser(db, again, USER);
    expect(again.expenses.value.map((e) => e.label)).toEqual(['offline']);
    expect(again.sync.value.pending).toBe(1);
  });
});

describe('startSync', () => {
  const fakeWindow = (onLine: boolean) => {
    const target = new EventTarget() as EventTarget & { navigator: { onLine: boolean } };
    target.navigator = { onLine };
    return target;
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('syncs on start, after a local write, and when the connection comes back', async () => {
    const win = fakeWindow(true);
    const stop = startSync(db, remote, store, win, { everyMs: 60_000 });
    await vi.waitFor(() => expect(remote.pulls.length).toBeGreaterThan(0));

    await writeRow(db, USER, 'expenses', expense({ label: 'kick' }), store);
    await vi.waitFor(() => expect(remote.table('expenses').size).toBe(1));

    win.navigator.onLine = false;
    win.dispatchEvent(new Event('offline'));
    expect(store.sync.value.online).toBe(false);
    await writeRow(db, USER, 'expenses', expense({ label: 'while offline' }), store);
    await settle();
    expect(remote.table('expenses').size).toBe(1);

    win.navigator.onLine = true;
    win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.sync.value).toMatchObject({ online: true, pending: 0 }));
    expect(remote.table('expenses').size).toBe(2);
    stop();
  });

  it('pushes a second write to a row whose push was in flight, without waiting for the timer', async () => {
    const stop = startSync(db, remote, store, fakeWindow(true), { everyMs: 60_000 });
    await vi.waitFor(() => expect(remote.pulls.length).toBeGreaterThan(0));
    const row = expense({ label: 'first' });
    let once = true;
    remote.onUpsert = async () => {
      if (!once) return;
      once = false;
      await writeRow(db, USER, 'expenses', { ...row, label: 'second' }, store);
    };
    await writeRow(db, USER, 'expenses', row, store);
    await vi.waitFor(() =>
      expect([...remote.table('expenses').values()].map((r) => r.label)).toEqual(['second']),
    );
    stop();
  });

  /* Session A finding: right after a reconnect the network is often not usable
     yet; the first round fails and nothing tried again until the 60 s timer. */
  it('a round that fails on the network while the browser says online is retried once, soon', async () => {
    remote.failNext('network');
    const stop = startSync(db, remote, store, fakeWindow(true), { everyMs: 60_000, quickRetryMs: 50 });
    await vi.waitFor(() => expect(store.sync.value.online).toBe(false));
    await vi.waitFor(() => expect(store.sync.value).toMatchObject({ online: true, load: 'ready' }));
    stop();
  });

  it('the quick retry happens once: a network that stays down waits for the timer, no retry storm', async () => {
    remote.failNext('network', 10);
    const stop = startSync(db, remote, store, fakeWindow(true), { everyMs: 60_000, quickRetryMs: 20 });
    await vi.waitFor(() => expect(remote.pulls.length).toBe(2));
    await settle();
    await settle();
    expect(remote.pulls.length).toBe(2);
    expect(store.sync.value.online).toBe(false);
    stop();
  });

  it('no quick retry while the browser is offline', async () => {
    const win = fakeWindow(true);
    remote.failNext('network');
    /* the connection drops during the failing round */
    remote.onPull = () => {
      win.navigator.onLine = false;
      return Promise.resolve();
    };
    const stop = startSync(db, remote, store, win, { everyMs: 60_000, quickRetryMs: 20 });
    await vi.waitFor(() => expect(store.sync.value.online).toBe(false));
    await settle();
    await settle();
    expect(remote.pulls.length).toBe(1);
    stop();
  });
});

describe('first load', () => {
  it('is loading until the first pull, then ready', async () => {
    expect(store.sync.value.load).toBe('loading');
    await syncOnce(db, remote, store);
    expect(store.sync.value.load).toBe('ready');
  });

  it('says a pull happened this session only once one succeeds', async () => {
    expect(store.sync.value.pulled).toBe(false);
    remote.failNext('network');
    await syncOnce(db, remote, store);
    expect(store.sync.value.pulled).toBe(false);
    await syncOnce(db, remote, store);
    expect(store.sync.value.pulled).toBe(true);
  });

  it('is ready at once when the device already holds the profile (offline start)', async () => {
    remote.serverWrite('profiles', profile());
    await syncOnce(db, remote, store);
    const again = createStore();
    await useUser(db, again, USER);
    expect(again.sync.value.load).toBe('ready');
  });

  it('is an error when the first pull fails and nothing is on the device', async () => {
    remote.failNext('server', 20);
    await syncOnce(db, remote, store);
    expect(store.sync.value.load).toBe('error');
  });
});

describe('local database v3 (Phase 3: reminders, incomes, chat)', () => {
  it('upgrading a v1 database keeps its rows and a pending outbox entry', async () => {
    const name = 'upgrade-v1';
    const old = await openDB(name, 1, {
      upgrade(v1) {
        for (const t of ['profiles', 'expenses', 'bills', 'bill_payments', 'debts', 'goals', 'savings_moves'])
          v1.createObjectStore(t);
        v1.createObjectStore('outbox', { keyPath: 'key' });
        v1.createObjectStore('meta');
      },
    });
    const e = expense({ label: 'avant' });
    const entry = { key: `${USER}:expenses:${e.id}`, userId: USER, table: 'expenses', rowKey: e.id, row: e };
    await old.put('expenses', e, e.id);
    await old.put('outbox', entry);
    await old.put('meta', USER, 'owner');
    old.close();

    const v3 = await openLocal(name);
    expect(v3.version).toBe(4);
    expect(await v3.get('expenses', e.id)).toEqual(e);
    expect(await v3.get('outbox', entry.key)).toEqual(entry);
    expect(await v3.get('meta', 'owner')).toBe(USER);
    expect(await v3.getAll('reminders')).toEqual([]);
    expect(await v3.getAll('incomes')).toEqual([]);
    expect(await v3.getAll('chat')).toEqual([]);
    v3.close();
  });

  it('sync pulls reminders and incomes into the mirror and the signals', async () => {
    const r = reminder();
    const i = income();
    remote.serverWrite('reminders', r);
    remote.serverWrite('incomes', i);
    await pull(db, remote, store);
    expect(store.reminders.value.map((x) => x.id)).toEqual([r.id]);
    expect(store.incomes.value.map((x) => x.id)).toEqual([i.id]);
    expect(await db.get('incomes', i.id)).toMatchObject({ label: 'Prime' });
  });

  it('a local income write goes out through the outbox', async () => {
    const i = income();
    await writeRow(db, USER, 'incomes', i, store);
    await syncOnce(db, remote, store);
    expect(remote.table('incomes').get(i.id)).toMatchObject({ amount_mil: 150_000 });
  });
});
