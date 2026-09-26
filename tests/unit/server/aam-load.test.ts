import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadRows } from '../../../src/server/aam/load';
import { expense, goal, income, move, profile, bill } from '../fixtures';

const ME = '00000000-0000-4000-8000-00000000a11c';
const AMIRA = '00000000-0000-4000-8000-0000000000b0';
const H = '00000000-0000-4000-8000-0000000000aa';

type Op = [string, unknown[]];
interface Query {
  table: string;
  ops: Op[];
}

/** supabase-js with the caller's JWT, as far as loadRows goes: records each
 * query, answers eq / neq / in / is filters, and couple_state. */
function recorder(data: Record<string, Record<string, unknown>[]>, state: unknown) {
  const queries: Query[] = [];
  const rpcs: [string, unknown][] = [];
  const answer = (q: Query) => {
    let rows = [...(data[q.table] ?? [])];
    for (const [op, args] of q.ops) {
      const [col, val] = args as [string, unknown];
      if (op === 'eq') rows = rows.filter((r) => r[col] === val);
      if (op === 'neq') rows = rows.filter((r) => r[col] !== val);
      if (op === 'in') rows = rows.filter((r) => (val as unknown[]).includes(r[col]));
      if (op === 'is') rows = rows.filter((r) => r[col] === val);
    }
    const single = q.ops.some(([op]) => op === 'maybeSingle');
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const sb = {
    rpc(name: string, args: unknown) {
      rpcs.push([name, args]);
      return Promise.resolve({ data: state, error: null });
    },
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
  return { sb: sb as unknown as SupabaseClient, queries, rpcs };
}

const ON = {
  household_id: H,
  status: 'on',
  invite: null,
  partner: { user_id: AMIRA, first_name: 'Amira', needs_mil: 900_000 },
};
const homeGoal = goal({ user_id: AMIRA, household_id: H });
const shared = expense({ user_id: AMIRA, household_id: H, spent_on: '2026-09-10' });
const data = {
  profiles: [profile({ user_id: ME, payday: 25 })],
  expenses: [expense({ user_id: ME, spent_on: '2026-09-10' }), shared],
  bills: [bill({ user_id: AMIRA, household_id: H })],
  incomes: [income({ user_id: AMIRA, household_id: H })],
  goals: [homeGoal],
  savings_moves: [move({ user_id: AMIRA, goal_id: homeGoal.id }), move({ user_id: AMIRA })],
} as unknown as Record<string, Record<string, unknown>[]>;

describe('loadRows — couple mode (plan Task 8)', () => {
  it("adds the household's shared rows and the partner's name and Besoins budget", async () => {
    const { sb, queries, rpcs } = recorder(data, ON);
    const rows = await loadRows(sb, ME, '2026-09-24');
    /* D2: the partner's budget is asked for my period start (payday 25 → 25 Aug) */
    expect(rpcs).toEqual([['couple_state', { p_on: '2026-08-25' }]]);
    expect(rows.partner).toEqual({ user_id: AMIRA, first_name: 'Amira', needs_mil: 900_000 });
    expect(rows.expenses.map((e) => e.id)).toContain(shared.id);
    expect(rows.bills.map((b) => b.user_id)).toEqual([AMIRA]);
    expect(rows.incomes.map((i) => i.user_id)).toEqual([AMIRA]);
    expect(rows.goals.map((g) => g.id)).toEqual([homeGoal.id]);
    expect(rows.savingsMoves.map((m) => m.goal_id)).toEqual([homeGoal.id]);
    /* the partner's rows are asked by household, never by their user id */
    for (const q of queries.filter((x) => x.ops.some(([op]) => op === 'neq')))
      expect(
        q.ops.some(([op, [c, v]]) => (op === 'eq' && c === 'household_id' && v === H) || op === 'in'),
        `${q.table} is scoped to the household`,
      ).toBe(true);
    expect(
      queries.some((q) => q.ops.some(([op, [c, v]]) => op === 'eq' && c === 'user_id' && v === AMIRA)),
    ).toBe(false);
  });

  it('solo, or an invite still waiting: no partner and no household query', async () => {
    for (const state of [
      { household_id: null, status: 'solo', invite: null, partner: null },
      { household_id: H, status: 'pending', invite: null, partner: null },
    ]) {
      const { sb, queries } = recorder(data, state);
      const rows = await loadRows(sb, ME, '2026-09-24');
      expect(rows.partner).toBeNull();
      expect(queries.some((q) => q.ops.some(([op]) => op === 'neq'))).toBe(false);
    }
  });

  it('a couple_state that fails or answers nonsense is solo', async () => {
    const { sb } = recorder(data, { status: 'on' });
    expect((await loadRows(sb, ME, '2026-09-24')).partner).toBeNull();
  });
});
