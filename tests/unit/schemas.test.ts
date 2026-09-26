import { describe, expect, it } from 'vitest';
import {
  BillRow,
  DebtRow,
  ExpenseInsert,
  ExpenseRow,
  GoalRow,
  IncomeInsert,
  IncomeRow,
  CoupleState,
  NotificationAction,
  NotificationRow,
  PushSubscriptionInsert,
  ProfileInsert,
  ProfileRow,
  ReminderRow,
  SavingsMoveInsert,
  SavingsMoveRow,
} from '../../src/shared/schemas';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
/* exactly what PostgREST returns for a timestamptz */
const AT = '2026-09-23T10:00:00.123456+00:00';

const expense = {
  id: U2,
  user_id: U1,
  household_id: null,
  amount_mil: 12_000,
  category: 'cafe',
  pot: 'wants',
  label: 'Café',
  spent_on: '2026-09-22',
  source: 'chat',
  bill_id: null,
  created_at: AT,
  updated_at: AT,
  deleted_at: null,
};
const profile = {
  user_id: U1,
  first_name: 'Sofiene',
  salary_mil: 2_500_000,
  payday: 25,
  split_needs: 50,
  split_wants: 30,
  split_savings: 20,
  onboarded_at: AT,
  created_at: AT,
  updated_at: AT,
};
const move = {
  id: U2,
  user_id: U1,
  goal_id: U1,
  amount_mil: 100_000,
  kind: 'deposit',
  from_pot: 'wants',
  occurred_on: '2026-09-22',
  created_at: AT,
};

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

const income = {
  id: U2,
  user_id: U1,
  household_id: null,
  amount_mil: 150_000,
  pot: 'wants',
  label: 'Prime',
  received_on: '2026-09-22',
  created_at: AT,
  updated_at: AT,
  deleted_at: null,
};

describe('row schemas accept what the database returns', () => {
  it.each([
    ['expense', ExpenseRow, expense],
    ['profile', ProfileRow, profile],
    ['move', SavingsMoveRow, move],
    [
      'bill',
      BillRow,
      {
        id: U2,
        user_id: U1,
        household_id: null,
        label: 'STEG',
        amount_mil: 95_000,
        frequency: 'quarterly',
        day: 12,
        starts_on: '2026-08-01',
        active: true,
        created_at: AT,
        updated_at: AT,
      },
    ],
    [
      'debt',
      DebtRow,
      {
        id: U2,
        user_id: U1,
        direction: 'owed_to_me',
        person: 'Karim',
        amount_mil: 50_000,
        due_on: null,
        note: '',
        settled_at: null,
        deleted_at: null,
        created_at: AT,
        updated_at: AT,
      },
    ],
    [
      'goal',
      GoalRow,
      {
        id: U2,
        user_id: U1,
        household_id: null,
        name: 'Voyage',
        icon: 'plane',
        target_mil: 20_000_000,
        archived_at: null,
        created_at: AT,
        updated_at: AT,
      },
    ],
    [
      'reminder',
      ReminderRow,
      {
        id: U2,
        user_id: U1,
        text: 'Payer la STEG',
        remind_at: AT,
        done_at: null,
        deleted_at: null,
        created_at: AT,
        updated_at: AT,
      },
    ],
    ['income', IncomeRow, income],
  ])('%s', (_name, schema, value) => {
    expect(ok(schema, value)).toBe(true);
  });

  it('debts and reminders keep deleted_at (soft delete, Phase 3)', () => {
    const debt = { id: U2, user_id: U1, direction: 'i_owe', person: 'Sami', amount_mil: 1, due_on: null };
    const common = { created_at: AT, updated_at: AT, deleted_at: AT };
    expect(DebtRow.parse({ ...debt, note: '', settled_at: null, ...common }).deleted_at).toBe(AT);
    const reminder = { id: U2, user_id: U1, text: 'STEG', remind_at: AT, done_at: null, ...common };
    expect(ReminderRow.parse(reminder).deleted_at).toBe(AT);
  });
});

