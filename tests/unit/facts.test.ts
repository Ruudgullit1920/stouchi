import { describe, expect, it } from 'vitest';
import { computeFacts, inOpeningPeriod, openingBudget, type FactsInput } from '../../src/shared/facts';
import { bill, debt, expense, income, move, payment, profile, uuidN } from './fixtures';

const base = (p: Partial<FactsInput> = {}): FactsInput => ({
  profile: profile(), // 2 000 TND, payday 1, 50/30/20
  expenses: [],
  bills: [],
  billPayments: [],
  debts: [],
  savingsMoves: [],
  incomes: [],
  today: '2026-09-10',
  ...p,
});

describe('computeFacts — budgets', () => {
  it('splits the salary into the three pots', () => {
    const f = computeFacts(base());
    expect(f.salary).toBe(2_000_000);
    expect(f.pots.needs.budget).toBe(1_000_000);
    expect(f.pots.wants.budget).toBe(600_000);
    expect(f.pots.savings.budget).toBe(400_000);
    expect(f.left).toBe(1_600_000);
    expect(f.period).toEqual({ start: '2026-09-01', end: '2026-09-30', label: '2026-09' });
    expect(f.daysLeft).toBe(21);
    expect(f.perDay).toBe(Math.floor(1_600_000 / 21));
  });

  it('honours a custom split', () => {
    const f = computeFacts(
      base({ profile: profile({ split_needs: 60, split_wants: 30, split_savings: 10 }) }),
    );
    expect(f.pots.needs.budget).toBe(1_200_000);
    expect(f.pots.savings.budget).toBe(200_000);
  });

  it('uses a pending plan once its period has opened, not before', () => {
    const next = {
      next_salary_mil: 3_000_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    };
    expect(computeFacts(base({ profile: profile(next) })).salary).toBe(2_000_000);
    const f = computeFacts(base({ profile: profile(next), today: '2026-10-02' }));
    expect(f.salary).toBe(3_000_000);
    expect(f.pots.savings.budget).toBe(600_000);
  });

  it('gives the split the period runs on', () => {
    const next = {
      next_salary_mil: 2_000_000,
      next_split_needs: 60,
      next_split_wants: 20,
      next_split_savings: 20,
      next_from: '2026-10-01',
    };
    expect(computeFacts(base({ profile: profile(next) })).split).toEqual({
      needs: 50,
      wants: 30,
      savings: 20,
    });
    expect(computeFacts(base({ profile: profile(next), today: '2026-10-02' })).split).toEqual({
      needs: 60,
      wants: 20,
      savings: 20,
    });
  });
});

describe('computeFacts — spending', () => {
  it('counts expenses in the period per pot and ignores deleted ones', () => {
    const f = computeFacts(
      base({
        expenses: [
          expense({ amount_mil: 100_000 }),
          expense({ amount_mil: 30_000, category: 'cafe', pot: 'wants' }),
          expense({ amount_mil: 999_000, deleted_at: '2026-09-05T10:00:00+01:00' }),
        ],
      }),
    );
    expect(f.pots.needs.spent).toBe(100_000);
    expect(f.pots.wants.spent).toBe(30_000);
    expect(f.pots.needs.left).toBe(900_000);
    expect(f.left).toBe(1_470_000);
  });

  it("counts the period's first and last day, not the days around it", () => {
    const f = computeFacts(
      base({
        expenses: ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'].map((d) =>
          expense({ spent_on: d, amount_mil: 1_000 }),
        ),
      }),
    );
    expect(f.pots.needs.spent).toBe(2_000);
  });

  it('lets an overspent pot go negative and floors perDay at 0', () => {
    const f = computeFacts(base({ expenses: [expense({ amount_mil: 1_700_000 })], today: '2026-09-10' }));
    expect(f.pots.needs.left).toBe(-700_000);
    expect(f.left).toBe(-100_000);
    expect(f.perDay).toBe(0);
  });

  it('warns at 80 % of a pot', () => {
    const at = (mil: number) =>
      computeFacts(base({ expenses: [expense({ amount_mil: mil, category: 'cafe', pot: 'wants' })] })).pots
        .wants;
    expect(at(479_999).warn).toBe(false);
    expect(at(480_000).warn).toBe(true);
    expect(at(480_000).ratio).toBeCloseTo(0.8);
  });

  it('treats any spending against a zero budget as full, and an untouched one as empty', () => {
    const zero = profile({ salary_mil: 0 });
    expect(computeFacts(base({ profile: zero, expenses: [expense()] })).pots.needs).toMatchObject({
      ratio: 1,
      warn: true,
    });
    expect(computeFacts(base({ profile: zero })).pots.needs).toMatchObject({ ratio: 0, warn: false });
  });

  it('lists the five most recent expenses, newest first', () => {
    const exps = [3, 9, 1, 7, 5, 8].map((d) => expense({ spent_on: `2026-09-0${d}`, label: `d${d}` }));
    expect(computeFacts(base({ expenses: exps })).recent.map((e) => e.label)).toEqual([
      'd9',
      'd8',
      'd7',
      'd5',
      'd3',
    ]);
  });
});

