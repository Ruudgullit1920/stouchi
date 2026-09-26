import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openLocal } from '../../../src/data/localdb';
import { pendingFor } from '../../../src/data/outbox';
import { runPayday, startPayday } from '../../../src/data/payday';
import { createStore } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { goal, profile, USER } from '../fixtures';

let n = 0;
const NOV_2 = new Date('2026-11-02T09:00:00+01:00');

async function setup(ready = true) {
  const db = await openLocal(`payday-${++n}`);
  const store = createStore();
  await useUser(db, store, USER);
  store.profile.value = profile({ onboarded_at: '2026-09-01T10:00:00+01:00' });
  store.goals.value = [
    goal({ archived_at: '2026-09-02T10:00:00+01:00' }),
    goal({ created_at: '2026-09-01T10:00:00+01:00' }),
  ];
  /* a cached profile makes the device 'ready' at once; payday waits for this session's first pull */
  store.sync.value = { ...store.sync.value, load: 'ready', pulled: ready };
  store.sync.value = { ...store.sync.value, load: 'ready', pulled: ready };
  return { db, store };
}

describe('runPayday', () => {
  it('writes the missed deposits to the device and the outbox, once', async () => {
    const { db, store } = await setup();
    await runPayday(db, store, NOV_2);
    expect(store.savingsMoves.value.map((m) => [m.occurred_on, m.goal_id])).toEqual([
      ['2026-10-01', store.goals.value[1].id],
      ['2026-11-01', store.goals.value[1].id],
    ]);
    expect((await pendingFor(db, USER)).map((e) => [e.table, e.mode])).toEqual([
      ['savings_moves', 'ignore'],
      ['savings_moves', 'ignore'],
    ]);

    await runPayday(db, store, NOV_2);
    expect(store.savingsMoves.value).toHaveLength(2);
    expect(await pendingFor(db, USER)).toHaveLength(2);
  });

  it('folds a pending plan whose period has opened into the profile, through the outbox, once', async () => {
    const { db, store } = await setup();
    store.profile.value = {
      ...store.profile.value!,
      next_salary_mil: 3_000_000,
      next_split_needs: 60,
      next_split_wants: 20,
      next_split_savings: 20,
      next_from: '2026-11-01',
    };
    await runPayday(db, store, NOV_2);
    expect(store.profile.value).toMatchObject({ salary_mil: 3_000_000, split_needs: 60, next_from: null });
    const profiles = () => pendingFor(db, USER).then((es) => es.filter((e) => e.table === 'profiles'));
    expect(await profiles()).toHaveLength(1);
    await runPayday(db, store, NOV_2);
    expect((await profiles())[0].rev).toBe(1);
  });

  it('waits for this session’s first pull, even with a cached profile', async () => {
    const { db, store } = await setup(false);
    await runPayday(db, store, NOV_2);
    expect(store.savingsMoves.value).toEqual([]);
  });
});

describe('startPayday', () => {
  it('runs once the first load is ready and again on focus', async () => {
    const { db, store } = await setup(false);
    const target = new EventTarget();
    const win = Object.assign(target, { document: { visibilityState: 'visible' as const } });
    const stop = startPayday(db, store, win, () => NOV_2);
    const settle = () => new Promise((r) => setTimeout(r, 50));

    await settle();
    expect(store.savingsMoves.value).toEqual([]);
    store.sync.value = { ...store.sync.value, pulled: true };
    await settle();
    const first = store.savingsMoves.value.length;
    expect(first).toBeGreaterThan(0);

    store.savingsMoves.value = [];
    win.dispatchEvent(new Event('focus'));
    await settle();
    expect(store.savingsMoves.value).toHaveLength(first);
    stop();
  });
});