describe('the same limits as the database', () => {
  it.each([
    ['amount 0', { amount_mil: 0 }],
    ['amount above the cap', { amount_mil: 1_000_000_001 }],
    ['millimes as a float', { amount_mil: 12.5 }],
    ['label of 61 characters', { label: 'x'.repeat(61) }],
    ['unknown category', { category: 'abo' }],
    ['impossible date', { spent_on: '2026-02-30' }],
    ['not a uuid', { id: '11111111-1111-1111-1111-111111111111' }],
  ])('refuses an expense with %s', (_why, patch) => {
    expect(ok(ExpenseRow, { ...expense, ...patch })).toBe(false);
  });

  it('a label of exactly 60 characters is fine', () => {
    expect(ok(ExpenseRow, { ...expense, label: 'x'.repeat(60) })).toBe(true);
  });

  it('a split must add up to 100 and payday must be 0–28', () => {
    expect(ok(ProfileRow, { ...profile, split_savings: 30 })).toBe(false);
    expect(ok(ProfileRow, { ...profile, payday: 29 })).toBe(false);
    expect(ok(ProfileRow, { ...profile, payday: 0 })).toBe(true);
  });

  it('a pending plan is all or nothing, and its split adds up to 100', () => {
    const next = {
      next_salary_mil: 3_000_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-25',
    };
    const none = Object.fromEntries(Object.keys(next).map((k) => [k, null]));
    expect(ok(ProfileRow, { ...profile, ...none })).toBe(true);
    expect(ok(ProfileRow, { ...profile, ...next })).toBe(true);
    expect(ok(ProfileRow, { ...profile, ...none, next_salary_mil: 3_000_000 })).toBe(false);
    expect(ok(ProfileRow, { ...profile, ...next, next_split_savings: 19 })).toBe(false);
    expect(ok(ProfileInsert, { ...profile, ...next, next_split_savings: 19 })).toBe(false);
  });

  it('withdrawals are negative, deposits positive, never zero', () => {
    expect(ok(SavingsMoveRow, { ...move, kind: 'withdraw', amount_mil: 100_000 })).toBe(false);
    expect(ok(SavingsMoveRow, { ...move, kind: 'withdraw', amount_mil: -100_000 })).toBe(true);
    expect(ok(SavingsMoveRow, { ...move, amount_mil: -1 })).toBe(false);
    expect(ok(SavingsMoveRow, { ...move, amount_mil: 0 })).toBe(false);
    /* the insert schema keeps the sign rule (created_at is simply stripped) */
    expect(ok(SavingsMoveInsert, { ...move, kind: 'withdraw', amount_mil: 5 })).toBe(false);
  });

  it.each([
    ['amount 0', { amount_mil: 0 }],
    ['amount above the cap', { amount_mil: 1_000_000_001 }],
    ['the savings pot', { pot: 'savings' }],
    ['an unknown pot', { pot: 'fun' }],
    ['label of 61 characters', { label: 'x'.repeat(61) }],
  ])('refuses an income with %s', (_why, patch) => {
    expect(ok(IncomeRow, { ...income, ...patch })).toBe(false);
    expect(ok(IncomeInsert, { ...income, ...patch })).toBe(false);
  });

  it('insert schemas leave server-owned columns out', () => {
    const parsed = ExpenseInsert.parse(expense);
    expect(parsed).not.toHaveProperty('created_at');
    expect(parsed).not.toHaveProperty('deleted_at');
    expect(IncomeInsert.parse(income)).not.toHaveProperty('updated_at');
  });
});

describe('notifications (Phase 4)', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000011',
    user_id: '00000000-0000-4000-8000-000000000001',
    trigger: 'pot_near',
    dedupe_key: 'pot80:2026-09-25:wants',
    title: 'Envies à 80 %',
    body: 'Il te reste 60 TND.',
    action: { kind: 'open_pot', ref: 'wants' },
    created_at: '2026-09-26T08:00:00+01:00',
    read_at: null,
  };
  it('accepts a row and every action kind', () => {
    expect(NotificationRow.parse(row).action).toEqual({ kind: 'open_pot', ref: 'wants' });
    for (const a of [
      { kind: 'pay_bill', ref: row.id },
      { kind: 'open_goal' },
      { kind: 'open_history' },
      { kind: 'open_category', ref: 'cafe' },
      { kind: 'remind_debt', ref: row.id },
      { kind: 'settle_debt', ref: row.id },
      { kind: 'log_expense' },
    ])
      expect(NotificationAction.safeParse(a).success).toBe(true);
    expect(NotificationRow.parse({ ...row, action: null }).action).toBeNull();
  });
  it('rejects unknown kinds, a savings pot, bad refs and bad triggers', () => {
    expect(NotificationAction.safeParse({ kind: 'explode' }).success).toBe(false);
    expect(NotificationAction.safeParse({ kind: 'open_pot', ref: 'savings' }).success).toBe(false);
    expect(NotificationAction.safeParse({ kind: 'pay_bill', ref: 'nope' }).success).toBe(false);
    expect(NotificationAction.safeParse({ kind: 'open_category', ref: 'caviar' }).success).toBe(false);
    expect(NotificationRow.safeParse({ ...row, trigger: 'pot_80' }).success).toBe(false);
    expect(NotificationRow.safeParse({ ...row, title: 'x'.repeat(81) }).success).toBe(false);
    expect(NotificationRow.safeParse({ ...row, body: 'x'.repeat(301) }).success).toBe(false);
  });
  it('push subscriptions are https only', () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' };
    expect(PushSubscriptionInsert.safeParse(sub).success).toBe(true);
    expect(PushSubscriptionInsert.safeParse({ ...sub, endpoint: 'http://x' }).success).toBe(false);
  });
});

