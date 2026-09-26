import { describe, expect, it } from 'vitest';
import { payPeriod } from '../../src/shared/dates';
import { isSavingsOpportunity, spendPace } from '../../src/shared/nudges';
import { expense } from './fixtures';

const period = payPeriod('2026-09-10', 1); // 1 → 30 Sept

describe('spendPace', () => {
  it("is this period's average day of variable spending, in 5 TND steps", () => {
    const es = [expense({ amount_mil: 240_000, spent_on: '2026-09-05' })];
    expect(spendPace(es, period, '2026-09-10')).toBe(20); // 240 / 10 = 24 → 20
  });
  it('ignores rent, bills, deleted rows, other periods and days after today', () => {
    const es = [
      expense({ amount_mil: 900_000, category: 'loyer' }),
      expense({ amount_mil: 90_000, category: 'factures' }),
      expense({ amount_mil: 90_000, bill_id: '00000000-0000-4000-8000-000000000999' }),
      expense({ amount_mil: 90_000, deleted_at: '2026-09-09T10:00:00+01:00' }),
      expense({ amount_mil: 90_000, spent_on: '2026-08-31' }),
      expense({ amount_mil: 90_000, spent_on: '2026-09-11' }),
    ];
    expect(spendPace(es, period, '2026-09-10')).toBe(0);
  });
});

describe('isSavingsOpportunity', () => {
  const at = (left: number, daysLeft: number, pace: number, hasGoal = true) =>
    isSavingsOpportunity({ left, daysLeft, pace, hasGoal });
  it('fires in the last 5 days when left ≥ 3 × pace', () => {
    expect(at(60_000, 5, 20)).toBe(true);
    expect(at(59_999, 5, 20)).toBe(false);
    expect(at(600_000, 6, 20)).toBe(false);
  });
  it('never without a goal or a pace', () => {
    expect(at(600_000, 3, 20, false)).toBe(false);
    expect(at(600_000, 3, 0)).toBe(false);
  });
});
