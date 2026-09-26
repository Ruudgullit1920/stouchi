/* Expenses on the device: every change is shown at once and queued for the
 * server. Ids are made by the caller (when the add sheet opens), so a double
 * tap or a retry never creates two expenses (spec §8.3). */
import { ExpenseInsert, ExpenseRow, type Expense, type NewExpense } from '../shared/schemas';
import { CoupleError } from './couple';
import type { LocalDb } from './localdb';
import type { Store } from './store';
import { writeRow } from './write';

export type ExpensePatch = Partial<Pick<Expense, 'amount_mil' | 'category' | 'pot' | 'label' | 'spent_on'>>;

export function createExpensesRepo(db: LocalDb, store: Store) {
  const user = () => {
    const id = store.userId.value;
    if (!id) throw new Error('no user on this device');
    return id;
  };

  async function change(id: string, fields: Partial<Expense>): Promise<Expense> {
    const current = (await db.get('expenses', id)) as Expense | undefined;
    if (!current) throw new Error(`expense ${id} is not on this device`);
    const next = ExpenseRow.parse({ ...current, ...fields, updated_at: new Date().toISOString() });
    return (await writeRow(db, user(), 'expenses', next, store)) as Expense;
  }

  /** A shared expense moved to Envies leaves the household (plan D7): Envies
   * are never shared. The shared row is deleted, so the partner sees it go,
   * and a private copy with a new id takes its place. Only its author moves it. */
  async function moveToWants(current: Expense, fields: ExpensePatch): Promise<Expense> {
    if (current.user_id !== user()) throw new CoupleError('couple.err.not_author');
    const now = new Date().toISOString();
    const copy = ExpenseRow.parse({
      ...current,
      ...fields,
      id: crypto.randomUUID(),
      pot: 'wants',
      household_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    const written = (await writeRow(db, user(), 'expenses', copy, store)) as Expense;
    await change(current.id, { deleted_at: now });
    return written;
  }

  return {
    async create(draft: NewExpense): Promise<Expense> {
      const parsed = ExpenseInsert.parse(draft);
      const existing = (await db.get('expenses', parsed.id)) as Expense | undefined;
      if (existing) return existing;
      const now = new Date().toISOString();
      const row = ExpenseRow.parse({ ...parsed, created_at: now, updated_at: now, deleted_at: null });
      return (await writeRow(db, user(), 'expenses', row, store)) as Expense;
    },
    /** resolves to the row now showing: a new one when a shared expense moves to Envies */
    async update(id: string, patch: ExpensePatch): Promise<Expense> {
      const current = (await db.get('expenses', id)) as Expense | undefined;
      if (current?.household_id && patch.pot === 'wants') return moveToWants(current, patch);
      return change(id, patch);
    },
    moveToWants,
    remove: (id: string) => change(id, { deleted_at: new Date().toISOString() }),
    restore: (id: string) => change(id, { deleted_at: null }),
  };
}
export type ExpensesRepo = ReturnType<typeof createExpensesRepo>;
