/* Spec §7 tables, in dependency order. households and household_members are
   kept from today's schema; the rest are created by 20260923_redesign_schema.sql, and incomes by
   20260925_phase3_incomes_soft_delete.sql. */
export const SPEC_TABLES = [
  'profiles',
  'households',
  'household_members',
  'goals',
  'bills',
  'expenses',
  'bill_payments',
  'debts',
  'savings_moves',
  'reminders',
  'notifications',
  'push_subscriptions',
  'ai_events',
  'incomes',
] as const;
export type SpecTable = (typeof SPEC_TABLES)[number];
