/* The setup answers (spec §4.1), kept on the device after every step so a
 * reload resumes where it stopped. Ids are made once, so repeating a step
 * upserts the same rows instead of adding new ones. */
import type { Table } from '../../data/localdb';
import { t, type StringKey } from '../../shared/i18n/t';
import { DEFAULT_SPLIT, MAX_MIL, MIL_PER_TND, splitSalary, type Mil } from '../../shared/money';
import type { ISODate } from '../../shared/dates';
import type { NewSavingsMove } from '../../shared/schemas';

export const STEPS = ['name', 'salary', 'payday', 'bills', 'goal'] as const;
export type StepName = (typeof STEPS)[number];
/** step index once the goal is answered: the reveal comes next */
export const DONE = STEPS.length;

export const MIN_SALARY: Mil = 100 * MIL_PER_TND;
export const NAME_MAX = 20;

export const BILL_PRESETS = [
  { key: 'loyer', icon: 'key-round', tnd: 400 },
  { key: 'steg', icon: 'zap', tnd: 120 },
  { key: 'sonede', icon: 'droplet', tnd: 75 },
  { key: 'net', icon: 'wifi', tnd: 45 },
  { key: 'tel', icon: 'smartphone', tnd: 30 },
  { key: 'credit', icon: 'landmark', tnd: 250 },
] as const;
export type BillKey = (typeof BILL_PRESETS)[number]['key'];

/** Sécurité has no preset: three salaries. */
export const GOAL_PRESETS = [
  { key: 'maison', icon: 'house', tnd: 20_000 },
  { key: 'voiture', icon: 'car', tnd: 15_000 },
  { key: 'mariage', icon: 'heart', tnd: 25_000 },
  { key: 'voyage', icon: 'plane', tnd: 3_000 },
  { key: 'secu', icon: 'shield', tnd: null },
  { key: 'autre', icon: 'sparkles', tnd: 5_000 },
] as const;
export type GoalKey = (typeof GOAL_PRESETS)[number]['key'];

export interface DraftBill {
  key: BillKey;
  id: string;
  on: boolean;
  amount_mil: Mil;
  /** already sent once: unticking it must turn the row off */
  written: boolean;
}

export interface Draft {
  userId: string;
  step: number;
  name: string;
  salary_mil: Mil;
  /** 1–28, 0 = last day, null = not answered */
  payday: number | null;
  bills: DraftBill[];
  goal: { key: GoalKey; target_mil: Mil; saved_mil: Mil } | null;
  goalId: string;
  depositId: string;
}

