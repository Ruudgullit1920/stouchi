/* Ledger views of the expenses: per-pot breakdown, day groups, per-period
 * totals, and Historique's one line. Deleted expenses never show. */
import { categoryLabel, type CategoryKey, type Pot } from './categories';
import { isInPeriod, type ISODate, type PayPeriod } from './dates';
import type { StringKey } from './i18n/t';
import { formatTnd, type Mil } from './money';
import type { Expense } from './schemas';

/** Category colours are tints of the pot colour (spec §5.1), biggest first. */
export const TINTS = [100, 70, 48, 30, 18] as const;
export type Tint = (typeof TINTS)[number];

const live = (es: Expense[]) => es.filter((e) => e.deleted_at === null);
const sum = (es: Expense[]) => es.reduce((s, e) => s + e.amount_mil, 0);

export const titleOf = (e: Expense): string => e.label || categoryLabel(e.category);

function byCategory(es: Expense[]): { key: CategoryKey; total: Mil }[] {
  const totals = new Map<CategoryKey, Mil>();
  for (const e of es) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount_mil);
  return [...totals].map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
}

export function potBreakdown(
  expenses: Expense[],
  pot: Pot,
  period: PayPeriod,
): { total: Mil; categories: { key: CategoryKey; total: Mil; tint: Tint }[] } {
  const mine = live(expenses).filter((e) => e.pot === pot && isInPeriod(e.spent_on, period));
  return {
    total: sum(mine),
    categories: byCategory(mine).map((c, i) => ({ ...c, tint: TINTS[Math.min(i, TINTS.length - 1)] })),
  };
}

export interface DayGroup {
  date: ISODate;
  items: Expense[];
  total: Mil;
}

export function groupByDay(expenses: Expense[]): DayGroup[] {
  const days = new Map<ISODate, Expense[]>();
  const sorted = live(expenses).sort(
    (a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at),
  );
  for (const e of sorted) days.set(e.spent_on, [...(days.get(e.spent_on) ?? []), e]);
  return [...days].map(([date, items]) => ({ date, items, total: sum(items) }));
}

export interface PeriodTotal {
  period: PayPeriod;
  needs: Mil;
  wants: Mil;
}

export function periodTotals(expenses: Expense[], periods: PayPeriod[]): PeriodTotal[] {
  const es = live(expenses);
  return periods.map((period) => {
    const inP = es.filter((e) => isInPeriod(e.spent_on, period));
    return {
      period,
      needs: sum(inP.filter((e) => e.pot === 'needs')),
      wants: sum(inP.filter((e) => e.pot === 'wants')),
    };
  });
}

/** Aam Salah's one line on Historique: the biggest category and how it moved. */
export function historyLine(
  expenses: Expense[],
  period: PayPeriod,
  previous: PayPeriod,
): { key: StringKey; vars: Record<string, string> } | null {
  const es = live(expenses);
  const [top] = byCategory(es.filter((e) => isInPeriod(e.spent_on, period)));
  if (!top) return null;
  const before = sum(es.filter((e) => e.category === top.key && isInPeriod(e.spent_on, previous)));
  const vars = {
    category: categoryLabel(top.key),
    amount: formatTnd(top.total),
    delta: formatTnd(Math.abs(top.total - before)),
  };
  if (before === 0) return { key: 'history.line.first', vars };
  return { key: top.total >= before ? 'history.line.up' : 'history.line.down', vars };
}
