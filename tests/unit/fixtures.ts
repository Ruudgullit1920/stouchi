/* Row builders for the shared-module tests: valid by default, override what the test is about. */
import type {
  Bill,
  Debt,
  Expense,
  Goal,
  Income,
  Notification,
  Profile,
  Reminder,
  SavingsMove,
} from '../../src/shared/schemas';
import type { BillPayment, CoupleStateT } from '../../src/shared/schemas';

export const USER = '00000000-0000-4000-8000-000000000001';
const STAMP = '2026-09-01T10:00:00+01:00';
let seq = 0;
export const uuidN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextId = () => uuidN(1000 + ++seq);

export const profile = (p: Partial<Profile> = {}): Profile => ({
  user_id: USER,
  first_name: 'Sofiene',
  salary_mil: 2_000_000,
  payday: 1,
  split_needs: 50,
  split_wants: 30,
  split_savings: 20,
  onboarded_at: STAMP,
  currency: 'TND',
  created_at: STAMP,
  updated_at: STAMP,
  ...p,
});

export const expense = (e: Partial<Expense> = {}): Expense => ({
  id: nextId(),
  user_id: USER,
  household_id: null,
  amount_mil: 10_000,
  category: 'courses',
  pot: 'needs',
  label: '',
  spent_on: '2026-09-10',
  source: 'manual',
  bill_id: null,
  created_at: STAMP,
  updated_at: STAMP,
  deleted_at: null,
  ...e,
});

export const bill = (b: Partial<Bill> = {}): Bill => ({
  id: nextId(),
  user_id: USER,
  household_id: null,
  label: 'STEG',
  amount_mil: 80_000,
  frequency: 'monthly',
  day: 15,
  starts_on: '2026-01-01',
  active: true,
  created_at: STAMP,
  updated_at: STAMP,
  ...b,
});

export const payment = (p: Partial<BillPayment> & Pick<BillPayment, 'bill_id'>): BillPayment => ({
  period_start: '2026-09-01',
  expense_id: null,
  created_at: STAMP,
  ...p,
});

export const debt = (d: Partial<Debt> = {}): Debt => ({
  id: nextId(),
  user_id: USER,
  direction: 'i_owe',
  person: 'Karim',
  amount_mil: 50_000,
  due_on: '2026-09-20',
  note: '',
  settled_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  deleted_at: null,
  ...d,
});

export const move = (m: Partial<SavingsMove> = {}): SavingsMove => ({
  id: nextId(),
  user_id: USER,
  goal_id: uuidN(999),
  amount_mil: 100_000,
  kind: 'deposit',
  from_pot: 'wants',
  occurred_on: '2026-09-10',
  created_at: STAMP,
  ...m,
});

export const income = (i: Partial<Income> = {}): Income => ({
  id: nextId(),
  user_id: USER,
  household_id: null,
  amount_mil: 150_000,
  pot: 'wants',
  label: 'Prime',
  received_on: '2026-09-10',
  created_at: STAMP,
  updated_at: STAMP,
  deleted_at: null,
  ...i,
});

export const reminder = (r: Partial<Reminder> = {}): Reminder => ({
  id: nextId(),
  user_id: USER,
  text: 'Payer la STEG',
  remind_at: '2026-09-24T08:00:00+01:00',
  done_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  deleted_at: null,
  ...r,
});

export const goal = (g: Partial<Goal> = {}): Goal => ({
  id: nextId(),
  user_id: USER,
  household_id: null,
  name: 'Sécurité',
  icon: 'shield',
  target_mil: 6_000_000,
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  ...g,
});

export const notification = (x: Partial<Notification> = {}): Notification => ({
  id: nextId(),
  user_id: USER,
  trigger: 'pot_over',
  dedupe_key: `potover:2026-09-01:wants:${seq}`,
  title: 'Envies dépassées',
  body: 'Tu as dépassé les Envies de 15 TND.',
  action: { kind: 'open_pot', ref: 'wants' },
  created_at: '2026-09-20T09:00:00+01:00',
  read_at: null,
  ...x,
});

/* couple mode (Phase 6): the states `couple_state` answers */
export const PARTNER = '00000000-0000-4000-8000-000000000002';
export const HOUSEHOLD = '00000000-0000-4000-8000-000000000099';
export const SOLO: CoupleStateT = { household_id: null, status: 'solo', invite: null, partner: null };
export const couplePending = (
  invite: { code: string; expires_at: string } | null = {
    code: 'STC-ABC234',
    expires_at: '2026-09-22T09:00:00+01:00',
  },
): CoupleStateT => ({ household_id: HOUSEHOLD, status: 'pending', invite, partner: null });
export const coupleOn = (first_name = 'Amira', needs_mil = 900_000): CoupleStateT => ({
  household_id: HOUSEHOLD,
  status: 'on',
  invite: null,
  partner: { user_id: PARTNER, first_name, needs_mil },
});
