/* The eval's user, as database rows: the prototype's September (spec §4), plus
 * June–August so the trends have history. src/shared/carnet.ts turns these
 * into the carnet the model reads, exactly as /api/aam does for a real user.
 *
 * Fixed uuids give fixed short ids: expense n → "e00nn", STEG → "ba200",
 * Ahmed's debt → "dd100", the reminder → "rc100".
 *
 * `household` (plan Task 8): the same user sharing a household with Amira, who
 * logged "Aziza" (courses, 45 TND) yesterday → "e0099", qui = "Amira". */
'use strict';

const USER = '00000000-0000-4000-8000-00000000000a';
const PARTNER = '00000000-0000-4000-8000-00000000000b';
const HOME = '00000000-0000-4000-8000-0000000000aa';
const uuid = (hex8) => `${hex8}-0000-4000-8000-000000000000`;
const at = (date, time = '12:00') => `${date}T${time}:00+01:00`;

const expense = (n, date, label, category, pot, tnd) => ({
  id: uuid(`00${String(n).padStart(2, '0')}0000`),
  user_id: USER,
  household_id: null,
  amount_mil: tnd * 1000,
  category,
  pot,
  label,
  spent_on: date,
  source: 'manual',
  bill_id: null,
  created_at: at(date),
  updated_at: at(date),
  deleted_at: null
});

const EXPENSES = [
  /* June: 1 203 */
  expense(1, '2026-06-01', 'Loyer', 'loyer', 'needs', 400),
  expense(2, '2026-06-07', 'Carrefour', 'courses', 'needs', 403),
  expense(3, '2026-06-15', 'Concert', 'sortie', 'wants', 200),
  expense(4, '2026-06-21', 'Mango', 'shopping', 'wants', 200),
  /* July: 1 118 */
  expense(5, '2026-07-01', 'Loyer', 'loyer', 'needs', 400),
  expense(6, '2026-07-06', 'Monoprix', 'courses', 'needs', 400),
  expense(7, '2026-07-14', 'Resto Sidi Bou', 'resto', 'wants', 118),
  expense(8, '2026-07-20', 'Zara', 'shopping', 'wants', 200),
  /* August: 1 261 */
  expense(10, '2026-08-01', 'Loyer', 'loyer', 'needs', 400),
  expense(11, '2026-08-05', 'Carrefour', 'courses', 'needs', 310),
  expense(12, '2026-08-12', 'Resto La Marsa', 'resto', 'wants', 120),
  expense(13, '2026-08-20', 'Soldes', 'shopping', 'wants', 231),
  expense(14, '2026-08-25', 'Station Shell', 'essence', 'needs', 80),
  expense(15, '2026-08-28', 'Plage', 'sortie', 'wants', 120),
  /* September (spec §4): Besoins 590, Envies 370 */
  expense(21, '2026-09-01', 'Loyer', 'loyer', 'needs', 400),
  expense(22, '2026-09-03', 'Netflix', 'abonnement', 'wants', 33),
  expense(23, '2026-09-06', 'Carrefour', 'courses', 'needs', 62),
  expense(24, '2026-09-08', 'Zara', 'shopping', 'wants', 140),
  expense(25, '2026-09-09', 'Station Shell', 'essence', 'needs', 40),
  expense(26, '2026-09-13', 'Cinéma', 'sortie', 'wants', 60),
  expense(27, '2026-09-14', 'Marché central', 'courses', 'needs', 50),
  expense(28, '2026-09-16', 'Resto La Marsa', 'resto', 'wants', 85),
  expense(29, '2026-09-18', 'Café', 'cafe', 'wants', 12),
  expense(30, '2026-09-19', 'Monoprix', 'courses', 'needs', 38),
  expense(31, '2026-09-20', 'Plan B', 'resto', 'wants', 32),
  expense(32, '2026-09-21', 'Café', 'cafe', 'wants', 8)
];

const bill = (hex8, label, tnd, frequency, day, startsOn) => ({
  id: uuid(hex8),
  user_id: USER,
  household_id: null,
  label,
  amount_mil: tnd * 1000,
  frequency,
  day,
  starts_on: startsOn,
  active: true,
  created_at: at('2026-06-01'),
  updated_at: at('2026-06-01')
});
const BILLS = [
  bill('a1000000', 'Loyer', 400, 'monthly', 1, '2026-06-01'),
  bill('a2000000', 'STEG', 120, 'bimonthly', 25, '2026-07-01'),
  bill('a3000000', 'Ooredoo Internet', 45, 'monthly', 28, '2026-06-01')
];

const GOAL = {
  id: uuid('f1000000'),
  user_id: USER,
  household_id: null,
  name: 'Ma maison',
  icon: 'house',
  target_mil: 20000000,
  archived_at: null,
  created_at: at('2025-06-01'),
  updated_at: at('2025-06-01')
};
const move = (hex8, date, tnd) => ({
  id: uuid(hex8),
  user_id: USER,
  goal_id: GOAL.id,
  amount_mil: tnd * 1000,
  kind: 'payday',
  from_pot: null,
  occurred_on: date,
  created_at: at(date, '08:00')
});

module.exports = {
  /* Tuesday 22 September 2026, 14:05 in Tunis */
  now: '2026-09-22T14:05:00+01:00',
  profile: {
    user_id: USER,
    first_name: 'Sofiene',
    salary_mil: 2000000,
    payday: 1,
    split_needs: 50,
    split_wants: 30,
    split_savings: 20,
    onboarded_at: at('2025-06-01'),
    created_at: at('2025-06-01'),
    updated_at: at('2025-06-01')
  },
  expenses: EXPENSES,
  bills: BILLS,
  /* Loyer is paid for September (by the Loyer expense); STEG and Ooredoo are to come */
  billPayments: [{ bill_id: BILLS[0].id, period_start: '2026-09-01', expense_id: EXPENSES[14].id, created_at: at('2026-09-01') }],
  debts: [{
    id: uuid('d1000000'),
    user_id: USER,
    direction: 'owed_to_me',
    person: 'Ahmed',
    amount_mil: 40000,
    due_on: null,
    note: '',
    settled_at: null,
    created_at: at('2026-09-10'),
    updated_at: at('2026-09-10'),
    deleted_at: null
  }],
  goals: [GOAL],
  /* 4 400 saved before September, 400 on this payday: 4 800 */
  savingsMoves: [move('5a000000', '2026-08-01', 4400), move('5b000000', '2026-09-01', 400)],
  reminders: [{
    id: uuid('c1000000'),
    user_id: USER,
    text: 'Rappeler Ahmed pour les 40 TND',
    remind_at: '2026-09-27T09:00:00+01:00',
    done_at: null,
    created_at: at('2026-09-15'),
    updated_at: at('2026-09-15'),
    deleted_at: null
  }],
  incomes: [],
  /* the café logged by chat five minutes ago (case 6, "annule") */
  lastAction: { type: 'add_expense', ref: EXPENSES[25].id, at: '2026-09-22T14:00:00+01:00', summary: 'Café, 8 TND, hier' },
  nudgeSeen: [],
  household: {
    partner: { user_id: PARTNER, first_name: 'Amira' },
    /* Amira's Besoins budget at Sofiene's period start */
    partnerNeeds: 900000,
    expenses: [Object.assign(expense(99, '2026-09-21', 'Aziza', 'courses', 'needs', 45), {
      user_id: PARTNER,
      household_id: HOME
    })]
  }
};
