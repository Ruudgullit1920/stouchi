/* The Objectif figures (spec §3): what is saved, how far along, when it is
 * reached, and what a little more each month would change. Derived, never stored. */
import type { ISODate } from './dates';
import type { Mil } from './money';
import { goalEta } from './payday';
import type { Goal, SavingsMove } from './schemas';

export interface GoalView {
  saved: Mil;
  /** whole percent, 0–100; 100 only once reached */
  pct: number;
  reached: boolean;
  eta: ISODate | null;
  /** this goal's moves, newest first */
  deposits: SavingsMove[];
}

const monthsTo = (target: Mil, saved: Mil, monthly: Mil) => Math.ceil((target - saved) / monthly);

export function goalView(goal: Goal, moves: SavingsMove[], monthly: Mil, today: ISODate): GoalView {
  const deposits = moves
    .filter((m) => m.goal_id === goal.id)
    .sort(
      (a, b) =>
        b.occurred_on.localeCompare(a.occurred_on) ||
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
    );
  const saved = deposits.reduce((s, m) => s + m.amount_mil, 0);
  const reached = saved >= goal.target_mil;
  const pct = reached ? 100 : Math.max(0, Math.min(99, Math.floor((saved * 100) / goal.target_mil)));
  return { saved, pct, reached, eta: goalEta(goal.target_mil, saved, monthly, today), deposits };
}

/** "Et si +X par mois": the new date, and how many months sooner (null when
 * nothing goes in today). Null when reached, or when the extra gains no month. */
export function sooner(
  goal: Goal,
  saved: Mil,
  monthly: Mil,
  extra: Mil,
  today: ISODate,
): { eta: ISODate; months: number | null } | null {
  if (saved >= goal.target_mil || extra <= 0) return null;
  const eta = goalEta(goal.target_mil, saved, monthly + extra, today) as ISODate;
  if (monthly <= 0) return { eta, months: null };
  const months =
    monthsTo(goal.target_mil, saved, monthly) - monthsTo(goal.target_mil, saved, monthly + extra);
  return months > 0 ? { eta, months } : null;
}

/** What a deposit of `amount` changes: the new total, whether that reaches the
 * goal, the new date, and how many months sooner (null with nothing going in). */
export function depositGain(
  goal: Goal,
  saved: Mil,
  amount: Mil,
  monthly: Mil,
  today: ISODate,
): { after: Mil; reached: boolean; eta: ISODate | null; months: number | null } {
  const after = saved + amount;
  const reached = after >= goal.target_mil;
  const eta = goalEta(goal.target_mil, after, monthly, today);
  if (monthly <= 0 || saved >= goal.target_mil) return { after, reached, eta, months: null };
  const months =
    monthsTo(goal.target_mil, saved, monthly) - Math.max(0, monthsTo(goal.target_mil, after, monthly));
  return { after, reached, eta, months };
}
