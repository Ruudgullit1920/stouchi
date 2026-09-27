/* zod schemas for the spec §7 tables — one source of truth for the client, the
 * server and the backfill. Limits mirror the SQL checks in
 * supabase/migrations/20260923_redesign_schema.sql, 20260925_phase3_incomes_soft_delete.sql and
 * 20260926_phase4_notify.sql and 20261002_currency.sql;
 * the db tests pin both.
 *
 * Refinements sit on top of plain objects: zod 4 refuses .omit() on a refined object. */
import { z } from 'zod';
import { CATEGORY_KEYS } from './categories';
import { CURRENCY_CODES } from './currencies';
import { MAX_MIL, isValidSplit } from './money';

const uuid = z.uuid();
const mil = z.int().min(0).max(MAX_MIL);
const positiveMil = z.int().min(1).max(MAX_MIL);
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const pot = z.enum(['needs', 'wants']);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/* ── profiles ── */
const ProfileBase = z.object({
  user_id: uuid,
  first_name: text(0, 40),
  salary_mil: mil,
  payday: z.int().min(0).max(28),
  split_needs: z.int().min(0).max(100),
  split_wants: z.int().min(0).max(100),
  split_savings: z.int().min(0).max(100),
  onboarded_at: instant.nullable(),
  /* a change waiting for the next payday (Phase 5): all null or all set.
     Optional, so rows cached before Phase 5 and older inserts still parse. */
  next_salary_mil: mil.nullable().optional(),
  next_split_needs: z.int().min(0).max(100).nullable().optional(),
  next_split_wants: z.int().min(0).max(100).nullable().optional(),
  next_split_savings: z.int().min(0).max(100).nullable().optional(),
  next_from: date.nullable().optional(),
  /* display only (currency spec §4). Rows cached before it, or a code this build doesn't
     know yet, read as TND rather than failing the whole profile. */
  currency: z.enum(CURRENCY_CODES).catch('TND'),
  /* what was left in the account at onboarding: that period's Besoins + Envies
     (spec §4.6). Optional, so older rows and inserts still parse. */
  opening_mil: mil.nullable().optional(),
  created_at: instant,
  updated_at: instant,
});
type SplitCols = { split_needs: number; split_wants: number; split_savings: number };
type NextCols = {
  next_salary_mil?: number | null;
  next_split_needs?: number | null;
  next_split_wants?: number | null;
  next_split_savings?: number | null;
  next_from?: string | null;
};
const splitAddsUp = (p: SplitCols) =>
  isValidSplit({ needs: p.split_needs, wants: p.split_wants, savings: p.split_savings });
const SPLIT_ERROR = { message: 'the split must add up to 100', path: ['split_savings'] };
const nextIsWhole = (p: NextCols) => {
  const set = [
    p.next_salary_mil,
    p.next_split_needs,
    p.next_split_wants,
    p.next_split_savings,
    p.next_from,
  ].filter((v) => v != null).length;
  if (set === 0) return true;
  return (
    set === 5 &&
    isValidSplit({
      needs: p.next_split_needs as number,
      wants: p.next_split_wants as number,
      savings: p.next_split_savings as number,
    })
  );
};
const NEXT_ERROR = { message: 'a pending plan is all or nothing and adds up to 100', path: ['next_from'] };
export const ProfileRow = ProfileBase.refine(splitAddsUp, SPLIT_ERROR).refine(nextIsWhole, NEXT_ERROR);
/* The currency is left out of inserts that don't choose one (the backfill): the column's default applies. */
export const ProfileInsert = ProfileBase.omit({ created_at: true, updated_at: true })
  .extend({ currency: z.enum(CURRENCY_CODES).optional() })
  .refine(splitAddsUp, SPLIT_ERROR)
  .refine(nextIsWhole, NEXT_ERROR);

