/* When a bill falls due. Monthly bills fall on `day` every month; the others
 * step 2, 3 or 12 months from their anchor — the first `day` on or after
 * `starts_on`. `day` past the month's end means the month's last day. */
import { daysBetween, daysInMonth, isInPeriod, type ISODate, type PayPeriod } from './dates';
import type { Mil } from './money';
import type { Bill, BillPayment, Expense } from './schemas';

const STEP: Record<Bill['frequency'], number> = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 };

const pad = (n: number) => String(n).padStart(2, '0');
/** Months since year 0, so stepping is plain arithmetic. */
const monthIndex = (d: ISODate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
const dueIn = (index: number, day: number): ISODate => {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
};

export function billDueDates(bill: Bill, period: PayPeriod): ISODate[] {
  if (!bill.active) return [];
  const first = monthIndex(bill.starts_on);
  const anchor = dueIn(first, bill.day) >= bill.starts_on ? first : first + 1;
  const step = STEP[bill.frequency];
  const out: ISODate[] = [];
  for (let i = monthIndex(period.start); i <= monthIndex(period.end); i++) {
    if (i < anchor || (i - anchor) % step !== 0) continue;
    const due = dueIn(i, bill.day);
    if (isInPeriod(due, period)) out.push(due);
  }
  return out;
}

/** What the active bills put aside in a period: each amount, once per due date in it. */
export const billsDueTotal = (bills: Bill[], period: PayPeriod): number =>
  bills.reduce((sum, b) => sum + b.amount_mil * billDueDates(b, period).length, 0);

/** How much of Besoins the bills take: amber above 80 %, over above 100 % (as in setup). */
export function billsMeter(reserved: Mil, needs: Mil): { pct: number; level: 'ok' | 'warn' | 'over' } {
  if (needs <= 0) return reserved > 0 ? { pct: 100, level: 'over' } : { pct: 0, level: 'ok' };
  const pct = Math.round((reserved * 100) / needs);
  return { pct, level: pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok' };
}

export type BillStatus = { kind: 'paid' } | { kind: 'due'; due: ISODate; days: number } | { kind: 'none' };

/** Where a bill stands this period: paid (its expense still there), due (days to go,
 * negative when late), or not due this period. */
export function billStatus(
  bill: Bill,
  payments: BillPayment[],
  expenses: Expense[],
  period: PayPeriod,
  today: ISODate,
): BillStatus {
  const live = new Set(expenses.filter((e) => e.deleted_at === null).map((e) => e.id));
  const paid = payments.some(
    (p) =>
      p.bill_id === bill.id &&
      p.period_start === period.start &&
      p.expense_id !== null &&
      live.has(p.expense_id),
  );
  if (paid) return { kind: 'paid' };
  const dues = billDueDates(bill, period);
  if (dues.length === 0) return { kind: 'none' };
  const due = dues.find((d) => d >= today) ?? dues[dues.length - 1];
  return { kind: 'due', due, days: daysBetween(today, due) };
}
