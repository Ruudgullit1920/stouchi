import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  execute,
  prepare,
  undoLast,
  type ExecCtx,
  type ServerAction,
} from '../../../src/features/chat/execute';
import { openLocal, rowKey, type LocalDb, type Row, type Table } from '../../../src/data/localdb';
import { pendingFor } from '../../../src/data/outbox';
import { applyRows, createStore, factsInput, type Store } from '../../../src/data/store';
import { useUser } from '../../../src/data/sync';
import { CoupleError, type CoupleApi } from '../../../src/data/couple';
import { computeFacts } from '../../../src/shared/facts';
import { bill, debt, expense, goal, profile, USER, uuidN } from '../fixtures';

let db: LocalDb;
let store: Store;
let ctx: ExecCtx;
let n = 0;
let ids = 0;

const TODAY = '2026-09-10';
const act = (type: string, fields: Record<string, unknown> = {}): ServerAction => ({
  type,
  kind: 'confirm',
  ...fields,
});

async function seed(table: Table, row: Row) {
  await db.put(table, row, rowKey(table, row));
  applyRows(store, table, [row]);
}
const outbox = async () => (await pendingFor(db, USER)).map((e) => e.table);
const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date(`${TODAY}T09:00:00Z`), toFake: ['Date'] });
  db = await openLocal(`execute-${++n}`);
  store = createStore();
  await useUser(db, store, USER);
  await seed('profiles', profile());
  ctx = { db, store, uuid: () => uuidN(9000 + ++ids) };
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('execute — each action writes its row', () => {
  it('add_expense: a chat expense in the mapped pot, dated as asked', async () => {
    const r = await execute(
      act('add_expense', {
        kind: 'direct',
        amount: 50,
        category: 'courses',
        pot: 'besoins',
        label: 'Courses',
        date: '2026-09-09',
      }),
      ctx,
    );
    expect(r).toMatchObject({ ok: true });
    expect(store.expenses.value[0]).toMatchObject({
      amount_mil: 50_000,
      category: 'courses',
      pot: 'needs',
      source: 'chat',
      spent_on: '2026-09-09',
      household_id: null,
      bill_id: null,
    });
    expect(await outbox()).toEqual(['expenses']);
    if (r.ok) expect(r.undo).toMatchObject({ type: 'add_expense', ref: store.expenses.value[0].id });
  });

  it('edit_expense changes only the asked fields, and the undo record keeps the old row', async () => {
    const e = expense({ amount_mil: 12_000, category: 'cafe', pot: 'wants', label: 'Café' });
    await seed('expenses', e);
    const r = await execute(
      act('edit_expense', {
        id: 'e1234',
        ref: e.id,
        changes: { amount: 21, category: 'resto', pot: 'envies' },
      }),
      ctx,
    );
    expect(store.expenses.value[0]).toMatchObject({
      amount_mil: 21_000,
      category: 'resto',
      pot: 'wants',
      label: 'Café',
    });
    expect(r.ok && r.undo?.before).toMatchObject({ amount_mil: 12_000, category: 'cafe' });
    expect(r.ok && r.summary).toContain('12');
  });

  it('delete_expense soft-deletes', async () => {
    const e = expense();
    await seed('expenses', e);
    await execute(act('delete_expense', { id: 'e1', ref: e.id }), ctx);
    expect(store.expenses.value[0].deleted_at).not.toBeNull();
    expect(await outbox()).toEqual(['expenses']);
  });

  it('pay_bill: a bill expense plus a payment for the current period', async () => {
    const b = bill({ label: 'STEG', amount_mil: 80_000 });
    await seed('bills', b);
    await execute(act('pay_bill', { id: 'b1', ref: b.id }), ctx);
    const [e] = store.expenses.value;
    expect(e).toMatchObject({
      source: 'bill',
      bill_id: b.id,
      amount_mil: 80_000,
      category: 'factures',
      pot: 'needs',
      label: 'STEG',
      spent_on: TODAY,
    });
    expect(store.billPayments.value).toEqual([
      expect.objectContaining({ bill_id: b.id, period_start: '2026-09-01', expense_id: e.id }),
    ]);
    expect((await outbox()).sort()).toEqual(['bill_payments', 'expenses']);
  });

  it('add_bill starts today', async () => {
    await execute(act('add_bill', { label: 'Internet', amount: 60, frequency: 'monthly', day: 5 }), ctx);
    expect(store.bills.value[0]).toMatchObject({
      label: 'Internet',
      amount_mil: 60_000,
      frequency: 'monthly',
      day: 5,
      starts_on: TODAY,
      active: true,
    });
  });

  it('savings_deposit leaves the pot it comes from; savings_withdraw arrives in its pot', async () => {
    const g = goal();
    await seed('goals', g);
    await execute(act('savings_deposit', { amount: 100, from: 'envies' }), ctx);
    await execute(act('savings_withdraw', { amount: 200, to: 'besoins', reason: '' }), ctx);
    expect(store.savingsMoves.value).toEqual([
      expect.objectContaining({
        goal_id: g.id,
        amount_mil: 100_000,
        kind: 'deposit',
        from_pot: 'wants',
        occurred_on: TODAY,
      }),
      expect.objectContaining({ goal_id: g.id, amount_mil: -200_000, kind: 'withdraw', from_pot: 'needs' }),
    ]);
  });

  it('add_income: épargne is a deposit with no pot, a pot is an incomes row', async () => {
    await seed('goals', goal());
    const toSavings = await execute(act('add_income', { amount: 150, to: 'epargne', label: 'Prime' }), ctx);
    await execute(act('add_income', { amount: 150, to: 'envies', label: 'Cadeau' }), ctx);
    expect(store.savingsMoves.value[0]).toMatchObject({
      amount_mil: 150_000,
      kind: 'deposit',
      from_pot: null,
    });
    expect(store.incomes.value[0]).toMatchObject({
      amount_mil: 150_000,
      pot: 'wants',
      label: 'Cadeau',
      received_on: TODAY,
    });
    expect(toSavings.ok && toSavings.undo).toBeNull();
  });

  it('add_debt and settle_debt', async () => {
    await execute(
      act('add_debt', {
        kind: 'direct',
        direction: 'owed_to_me',
        person: 'Sami',
        amount: 40,
        due: '2026-09-20',
        note: '',
      }),
      ctx,
    );
    const [d] = store.debts.value;
    expect(d).toMatchObject({
      direction: 'owed_to_me',
      person: 'Sami',
      amount_mil: 40_000,
      due_on: '2026-09-20',
      settled_at: null,
    });
    await execute(act('settle_debt', { id: 'd1', ref: d.id }), ctx);
    expect(store.debts.value[0].settled_at).not.toBeNull();
  });

  it('set_reminder stores the Tunis local time as an instant', async () => {
    await execute(
      act('set_reminder', { kind: 'direct', text: 'Appeler Sami', date: '2026-09-12', time: '18:30' }),
      ctx,
    );
    expect(store.reminders.value[0]).toMatchObject({ text: 'Appeler Sami', done_at: null });
    expect(new Date(store.reminders.value[0].remind_at).toISOString()).toBe('2026-09-12T17:30:00.000Z');
  });

  it('update_goal changes the active goal', async () => {
    await seed('goals', goal({ target_mil: 5_000_000, name: 'Voyage' }));
    const r = await execute(act('update_goal', { target: 6000 }), ctx);
    expect(store.goals.value[0]).toMatchObject({ target_mil: 6_000_000, name: 'Voyage' });
    expect(r.ok && r.undo?.before).toMatchObject({ target_mil: 5_000_000 });
  });
});

