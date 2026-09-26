import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { EXPORT_PAGE, fetchExportRows } from '../../../src/data/exportRows';
import { expense, USER } from '../fixtures';

type Call = [string, ...unknown[]];
type Page = { data: unknown[] | null; error: { message: string } | null; status: number };

/** A PostgREST builder that records every call and answers pages in order, per table. */
function fakeClient(pages: Record<string, Page[]>) {
  const calls: Record<string, Call[][]> = {};
  const client = {
    from(table: string) {
      const mine: Call[] = [];
      (calls[table] ??= []).push(mine);
      const page = pages[table]?.shift() ?? { data: [], error: null, status: 200 };
      const q: Record<string, unknown> = {
        then: (ok: (p: Page) => unknown) => Promise.resolve(page).then(ok),
      };
      for (const m of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'range'])
        q[m] = (...args: unknown[]) => {
          mine.push([m, ...args]);
          return q;
        };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('fetchExportRows', () => {
  it("asks for the caller's live rows in range, per table", async () => {
    const { client, calls } = fakeClient({});
    await fetchExportRows(client, USER, { from: '2026-09-01', to: '2026-09-30' });
    const expenses = calls.expenses[0];
    expect(expenses).toContainEqual(['eq', 'user_id', USER]);
    expect(expenses).toContainEqual(['is', 'deleted_at', null]);
    expect(expenses).toContainEqual(['gte', 'spent_on', '2026-09-01']);
    expect(expenses).toContainEqual(['lte', 'spent_on', '2026-09-30']);
    expect(calls.incomes[0]).toContainEqual(['gte', 'received_on', '2026-09-01']);
    expect(calls.savings_moves[0]).toContainEqual(['lte', 'occurred_on', '2026-09-30']);
    expect(calls.debts[0]).toContainEqual(['is', 'deleted_at', null]);
    expect(calls.bills[0]).toContainEqual(['eq', 'active', true]);
    expect(calls.goals[0]).toContainEqual(['eq', 'user_id', USER]);
  });

  it('with no start, has no lower bound', async () => {
    const { client, calls } = fakeClient({});
    await fetchExportRows(client, USER, { from: null, to: '2026-09-30' });
    expect(calls.expenses[0].some(([m]) => m === 'gte')).toBe(false);
  });

  it('reads page after page until a short one', async () => {
    const full = Array.from({ length: EXPORT_PAGE }, () => expense());
    const { client, calls } = fakeClient({
      expenses: [
        { data: full, error: null, status: 200 },
        { data: [expense()], error: null, status: 200 },
      ],
    });
    const rows = await fetchExportRows(client, USER, { from: null, to: '2026-09-30' });
    expect(rows.expenses).toHaveLength(EXPORT_PAGE + 1);
    expect(calls.expenses[1]).toContainEqual(['range', EXPORT_PAGE, 2 * EXPORT_PAGE - 1]);
  });

  it('fails on an error rather than export half the rows', async () => {
    const { client } = fakeClient({ incomes: [{ data: null, error: { message: 'boom' }, status: 500 }] });
    await expect(fetchExportRows(client, USER, { from: null, to: '2026-09-30' })).rejects.toThrow('boom');
  });
});
