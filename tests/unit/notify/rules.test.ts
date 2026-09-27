import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../../src/shared/money';
import { evaluate, type Candidate, type Sent, type UserSnapshot } from '../../../src/shared/notify/rules';
import { templateFor } from '../../../src/shared/notify/writer';
import { dueDeposits, tunisInstant } from '../../../src/shared/payday';
import {
  bill,
  debt,
  expense,
  goal,
  HOUSEHOLD,
  move,
  PARTNER,
  payment,
  profile,
  reminder,
  USER,
} from '../fixtures';

/* Payday 1 → the period is 1–30 Sept 2026. 24 Sept is a Thursday, 27 Sept a Sunday. */
const at = (date: string, hh: number, mm = 0) => tunisInstant(date, hh, mm);
const recent = () => expense({ spent_on: '2026-09-23', created_at: '2026-09-23T10:00:00+01:00' });
const snap = (p: Partial<UserSnapshot> = {}): UserSnapshot => ({
  profile: profile({ onboarded_at: '2026-08-10T10:00:00+01:00' }), // 2 000 TND · 50/30/20
  expenses: [recent()],
  bills: [],
  billPayments: [],
  debts: [],
  savingsMoves: [],
  incomes: [],
  goals: [],
  reminders: [],
  ...p,
});
const run = (s: UserSnapshot, now: Date, sentToday: Sent[] = [], sent: string[] = []) =>
  evaluate(s, now, sentToday, new Set(sent));
const kinds = (cs: Candidate[]) => cs.map((c) => c.trigger).sort();
const keys = (cs: Candidate[]) => cs.map((c) => c.dedupeKey).sort();
const only = (trigger: string, cs: Candidate[]) => cs.filter((c) => c.trigger === trigger);
/** Envies (600 TND) at 90 % */
const wants90 = () =>
  expense({ amount_mil: 540_000, category: 'resto', pot: 'wants', spent_on: '2026-09-20' });
/** Envies over budget */
const wantsOver = () =>
  expense({ amount_mil: 610_000, category: 'resto', pot: 'wants', spent_on: '2026-09-20' });

describe('quiet hours (Review Focus 2)', () => {
  const s = snap({ expenses: [recent(), wants90()] });
  it('nothing from 21:00 to 07:59, something at 20:59 and 08:00', () => {
    expect(kinds(run(s, at('2026-09-24', 20, 59)))).toEqual(['pot_near']);
    expect(run(s, at('2026-09-24', 21, 0))).toEqual([]);
    expect(run(s, at('2026-09-25', 7, 59))).toEqual([]);
    expect(kinds(run(s, at('2026-09-25', 8, 0)))).toEqual(['pot_near']);
  });
  it('a reminder the user set for 22:30 still fires at 22:30', () => {
    const r = reminder({ text: 'Appeler maman', remind_at: at('2026-09-24', 22, 30).toISOString() });
    const cs = run(snap({ reminders: [r] }), at('2026-09-24', 22, 30));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({
      trigger: 'user_reminder',
      dedupeKey: `reminder:${r.id}`,
      action: null,
      facts: { texte: 'Appeler maman', heure: '22:30' },
    });
    expect(run(snap({ reminders: [r] }), at('2026-09-24', 22, 29))).toEqual([]);
  });
  it('a reminder more than a day old, done or deleted never fires', () => {
    const now = at('2026-09-24', 10);
    for (const r of [
      reminder({ remind_at: at('2026-09-23', 9, 59).toISOString() }),
      reminder({ remind_at: at('2026-09-24', 9).toISOString(), done_at: now.toISOString() }),
      reminder({ remind_at: at('2026-09-24', 9).toISOString(), deleted_at: now.toISOString() }),
    ])
      expect(run(snap({ reminders: [r] }), now)).toEqual([]);
  });
});

