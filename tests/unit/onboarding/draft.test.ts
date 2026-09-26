import { describe, expect, it } from 'vitest';
import {
  BILL_PRESETS,
  clearDraft,
  goalTarget,
  loadDraft,
  markWritten,
  meter,
  newDraft,
  openingDeposit,
  rowsForStep,
  saveDraft,
  stepValid,
  type Draft,
} from '../../../src/features/onboarding/draft';
import { USER } from '../fixtures';

const TODAY = '2026-09-24';
let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const answered = (over: Partial<Draft> = {}): Draft => ({
  ...newDraft(USER, {}, ids),
  name: 'Amel',
  salary_mil: 2_000_000,
  payday: 25,
  ...over,
});
const withBill = (d: Draft, key: string, amount_mil: number, on = true): Draft => ({
  ...d,
  bills: d.bills.map((b) => (b.key === key ? { ...b, on, amount_mil } : b)),
});

describe('newDraft', () => {
  it('starts at the first step with every bill off and ids made once', () => {
    const d = newDraft(USER, { name: 'Sofiene' }, ids);
    expect(d.step).toBe(0);
    expect(d.name).toBe('Sofiene');
    expect(d.bills).toHaveLength(BILL_PRESETS.length);
    expect(d.bills.every((b) => !b.on && !b.written)).toBe(true);
    const all = [...d.bills.map((b) => b.id), d.goalId, d.depositId];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('draft storage', () => {
  it('survives a reload for the same user only', () => {
    const s = memory();
    const d = answered({ step: 3 });
    saveDraft(d, s);
    expect(loadDraft(USER, s)).toEqual(d);
    expect(loadDraft('00000000-0000-4000-8000-0000000000b2', s)).toBeNull();
    clearDraft(USER, s);
    expect(loadDraft(USER, s)).toBeNull();
  });
  it('ignores a corrupt or blocked store', () => {
    const s = memory();
    s.setItem(`stouchi.setup.${USER}`, '{nope');
    expect(loadDraft(USER, s)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDraft(USER, blocked)).toBeNull();
    expect(() => saveDraft(answered(), blocked)).not.toThrow();
    expect(() => clearDraft(USER, blocked)).not.toThrow();
  });
});

describe('stepValid', () => {
  it('checks each answer', () => {
    const d = answered();
    expect(stepValid({ ...d, name: '   ' }, 'name')).toBe(false);
    expect(stepValid(d, 'name')).toBe(true);
    expect(stepValid({ ...d, salary_mil: 99_999 }, 'salary')).toBe(false);
    expect(stepValid({ ...d, salary_mil: 100_000 }, 'salary')).toBe(true);
    expect(stepValid({ ...d, payday: null }, 'payday')).toBe(false);
    expect(stepValid({ ...d, payday: 0 }, 'payday')).toBe(true);
    expect(stepValid(d, 'bills')).toBe(true);
    expect(stepValid(withBill(d, 'loyer', 0), 'bills')).toBe(false);
    expect(stepValid(d, 'goal')).toBe(false);
    expect(stepValid({ ...d, goal: { key: 'maison', target_mil: 0, saved_mil: 0 } }, 'goal')).toBe(false);
    expect(stepValid({ ...d, goal: { key: 'maison', target_mil: 1_000, saved_mil: 0 } }, 'goal')).toBe(true);
  });
});

describe('meter (reserved in Besoins)', () => {
  it('turns amber above 80 % and explains itself above 100 %', () => {
    const d = answered();
    expect(meter(withBill(d, 'loyer', 800_000))).toMatchObject({ need: 1_000_000, pct: 80, level: 'ok' });
    expect(meter(withBill(d, 'loyer', 810_000))).toMatchObject({ pct: 81, level: 'warn' });
    expect(meter(withBill(d, 'loyer', 1_000_000))).toMatchObject({ pct: 100, level: 'warn' });
    expect(meter(withBill(d, 'loyer', 1_010_000))).toMatchObject({
      pct: 101,
      level: 'over',
      used: 1_010_000,
    });
    expect(meter(withBill(d, 'loyer', 900_000, false))).toMatchObject({ used: 0, level: 'ok' });
  });
});

describe('goalTarget', () => {
  it('prefills Sécurité with three salaries and the others with their preset', () => {
    expect(goalTarget('secu', 2_000_000)).toBe(6_000_000);
    expect(goalTarget('maison', 2_000_000)).toBe(20_000_000);
  });
});

describe('rowsForStep', () => {
  it('writes the profile, not yet onboarded, on the first three steps', () => {
    const [{ table, row }] = rowsForStep(answered({ name: ' Amel ' }), 'salary', TODAY);
    expect(table).toBe('profiles');
    expect(row).toEqual({
      user_id: USER,
      first_name: 'Amel',
      salary_mil: 2_000_000,
      payday: 25,
      split_needs: 50,
      split_wants: 30,
      split_savings: 20,
      onboarded_at: null,
    });
    expect(rowsForStep(answered({ payday: null }), 'name', TODAY)[0].row.payday).toBe(1);
  });

  it('writes no bill when none is chosen', () => {
    expect(rowsForStep(answered(), 'bills', TODAY)).toEqual([]);
  });

  it('writes chosen bills as monthly, due on payday (31 when payday is the last day)', () => {
    const d = withBill(answered(), 'loyer', 400_000);
    const [{ table, row }] = rowsForStep(d, 'bills', TODAY);
    expect(table).toBe('bills');
    expect(row).toMatchObject({
      id: d.bills[0].id,
      user_id: USER,
      household_id: null,
      label: 'Loyer',
      amount_mil: 400_000,
      frequency: 'monthly',
      day: 25,
      starts_on: TODAY,
      active: true,
    });
    expect(rowsForStep({ ...d, payday: 0 }, 'bills', TODAY)[0].row.day).toBe(31);
  });

  it('keeps the same ids when a step is repeated, and turns an unticked bill off', () => {
    let d = withBill(answered(), 'loyer', 400_000);
    const first = rowsForStep(d, 'bills', TODAY);
    d = markWritten(d);
    d = withBill(d, 'loyer', 400_000, false);
    const again = rowsForStep(d, 'bills', TODAY);
    expect(again.map((r) => r.row.id)).toEqual(first.map((r) => r.row.id));
    expect(again[0].row).toMatchObject({ active: false, amount_mil: 400_000 });
  });

  it('writes the goal with its stable id', () => {
    const d = answered({ goal: { key: 'voyage', target_mil: 3_000_000, saved_mil: 500_000 } });
    expect(rowsForStep(d, 'goal', TODAY)).toEqual([
      {
        table: 'goals',
        row: {
          id: d.goalId,
          user_id: USER,
          household_id: null,
          name: 'Mon voyage',
          icon: 'plane',
          target_mil: 3_000_000,
          archived_at: null,
        },
      },
    ]);
  });
});

describe('openingDeposit', () => {
  it('records "déjà épargné" once, with the draft’s id', () => {
    const d = answered({ goal: { key: 'voyage', target_mil: 3_000_000, saved_mil: 500_000 } });
    expect(openingDeposit(d, TODAY)).toEqual({
      id: d.depositId,
      user_id: USER,
      goal_id: d.goalId,
      amount_mil: 500_000,
      kind: 'deposit',
      from_pot: null,
      occurred_on: TODAY,
    });
    expect(openingDeposit({ ...d, goal: { ...d.goal!, saved_mil: 0 } }, TODAY)).toBeNull();
  });
});