describe('computeFacts — bills and debts', () => {
  const steg = bill({ amount_mil: 80_000, day: 15 });

  it('reserves an unpaid bill inside Besoins', () => {
    const f = computeFacts(base({ bills: [steg] }));
    expect(f.pots.needs.reserved).toBe(80_000);
    expect(f.pots.needs.left).toBe(920_000);
    expect(f.pots.wants.reserved).toBe(0);
    expect(f.left).toBe(1_520_000);
    expect(f.upcoming).toEqual([
      { kind: 'bill', id: steg.id, label: 'STEG', amount_mil: 80_000, due_on: '2026-09-15' },
    ]);
  });

  it('counts a paid bill once: its expense is spent, nothing is reserved', () => {
    const paid = expense({ amount_mil: 82_000, source: 'bill', bill_id: steg.id, category: 'factures' });
    const f = computeFacts(
      base({
        bills: [steg],
        expenses: [paid],
        billPayments: [payment({ bill_id: steg.id, expense_id: paid.id })],
      }),
    );
    expect(f.pots.needs.reserved).toBe(0);
    expect(f.pots.needs.spent).toBe(82_000);
    expect(f.pots.needs.left).toBe(918_000);
    expect(f.upcoming).toEqual([]);
  });

  it('reserves the bill again when the expense that paid it is deleted', () => {
    const paid = expense({ amount_mil: 82_000, bill_id: steg.id, deleted_at: '2026-09-16T09:00:00+01:00' });
    const f = computeFacts(
      base({
        bills: [steg],
        expenses: [paid],
        billPayments: [payment({ bill_id: steg.id, expense_id: paid.id })],
      }),
    );
    expect(f.pots.needs.spent).toBe(0);
    expect(f.pots.needs.reserved).toBe(80_000);
  });

  it('ignores a payment recorded for another period', () => {
    const f = computeFacts(
      base({ bills: [steg], billPayments: [payment({ bill_id: steg.id, period_start: '2026-08-01' })] }),
    );
    expect(f.pots.needs.reserved).toBe(80_000);
  });

  it('shows unsettled debts due this period in À venir without touching Reste', () => {
    const owe = debt({ due_on: '2026-09-12' });
    const owed = debt({ direction: 'owed_to_me', due_on: '2026-09-20', person: 'Amel' });
    const later = debt({ due_on: '2026-10-05' });
    const settled = debt({ settled_at: '2026-09-02T10:00:00+01:00' });
    const f = computeFacts(base({ bills: [steg], debts: [later, owed, settled, owe] }));
    expect(f.left).toBe(1_520_000);
    expect(f.upcoming.map((u) => [u.kind, u.due_on])).toEqual([
      ['debt', '2026-09-12'],
      ['bill', '2026-09-15'],
      ['debt', '2026-09-20'],
    ]);
    expect(f.upcoming[2]).toMatchObject({ direction: 'owed_to_me', label: 'Amel' });
  });
});