describe('bill due', () => {
  const b = bill({ day: 27, label: 'STEG', amount_mil: 120_000 });
  it('3 days before and on the day, from 08:00', () => {
    const s = snap({ bills: [b] });
    expect(run(s, at('2026-09-23', 12))).toEqual([]);
    expect(run(s, at('2026-09-24', 7, 59))).toEqual([]);
    const d3 = run(s, at('2026-09-24', 8));
    expect(keys(d3)).toEqual([`bill:${b.id}:2026-09-27:d3`]);
    expect(d3[0]).toMatchObject({
      trigger: 'bill_due',
      action: { kind: 'pay_bill', ref: b.id },
      facts: { facture: 'STEG', montant: '120', jours: '3' },
    });
    expect(keys(only('bill_due', run(s, at('2026-09-27', 8))))).toEqual([`bill:${b.id}:2026-09-27:d0`]);
  });
  it("is skipped once that period's payment exists and its expense is live", () => {
    const paidBy = expense({
      bill_id: b.id,
      category: 'factures',
      amount_mil: 120_000,
      spent_on: '2026-09-22',
    });
    const paid = snap({
      bills: [b],
      expenses: [recent(), paidBy],
      billPayments: [payment({ bill_id: b.id, period_start: '2026-09-01', expense_id: paidBy.id })],
    });
    expect(run(paid, at('2026-09-24', 8))).toEqual([]);
    const undone = { ...paidBy, deleted_at: '2026-09-23T10:00:00+01:00' };
    expect(run({ ...paid, expenses: [recent(), undone] }, at('2026-09-24', 8))).toHaveLength(1);
  });
  it('looks into the next period for a due date 3 days away, without a pay button (it would pay this period)', () => {
    const early = bill({ day: 2 });
    const next = only('bill_due', run(snap({ bills: [early] }), at('2026-09-29', 9)));
    expect(keys(next)).toEqual([`bill:${early.id}:2026-10-02:d3`]);
    expect(next[0].action).toBeNull();
    const thisPeriod = only('bill_due', run(snap({ bills: [early] }), at('2026-10-02', 9)));
    expect(thisPeriod[0].action).toEqual({ kind: 'pay_bill', ref: early.id });
  });
  it('an inactive bill never fires', () => {
    expect(run(snap({ bills: [{ ...b, active: false }] }), at('2026-09-24', 8))).toEqual([]);
  });
});

describe('daily cap (Review Focus 2)', () => {
  it('pot_over and quiet_week together → only pot_over', () => {
    const s = snap({ expenses: [expense({ created_at: '2026-09-20T10:00:00+01:00' }), wantsOver()] });
    expect(kinds(run(s, at('2026-09-24', 10)))).toEqual(['pot_over']);
  });
  it('the weekly recap is not capped: it still goes out on a Sunday that already had an alert', () => {
    const s = snap({ expenses: [recent(), wantsOver()] });
    expect(kinds(run(s, at('2026-09-27', 19)))).toEqual(['pot_over', 'weekly_recap']);
    const sentToday = [{ trigger: 'pot_near', dedupeKey: 'pot80:x' }];
    expect(kinds(run(s, at('2026-09-27', 19), sentToday))).toEqual(['weekly_recap']);
  });
  it('with one capped row already today, only bills and reminders pass', () => {
    const b = bill({ day: 27 });
    const r = reminder({ remind_at: at('2026-09-24', 9).toISOString() });
    const s = snap({ expenses: [recent(), wantsOver()], bills: [b], reminders: [r] });
    const sentToday = [{ trigger: 'pot_near', dedupeKey: 'pot80:x' }];
    expect(kinds(run(s, at('2026-09-24', 10), sentToday))).toEqual(['bill_due', 'user_reminder']);
    expect(kinds(run(s, at('2026-09-24', 10), [{ trigger: 'bill_due', dedupeKey: 'b' }]))).toEqual([
      'bill_due',
      'pot_over',
      'user_reminder',
    ]);
  });
  it('a key already sent is dropped, and the next capped candidate takes the day', () => {
    const d = debt({ direction: 'owed_to_me', created_at: '2026-09-01T10:00:00+01:00' });
    const s = snap({ expenses: [recent(), wantsOver()], debts: [d] });
    const now = at('2026-09-24', 10);
    const first = run(s, now);
    expect(kinds(first)).toEqual(['pot_over']);
    expect(kinds(run(s, now, [], keys(first)))).toEqual(['owed_to_me']);
  });
});

