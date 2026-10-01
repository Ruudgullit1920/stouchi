import { describe, expect, it } from 'vitest';
import { payPeriod, periodsBack } from '../../src/shared/dates';
import { groupByDay, historyLine, periodTotals, potBreakdown, titleOf } from '../../src/shared/ledger';
import { formatMoney } from '../../src/shared/money';
import { expense } from './fixtures';

const sept = payPeriod('2026-09-10', 1);
const aug = payPeriod('2026-08-10', 1);
const DELETED = '2026-09-05T10:00:00+01:00';

describe('titleOf', () => {
  it('is the label, or the category name when there is none', () => {
    expect(titleOf(expense({ label: 'Carrefour' }))).toBe('Carrefour');
    expect(titleOf(expense({ label: '', category: 'cafe', pot: 'wants' }))).toBe('Café');
  });
});

describe('potBreakdown', () => {
  it('totals one pot for one period, biggest category first, in pot tints', () => {
    const b = potBreakdown(
      [
        expense({ category: 'courses', amount_mil: 50_000 }),
        expense({ category: 'loyer', amount_mil: 400_000 }),
        expense({ category: 'courses', amount_mil: 30_000 }),
        expense({ category: 'cafe', pot: 'wants', amount_mil: 9_000 }),
        expense({ category: 'loyer', amount_mil: 1, spent_on: '2026-08-30' }),
        expense({ category: 'sante', amount_mil: 7, deleted_at: DELETED }),
      ],
      'needs',
      sept,
    );
    expect(b.total).toBe(480_000);
    expect(b.categories).toEqual([
      { key: 'loyer', total: 400_000, tint: 100 },
      { key: 'courses', total: 80_000, tint: 70 },
    ]);
  });

  it('gives every category past the fifth the lightest tint', () => {
    const cats = ['courses', 'loyer', 'factures', 'transport', 'essence', 'sante'] as const;
    const b = potBreakdown(
      cats.map((c, i) => expense({ category: c, amount_mil: 1000 * (10 - i) })),
      'needs',
      sept,
    );
    expect(b.categories.map((c) => c.tint)).toEqual([100, 70, 48, 30, 18, 18]);
  });
});

describe('groupByDay', () => {
  it('groups live expenses by day, newest day first, newest entry first, with day totals', () => {
    const days = groupByDay([
      expense({
        spent_on: '2026-09-03',
        amount_mil: 1_000,
        label: 'a',
        created_at: '2026-09-03T08:00:00+01:00',
      }),
      expense({ spent_on: '2026-09-05', amount_mil: 2_000, label: 'b' }),
      expense({
        spent_on: '2026-09-03',
        amount_mil: 4_000,
        label: 'c',
        created_at: '2026-09-03T09:00:00+01:00',
      }),
      expense({ spent_on: '2026-09-04', deleted_at: DELETED }),
    ]);
    expect(days.map((d) => [d.date, d.total, d.items.map((e) => e.label).join()])).toEqual([
      ['2026-09-05', 2_000, 'b'],
      ['2026-09-03', 5_000, 'c,a'],
    ]);
  });
});

describe('periodTotals', () => {
  it('totals each period per pot, in the order given', () => {
    const periods = periodsBack('2026-09-10', 1, 3);
    const totals = periodTotals(
      [
        expense({ spent_on: '2026-09-02', amount_mil: 5_000 }),
        expense({ spent_on: '2026-08-31', amount_mil: 3_000, category: 'cafe', pot: 'wants' }),
        expense({ spent_on: '2026-08-01', amount_mil: 2_000 }),
        expense({ spent_on: '2026-08-02', amount_mil: 9_000, deleted_at: DELETED }),
      ],
      periods,
    );
    expect(totals.map((t) => [t.period.label, t.needs, t.wants])).toEqual([
      ['2026-09', 5_000, 0],
      ['2026-08', 2_000, 3_000],
      ['2026-07', 0, 0],
    ]);
  });
});

describe('historyLine', () => {
  it('says nothing when the period has no expenses', () => {
    expect(historyLine([], sept, aug)).toBeNull();
  });

  it('names the biggest category and how it moved since last period', () => {
    const exps = [
      expense({ category: 'courses', amount_mil: 300_000 }),
      expense({ category: 'cafe', pot: 'wants', amount_mil: 20_000 }),
      expense({ category: 'courses', amount_mil: 250_000, spent_on: '2026-08-12' }),
    ];
    expect(historyLine(exps, sept, aug)).toEqual({
      key: 'history.line.up',
      vars: { category: 'Courses', amount: formatMoney(300_000), delta: formatMoney(50_000) },
    });
  });

  it('says when the biggest category went down, or is new', () => {
    const down = [
      expense({ category: 'courses', amount_mil: 100_000 }),
      expense({ category: 'courses', amount_mil: 250_000, spent_on: '2026-08-12' }),
    ];
    expect(historyLine(down, sept, aug)?.key).toBe('history.line.down');
    expect(historyLine(down, sept, aug)?.vars.delta).toBe(formatMoney(150_000));
    expect(historyLine([expense({ amount_mil: 100_000 })], sept, aug)?.key).toBe('history.line.first');
  });
});
