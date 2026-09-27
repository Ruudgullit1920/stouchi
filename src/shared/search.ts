/* Historique's search (spec §4.3): shop name, category, pot or exact amount,
 * across the pay periods given (the last 12), ignoring case and accents. */
import { categoryLabel } from './categories';
import { isInPeriod, type PayPeriod } from './dates';
import { t } from './i18n/t';
import { titleOf } from './ledger';
import { parseMoney, type Mil } from './money';
import type { Expense } from './schemas';

const MARKS = /[̀-ͯ]/g;

export const normalize = (s: string): string => s.normalize('NFD').replace(MARKS, '').toLowerCase();

/** Where `q` (already normalised) sits in `text`, as [start, end) offsets into the original text. */
function ranges(text: string, q: string): [number, number][] {
  let flat = '';
  const origin: number[] = [];
  [...text].forEach((ch, i) => {
    for (const c of normalize(ch)) {
      flat += c;
      origin.push(i);
    }
  });
  const out: [number, number][] = [];
  for (let at = flat.indexOf(q); at !== -1; at = flat.indexOf(q, at + q.length))
    out.push([origin[at], origin[at + q.length - 1] + 1]);
  return out;
}

export interface SearchGroup {
  period: PayPeriod;
  count: number;
  total: Mil;
  items: { expense: Expense; ranges: [number, number][] }[];
}

export function searchExpenses(expenses: Expense[], query: string, periods: PayPeriod[]): SearchGroup[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const amount = parseMoney(query);
  const matches = (e: Expense) =>
    e.amount_mil === amount ||
    [titleOf(e), categoryLabel(e.category), t(`pot.${e.pot}`)].some((s) => normalize(s).includes(q));

  const hits = expenses
    .filter((e) => e.deleted_at === null && matches(e))
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at));

  return periods.flatMap((period) => {
    const items = hits
      .filter((e) => isInPeriod(e.spent_on, period))
      .map((expense) => ({ expense, ranges: ranges(titleOf(expense), q) }));
    if (!items.length) return [];
    return [
      { period, count: items.length, total: items.reduce((s, i) => s + i.expense.amount_mil, 0), items },
    ];
  });
}
