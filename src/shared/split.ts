/* The Répartition editor (spec §4.6): two handles over one bar, in steps of 5 %,
 * and what Aam Salah says about the result — bills first, then the goal. */
import type { ISODate } from './dates';
import { MIL_PER_TND, splitSalary, type Mil, type Split } from './money';
import { goalEta } from './payday';

const STEP = 5;
/** each pot keeps at least this much, so no handle can swallow another */
const MIN_POT = 5;
/** Besoins left after the bills below this is "serré" */
const TIGHT_MIL = 250 * MIL_PER_TND;
const LOW_SAVINGS = 10;

export const SPLIT_PRESETS: { key: 'classic' | 'rent' | 'hard'; split: Split; recommended?: boolean }[] = [
  { key: 'classic', split: { needs: 50, wants: 30, savings: 20 }, recommended: true },
  { key: 'rent', split: { needs: 60, wants: 20, savings: 20 } },
  { key: 'hard', split: { needs: 70, wants: 20, savings: 10 } },
];

/** "50 / 30 / 20" */
export const splitText = (s: Split): string => `${s.needs} / ${s.wants} / ${s.savings}`;

export const sameSplit = (a: Split, b: Split): boolean =>
  a.needs === b.needs && a.wants === b.wants && a.savings === b.savings;

/** Handle 1 sits at Besoins, handle 2 at Besoins + Envies; `v` is the new position in %. */
export function moveHandle(s: Split, which: 1 | 2, v: number): Split {
  const snapped = Math.round(v / STEP) * STEP;
  let a = s.needs;
  let b = s.needs + s.wants;
  if (which === 1) a = Math.max(MIN_POT, Math.min(b - MIN_POT, snapped));
  else b = Math.max(a + MIN_POT, Math.min(100 - MIN_POT, snapped));
  return { needs: a, wants: b - a, savings: 100 - b };
}

export type SplitTip =
  | { kind: 'over'; bills: Mil; needs: Mil }
  | { kind: 'tight'; left: Mil }
  | { kind: 'low'; monthly: Mil; eta: ISODate | null }
  | { kind: 'goal'; monthly: Mil; eta: ISODate | null; diff: number }
  | { kind: 'left'; left: Mil };

const monthsTo = (left: Mil, monthly: Mil) => Math.ceil(left / monthly);

export function splitTip({
  split,
  current,
  salary,
  bills,
  goal,
  today,
}: {
  split: Split;
  /** the split in force, to say "N mois plus tôt / plus tard" */
  current: Split;
  salary: Mil;
  /** what the active bills put aside this period */
  bills: Mil;
  goal: { target: Mil; saved: Mil } | null;
  today: ISODate;
}): SplitTip {
  const pots = splitSalary(salary, split);
  if (bills > pots.needs) return { kind: 'over', bills, needs: pots.needs };
  if (pots.needs - bills < TIGHT_MIL) return { kind: 'tight', left: pots.needs - bills };
  const open = goal && goal.saved < goal.target ? goal : null;
  const eta = open && goalEta(open.target, open.saved, pots.savings, today);
  if (split.savings < LOW_SAVINGS) return { kind: 'low', monthly: pots.savings, eta: eta ?? null };
  if (!open) return { kind: 'left', left: pots.needs - bills };
  const before = splitSalary(salary, current).savings;
  const left = open.target - open.saved;
  return {
    kind: 'goal',
    monthly: pots.savings,
    eta: eta ?? null,
    diff: monthsTo(left, before) - monthsTo(left, pots.savings),
  };
}