describe('pots', () => {
  it('a pot already over gets pot_over only; 80 % gets pot_near', () => {
    const over = run(snap({ expenses: [recent(), wantsOver()] }), at('2026-09-24', 10));
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      trigger: 'pot_over',
      dedupeKey: 'potover:2026-09-01:wants',
      action: { kind: 'open_pot', ref: 'wants' },
      facts: { pot: 'Envies', depasse: '10' },
    });
    const near = run(snap({ expenses: [recent(), wants90()] }), at('2026-09-24', 10));
    expect(near[0]).toMatchObject({
      dedupeKey: 'pot80:2026-09-01:wants',
      facts: { pourcent: '90', reste: '60', jours: '7' },
    });
  });
  it('a new period gives a new key', () => {
    const oct = expense({ amount_mil: 540_000, category: 'resto', pot: 'wants', spent_on: '2026-10-02' });
    const late = expense({ spent_on: '2026-10-02', created_at: '2026-10-02T10:00:00+01:00' });
    expect(keys(only('pot_near', run(snap({ expenses: [late, oct] }), at('2026-10-03', 10))))).toEqual([
      'pot80:2026-10-01:wants',
    ]);
  });
});

describe('category spike', () => {
  /** café at `median` mil in each of Jun, Jul, Aug, and `now` mil this period */
  const cafe = (median: number, now: number) => [
    recent(),
    ...(median > 0 ? ['2026-06-10', '2026-07-10', '2026-08-10'] : []).map((d) =>
      expense({ amount_mil: median, category: 'cafe', pot: 'wants', spent_on: d }),
    ),
    expense({ amount_mil: now, category: 'cafe', pot: 'wants', spent_on: '2026-09-20' }),
  ];
  const spike = (median: number, now: number) =>
    run(snap({ expenses: cafe(median, now) }), at('2026-09-24', 10)).filter(
      (c) => c.trigger === 'category_spike',
    );
  it('fires at exactly 1.3 × the 3-period median, from 50 TND', () => {
    const [c] = spike(50_000, 65_000);
    expect(c).toMatchObject({
      dedupeKey: 'spike:2026-W39',
      action: { kind: 'open_category', ref: 'cafe' },
      facts: { categorie: 'Café', montant: '65', habituel: '50' },
    });
    expect(spike(50_000, 64_999)).toEqual([]);
  });
  it('never under 50 TND, never on a median of 0', () => {
    expect(spike(10_000, 49_000)).toEqual([]);
    expect(spike(0, 90_000)).toEqual([]);
  });
});

describe('payday', () => {
  const g = goal({ name: 'Voyage' });
  it('on payday from 08:00, carrying the same deposit the device would write', () => {
    const s = snap({ goals: [g] });
    expect(run(s, at('2026-09-01', 7, 59))).toEqual([]);
    const now = at('2026-09-01', 8);
    const [c] = run(s, now);
    const [device] = dueDeposits({ profile: s.profile, goal: g, moves: [], now });
    expect(c).toMatchObject({ trigger: 'payday', dedupeKey: 'payday:2026-09-01', action: null });
    expect(c.paydayDeposit).toEqual(device);
    expect(c.facts).toMatchObject({
      salaire: formatMoney(2_000_000, { unit: false }),
      besoins: formatMoney(1_000_000, { unit: false }),
      envies: '600',
      epargne: '400',
      objectif: 'Voyage',
    });
  });
  it('no deposit without a goal', () => {
    const [c] = run(snap(), at('2026-09-01', 9));
    expect(c.trigger).toBe('payday');
    expect(c.paydayDeposit).toBeUndefined();
  });
  it('a payday missed by every run (an outage) still comes within 3 days, once', () => {
    expect(keys(only('payday', run(snap(), at('2026-09-03', 9))))).toEqual(['payday:2026-09-01']);
    expect(run(snap(), at('2026-09-02', 9), [], ['payday:2026-09-01'])).toEqual([]);
    expect(run(snap(), at('2026-09-04', 9))).toEqual([]);
  });
  it('payday "fin du mois" opens on the 30th in September', () => {
    const s = snap({ profile: profile({ payday: 0, onboarded_at: '2026-08-10T10:00:00+01:00' }) });
    expect(keys(run(s, at('2026-09-30', 8)))).toContain('payday:2026-09-30');
  });
  it('not in the period the user onboarded in', () => {
    const s = snap({ profile: profile({ onboarded_at: '2026-09-01T07:00:00+01:00' }) });
    expect(run(s, at('2026-09-01', 9))).toEqual([]);
  });
});

