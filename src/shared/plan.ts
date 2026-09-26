/* The plan a pay period runs on: salary and split (spec §4.6). A change made
 * mid-period applies from the next payday unless the user picks "dès ce mois";
 * the waiting change sits in profiles.next_* and is resolved here, by period,
 * so figures, the carnet and the payday deposit all agree without a job. */
import { nextPayday, payPeriod, type ISODate, type PayPeriod, type Payday } from './dates';
import type { Mil, Split } from './money';
import type { Profile } from './schemas';

export interface Plan {
  salary_mil: Mil;
  split: Split;
}
export interface PendingPlan extends Plan {
  from: ISODate;
}
export type PlanChange = Partial<Plan>;
type NextCols = Pick<
  Profile,
  'next_salary_mil' | 'next_split_needs' | 'next_split_wants' | 'next_split_savings' | 'next_from'
>;

export const currentPlan = (p: Profile): Plan => ({
  salary_mil: p.salary_mil,
  split: { needs: p.split_needs, wants: p.split_wants, savings: p.split_savings },
});

export function pendingPlan(p: Profile): PendingPlan | null {
  if (p.next_from == null || p.next_salary_mil == null) return null;
  return {
    salary_mil: p.next_salary_mil,
    split: {
      needs: p.next_split_needs as number,
      wants: p.next_split_wants as number,
      savings: p.next_split_savings as number,
    },
    from: p.next_from,
  };
}

export function planFor(p: Profile, period: PayPeriod): Plan {
  const next = pendingPlan(p);
  return next && period.start >= next.from
    ? { salary_mil: next.salary_mil, split: next.split }
    : currentPlan(p);
}

const samePlan = (a: Plan, b: Plan) =>
  a.salary_mil === b.salary_mil &&
  a.split.needs === b.split.needs &&
  a.split.wants === b.split.wants &&
  a.split.savings === b.split.savings;

const NO_NEXT: Required<NextCols> = {
  next_salary_mil: null,
  next_split_needs: null,
  next_split_wants: null,
  next_split_savings: null,
  next_from: null,
};
const nextCols = (plan: Plan, from: ISODate): Required<NextCols> => ({
  next_salary_mil: plan.salary_mil,
  next_split_needs: plan.split.needs,
  next_split_wants: plan.split.wants,
  next_split_savings: plan.split.savings,
  next_from: from,
});
const mainCols = (plan: Plan) => ({
  salary_mil: plan.salary_mil,
  split_needs: plan.split.needs,
  split_wants: plan.split.wants,
  split_savings: plan.split.savings,
});

/** The profile patch for a salary or split change.
 * - `now`: the main columns change; a pending change keeps its own date and
 *   takes the new value too, and disappears when that makes it the same plan.
 * - `next`: only next_*, from the next payday, carrying the other half from
 *   the pending plan (or the current one); a change back to today's plan clears it. */
export function nextPlanPatch(
  p: Profile,
  change: PlanChange,
  when: 'now' | 'next',
  today: ISODate,
): Partial<Profile> {
  /* a pending plan already in force (not folded yet: offline, before the first pull) counts as current */
  const fold = foldPatch(p, today);
  if (fold) return { ...fold, ...nextPlanPatch({ ...p, ...fold }, change, when, today) };
  const current = currentPlan(p);
  const pending = pendingPlan(p);
  if (when === 'now') {
    const main = { ...current, ...change };
    const next = pending && { ...pending, ...change };
    return { ...mainCols(main), ...(next && !samePlan(next, main) ? nextCols(next, next.from) : NO_NEXT) };
  }
  const next = { ...(pending ?? current), ...change };
  return samePlan(next, current) ? NO_NEXT : nextCols(next, nextPayday(today, p.payday));
}

/** A payday change is immediate; a pending change moves to the new next payday. */
export function paydayPatch(p: Profile, payday: Payday, today: ISODate): Partial<Profile> {
  const fold = foldPatch(p, today);
  if (fold) return { ...fold, payday };
  return pendingPlan(p) ? { payday, next_from: nextPayday(today, payday) } : { payday };
}

/** Once the pending plan's period has opened, it becomes the main plan. */
export function foldPatch(p: Profile, today: ISODate): Partial<Profile> | null {
  const next = pendingPlan(p);
  if (!next || payPeriod(today, p.payday).start < next.from) return null;
  return { ...mainCols(next), ...NO_NEXT };
}