describe('execute — Review Focus 2: amounts at the boundary', () => {
  it.each([12.5, '12,5', 0.0004, -5, Number.NaN, 50001, 1e9])(
    'only whole-millime amounts in (0, 50 000] run: %s',
    async (amount) => {
      const r = await execute(
        act('add_expense', {
          kind: 'direct',
          amount,
          category: 'cafe',
          pot: 'envies',
          label: 'Café',
          date: TODAY,
        }),
        ctx,
      );
      if (amount === 12.5) {
        expect(r.ok).toBe(true);
        expect(store.expenses.value[0].amount_mil).toBe(12_500);
      } else {
        expect(r).toEqual({ ok: false, reason: 'invalid' });
        expect(await outbox()).toEqual([]);
      }
    },
  );
});

describe('execute — Review Focus 3: stale or repeated cards', () => {
  it('Oui twice on an edit card writes once', async () => {
    const e = expense({ amount_mil: 12_000 });
    await seed('expenses', e);
    const card = await prepare(act('edit_expense', { id: 'e1', ref: e.id, changes: { amount: 21 } }), ctx);
    tick(1000);
    expect((await execute(card, ctx)).ok).toBe(true);
    tick(1000);
    expect(await execute(card, ctx)).toEqual({ ok: false, reason: 'stale' });
    expect((await pendingFor(db, USER))[0].rev).toBe(1);
  });

  it('a row edited after the card was shown is stale, and nothing is written', async () => {
    const e = expense();
    await seed('expenses', e);
    const card = await prepare(act('delete_expense', { id: 'e1', ref: e.id }), ctx);
    await seed('expenses', { ...e, amount_mil: 99_000, updated_at: '2026-09-10T08:00:00+01:00' });
    expect(await execute(card, ctx)).toEqual({ ok: false, reason: 'stale' });
    expect(await outbox()).toEqual([]);
  });

  it('a row the server only re-stamped (same content, new updated_at) is not stale', async () => {
    const e = expense({ amount_mil: 12_000 });
    await seed('expenses', e);
    const card = await prepare(act('edit_expense', { id: 'e1', ref: e.id, changes: { amount: 21 } }), ctx);
    await seed('expenses', { ...e, updated_at: '2026-09-10T08:00:00+01:00' });
    expect((await execute(card, ctx)).ok).toBe(true);
    expect(store.expenses.value[0].amount_mil).toBe(21_000);
  });

  it('a deleted row is stale', async () => {
    const e = expense({ deleted_at: '2026-09-09T10:00:00+01:00' });
    await seed('expenses', e);
    const card = await prepare(act('edit_expense', { id: 'e1', ref: e.id, changes: { amount: 5 } }), ctx);
    expect(await execute(card, ctx)).toEqual({ ok: false, reason: 'stale' });
  });

  it('a row that is not on the device is stale', async () => {
    const card = await prepare(act('delete_expense', { id: 'e1', ref: uuidN(4242) }), ctx);
    expect(await execute(card, ctx)).toEqual({ ok: false, reason: 'stale' });
  });

  it('Oui twice on a create card (add_bill, deposit) writes once', async () => {
    await seed('goals', goal());
    const billCard = await prepare(
      act('add_bill', { label: 'Internet', amount: 60, frequency: 'monthly', day: 5 }),
      ctx,
    );
    const depositCard = await prepare(act('savings_deposit', { amount: 10, from: 'envies' }), ctx);
    for (const card of [billCard, billCard, depositCard, depositCard]) await execute(card, ctx);
    expect(store.bills.value).toHaveLength(1);
    expect(store.savingsMoves.value).toHaveLength(1);
    expect((await outbox()).sort()).toEqual(['bills', 'savings_moves']);
  });
});