describe('owed to me', () => {
  const now = at('2026-09-24', 10);
  it('after 10 days, once a week per debt', () => {
    const d = debt({
      direction: 'owed_to_me',
      person: 'Ahmed',
      amount_mil: 40_000,
      created_at: at('2026-09-13', 9).toISOString(),
    });
    const [c] = run(snap({ debts: [d] }), now);
    expect(c).toMatchObject({
      trigger: 'owed_to_me',
      dedupeKey: `owed:${d.id}:2026-W39`,
      action: { kind: 'remind_debt', ref: d.id },
      facts: { personne: 'Ahmed', montant: '40', jours: '11' },
    });
  });
  it('not before 10 days, not settled, not deleted, not money I owe', () => {
    const old = at('2026-09-01', 9).toISOString();
    for (const d of [
      debt({ direction: 'owed_to_me', created_at: at('2026-09-15', 9).toISOString() }),
      debt({ direction: 'owed_to_me', created_at: old, settled_at: old }),
      debt({ direction: 'owed_to_me', created_at: old, deleted_at: old }),
      debt({ direction: 'i_owe', created_at: old }),
    ])
      expect(run(snap({ debts: [d] }), now)).toEqual([]);
  });
});

describe('savings opportunity, recap, quiet week', () => {
  it('savings: last 5 days, a goal, left ≥ 3 × pace', () => {
    const spent = expense({
      amount_mil: 260_000,
      spent_on: '2026-09-10',
      created_at: '2026-09-25T10:00:00+01:00',
    });
    const s = snap({ goals: [goal()], expenses: [spent] }); // pace 10 TND a day
    const [c] = run(s, at('2026-09-26', 10));
    expect(c).toMatchObject({
      trigger: 'savings_opportunity',
      dedupeKey: 'savings:2026-09-01',
      action: { kind: 'open_goal' },
    });
    expect(run(s, at('2026-09-25', 10))).toEqual([]); // 6 days left
  });
  it('weekly recap on Sunday from 19:00, skipped when the week is empty', () => {
    const e = expense({
      amount_mil: 175_000,
      category: 'resto',
      pot: 'wants',
      spent_on: '2026-09-26',
      created_at: '2026-09-26T10:00:00+01:00',
    });
    const s = snap({ expenses: [e] });
    expect(run(s, at('2026-09-27', 18, 59))).toEqual([]);
    const [c] = run(s, at('2026-09-27', 19));
    expect(c).toMatchObject({
      trigger: 'weekly_recap',
      dedupeKey: 'recap:2026-W39',
      action: { kind: 'open_history' },
      facts: { total: '175', top: 'Resto' },
    });
    const old = expense({ spent_on: '2026-09-19', created_at: '2026-09-26T10:00:00+01:00' });
    expect(run(snap({ expenses: [old] }), at('2026-09-27', 19))).toEqual([]);
  });
  it('quiet week: newest expense created more than 3 days ago', () => {
    const e = expense({ created_at: at('2026-09-21', 9).toISOString() });
    const [c] = run(snap({ expenses: [e] }), at('2026-09-24', 9, 1));
    expect(c).toMatchObject({
      trigger: 'quiet_week',
      dedupeKey: 'quiet:2026-W39',
      action: { kind: 'log_expense' },
    });
    expect(run(snap({ expenses: [e] }), at('2026-09-24', 8, 59))).toEqual([]);
  });
  it('quiet week waits for 3 days after onboarding', () => {
    const fresh = profile({ onboarded_at: at('2026-09-22', 9).toISOString() });
    expect(run(snap({ profile: fresh, expenses: [] }), at('2026-09-24', 10))).toEqual([]);
  });
  it('a user who has not finished onboarding gets nothing', () => {
    const s = snap({ profile: profile({ onboarded_at: null }), expenses: [], bills: [bill({ day: 27 })] });
    expect(run(s, at('2026-09-24', 10))).toEqual([]);
  });
});