describe('computeFacts — money moved into and out of the pots (Phase 3)', () => {
  // 2 000 TND, 50/30/20: Besoins 1 000, Envies 600; 2026-09-10 → 21 days left
  it('a deposit from Envies lowers Envies; a withdrawal to Besoins raises Besoins', () => {
    const f = computeFacts(
      base({
        savingsMoves: [
          move({ amount_mil: 100_000, kind: 'deposit', from_pot: 'wants' }),
          move({ amount_mil: -200_000, kind: 'withdraw', from_pot: 'needs' }),
        ],
      }),
    );
    expect(f.pots.wants).toMatchObject({ budget: 600_000, moved: -100_000, left: 500_000 });
    expect(f.pots.needs).toMatchObject({ budget: 1_000_000, moved: 200_000, left: 1_200_000 });
    expect(f.left).toBe(1_700_000);
  });

  it('an income to Envies raises Envies; a deleted one, or one from last period, changes nothing', () => {
    const f = computeFacts(
      base({
        incomes: [
          income({ amount_mil: 150_000, pot: 'wants' }),
          income({ amount_mil: 70_000, pot: 'wants', deleted_at: '2026-09-10T12:00:00+01:00' }),
          income({ amount_mil: 90_000, pot: 'wants', received_on: '2026-08-31' }),
        ],
      }),
    );
    expect(f.pots.wants).toMatchObject({ moved: 150_000, left: 750_000 });
    expect(f.pots.needs.moved).toBe(0);
  });

  it('payday moves, deposits with no pot and last period moves leave both pots alone', () => {
    const plain = computeFacts(base());
    const f = computeFacts(
      base({
        savingsMoves: [
          move({ amount_mil: 400_000, kind: 'payday', from_pot: null }),
          move({ amount_mil: 50_000, kind: 'payday', from_pot: 'wants' }),
          move({ amount_mil: 100_000, kind: 'deposit', from_pot: null }),
          move({ amount_mil: 100_000, kind: 'deposit', from_pot: 'wants', occurred_on: '2026-08-30' }),
        ],
      }),
    );
    expect(f.pots.needs).toEqual(plain.pots.needs);
    expect(f.pots.wants).toEqual(plain.pots.wants);
    expect(f.perDay).toBe(plain.perDay);
  });

  it('perDay follows the new left', () => {
    const f = computeFacts(base({ incomes: [income({ amount_mil: 210_000, pot: 'needs' })] }));
    // (1 000 + 210 + 600) TND over 21 days
    expect(f.left).toBe(1_810_000);
    expect(f.perDay).toBe(Math.floor(1_810_000 / 21));
  });

  it('the fill ratio is measured against what the pot now holds', () => {
    const f = computeFacts(
      base({
        expenses: [expense({ amount_mil: 480_000, category: 'cafe', pot: 'wants' })],
        incomes: [income({ amount_mil: 200_000, pot: 'wants' })],
      }),
    );
    // 480 of 600 would warn (80 %); of 800 it is 60 %
    expect(f.pots.wants.ratio).toBeCloseTo(0.6);
    expect(f.pots.wants.warn).toBe(false);
  });

  it('a deleted debt is not upcoming', () => {
    const gone = debt({ due_on: '2026-09-20', deleted_at: '2026-09-10T12:00:00+01:00' });
    const kept = debt({ due_on: '2026-09-21' });
    expect(computeFacts(base({ debts: [gone, kept] })).upcoming.map((u) => u.id)).toEqual([kept.id]);
  });
});

describe('computeFacts — couple mode (Phase 6)', () => {
  const PARTNER = uuidN(777);
  const HOME = uuidN(778);
  const couple = { me: profile().user_id, partnerNeeds: 900_000 };
  const theirs = { user_id: PARTNER, household_id: HOME };

  it('leaves the solo figures untouched, and says so', () => {
    const rows = { expenses: [expense({ amount_mil: 40_000 })], bills: [bill()] };
    const solo = computeFacts(base(rows));
    expect(computeFacts(base({ ...rows, couple: null }))).toEqual(solo);
    expect(solo.couple).toBe(false);
  });

  it('adds both Besoins budgets and both partners’ Besoins spending', () => {
    const f = computeFacts(
      base({
        couple,
        expenses: [
          expense({ amount_mil: 40_000, household_id: HOME }),
          expense({ amount_mil: 60_000, ...theirs }),
        ],
      }),
    );
    expect(f.couple).toBe(true);
    expect(f.pots.needs.budget).toBe(1_900_000);
    expect(f.pots.needs.spent).toBe(100_000);
    expect(f.pots.wants.budget).toBe(600_000);
    expect(f.left).toBe(1_800_000 + 600_000);
  });

  it('ignores the partner’s Envies rows passed by mistake', () => {
    const f = computeFacts(
      base({
        couple,
        expenses: [expense({ pot: 'wants', amount_mil: 30_000 }), expense({ pot: 'wants', ...theirs })],
        incomes: [income({ pot: 'wants', ...theirs })],
        savingsMoves: [move({ from_pot: 'wants', user_id: PARTNER })],
      }),
    );
    expect(f.pots.wants.spent).toBe(30_000);
    expect(f.pots.wants.moved).toBe(0);
    expect(f.recent.every((e) => e.user_id === couple.me || e.pot === 'needs')).toBe(true);
  });

  it('reserves a shared bill once, and not at all once the partner has paid it', () => {
    const shared = bill({ amount_mil: 80_000, day: 15, ...theirs });
    expect(computeFacts(base({ couple, bills: [shared] })).pots.needs.reserved).toBe(80_000);
    const paid = expense({ amount_mil: 80_000, source: 'bill', bill_id: shared.id, ...theirs });
    const f = computeFacts(
      base({
        couple,
        bills: [shared],
        expenses: [paid],
        billPayments: [payment({ bill_id: shared.id, expense_id: paid.id })],
      }),
    );
    expect(f.pots.needs.reserved).toBe(0);
    expect(f.pots.needs.spent).toBe(80_000);
  });

  it('a partner’s deposit from Besoins, or income kept in Besoins, moves shared Besoins', () => {
    const f = computeFacts(
      base({
        couple,
        savingsMoves: [move({ from_pot: 'needs', amount_mil: 50_000, user_id: PARTNER })],
        incomes: [income({ pot: 'needs', amount_mil: 20_000, ...theirs })],
      }),
    );
    expect(f.pots.needs.moved).toBe(-30_000);
  });

  it('gives each partner their own pay period over the same rows (paydays 25 and 5)', () => {
    const rows = {
      expenses: [
        expense({ spent_on: '2026-08-30', amount_mil: 10_000 }),
        expense({ spent_on: '2026-09-07', amount_mil: 20_000, ...theirs }),
      ],
    };
    const mine = computeFacts(base({ ...rows, couple, profile: profile({ payday: 25 }) }));
    const partners = computeFacts(
      base({
        ...rows,
        couple: { me: PARTNER, partnerNeeds: 1_000_000 },
        profile: profile({ user_id: PARTNER, payday: 5, salary_mil: 1_800_000 }),
      }),
    );
    expect(mine.period.start).toBe('2026-08-25');
    expect(mine.pots.needs.spent).toBe(30_000);
    expect(partners.period.start).toBe('2026-09-05');
    expect(partners.pots.needs.spent).toBe(20_000);
    expect(partners.pots.needs.budget).toBe(900_000 + 1_000_000);
  });
});