export function newDraft(
  userId: string,
  seed: { name?: string; salary_mil?: Mil; payday?: number | null } = {},
  uuid: () => string = () => crypto.randomUUID(),
): Draft {
  return {
    userId,
    step: 0,
    name: seed.name ?? '',
    salary_mil: seed.salary_mil ?? 0,
    payday: seed.payday ?? null,
    bills: BILL_PRESETS.map((b) => ({
      key: b.key,
      id: uuid(),
      on: false,
      amount_mil: b.tnd * MIL_PER_TND,
      written: false,
    })),
    goal: null,
    goalId: uuid(),
    depositId: uuid(),
  };
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyFor = (userId: string) => `stouchi.setup.${userId}`;

export function loadDraft(userId: string, storage: KeyValue = localStorage): Draft | null {
  try {
    const raw = storage.getItem(keyFor(userId));
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d?.userId === userId ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft, storage: KeyValue = localStorage): void {
  try {
    storage.setItem(keyFor(d.userId), JSON.stringify(d));
  } catch {
    /* private mode: the rows are on the server already, only the resume point is lost */
  }
}

export function clearDraft(userId: string, storage: KeyValue = localStorage): void {
  try {
    storage.removeItem(keyFor(userId));
  } catch {
    /* nothing to clear */
  }
}

const inRange = (m: Mil) => m > 0 && m <= MAX_MIL;

export function stepValid(d: Draft, step: StepName): boolean {
  switch (step) {
    case 'name':
      return d.name.trim().length > 0 && d.name.trim().length <= NAME_MAX;
    case 'salary':
      return d.salary_mil >= MIN_SALARY && d.salary_mil <= MAX_MIL;
    case 'payday':
      return d.payday !== null;
    case 'bills':
      return d.bills.every((b) => !b.on || inRange(b.amount_mil));
    case 'goal':
      return (
        d.goal !== null && inRange(d.goal.target_mil) && d.goal.saved_mil >= 0 && d.goal.saved_mil <= MAX_MIL
      );
  }
}

export const potsOf = (salary: Mil) => splitSalary(salary, DEFAULT_SPLIT);

/** What the chosen bills take out of Besoins each month. */
export function meter(d: Draft): { used: Mil; need: Mil; pct: number; level: 'ok' | 'warn' | 'over' } {
  const need = potsOf(d.salary_mil).needs;
  const used = d.bills.filter((b) => b.on).reduce((s, b) => s + b.amount_mil, 0);
  const pct = need ? Math.round((used / need) * 100) : 0;
  return { used, need, pct, level: pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok' };
}

export function goalTarget(key: GoalKey, salary: Mil): Mil {
  const preset = GOAL_PRESETS.find((g) => g.key === key);
  return preset?.tnd === null || !preset ? 3 * salary : preset.tnd * MIL_PER_TND;
}

export const billLabel = (key: BillKey): StringKey => `setup.bill.${key}` as StringKey;
export const goalLabel = (key: GoalKey): StringKey => `setup.goal.${key}` as StringKey;

export function rowsForStep(
  d: Draft,
  step: StepName,
  today: ISODate,
): { table: Table; row: Record<string, unknown> }[] {
  if (step === 'name' || step === 'salary' || step === 'payday')
    return [
      {
        table: 'profiles',
        row: {
          user_id: d.userId,
          first_name: d.name.trim(),
          salary_mil: d.salary_mil,
          payday: d.payday ?? 1,
          split_needs: DEFAULT_SPLIT.needs,
          split_wants: DEFAULT_SPLIT.wants,
          split_savings: DEFAULT_SPLIT.savings,
          onboarded_at: null,
        },
      },
    ];
  if (step === 'bills')
    return d.bills
      .filter((b) => b.on || b.written)
      .map((b) => ({
        table: 'bills' as const,
        row: {
          id: b.id,
          user_id: d.userId,
          household_id: null,
          label: t(billLabel(b.key)),
          amount_mil: inRange(b.amount_mil)
            ? b.amount_mil
            : (BILL_PRESETS.find((p) => p.key === b.key)?.tnd ?? 1) * MIL_PER_TND,
          frequency: 'monthly',
          /* plan: setup bills fall due on payday; 31 is clamped to the month's end */
          day: d.payday === 0 || d.payday === null ? 31 : d.payday,
          starts_on: today,
          active: b.on,
        },
      }));
  if (!d.goal) return [];
  const preset = GOAL_PRESETS.find((g) => g.key === d.goal?.key);
  return [
    {
      table: 'goals',
      row: {
        id: d.goalId,
        user_id: d.userId,
        household_id: null,
        name: t(`${goalLabel(d.goal.key)}.name` as StringKey),
        icon: preset?.icon ?? 'sparkles',
        target_mil: d.goal.target_mil,
        archived_at: null,
      },
    },
  ];
}

/** After a bills step is sent: a ticked bill now exists on the server. */
export const markWritten = (d: Draft): Draft => ({
  ...d,
  bills: d.bills.map((b) => ({ ...b, written: b.written || b.on })),
});

/** "Déjà épargné", written once with the reveal (savings moves are insert-only,
 * so it waits until the amount can no longer change). */
export function openingDeposit(d: Draft, today: ISODate): NewSavingsMove | null {
  if (!d.goal || d.goal.saved_mil <= 0) return null;
  return {
    id: d.depositId,
    user_id: d.userId,
    goal_id: d.goalId,
    amount_mil: d.goal.saved_mil,
    kind: 'deposit',
    from_pot: null,
    occurred_on: today,
  };
}

export interface StepProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  today: ISODate;
}