describe('couple mode (Phase 6)', () => {
  it('goals and incomes carry household_id', () => {
    expect(IncomeRow.parse({ ...income, pot: 'needs', household_id: U2 }).household_id).toBe(U2);
    expect(ok(IncomeRow, { ...income, household_id: 'nope' })).toBe(false);
    expect(ok(IncomeRow, { ...income, household_id: undefined })).toBe(false);
  });

  it('parses the three couple_state answers', () => {
    const solo = { household_id: null, status: 'solo', invite: null, partner: null };
    expect(CoupleState.parse(solo)).toEqual(solo);
    expect(
      CoupleState.parse({
        household_id: U2,
        status: 'pending',
        invite: { code: 'STC-AB23CD', expires_at: AT },
        partner: null,
      }).invite?.code,
    ).toBe('STC-AB23CD');
    const on = CoupleState.parse({
      household_id: U2,
      status: 'on',
      invite: null,
      partner: { user_id: U1, first_name: 'Amira', needs_mil: 1_000_000 },
    });
    expect(on.partner).toEqual({ user_id: U1, first_name: 'Amira', needs_mil: 1_000_000 });
  });

  it('rejects a malformed couple_state', () => {
    const on = { household_id: U2, status: 'on', invite: null };
    const partner = { user_id: U1, first_name: 'Amira', needs_mil: 1_000_000 };
    expect(ok(CoupleState, { ...on, status: 'maybe', partner })).toBe(false);
    expect(ok(CoupleState, { ...on, partner: { ...partner, needs_mil: -1 } })).toBe(false);
    expect(ok(CoupleState, { ...on, partner: { ...partner, needs_mil: 1.5 } })).toBe(false);
    expect(ok(CoupleState, { ...on, partner: null })).toBe(false);
    expect(
      ok(CoupleState, {
        ...on,
        status: 'pending',
        partner: null,
        invite: { code: 'AB23CD', expires_at: AT },
      }),
    ).toBe(false);
  });

  const request = {
    kind: 'partner_request',
    ref: U2,
    from: U1,
    change: { kind: 'edit', fields: { amount_mil: 45_000, label: 'Carrefour' } },
  };
  it('parses a partner request, edit or delete', () => {
    expect(NotificationAction.parse(request)).toEqual(request);
    expect(ok(NotificationAction, { ...request, change: { kind: 'delete' } })).toBe(true);
    expect(ok(NotificationAction, { ...request, change: { kind: 'edit', fields: { pot: 'wants' } } })).toBe(
      true,
    );
  });

  it('rejects a malformed partner request', () => {
    for (const change of [
      { kind: 'drop' },
      { kind: 'edit' },
      { kind: 'edit', fields: {} },
      { kind: 'edit', fields: { user_id: U1 } },
      { kind: 'edit', fields: { amount_mil: 0 } },
      { kind: 'edit', fields: { category: 'caviar' } },
      { kind: 'edit', fields: { spent_on: '2026-02-30' } },
    ])
      expect(ok(NotificationAction, { ...request, change }), JSON.stringify(change)).toBe(false);
    expect(ok(NotificationAction, { ...request, ref: 'nope' })).toBe(false);
    expect(ok(NotificationAction, { ...request, from: undefined })).toBe(false);
  });

  it('a partner request row has no text of its own', () => {
    const row = {
      id: U2,
      user_id: U1,
      trigger: 'partner_request',
      dedupe_key: `partner:${U2}:edit:2026-09-25`,
      title: '',
      body: '',
      action: request,
      created_at: AT,
      read_at: null,
    };
    expect(ok(NotificationRow, row)).toBe(true);
  });
});