/* ── expenses ── */
export const ExpenseRow = z.object({
  id: uuid,
  user_id: uuid,
  household_id: uuid.nullable(),
  amount_mil: positiveMil,
  category: z.enum(CATEGORY_KEYS),
  pot,
  label: text(0, 60),
  spent_on: date,
  source: z.enum(['manual', 'chat', 'bill']),
  bill_id: uuid.nullable(),
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
});
export const ExpenseInsert = ExpenseRow.omit({ created_at: true, updated_at: true, deleted_at: true });

/* ── bills ── */
export const BillRow = z.object({
  id: uuid,
  user_id: uuid,
  household_id: uuid.nullable(),
  label: text(1, 60),
  amount_mil: positiveMil,
  frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'yearly']),
  day: z.int().min(1).max(31),
  starts_on: date,
  active: z.boolean(),
  created_at: instant,
  updated_at: instant,
});
export const BillInsert = BillRow.omit({ created_at: true, updated_at: true });

/* ── bill payments: one per bill and pay period ── */
export const BillPaymentRow = z.object({
  bill_id: uuid,
  period_start: date,
  expense_id: uuid.nullable(),
  created_at: instant,
});
export const BillPaymentInsert = BillPaymentRow.omit({ created_at: true });

/* ── debts ── */
export const DebtRow = z.object({
  id: uuid,
  user_id: uuid,
  direction: z.enum(['i_owe', 'owed_to_me']),
  person: text(1, 40),
  amount_mil: positiveMil,
  due_on: date.nullable(),
  note: text(0, 120),
  settled_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
});
export const DebtInsert = DebtRow.omit({ created_at: true, updated_at: true, deleted_at: true });

/* ── goals ── */
export const GoalRow = z.object({
  id: uuid,
  user_id: uuid,
  /* set only by the couple functions (Phase 6): the household's goal */
  household_id: uuid.nullable(),
  name: text(1, 40),
  icon: z.string().regex(/^[a-z0-9-]{1,30}$/),
  target_mil: positiveMil,
  archived_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
});
export const GoalInsert = GoalRow.omit({ archived_at: true, created_at: true, updated_at: true });

/* ── savings moves (signed) ── */
const MoveBase = z.object({
  id: uuid,
  user_id: uuid,
  goal_id: uuid,
  amount_mil: z
    .int()
    .min(-MAX_MIL)
    .max(MAX_MIL)
    .refine((n) => n !== 0, 'amount cannot be 0'),
  kind: z.enum(['payday', 'deposit', 'withdraw']),
  from_pot: pot.nullable(),
  occurred_on: date,
  created_at: instant,
});
const signMatchesKind = (m: { kind: string; amount_mil: number }) =>
  (m.kind === 'withdraw') === m.amount_mil < 0;
const SIGN_ERROR = {
  message: 'withdrawals are negative; payday and deposits positive',
  path: ['amount_mil'],
};
export const SavingsMoveRow = MoveBase.refine(signMatchesKind, SIGN_ERROR);
export const SavingsMoveInsert = MoveBase.omit({ created_at: true }).refine(signMatchesKind, SIGN_ERROR);

/* ── reminders ── */
export const ReminderRow = z.object({
  id: uuid,
  user_id: uuid,
  text: text(1, 120),
  remind_at: instant,
  done_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
});
export const ReminderInsert = ReminderRow.omit({ created_at: true, updated_at: true, deleted_at: true });

/* ── incomes: money into Besoins or Envies for the period (Épargne is a savings move) ── */
export const IncomeRow = z.object({
  id: uuid,
  user_id: uuid,
  household_id: uuid.nullable(),
  amount_mil: positiveMil,
  pot,
  label: text(0, 60),
  received_on: date,
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
});
export const IncomeInsert = IncomeRow.omit({ created_at: true, updated_at: true, deleted_at: true });

