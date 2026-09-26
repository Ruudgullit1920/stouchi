/* Small repositories for the tables Aam Salah writes (Phase 3), built the way
 * expenses.ts is: zod parse, a create that is idempotent on the row's key, and
 * a fresh updated_at on every change. Everything goes through writeRow, so a
 * chat write is shown at once and queued for the server like a keypad write. */
import type { z } from 'zod';
import { payPeriod, type ISODate } from '../shared/dates';
import {
  BillInsert,
  BillPaymentInsert,
  BillPaymentRow,
  BillRow,
  DebtInsert,
  DebtRow,
  GoalInsert,
  GoalRow,
  IncomeInsert,
  IncomeRow,
  ReminderInsert,
  ReminderRow,
  SavingsMoveInsert,
  SavingsMoveRow,
  type Bill,
  type Expense,
} from '../shared/schemas';
import { STOUCHI_NS, uuidv5 } from '../shared/uuid5';
import type { ExpensesRepo } from './expenses';
import { rowKey, type LocalDb, type Row, type Table } from './localdb';
import type { Store } from './store';
import { writeRow } from './write';

interface Spec<R> {
  row: z.ZodType<R>;
  insert: z.ZodType;
  /** the columns a new row starts with, besides what the caller gives */
  stamps: (now: string) => Row;
}

const created = (now: string) => ({ created_at: now });
const updated = (now: string) => ({ created_at: now, updated_at: now });
const deletable = (now: string) => ({ created_at: now, updated_at: now, deleted_at: null });

function repo<R extends Row>(db: LocalDb, store: Store, table: Table, spec: Spec<R>) {
  const user = () => {
    const id = store.userId.value;
    if (!id) throw new Error('no user on this device');
    return id;
  };
  return {
    get: async (key: string) => (await db.get(table, key)) as R | undefined,
    async create(draft: Row): Promise<R> {
      const parsed = spec.insert.parse(draft) as Row;
      const existing = (await db.get(table, rowKey(table, parsed))) as R | undefined;
      if (existing) return existing;
      const row = spec.row.parse({ ...parsed, ...spec.stamps(new Date().toISOString()) });
      await writeRow(db, user(), table, row, store);
      return row;
    },
    async change(key: string, fields: Row): Promise<R> {
      const current = (await db.get(table, key)) as R | undefined;
      if (!current) throw new Error(`${table} ${key} is not on this device`);
      const next = spec.row.parse({ ...current, ...fields, updated_at: new Date().toISOString() });
      await writeRow(db, user(), table, next, store);
      return next;
    },
  };
}

export function createRepos(db: LocalDb, store: Store) {
  return {
    debts: repo(db, store, 'debts', { row: DebtRow, insert: DebtInsert, stamps: deletable }),
    bills: repo(db, store, 'bills', { row: BillRow, insert: BillInsert, stamps: updated }),
    billPayments: repo(db, store, 'bill_payments', {
      row: BillPaymentRow,
      insert: BillPaymentInsert,
      stamps: created,
    }),
    reminders: repo(db, store, 'reminders', { row: ReminderRow, insert: ReminderInsert, stamps: deletable }),
    incomes: repo(db, store, 'incomes', { row: IncomeRow, insert: IncomeInsert, stamps: deletable }),
    goals: repo(db, store, 'goals', {
      row: GoalRow,
      insert: GoalInsert,
      stamps: (now) => ({ ...updated(now), archived_at: null }),
    }),
    savingsMoves: repo(db, store, 'savings_moves', {
      row: SavingsMoveRow,
      insert: SavingsMoveInsert,
      stamps: created,
    }),
  };
}
export type Repos = ReturnType<typeof createRepos>;

/** Pay a bill for the pay period holding `today`: one Factures expense and one
 * bill_payments row, both keyed by (bill, period), so a repeat writes nothing.
 * After an undo (the expense deleted), paying again brings the same expense back.
 * 'already' when this period is paid and its expense is still there. */
export async function payBill(
  db: LocalDb,
  repos: Repos,
  expenses: ExpensesRepo,
  userId: string,
  b: Bill,
  today: ISODate,
  payday: number,
): Promise<{ status: 'paid' | 'already'; expenseId: string; amount_mil: number }> {
  const period = payPeriod(today, payday).start;
  const paid = await repos.billPayments.get(`${b.id}|${period}`);
  const expenseId = paid?.expense_id ?? uuidv5(`bill:${userId}:${b.id}:${period}`, STOUCHI_NS);
  const existing = (await db.get('expenses', expenseId)) as Expense | undefined;
  const already = { status: 'already' as const, expenseId, amount_mil: existing?.amount_mil ?? b.amount_mil };
  if ((paid && !paid.expense_id) || (existing && !existing.deleted_at) || (paid && !existing)) return already;
  if (existing) await expenses.restore(expenseId);
  else
    await expenses.create({
      id: expenseId,
      user_id: userId,
      household_id: null,
      amount_mil: b.amount_mil,
      category: 'factures',
      pot: 'needs',
      label: b.label,
      spent_on: today,
      source: 'bill',
      bill_id: b.id,
    });
  await repos.billPayments.create({ bill_id: b.id, period_start: period, expense_id: expenseId });
  return { status: 'paid', expenseId, amount_mil: existing ? existing.amount_mil : b.amount_mil };
}

/** Mark a debt settled; 'already' when it is settled, deleted or not on the device. */
export async function settleDebt(repos: Repos, debtId: string): Promise<'settled' | 'already'> {
  const d = await repos.debts.get(debtId);
  if (!d || d.settled_at || d.deleted_at) return 'already';
  await repos.debts.change(d.id, { settled_at: new Date().toISOString() });
  return 'settled';
}
