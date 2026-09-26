/* The rows an export needs, read from the server with the caller's JWT (plan
 * D3): the device only keeps 12 pay periods, the export can go further back.
 * It needs a connection and says so; any failed page fails the whole export. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportInput, ExportRange } from '../shared/exportCsv';

export const EXPORT_PAGE = 1000;

type Query = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

/** Every row the query matches, one page at a time (stable order by id). */
async function all<T>(build: () => Query): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await build()
      .order('id')
      .range(rows.length, rows.length + EXPORT_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data as T[]));
    if (data.length < EXPORT_PAGE) return rows;
  }
}

export async function fetchExportRows(
  client: SupabaseClient,
  userId: string,
  range: ExportRange,
): Promise<ExportInput> {
  const mine = (table: string) => client.from(table).select('*').eq('user_id', userId);
  const dated = (table: string, col: string) => () => {
    const q = mine(table).lte(col, range.to);
    return range.from === null ? q : q.gte(col, range.from);
  };
  const [expenses, incomes, savingsMoves, bills, debts, goals] = await Promise.all([
    all<ExportInput['expenses'][number]>(() => dated('expenses', 'spent_on')().is('deleted_at', null)),
    all<ExportInput['incomes'][number]>(() => dated('incomes', 'received_on')().is('deleted_at', null)),
    all<ExportInput['savingsMoves'][number]>(dated('savings_moves', 'occurred_on')),
    all<ExportInput['bills'][number]>(() => mine('bills').eq('active', true)),
    all<ExportInput['debts'][number]>(() => mine('debts').is('deleted_at', null)),
    all<ExportInput['goals'][number]>(() => mine('goals')),
  ]);
  return { expenses, incomes, savingsMoves, bills, debts, goals };
}
