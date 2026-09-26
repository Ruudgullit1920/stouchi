import { describe, expect, it } from 'vitest';
import { billDueDates, billStatus, billsDueTotal, billsMeter } from '../../src/shared/bills';
import { payPeriod } from '../../src/shared/dates';
import { bill, expense, payment } from './fixtures';

const sept = payPeriod('2026-09-10', 1); // 2026-09-01 → 2026-09-30
const from25 = payPeriod('2026-09-26', 25); // 2026-09-25 → 2026-10-24

describe('billDueDates', () => {
  it('puts a monthly bill on its day', () => {
    expect(billDueDates(bill({ day: 15 }), sept)).toEqual(['2026-09-15']);
  });

  it('finds the due date in whichever month of a straddling period it falls', () => {
    expect(billDueDates(bill({ day: 5 }), from25)).toEqual(['2026-10-05']);
    expect(billDueDates(bill({ day: 28 }), from25)).toEqual(['2026-09-28']);
  });

  it('clamps day 31 to the end of a short month', () => {
    expect(billDueDates(bill({ day: 31 }), payPeriod('2026-02-10', 1))).toEqual(['2026-02-28']);
    expect(billDueDates(bill({ day: 31 }), payPeriod('2028-02-10', 1))).toEqual(['2028-02-29']);
  });

  it('yields nothing for an inactive bill', () => {
    expect(billDueDates(bill({ active: false }), sept)).toEqual([]);
  });

  it('yields nothing before starts_on, and starts at the first due day on or after it', () => {
    expect(billDueDates(bill({ starts_on: '2026-10-01' }), sept)).toEqual([]);
    expect(billDueDates(bill({ day: 5, starts_on: '2026-09-20' }), sept)).toEqual([]);
    expect(billDueDates(bill({ day: 25, starts_on: '2026-09-20' }), sept)).toEqual(['2026-09-25']);
  });

  it('steps bimonthly, quarterly and yearly bills from their anchor, across a year boundary', () => {
    const q = bill({ frequency: 'quarterly', day: 10, starts_on: '2026-11-01' });
    const hits = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
      .map((m) => billDueDates(q, payPeriod(`${m}-15`, 1)))
      .map((d) => d.join());
    expect(hits).toEqual(['2026-11-10', '', '', '2027-02-10', '']);

    const b = bill({ frequency: 'bimonthly', day: 1, starts_on: '2026-12-01' });
    expect(billDueDates(b, payPeriod('2027-01-15', 1))).toEqual([]);
    expect(billDueDates(b, payPeriod('2027-02-15', 1))).toEqual(['2027-02-01']);

    const y = bill({ frequency: 'yearly', day: 3, starts_on: '2026-03-01' });
    expect(billDueDates(y, payPeriod('2027-03-15', 1))).toEqual(['2027-03-03']);
    expect(billDueDates(y, payPeriod('2027-04-15', 1))).toEqual([]);
  });
});

describe('billsDueTotal', () => {
  const sept = payPeriod('2026-09-10', 1);
  it('sums what active bills fall due in the period', () => {
    const total = billsDueTotal(
      [
        bill({ amount_mil: 80_000 }),
        bill({ amount_mil: 20_000, active: false }),
        bill({ amount_mil: 300_000, frequency: 'yearly', starts_on: '2026-03-01', day: 1 }),
      ],
      sept,
    );
    expect(total).toBe(80_000);
  });
  it('is 0 with no bills', () => expect(billsDueTotal([], sept)).toBe(0));
});

describe('billsMeter', () => {
  it('is ok up to 80 %, warn above, over above 100 %', () => {
    expect(billsMeter(800_000, 1_000_000)).toEqual({ pct: 80, level: 'ok' });
    expect(billsMeter(810_000, 1_000_000)).toEqual({ pct: 81, level: 'warn' });
    expect(billsMeter(1_000_000, 1_000_000)).toEqual({ pct: 100, level: 'warn' });
    expect(billsMeter(1_100_000, 1_000_000)).toEqual({ pct: 110, level: 'over' });
  });
  it('is over when there are bills and no Besoins, ok when neither', () => {
    expect(billsMeter(10_000, 0)).toEqual({ pct: 100, level: 'over' });
    expect(billsMeter(0, 0)).toEqual({ pct: 0, level: 'ok' });
  });
});

describe('billStatus', () => {
  const sept = payPeriod('2026-09-10', 1);
  const b = bill({ day: 15 });
  it('is paid when the period has a payment with a live expense', () => {
    const e = expense({ bill_id: b.id });
    const pay = payment({ bill_id: b.id, expense_id: e.id });
    expect(billStatus(b, [pay], [e], sept, '2026-09-10')).toEqual({ kind: 'paid' });
    const gone = { ...e, deleted_at: '2026-09-12T10:00:00+01:00' };
    expect(billStatus(b, [pay], [gone], sept, '2026-09-10')).toEqual({
      kind: 'due',
      due: '2026-09-15',
      days: 5,
    });
  });
  it('gives the next due date in the period and the days to it (negative when late)', () => {
    expect(billStatus(b, [], [], sept, '2026-09-15')).toEqual({ kind: 'due', due: '2026-09-15', days: 0 });
    expect(billStatus(b, [], [], sept, '2026-09-20')).toEqual({ kind: 'due', due: '2026-09-15', days: -5 });
  });
  it('is none when the bill does not fall due this period', () => {
    const q = bill({ frequency: 'quarterly', starts_on: '2026-08-01', day: 1 });
    expect(billStatus(q, [], [], sept, '2026-09-10')).toEqual({ kind: 'none' });
  });
});
