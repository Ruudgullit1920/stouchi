/* Phase 7, Review Focus 2: a backfilled user's first open writes at most the
 * current period's payday deposit, and never one for a period before the
 * launch. The fixture households go through the real converter, and each
 * account's rows go to dueDeposits as the app would see them. */
import { describe, expect, it } from 'vitest';
import { convertAll } from '../../../scripts/backfill/convert';
import { activeGoal, dueDeposits, tunisInstant } from '../../../src/shared/payday';
import type { Goal, Profile } from '../../../src/shared/schemas';
import { HOUSEHOLDS, ROWS } from './fixtures';

const LAUNCH = '2026-11-01';

function firstOpen(backfillAt: Date, openAt: Date) {
  const out = convertAll(ROWS, HOUSEHOLDS, backfillAt);
  const homesOf = (uid: string) =>
    HOUSEHOLDS.filter((h) => h.members.some((m) => m.user_id === uid)).map((h) => h.household_id);
  return out.profiles.map((profile) => {
    const homes = homesOf(profile.user_id);
    const goals = out.goals.filter(
      (g) => g.user_id === profile.user_id || (g.household_id && homes.includes(g.household_id)),
    ) as Goal[];
    const due = dueDeposits({
      profile: profile as Profile,
      goal: activeGoal(goals),
      moves: out.savings_moves,
      now: openAt,
    });
    return { user: profile.user_id, days: due.map((m) => m.occurred_on) };
  });
}

const total = (r: ReturnType<typeof firstOpen>) => r.flatMap((x) => x.days);

describe('the first open after the backfill', () => {
  const morning = tunisInstant(LAUNCH, 7);

  it('backfilled on launch morning: no deposit on the 1st at 09:00, nor on the 15th', () => {
    expect(total(firstOpen(morning, tunisInstant(LAUNCH, 9)))).toEqual([]);
    expect(total(firstOpen(morning, tunisInstant('2026-11-15', 9)))).toEqual([]);
  });

  it('the next payday brings exactly one deposit each, for that period', () => {
    const r = firstOpen(morning, tunisInstant('2026-12-01', 9));
    expect(r.filter((x) => x.days.length).map((x) => x.days)).toEqual([
      ['2026-12-01'],
      ['2026-12-01'],
      ['2026-12-01'],
      ['2026-12-01'],
    ]);
  });

  it('backfilled the evening before: at most the launch period, never earlier', () => {
    const eve = tunisInstant('2026-10-31', 22);
    expect(total(firstOpen(eve, tunisInstant(LAUNCH, 7, 30)))).toEqual([]);
    const r = firstOpen(eve, tunisInstant('2026-11-15', 9));
    for (const x of r) expect(x.days.length).toBeLessThanOrEqual(1);
    expect(total(r).every((d) => d === LAUNCH)).toBe(true);
    expect(total(r)).toHaveLength(4);
  });
});
