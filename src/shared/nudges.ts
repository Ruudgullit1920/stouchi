/* Rules shared by the carnet's a_signaler (Phase 3) and the notification
 * engine (Phase 4), so the chat and the bell never disagree. */
import type { CategoryKey } from './categories';
import { daysBetween, type ISODate, type PayPeriod } from './dates';
import { MIL_PER_TND, type Mil } from './money';
import type { Expense } from './schemas';

/** Rent and bills are fixed: they say nothing about the user's daily pace. */
export const FIXED: CategoryKey[] = ['loyer', 'factures'];

/** This period's average day of variable spending so far, in whole TND, in 5 TND steps. */
export function spendPace(expenses: Expense[], period: PayPeriod, today: ISODate): number {
  const variable = expenses
    .filter(
      (e) =>
        e.deleted_at === null &&
        e.bill_id === null &&
        !FIXED.includes(e.category) &&
        e.spent_on >= period.start &&
        e.spent_on <= today,
    )
    .reduce((s, e) => s + e.amount_mil, 0);
  return Math.floor(variable / (daysBetween(period.start, today) + 1) / 5_000) * 5;
}

/** Last 5 days of the period, a goal to put it in, and at least 3 days' pace left over. */
export function isSavingsOpportunity({
  left,
  daysLeft,
  pace,
  hasGoal,
}: {
  left: Mil;
  daysLeft: number;
  pace: number;
  hasGoal: boolean;
}): boolean {
  return hasGoal && daysLeft <= 5 && pace > 0 && left >= 3 * pace * MIL_PER_TND;
}
