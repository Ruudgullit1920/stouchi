/* Payday (spec §4.6): at 08:00 Africa/Tunis on payday the savings share of the
 * salary goes to the goal. Figures switch periods on the date (dates.ts); the
 * 08:00 rule decides only when the deposit is written. Each deposit has a
 * deterministic id, so the app and the Phase 4 cron converge on one row. */
import { daysInMonth, isInPeriod, periodsBack, todayTunis, type ISODate, type PayPeriod } from './dates';
import { splitSalary, type Mil } from './money';
import { planFor } from './plan';
import type { Goal, NewSavingsMove, Profile, SavingsMove } from './schemas';
import { STOUCHI_NS, uuidv5 } from './uuid5';

/** How many missed paydays one run catches up on (the device keeps 12 periods). */
const MAX_DEPOSITS = 12;
const OPENS_AT_HOUR = 8;

const TUNIS_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Tunis',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** The instant it is `hour`:`minute` in Tunis on `date`, whatever the offset that day. */
export function tunisInstant(date: ISODate, hour: number, minute = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = Object.fromEntries(
    TUNIS_CLOCK.formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]),
  );
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (shown - guess));
}

export const paydayOpensAt = (period: PayPeriod): string =>
  tunisInstant(period.start, OPENS_AT_HOUR).toISOString();

export const paydayId = (userId: string, periodStart: ISODate): string =>
  uuidv5(`payday:${userId}:${periodStart}`, STOUCHI_NS);

/** One `payday` move per period that opened after the onboarding date and by
 * `now`, that has no payday move yet (by id, or dated inside it after a payday
 * change), while a goal is active — oldest first, at most 12.
 * The period onboarding happened in gets none ("déjà épargné" covers it).
 * Each amount is that period's savings share (planFor: a pending change counts). */
export function dueDeposits({
  profile,
  goal,
  moves,
  now,
}: {
  profile: Profile;
  goal: Goal | null | undefined;
  moves: Pick<SavingsMove, 'id' | 'user_id' | 'kind' | 'occurred_on'>[];
  now: Date;
}): NewSavingsMove[] {
  if (!profile.onboarded_at || !goal || goal.archived_at) return [];

  const onboardedOn = todayTunis(new Date(profile.onboarded_at));
  const have = new Set(moves.map((m) => m.id));
  /* a payday deposit of mine dated inside a period covers it, whatever payday it
     was made for; a partner's, on the shared goal, covers only theirs */
  const paidOn = moves
    .filter((m) => m.kind === 'payday' && m.user_id === profile.user_id)
    .map((m) => m.occurred_on);
  const due: NewSavingsMove[] = [];
  for (const period of periodsBack(todayTunis(now), profile.payday, MAX_DEPOSITS + 1)) {
    if (period.start <= onboardedOn) break;
    if (new Date(paydayOpensAt(period)) > now) continue;
    const id = paydayId(profile.user_id, period.start);
    if (have.has(id) || paidOn.some((d) => isInPeriod(d, period))) continue;
    /* each period's share, from the plan that period runs on */
    const { salary_mil, split } = planFor(profile, period);
    const amount = splitSalary(salary_mil, split).savings;
    if (amount <= 0) continue;
    due.push({
      id,
      user_id: profile.user_id,
      goal_id: goal.id,
      amount_mil: amount,
      kind: 'payday',
      from_pot: null,
      occurred_on: period.start,
    });
  }
  return due.slice(0, MAX_DEPOSITS).reverse();
}

/** The goal deposits go to: the household's while paired, else the newest one
 * not archived. A goal written on this device has no created_at until the
 * server's copy comes back — it is the newest. */
export function activeGoal(goals: Goal[]): Goal | undefined {
  const stamp = (g: Goal) => (g.created_at as string | undefined) ?? '￿';
  const active = goals.filter((g) => !g.archived_at).sort((a, b) => stamp(b).localeCompare(stamp(a)));
  /* a row cached before Phase 6 has no household_id at all — not a household goal */
  return active.find((g) => !!g.household_id) ?? active[0];
}

/** The day the goal is reached at `monthly` a month: today when already there,
 * null when nothing goes in. */
export function goalEta(target: Mil, saved: Mil, monthly: Mil, today: ISODate): ISODate | null {
  if (saved >= target) return today;
  if (monthly <= 0) return null;
  const months = Math.ceil((target - saved) / monthly);
  const [y, m, d] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth() + 1;
  const day = Math.min(d, daysInMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
