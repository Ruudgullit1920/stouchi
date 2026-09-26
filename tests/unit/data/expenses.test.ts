import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpensesRepo } from '../../../src/data/expenses';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import { pendingFor } from '../../../src/data/outbox';
import { createStore, type Store } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { ExpenseRow } from '../../../src/shared/schemas';
import { USER, uuidN } from '../fixtures';

let db: LocalDb;
let store: Store;
let n = 0;
const draft = {
  id: uuidN(500),
  user_id: USER,
  household_id: null,
  amount_mil: 4_500,
  category: 'cafe' as const,
  pot: 'wants' as const,
  label: 'Café',
  spent_on: '2026-09-10',
  source: 'manual' as const,
  bill_id: null,
};

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  db = await openLocal(`expenses-${++n}`);
  store = createStore();
  await useUser(db, store, USER);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('expenses repository', () => {
  it('create shows the expense at once and queues it', async () => {
    const repo = createExpensesRepo(db, store);
    await repo.create(draft);
    const [shown] = store.expenses.value;
    expect(ExpenseRow.safeParse(shown).success).toBe(true);
    expect(shown).toMatchObject({ id: draft.id, deleted_at: null, created_at: '2026-09-10T09:00:00.000Z' });
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it('creating the same id twice (a double tap) stays one expense', async () => {
    const repo = createExpensesRepo(db, store);
    await repo.create(draft);
    await repo.create(draft);
    expect(store.expenses.value).toHaveLength(1);
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it('refuses an invalid expense and writes nothing', async () => {
    const repo = createExpensesRepo(db, store);
    await expect(repo.create({ ...draft, amount_mil: 0 })).rejects.toThrow();
    expect(store.expenses.value).toEqual([]);
    expect(await pendingFor(db, USER)).toHaveLength(0);
  });

  it('update, remove and restore change the one row', async () => {
    const repo = createExpensesRepo(db, store);
    await repo.create(draft);
    vi.setSystemTime(new Date('2026-09-10T09:05:00Z'));
    await repo.update(draft.id, { label: 'Café Ali', amount_mil: 5_000 });
    expect(store.expenses.value[0]).toMatchObject({ label: 'Café Ali', amount_mil: 5_000 });

    await repo.remove(draft.id);
    expect(store.expenses.value[0].deleted_at).toBe('2026-09-10T09:05:00.000Z');
    await repo.restore(draft.id);
    expect(store.expenses.value[0].deleted_at).toBeNull();
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it('refuses to edit an expense that is not on the device', async () => {
    const repo = createExpensesRepo(db, store);
    await expect(repo.update(uuidN(999), { label: 'x' })).rejects.toThrow();
  });
});

describe('a shared expense moved to Envies (plan D7, Review Focus 2)', () => {
  const HOME = uuidN(778);
  const shared = {
    ...draft,
    id: uuidN(501),
    pot: 'needs' as const,
    category: 'courses' as const,
    household_id: HOME,
  };
  beforeEach(() => {
    store.household.value = {
      household_id: HOME,
      status: 'on',
      invite: null,
      partner: { user_id: uuidN(777), first_name: 'Amel', needs_mil: 0 },
    };
  });

  it('deletes the shared row and shows a private copy with a new id', async () => {
    const repo = createExpensesRepo(db, store);
    await repo.create(shared);
    const moved = await repo.update(shared.id, { pot: 'wants', category: 'resto', label: 'Resto' });
    expect(moved.id).not.toBe(shared.id);
    expect(moved).toMatchObject({ pot: 'wants', household_id: null, label: 'Resto', deleted_at: null });
    const old = (await db.get('expenses', shared.id)) as Record<string, unknown>;
    expect(old.deleted_at).not.toBe(null);
    expect(old.household_id).toBe(HOME);
    const live = store.expenses.value.filter((e) => !e.deleted_at);
    expect(live.map((e) => e.id)).toEqual([moved.id]);
    expect((await pendingFor(db, USER)).map((e) => e.row.id).sort()).toEqual([shared.id, moved.id].sort());
  });

  it('refuses to move the partner’s expense', async () => {
    const repo = createExpensesRepo(db, store);
    const theirs = ExpenseRow.parse({
      ...shared,
      user_id: uuidN(777),
      created_at: '2026-09-10T08:00:00Z',
      updated_at: '2026-09-10T08:00:00Z',
      deleted_at: null,
    });
    await db.put('expenses', theirs, theirs.id);
    await expect(repo.update(theirs.id, { pot: 'wants' })).rejects.toMatchObject({
      key: 'couple.err.not_author',
    });
    expect(await pendingFor(db, USER)).toEqual([]);
  });

  it('a private expense (logged before the join) changes pot in place', async () => {
    const repo = createExpensesRepo(db, store);
    const old = ExpenseRow.parse({
      ...shared,
      household_id: null,
      created_at: '2026-09-01T08:00:00Z',
      updated_at: '2026-09-01T08:00:00Z',
      deleted_at: null,
    });
    await db.put('expenses', old, old.id);
    const moved = await repo.update(shared.id, { pot: 'wants' });
    expect(moved.id).toBe(shared.id);
  });
});