describe('undo', () => {
  it('pay_bill then undo: the expense is soft-deleted and the bill is reserved again', async () => {
    const b = bill({ day: 15, amount_mil: 80_000 });
    await seed('bills', b);
    const before = computeFacts(factsInput(store, store.profile.value!, TODAY)).pots.needs.reserved;
    const r = await execute(act('pay_bill', { id: 'b1', ref: b.id }), ctx);
    expect(computeFacts(factsInput(store, store.profile.value!, TODAY)).pots.needs.reserved).toBe(
      before - 80_000,
    );
    expect(await undoLast(r.ok ? r.undo! : (null as never), ctx)).toBeTruthy();
    expect(store.expenses.value[0].deleted_at).not.toBeNull();
    expect(computeFacts(factsInput(store, store.profile.value!, TODAY)).pots.needs.reserved).toBe(before);
  });

  it('paying the bill again after an undo brings the same expense back (one payment per period)', async () => {
    const b = bill();
    await seed('bills', b);
    const first = await execute(act('pay_bill', { id: 'b1', ref: b.id }), ctx);
    if (first.ok) await undoLast(first.undo!, ctx);
    await execute(act('pay_bill', { id: 'b1', ref: b.id }), ctx);
    expect(store.expenses.value).toHaveLength(1);
    expect(store.expenses.value[0].deleted_at).toBeNull();
    expect(store.billPayments.value).toHaveLength(1);
  });

  it('undo of edit_expense restores every previous field', async () => {
    const e = expense({
      amount_mil: 12_000,
      category: 'cafe',
      pot: 'wants',
      label: 'Café',
      spent_on: '2026-09-08',
    });
    await seed('expenses', e);
    const r = await execute(
      act('edit_expense', {
        id: 'e1',
        ref: e.id,
        changes: { amount: 21, category: 'courses', pot: 'besoins', label: 'Marché', date: '2026-09-09' },
      }),
      ctx,
    );
    expect(await undoLast(r.ok ? r.undo! : (null as never), ctx)).toContain('Café');
    const back = store.expenses.value[0];
    expect(back).toMatchObject({
      amount_mil: 12_000,
      category: 'cafe',
      pot: 'wants',
      label: 'Café',
      spent_on: '2026-09-08',
      deleted_at: null,
    });
  });

  it('an edit that moves a shared expense to Envies: the ref follows the copy, and undo brings the shared row back', async () => {
    const HOME = uuidN(778);
    store.household.value = {
      household_id: HOME,
      status: 'on',
      invite: null,
      partner: { user_id: uuidN(777), first_name: 'Amel', needs_mil: 0 },
    };
    const e = expense({ category: 'courses', pot: 'needs', label: 'Marché', household_id: HOME });
    await seed('expenses', e);
    const r = await execute(
      act('edit_expense', { id: 'e1', ref: e.id, changes: { category: 'resto', pot: 'envies' } }),
      ctx,
    );
    if (!r.ok) throw new Error('refused');
    const copy = store.expenses.value.find((x) => !x.deleted_at)!;
    expect(copy).toMatchObject({ pot: 'wants', household_id: null });
    expect(r.undo?.ref).toBe(copy.id);
    await undoLast(r.undo!, ctx);
    const live = store.expenses.value.filter((x) => !x.deleted_at);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: e.id, pot: 'needs', household_id: HOME, category: 'courses' });
  });

  it.each([
    [
      'add_expense',
      { amount: 5, category: 'cafe', pot: 'envies', label: 'Café', date: TODAY },
      'expenses',
      (r: Row) => r.deleted_at !== null,
    ],
    [
      'add_debt',
      { direction: 'i_owe', person: 'Sami', amount: 5, due: null, note: '' },
      'debts',
      (r: Row) => r.deleted_at !== null,
    ],
    [
      'set_reminder',
      { text: 'Loyer', date: '2026-09-12', time: '09:00' },
      'reminders',
      (r: Row) => r.deleted_at !== null,
    ],
    [
      'add_bill',
      { label: 'Internet', amount: 60, frequency: 'monthly', day: 5 },
      'bills',
      (r: Row) => r.active === false,
    ],
    [
      'add_income',
      { amount: 50, to: 'besoins', label: 'Prime' },
      'incomes',
      (r: Row) => r.deleted_at !== null,
    ],
  ] as const)('undo of %s', async (type, fields, table, undone) => {
    const r = await execute(act(type, fields), ctx);
    expect(await undoLast(r.ok ? r.undo! : (null as never), ctx)).toBeTruthy();
    expect(undone((await db.getAll(table))[0] as Row)).toBe(true);
  });

  it('undo of delete_expense, settle_debt and update_goal', async () => {
    const e = expense();
    const d = debt();
    await seed('expenses', e);
    await seed('debts', d);
    await seed('goals', goal({ target_mil: 5_000_000 }));
    for (const a of [
      act('delete_expense', { id: 'e1', ref: e.id }),
      act('settle_debt', { id: 'd1', ref: d.id }),
      act('update_goal', { target: 7000 }),
    ]) {
      const r = await execute(a, ctx);
      await undoLast(r.ok ? r.undo! : (null as never), ctx);
    }
    expect(store.expenses.value[0].deleted_at).toBeNull();
    expect(store.debts.value[0].settled_at).toBeNull();
    expect(store.goals.value[0].target_mil).toBe(5_000_000);
  });

  it('after 10 minutes there is nothing to undo', async () => {
    const r = await execute(
      act('add_expense', { amount: 5, category: 'cafe', pot: 'envies', label: 'Café', date: TODAY }),
      ctx,
    );
    tick(10 * 60_000);
    expect(await undoLast(r.ok ? r.undo! : (null as never), ctx)).toBeNull();
    expect(store.expenses.value[0].deleted_at).toBeNull();
  });
});