describe('couple mode (plan D2, Task 7)', () => {
  const couple = { me: USER, partnerNeeds: 900_000 };
  const theirs = (p: Partial<Parameters<typeof expense>[0]> = {}) =>
    expense({ user_id: PARTNER, household_id: HOUSEHOLD, spent_on: '2026-09-20', ...p });

  it('the Besoins warning uses the household budget', () => {
    const s = snap({ expenses: [recent(), theirs({ amount_mil: 1_600_000 })] });
    expect(only('pot_over', run(s, at('2026-09-24', 10))).map((c) => c.dedupeKey)).toEqual([
      'potover:2026-09-01:needs',
    ]);
    const shared = run({ ...s, couple }, at('2026-09-24', 10));
    expect(only('pot_over', shared)).toEqual([]);
    expect(only('pot_near', shared)[0]).toMatchObject({ dedupeKey: 'pot80:2026-09-01:needs' });
  });

  it('my payday deposit goes to the shared goal, even when the partner has made theirs', () => {
    const shared = goal({ user_id: PARTNER, household_id: HOUSEHOLD, name: 'Maison' });
    const partnerPaid = move({
      user_id: PARTNER,
      goal_id: shared.id,
      kind: 'payday',
      from_pot: null,
      occurred_on: '2026-09-01',
    });
    const [c] = run(snap({ goals: [shared], savingsMoves: [partnerPaid], couple }), at('2026-09-01', 9));
    expect(c.paydayDeposit).toMatchObject({ user_id: USER, goal_id: shared.id, kind: 'payday' });
  });

  it('quiet week counts only what I logged', () => {
    const mine = expense({ created_at: at('2026-09-20', 9).toISOString() });
    const partners = theirs({ created_at: at('2026-09-23', 9).toISOString() });
    expect(kinds(run(snap({ expenses: [mine, partners], couple }), at('2026-09-24', 10)))).toContain(
      'quiet_week',
    );
  });
});

describe('the profile currency', () => {
  const payday = (currency: 'EUR' | 'TND', salary_mil = 2_000_000) =>
    only(
      'payday',
      run(
        snap({ profile: profile({ onboarded_at: '2026-08-10T10:00:00+01:00', currency, salary_mil }) }),
        at('2026-09-01', 8),
      ),
    )[0];

  it('a EUR profile reads "2 000 € : …" and carries its unit', () => {
    const c = payday('EUR');
    expect(c.facts.unit).toBe('€');
    expect(templateFor('payday', c.facts).body.replace(/\s/g, ' ')).toMatch(/^2 000 € : 1 000 en Besoins/);
  });

  it('a TND profile is unchanged', () => {
    expect(templateFor('payday', payday('TND').facts).body.replace(/\s/g, ' ')).toMatch(/^2 000 TND : /);
  });

  it('figures follow the currency decimals, not the server default', () => {
    expect(payday('EUR', 2_000_500).facts.salaire.replace(/\s/g, ' ')).toBe('2 000,50');
    expect(payday('TND', 2_000_500).facts.salaire.replace(/\s/g, ' ')).toBe('2 000,5');
  });
});