/* ── couple mode (Phase 6) ── */
/** A change Aam Salah may propose on a partner's shared expense (plan D7). */
export const PartnerChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delete') }).strict(),
  z
    .object({
      kind: z.literal('edit'),
      fields: ExpenseRow.pick({ amount_mil: true, category: true, pot: true, label: true, spent_on: true })
        .partial()
        .strict()
        .refine((f) => Object.keys(f).length > 0, 'nothing to change'),
    })
    .strict(),
]);
/** public.couple_state(p_on): the partner's Besoins amount, never their salary or split. */
export const CoupleState = z.discriminatedUnion('status', [
  z.object({ household_id: z.null(), status: z.literal('solo'), invite: z.null(), partner: z.null() }),
  z.object({
    household_id: uuid,
    status: z.literal('pending'),
    invite: z.object({ code: z.string().regex(/^STC-[A-Z0-9]{6}$/), expires_at: instant }).nullable(),
    partner: z.null(),
  }),
  z.object({
    household_id: uuid,
    status: z.literal('on'),
    invite: z.null(),
    partner: z.object({
      user_id: uuid,
      first_name: z.string().max(40),
      needs_mil: z.int().min(0).max(MAX_MIL),
    }),
  }),
]);

/* ── notifications: written by notify-run (and couple_request); the app only sets read_at ── */
export const NotificationAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open_pot'), ref: pot }),
  z.object({ kind: z.literal('pay_bill'), ref: uuid }),
  z.object({ kind: z.literal('open_goal') }),
  z.object({ kind: z.literal('open_history') }),
  z.object({ kind: z.literal('open_category'), ref: z.enum(CATEGORY_KEYS) }),
  z.object({ kind: z.literal('remind_debt'), ref: uuid }),
  z.object({ kind: z.literal('settle_debt'), ref: uuid }),
  z.object({ kind: z.literal('log_expense') }),
  /* Phase 6: the partner's Aam Salah proposes a change to my shared expense */
  z.object({ kind: z.literal('partner_request'), ref: uuid, from: uuid, change: PartnerChange }),
]);
export const NotificationRow = z.object({
  id: uuid,
  user_id: uuid,
  trigger: z.string().regex(/^[a-z_]{2,40}$/),
  dedupe_key: z.string().min(1).max(120),
  /* empty for a partner request: the app renders it from the action */
  title: z.string().max(80),
  body: z.string().max(300),
  action: NotificationAction.nullable(),
  created_at: instant,
  read_at: instant.nullable(),
});

/* ── push_subscriptions: one row per device endpoint ── */
export const PushSubscriptionInsert = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
});

export type Profile = z.infer<typeof ProfileRow>;
export type NewProfile = z.infer<typeof ProfileInsert>;
export type Expense = z.infer<typeof ExpenseRow>;
export type NewExpense = z.infer<typeof ExpenseInsert>;
export type Bill = z.infer<typeof BillRow>;
export type NewBill = z.infer<typeof BillInsert>;
export type BillPayment = z.infer<typeof BillPaymentRow>;
export type NewBillPayment = z.infer<typeof BillPaymentInsert>;
export type Debt = z.infer<typeof DebtRow>;
export type NewDebt = z.infer<typeof DebtInsert>;
export type Goal = z.infer<typeof GoalRow>;
export type NewGoal = z.infer<typeof GoalInsert>;
export type SavingsMove = z.infer<typeof SavingsMoveRow>;
export type NewSavingsMove = z.infer<typeof SavingsMoveInsert>;
export type Reminder = z.infer<typeof ReminderRow>;
export type NewReminder = z.infer<typeof ReminderInsert>;
export type Income = z.infer<typeof IncomeRow>;
export type NewIncome = z.infer<typeof IncomeInsert>;
export type NotificationActionT = z.infer<typeof NotificationAction>;
export type Notification = z.infer<typeof NotificationRow>;
export type PartnerChangeT = z.infer<typeof PartnerChange>;
export type CoupleStateT = z.infer<typeof CoupleState>;
export type NewPushSubscription = z.infer<typeof PushSubscriptionInsert>;