describe('computeFacts — the opening balance (spec §4.6)', () => {
  /* joined on 2026-09-01; the September period is the one onboarding happened in */
  const joined = (opening_mil: number | null, p: Partial<FactsInput['profile']> = {}) =>
    profile({ opening_mil, ...p });

  it('runs the joining period on it, split between Besoins and Envies in the plan ratio', () => {
    const f = computeFacts(base({ profile: joined(800_000) }));
    expect(f.pots.needs.budget).toBe(500_000);
    expect(f.pots.wants.budget).toBe(300_000);
    expect(f.pots.savings.budget).toBe(400_000);
    expect(f.left).toBe(800_000);
  });

  it('is back to the salary from the next payday', () => {
    const f = computeFacts(base({ profile: joined(800_000), today: '2026-10-05' }));
    expect(f.left).toBe(1_600_000);
  });

  it('changes nothing while unanswered', () => {
    expect(computeFacts(base({ profile: joined(null) })).left).toBe(1_600_000);
  });

  it('puts it all in Besoins when Besoins and Envies are both 0 %', () => {
    const p = joined(500_000, { split_needs: 0, split_wants: 0, split_savings: 100 });
    const f = computeFacts(base({ profile: p }));
    expect(f.pots.needs.budget).toBe(500_000);
    expect(f.pots.wants.budget).toBe(0);
  });

  it('knows which period is the joining one', () => {
    expect(inOpeningPeriod(profile(), '2026-09-28')).toBe(true);
    expect(inOpeningPeriod(profile(), '2026-10-01')).toBe(false);
    expect(inOpeningPeriod(profile({ onboarded_at: null }), '2026-09-28')).toBe(false);
  });
});

describe('openingBudget', () => {
  it('makes Reste the balance typed, whatever was logged before', () => {
    const input = base({
      profile: profile(),
      expenses: [expense({ amount_mil: 100_000, pot: 'needs' })],
      incomes: [income({ amount_mil: 150_000, pot: 'wants', received_on: '2026-09-05' })],
    });
    const opening_mil = openingBudget(input, 700_000);
    expect(opening_mil).toBe(650_000);
    expect(computeFacts({ ...input, profile: profile({ opening_mil }) }).left).toBe(700_000);
  });

  it('still sets unpaid bills aside from the balance', () => {
    const input = base({ profile: profile(), bills: [bill()] });
    const f = computeFacts({ ...input, profile: profile({ opening_mil: openingBudget(input, 700_000) }) });
    expect(f.pots.needs.reserved).toBeGreaterThan(0);
    expect(f.left).toBe(700_000 - f.pots.needs.reserved);
  });

  it("ignores a partner's rows: they never left my account", () => {
    const input = base({
      profile: profile(),
      expenses: [expense({ user_id: uuidN(9), amount_mil: 300_000, pot: 'needs' })],
    });
    expect(openingBudget(input, 700_000)).toBe(700_000);
  });

  it('never goes below zero', () => {
    const input = base({ incomes: [income({ amount_mil: 900_000, received_on: '2026-09-05' })] });
    expect(openingBudget(input, 100_000)).toBe(0);
  });
});