describe('execute — refusals', () => {
  it('a deposit with no active goal is invalid, and nothing is written', async () => {
    expect(await execute(act('savings_deposit', { amount: 10, from: 'envies' }), ctx)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await execute(act('add_income', { amount: 10, to: 'epargne', label: 'Prime' }), ctx)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await outbox()).toEqual([]);
  });

  it('an unknown type, or open / undo (the chat handles those), is invalid', async () => {
    for (const type of ['hack', 'open', 'undo']) expect((await execute(act(type), ctx)).ok).toBe(false);
  });
});

describe('execute — partner_request (plan D7)', () => {
  const H = '00000000-0000-4000-8000-000000000099';
  const AMIRA = '00000000-0000-4000-8000-000000000002';
  const theirs = () => expense({ user_id: AMIRA, household_id: H, label: 'Aziza', amount_mil: 45_000 });
  const ask = (ref: string, change: unknown) => act('partner_request', { id: 'e1', ref, change });
  let request: Mock<CoupleApi['request']>;
  beforeEach(() => {
    request = vi.fn<CoupleApi['request']>().mockResolvedValue(undefined);
    ctx = { ...ctx, couple: { request } };
    store.household.value = {
      household_id: H,
      status: 'on',
      invite: null,
      partner: { user_id: AMIRA, first_name: 'Amira', needs_mil: 900_000 },
    };
  });

  it('a delete asks the partner, once, and changes nothing here', async () => {
    const e = theirs();
    await seed('expenses', e);
    const r = await execute(ask(e.id, { kind: 'delete' }), ctx);
    expect(r).toEqual({ ok: true, summary: expect.stringContaining('Amira') as string, undo: null });
    expect(request).toHaveBeenCalledExactlyOnceWith(e.id, { kind: 'delete' });
    expect(store.expenses.value[0].deleted_at).toBeNull();
    expect(await outbox()).toEqual([]);
  });

  it("an edit sends the change in the database's terms", async () => {
    const e = theirs();
    await seed('expenses', e);
    await execute(
      ask(e.id, {
        kind: 'edit',
        changes: { amount: 40, category: 'maison', pot: 'besoins', date: '2026-09-08' },
      }),
      ctx,
    );
    expect(request).toHaveBeenCalledWith(e.id, {
      kind: 'edit',
      fields: { amount_mil: 40_000, category: 'maison', pot: 'needs', spent_on: '2026-09-08' },
    });
  });

  it('a malformed change is invalid and sends nothing', async () => {
    const e = theirs();
    await seed('expenses', e);
    expect(await execute(ask(e.id, { kind: 'edit', changes: {} }), ctx)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('offline, it says so', async () => {
    const e = theirs();
    await seed('expenses', e);
    request.mockRejectedValue(new CoupleError('couple.err.offline'));
    expect(await execute(ask(e.id, { kind: 'delete' }), ctx)).toEqual({
      ok: false,
      reason: 'couple',
      key: 'couple.err.offline',
    });
  });

  it('a request on a gone expense is stale', async () => {
    expect(await execute(ask(uuidN(4242), { kind: 'delete' }), ctx)).toEqual({ ok: false, reason: 'stale' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("review I1: the chat never changes someone else's expense", () => {
  it.each([
    ['edit_expense', { changes: { amount: 40 } }],
    ['delete_expense', {}],
  ])("%s on the partner's shared row is invalid", async (type, fields) => {
    const e = expense({
      user_id: '00000000-0000-4000-8000-000000000002',
      household_id: '00000000-0000-4000-8000-000000000099',
      amount_mil: 45_000,
    });
    await seed('expenses', e);
    expect(await execute(act(type, { id: 'e1', ref: e.id, ...fields }), ctx)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(store.expenses.value[0]).toMatchObject({ amount_mil: 45_000, deleted_at: null });
  });
});
