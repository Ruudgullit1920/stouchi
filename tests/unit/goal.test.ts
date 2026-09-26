import { describe, expect, it } from 'vitest';
import { depositGain, goalView, sooner } from '../../src/shared/goal';
import { goal, move, uuidN } from './fixtures';

const TODAY = '2026-09-10';
const G = goal({ target_mil: 6_000_000 });
const mv = (
  amount_mil: number,
  occurred_on = '2026-09-01',
  kind: 'payday' | 'deposit' | 'withdraw' = 'deposit',
) => move({ goal_id: G.id, amount_mil, occurred_on, kind });

describe('goalView', () => {
  it('starts at nothing saved', () => {
    const v = goalView(G, [], 400_000, TODAY);
    expect(v).toMatchObject({ saved: 0, pct: 0, reached: false, eta: '2027-12-10', deposits: [] });
  });

  it('sums deposits and withdrawals with their signs, newest first, and ignores other goals', () => {
    const moves = [
      mv(400_000, '2026-08-01', 'payday'),
      mv(-100_000, '2026-09-05', 'withdraw'),
      mv(200_000, '2026-09-02'),
      move({ goal_id: 'other', amount_mil: 999_000 }),
    ];
    const v = goalView(G, moves, 400_000, TODAY);
    expect(v.saved).toBe(500_000);
    expect(v.pct).toBe(8);
    expect(v.deposits.map((m) => m.occurred_on)).toEqual(['2026-09-05', '2026-09-02', '2026-08-01']);
  });

  it('never rounds up to 100 % before the goal is reached', () => {
    const v = goalView(G, [mv(5_990_000)], 400_000, TODAY);
    expect(v.pct).toBe(99);
    expect(v.reached).toBe(false);
  });

  it('is reached exactly at the target, dated today', () => {
    expect(goalView(G, [mv(6_000_000)], 400_000, TODAY)).toMatchObject({
      pct: 100,
      reached: true,
      eta: TODAY,
    });
  });

  it('caps at 100 % when the target is lowered below what is saved', () => {
    const v = goalView(goal({ id: G.id, target_mil: 1_000_000 }), [mv(1_500_000)], 400_000, TODAY);
    expect(v).toMatchObject({ saved: 1_500_000, pct: 100, reached: true, eta: TODAY });
  });

  it('has no date when nothing goes in each month', () => {
    expect(goalView(G, [], 0, TODAY).eta).toBeNull();
  });

  it('shows 0 % after withdrawing more than was saved', () => {
    expect(goalView(G, [mv(-100_000, '2026-09-01', 'withdraw')], 400_000, TODAY).pct).toBe(0);
  });
});

describe('sooner', () => {
  it('gives the new date and how many months it saves', () => {
    /* 6 000 at 400/month: 15 months; at 500: 12 months */
    expect(sooner(G, 0, 400_000, 100_000, TODAY)).toEqual({ eta: '2027-09-10', months: 3 });
  });

  it('is null once the goal is reached, never "−2 mois"', () => {
    expect(sooner(goal({ target_mil: 1_000_000 }), 1_500_000, 400_000, 100_000, TODAY)).toBeNull();
  });

  it('is null when the extra gains no month', () => {
    /* 1 000 left: 1 month at 1 000 or at 1 050 */
    expect(sooner(G, 5_000_000, 1_000_000, 50_000, TODAY)).toBeNull();
  });

  it('with nothing going in today, still dates the extra, with no months to compare', () => {
    expect(sooner(G, 0, 0, 200_000, TODAY)).toEqual({ eta: '2029-03-10', months: null });
  });
});

describe('depositGain', () => {
  it('gives the new total, date and months gained', () => {
    /* 6 000 at 400/month: 15 months; after 1 200 in, 12 months */
    expect(depositGain(G, 0, 1_200_000, 400_000, TODAY)).toEqual({
      after: 1_200_000,
      reached: false,
      eta: '2027-09-10',
      months: 3,
    });
  });

  it('says when the deposit reaches the goal', () => {
    expect(depositGain(G, 5_000_000, 1_000_000, 400_000, TODAY)).toMatchObject({ reached: true, eta: TODAY });
  });

  it('has no months to compare when nothing goes in each month', () => {
    expect(depositGain(G, 0, 100_000, 0, TODAY)).toMatchObject({ eta: null, months: null });
  });
});

describe('goalView — the household goal (Phase 6)', () => {
  it('counts both partners’ moves into the shared goal', () => {
    const shared = goal({ household_id: uuidN(778), target_mil: 1_000_000 });
    const moves = [
      move({ goal_id: shared.id, amount_mil: 200_000 }),
      move({ goal_id: shared.id, amount_mil: 300_000, user_id: uuidN(777) }),
    ];
    const v = goalView(shared, moves, 0, '2026-09-10');
    expect(v.saved).toBe(500_000);
    expect(v.pct).toBe(50);
    expect(v.deposits).toHaveLength(2);
  });
});
