import { describe, expect, it } from 'vitest';
import { payPeriod } from '../../src/shared/dates';
import { foldPatch, nextPlanPatch, paydayPatch, pendingPlan, planFor } from '../../src/shared/plan';
import type { Profile } from '../../src/shared/schemas';
import { profile } from './fixtures';

/* 2 000 TND, payday 1, 50/30/20 — today is in the period 2026-09-01 → 09-30 */
const TODAY = '2026-09-10';
const SPLIT = { needs: 50, wants: 30, savings: 20 };
const pending = (p: Partial<Profile> = {}) =>
  profile({
    next_salary_mil: 3_000_000,
    next_split_needs: 60,
    next_split_wants: 20,
    next_split_savings: 20,
    next_from: '2026-10-01',
    ...p,
  });
const apply = (p: Profile, patch: Partial<Profile>): Profile => ({ ...p, ...patch });

describe('planFor', () => {
  it('is the main plan when nothing is pending', () => {
    expect(planFor(profile(), payPeriod(TODAY, 1))).toEqual({ salary_mil: 2_000_000, split: SPLIT });
    expect(pendingPlan(profile())).toBeNull();
  });

  it('switches to the pending plan from its period on', () => {
    const p = pending();
    expect(planFor(p, payPeriod('2026-09-30', 1)).salary_mil).toBe(2_000_000);
    expect(planFor(p, payPeriod('2026-10-01', 1))).toEqual({
      salary_mil: 3_000_000,
      split: { needs: 60, wants: 20, savings: 20 },
    });
    expect(planFor(p, payPeriod('2026-12-05', 1)).salary_mil).toBe(3_000_000);
  });
});

describe('nextPlanPatch', () => {
  it('"now" writes the main columns and leaves nothing pending', () => {
    const patch = nextPlanPatch(profile(), { salary_mil: 2_500_000 }, 'now', TODAY);
    expect(patch).toMatchObject({ salary_mil: 2_500_000, next_salary_mil: null, next_from: null });
  });

  it('"next" writes only next_*, from the next payday, carrying the other half', () => {
    const patch = nextPlanPatch(profile(), { salary_mil: 3_000_000 }, 'next', TODAY);
    expect(patch).not.toHaveProperty('salary_mil');
    expect(patch).toEqual({
      next_salary_mil: 3_000_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
  });

  it('a salary-only "next" keeps the pending split, and the reverse', () => {
    const p = pending();
    expect(nextPlanPatch(p, { salary_mil: 2_800_000 }, 'next', TODAY)).toMatchObject({
      next_salary_mil: 2_800_000,
      next_split_needs: 60,
    });
    expect(nextPlanPatch(p, { split: { needs: 40, wants: 40, savings: 20 } }, 'next', TODAY)).toMatchObject({
      next_salary_mil: 3_000_000,
      next_split_needs: 40,
    });
  });

  it('"next" then "now" on the same field: the pending change is gone, the home figures use the new value', () => {
    const p = apply(profile(), nextPlanPatch(profile(), { salary_mil: 3_000_000 }, 'next', TODAY));
    const q = apply(p, nextPlanPatch(p, { salary_mil: 2_200_000 }, 'now', TODAY));
    expect(pendingPlan(q)).toBeNull();
    expect(planFor(q, payPeriod(TODAY, 1)).salary_mil).toBe(2_200_000);
    expect(planFor(q, payPeriod('2026-10-05', 1)).salary_mil).toBe(2_200_000);
  });

  it('"now" on the other field keeps the pending change and gives it the new value too', () => {
    const p = apply(profile(), nextPlanPatch(profile(), { salary_mil: 3_000_000 }, 'next', TODAY));
    const q = apply(p, nextPlanPatch(p, { split: { needs: 60, wants: 20, savings: 20 } }, 'now', TODAY));
    expect(planFor(q, payPeriod(TODAY, 1))).toEqual({
      salary_mil: 2_000_000,
      split: { needs: 60, wants: 20, savings: 20 },
    });
    expect(planFor(q, payPeriod('2026-10-05', 1))).toEqual({
      salary_mil: 3_000_000,
      split: { needs: 60, wants: 20, savings: 20 },
    });
  });

  it('"now" then "next" keeps both', () => {
    const p = apply(profile(), nextPlanPatch(profile(), { salary_mil: 2_500_000 }, 'now', TODAY));
    const q = apply(p, nextPlanPatch(p, { split: { needs: 40, wants: 40, savings: 20 } }, 'next', TODAY));
    expect(planFor(q, payPeriod(TODAY, 1)).salary_mil).toBe(2_500_000);
    expect(planFor(q, payPeriod('2026-10-05', 1))).toEqual({
      salary_mil: 2_500_000,
      split: { needs: 40, wants: 40, savings: 20 },
    });
  });
});

describe('paydayPatch', () => {
  it('only sets the payday when nothing is pending', () => {
    expect(paydayPatch(profile(), 25, TODAY)).toEqual({ payday: 25 });
  });

  it('moves a pending change to the new next payday, never mid-period', () => {
    const patch = paydayPatch(pending(), 25, TODAY);
    expect(patch).toEqual({ payday: 25, next_from: '2026-09-25' });
    const p = apply(pending(), patch);
    /* with payday 25 the periods are 08-25 → 09-24 and 09-25 → 10-24 */
    expect(planFor(p, payPeriod('2026-09-24', 25)).salary_mil).toBe(2_000_000);
    expect(planFor(p, payPeriod('2026-09-25', 25)).salary_mil).toBe(3_000_000);
  });
});

describe('foldPatch', () => {
  it('is null while the pending period has not opened', () => {
    expect(foldPatch(pending(), '2026-09-30')).toBeNull();
    expect(foldPatch(profile(), '2026-10-05')).toBeNull();
  });

  it('moves the pending plan into the main columns once its period opens', () => {
    expect(foldPatch(pending(), '2026-10-01')).toEqual({
      salary_mil: 3_000_000,
      split_needs: 60,
      split_wants: 20,
      split_savings: 20,
      next_salary_mil: null,
      next_split_needs: null,
      next_split_wants: null,
      next_split_savings: null,
      next_from: null,
    });
  });
});

describe('a pending plan already due but not yet folded (offline, before the first pull)', () => {
  /* pending() applies from 2026-10-01; today is inside that period */
  const LATER = '2026-10-02';

  it('a "next" change keeps it in force now and waits for the period after', () => {
    const p = pending();
    const q = apply(p, nextPlanPatch(p, { split: { needs: 40, wants: 40, savings: 20 } }, 'next', LATER));
    expect(planFor(q, payPeriod(LATER, 1))).toEqual({
      salary_mil: 3_000_000,
      split: { needs: 60, wants: 20, savings: 20 },
    });
    expect(planFor(q, payPeriod('2026-11-01', 1)).split).toEqual({ needs: 40, wants: 40, savings: 20 });
  });

  it('a payday change keeps it in force instead of pushing it back', () => {
    const p = pending();
    const q = apply(p, paydayPatch(p, 25, LATER));
    expect(planFor(q, payPeriod(LATER, 25)).salary_mil).toBe(3_000_000);
    expect(pendingPlan(q)).toBeNull();
  });
});
