import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { supabaseNotifyDb } from '../../../src/server/notify/load';
import { splitSalary } from '../../../src/shared/money';
import { bill, debt, expense, goal, income, move, payment, profile, reminder } from '../fixtures';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';

type Op = [string, unknown[]];
interface Query {
  table: string;
  ops: Op[];
}

/** A supabase-js stand-in: records every call chain and answers eq / in / is / gt filters over `data`. */
function recorder(data: Record<string, Record<string, unknown>[]>) {
  const queries: Query[] = [];
  const answer = (q: Query) => {
    let rows = [...(data[q.table] ?? [])];
    for (const [op, args] of q.ops) {
      const [col, val] = args as [string, unknown];
      if (op === 'eq') rows = rows.filter((r) => r[col] === val);
      if (op === 'neq') rows = rows.filter((r) => r[col] !== val);
      if (op === 'in') rows = rows.filter((r) => (val as unknown[]).includes(r[col]));
      if (op === 'gt') rows = rows.filter((r) => String(r[col]) > String(val));
      if (op === 'not') rows = rows.filter((r) => r[col] !== null);
      if (op === 'is') rows = rows.filter((r) => r[col] === val);
      if (op === 'order') rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
    }
    const single = q.ops.some(([op]) => op === 'maybeSingle');
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const sb = {
    from(table: string) {
      const q: Query = { table, ops: [] };
      queries.push(q);
      const chain: unknown = new Proxy(
        {},
        {
          get(_, prop: string) {
            if (prop === 'then')
              return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
                Promise.resolve(answer(q)).then(ok, ko);
            return (...args: unknown[]) => {
              q.ops.push([prop, args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return { sb: sb as unknown as SupabaseClient, queries };
}

const eqUser = (q: Query, user: string) =>
  q.ops.some(([op, [c, v]]) => op === 'eq' && c === 'user_id' && v === user);

describe('supabaseNotifyDb (Review Focus 1)', () => {
  const aliceBill = bill({ user_id: ALICE });
  const bobBill = bill({ user_id: BOB });
  const aliceGoal = goal({ user_id: ALICE });
  const data = {
    profiles: [profile({ user_id: ALICE }), profile({ user_id: BOB })],
    expenses: [
      expense({ user_id: ALICE, spent_on: '2026-09-10' }),
      expense({ user_id: BOB, spent_on: '2026-09-10' }),
    ],
    bills: [aliceBill, bobBill],
    bill_payments: [payment({ bill_id: aliceBill.id }), payment({ bill_id: bobBill.id })],
    debts: [debt({ user_id: ALICE }), debt({ user_id: BOB })],
    goals: [aliceGoal, goal({ user_id: BOB })],
    savings_moves: [move({ user_id: ALICE }), move({ user_id: BOB })],
    reminders: [reminder({ user_id: ALICE }), reminder({ user_id: BOB })],
    incomes: [income({ user_id: ALICE }), income({ user_id: BOB })],
    household_members: [],
  } as unknown as Record<string, Record<string, unknown>[]>;

  it("loads one user's rows, every query filtered on that user", async () => {
    const { sb, queries } = recorder(data);
    const snap = await supabaseNotifyDb(sb).loadSnapshot(ALICE, '2026-09-24');
    expect(snap?.profile.user_id).toBe(ALICE);
    for (const rows of [
      snap?.expenses,
      snap?.bills,
      snap?.debts,
      snap?.goals,
      snap?.savingsMoves,
      snap?.reminders,
      snap?.incomes,
    ])
      expect(rows?.map((r) => r.user_id)).toEqual([ALICE]);
    expect(snap?.billPayments.map((p) => p.bill_id)).toEqual([aliceBill.id]);

    for (const q of queries) {
      if (q.table === 'bill_payments') expect(q.ops).toContainEqual(['in', ['bill_id', [aliceBill.id]]]);
      else expect(eqUser(q, ALICE), `${q.table} is filtered on user_id`).toBe(true);
    }
    expect(new Set(queries.map((q) => q.table))).toEqual(new Set(Object.keys(data)));
  });

  it('a user who has not onboarded has no snapshot', async () => {
    const { sb } = recorder({ ...data, profiles: [profile({ user_id: ALICE, onboarded_at: null })] });
    expect(await supabaseNotifyDb(sb).loadSnapshot(ALICE, '2026-09-24')).toBeNull();
  });

  it('with no bills, bill_payments is not queried at all', async () => {
    const { sb, queries } = recorder({ ...data, bills: [] });
    await supabaseNotifyDb(sb).loadSnapshot(ALICE, '2026-09-24');
    expect(queries.map((q) => q.table)).not.toContain('bill_payments');
  });

  it('every write and read of notifications and subscriptions is scoped to the user', async () => {
    const { sb, queries } = recorder({ notifications: [], push_subscriptions: [] });
    const db = supabaseNotifyDb(sb);
    await db.recentNotifications(ALICE, '2026-08-15T00:00:00Z');
    await db.subscriptions(ALICE);
    await db.deleteSubscription(ALICE, 'https://push.example/a');
    for (const q of queries) expect(eqUser(q, ALICE)).toBe(true);
    expect(queries[2].ops).toContainEqual(['eq', ['endpoint', 'https://push.example/a']]);
  });

  it('inserts ignore duplicates: notifications on (user_id, dedupe_key), deposits on id', async () => {
    const { sb, queries } = recorder({ notifications: [], savings_moves: [] });
    const db = supabaseNotifyDb(sb);
    const row = { user_id: ALICE, trigger: 'pot_over', dedupe_key: 'k', title: 't', body: 'b', action: null };
    expect(await db.insertNotification(row)).toBeNull(); // the recorder returns no row
    await db.insertDeposit({
      id: '00000000-0000-4000-8000-000000000001',
      user_id: ALICE,
      goal_id: aliceGoal.id,
      amount_mil: 1,
      kind: 'payday',
      from_pot: null,
      occurred_on: '2026-09-01',
    });
    expect(queries[0].ops[0]).toEqual([
      'upsert',
      [row, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }],
    ]);
    expect(queries[1].ops[0][0]).toBe('upsert');
    expect(queries[1].ops[0][1][1]).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('listUsers is the one unscoped query: onboarded profiles, by id, paged', async () => {
    const { sb, queries } = recorder({
      profiles: [
        profile({ user_id: ALICE }),
        profile({ user_id: BOB }),
        profile({ user_id: 'z', onboarded_at: null }),
      ],
    });
    expect(await supabaseNotifyDb(sb).listUsers(null, 100)).toEqual([ALICE, BOB].sort());
    expect(queries[0].ops).toContainEqual(['not', ['onboarded_at', 'is', null]]);
    expect(queries[0].ops).toContainEqual(['order', ['user_id']]);
    expect(queries[0].ops).toContainEqual(['limit', [100]]);
  });
});

describe('supabaseNotifyDb — couple mode (Task 7)', () => {
  const H = '00000000-0000-4000-8000-0000000000aa';
  const aliceGoal = goal({ user_id: ALICE, household_id: H });
  const bobOldGoal = goal({ user_id: BOB, archived_at: '2026-09-02T10:00:00+01:00' });
  const bobShared = expense({ user_id: BOB, household_id: H, spent_on: '2026-09-10', label: 'shared' });
  const bobPrivate = expense({ user_id: BOB, pot: 'wants', category: 'resto', spent_on: '2026-09-10' });
  const bobBill = bill({ user_id: BOB, household_id: H });
  const bobPrivateBill = bill({ user_id: BOB });
  const bobMove = move({ user_id: BOB, goal_id: aliceGoal.id });
  const data = {
    profiles: [profile({ user_id: ALICE }), profile({ user_id: BOB, salary_mil: 1_800_000 })],
    household_members: [
      { household_id: H, user_id: ALICE },
      { household_id: H, user_id: BOB },
    ],
    expenses: [expense({ user_id: ALICE, spent_on: '2026-09-10' }), bobShared, bobPrivate],
    bills: [bill({ user_id: ALICE }), bobBill, bobPrivateBill],
    bill_payments: [payment({ bill_id: bobBill.id }), payment({ bill_id: bobPrivateBill.id })],
    debts: [debt({ user_id: BOB })],
    goals: [aliceGoal, bobOldGoal],
    savings_moves: [
      move({ user_id: ALICE, goal_id: aliceGoal.id }),
      bobMove,
      move({ user_id: BOB, goal_id: bobOldGoal.id }),
    ],
    reminders: [reminder({ user_id: BOB })],
    incomes: [income({ user_id: BOB, household_id: H }), income({ user_id: BOB, pot: 'wants' })],
  } as unknown as Record<string, Record<string, unknown>[]>;

  it("adds the household's shared rows and the partner's Besoins budget, never their private rows", async () => {
    const { sb, queries } = recorder(data);
    const snap = await supabaseNotifyDb(sb).loadSnapshot(ALICE, '2026-09-24');
    expect(snap?.expenses.map((e) => e.id).sort()).toEqual(
      [data.expenses[0].id as string, bobShared.id].sort(),
    );
    expect(snap?.bills.map((b) => b.id)).toContain(bobBill.id);
    expect(snap?.bills.map((b) => b.id)).not.toContain(bobPrivateBill.id);
    expect(snap?.billPayments.map((p) => p.bill_id)).toEqual([bobBill.id]);
    expect(snap?.incomes.map((i) => i.user_id)).toEqual([BOB]);
    expect(snap?.incomes[0].household_id).toBe(H);
    expect(snap?.goals.map((g) => g.id)).toEqual([aliceGoal.id]);
    expect(snap?.savingsMoves.map((m) => m.id)).toContain(bobMove.id);
    expect(snap?.savingsMoves).toHaveLength(2);
    expect(snap?.debts).toEqual([]);
    expect(snap?.reminders).toEqual([]);
    expect(snap?.profile.user_id).toBe(ALICE);
    expect(snap?.couple).toEqual({
      me: ALICE,
      partnerNeeds: splitSalary(1_800_000, { needs: 50, wants: 30, savings: 20 }).needs,
    });
    /* every query names Alice or her household */
    for (const q of queries) {
      if (q.table === 'bill_payments') continue;
      /* the partner's moves carry no household_id: they are read through the household goal */
      if (q.table === 'savings_moves' && !eqUser(q, ALICE)) {
        expect(q.ops).toContainEqual(['in', ['goal_id', [aliceGoal.id]]]);
        continue;
      }
      const scoped = q.ops.some(
        ([op, [c, v]]) =>
          op === 'eq' && ((c === 'user_id' && v === ALICE) || (c === 'household_id' && v === H)),
      );
      const partnerProfile = q.table === 'profiles' && eqUser(q, BOB);
      expect(scoped || partnerProfile, `${q.table} is scoped`).toBe(true);
    }
  });

  it('alone in a household (an invite waiting) is solo', async () => {
    const { sb } = recorder({ ...data, household_members: [{ household_id: H, user_id: ALICE }] });
    const snap = await supabaseNotifyDb(sb).loadSnapshot(ALICE, '2026-09-24');
    expect(snap?.couple ?? null).toBeNull();
    expect(snap?.expenses.map((e) => e.user_id)).toEqual([ALICE]);
  });
});
