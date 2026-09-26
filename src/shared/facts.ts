/* The budget maths — the only place figures are computed, for the screens and
 * (Phase 3) the assistant's carnet. Nothing here is stored (spec §7).
 *
 * Reste à dépenser = Besoins + Envies budgets − what was spent − unpaid bills
 * due this period (bills are reserved inside Besoins). Debts show in À venir
 * but never change Reste. A bill is paid for a period only while the expense
 * its payment points to still exists, so nothing is counted twice.
 *
 * Money moved in the period also counts (Phase 3): a deposit to Épargne from a
 * pot lowers it, a withdrawal into a pot raises it, and so does an income kept
 * in a pot. Payday moves and deposits with no pot (from_pot null) never touch
 * Besoins or Envies.
 *
 * Couple mode (Phase 6): Besoins is the household's — both budgets, and every
 * Besoins row passed in, whoever wrote it. Envies stays mine: a partner's
 * Envies row is dropped here even though RLS already hides it. Each partner
 * keeps their own pay period. */
import { billDueDates } from './bills';
import { daysLeft as daysLeftIn, isInPeriod, payPeriod, type ISODate, type PayPeriod } from './dates';
import { splitSalary, type Mil, type Split } from './money';
import { planFor } from './plan';
import type { Bill, BillPayment, Debt, Expense, Income, Profile, SavingsMove } from './schemas';

export interface FactsInput {
  profile: Profile;
  expenses: Expense[];
  bills: Bill[];
  billPayments: BillPayment[];
  debts: Debt[];
  savingsMoves: SavingsMove[];
  incomes: Income[];
  today: ISODate;
  /** set while paired: who I am, and the partner's Besoins budget this period */
  couple?: { me: string; partnerNeeds: Mil } | null;
}

export interface PotFacts {
  budget: Mil;
  spent: Mil;
  /** unpaid bills due this period — always 0 for Envies */
  reserved: Mil;
  /** incomes and withdrawals in, minus deposits out, this period */
  moved: Mil;
  /** budget + moved − reserved − spent; may be negative when the pot is overspent */
  left: Mil;
  /** (spent + reserved) / (budget + moved) */
  ratio: number;
  /** ratio ≥ 80 % */
  warn: boolean;
}

export type Upcoming =
  | { kind: 'bill'; id: string; label: string; amount_mil: Mil; due_on: ISODate }
  | {
      kind: 'debt';
      id: string;
      label: string;
      amount_mil: Mil;
      due_on: ISODate;
      direction: Debt['direction'];
    };

export interface Facts {
  period: PayPeriod;
  daysLeft: number;
  salary: Mil;
  /** the split this period runs on (a pending change counts from its period) */
  split: Split;
  pots: { needs: PotFacts; wants: PotFacts; savings: { budget: Mil } };
  left: Mil;
  perDay: Mil;
  upcoming: Upcoming[];
  recent: Expense[];
  /** figures are the household's (Besoins shared) */
  couple: boolean;
}

const WARN_AT = 0.8;

function pot(budget: Mil, spent: Mil, reserved: Mil, moved: Mil): PotFacts {
  const holds = budget + moved;
  const used = spent + reserved;
  const ratio = holds > 0 ? used / holds : used > 0 ? 1 : 0;
  return { budget, spent, reserved, moved, left: holds - used, ratio, warn: ratio >= WARN_AT };
}

export function computeFacts({
  profile,
  expenses,
  bills,
  billPayments,
  debts,
  savingsMoves,
  incomes: allIncomes,
  today,
  couple = null,
}: FactsInput): Facts {
  const period = payPeriod(today, profile.payday);
  /* a change waiting for the next payday counts from its period on (spec §4.6) */
  const plan = planFor(profile, period);
  const budgets = splitSalary(plan.salary_mil, plan.split);
  const mine = (row: { user_id: string }, p: 'needs' | 'wants' | null) =>
    !couple || p !== 'wants' || row.user_id === couple.me;
  const incomes = allIncomes.filter((i) => mine(i, i.pot));
  const moves = savingsMoves.filter((m) => mine(m, m.from_pot));

  const live = expenses.filter((e) => e.deleted_at === null && mine(e, e.pot));
  const liveIds = new Set(live.map((e) => e.id));
  const inPeriod = live.filter((e) => isInPeriod(e.spent_on, period));
  const spentIn = (p: 'needs' | 'wants') =>
    inPeriod.filter((e) => e.pot === p).reduce((sum, e) => sum + e.amount_mil, 0);

  /* savings_moves are signed: a deposit (> 0) leaves its pot, a withdrawal (< 0) arrives in it. */
  const movedIn = (p: 'needs' | 'wants') =>
    incomes
      .filter((i) => i.deleted_at === null && i.pot === p && isInPeriod(i.received_on, period))
      .reduce((sum, i) => sum + i.amount_mil, 0) -
    moves
      .filter((m) => m.kind !== 'payday' && m.from_pot === p && isInPeriod(m.occurred_on, period))
      .reduce((sum, m) => sum + m.amount_mil, 0);

  const paid = new Set(
    billPayments
      .filter((b) => b.period_start === period.start && b.expense_id !== null && liveIds.has(b.expense_id))
      .map((b) => b.bill_id),
  );
  const unpaidBills: Upcoming[] = bills
    .filter((b) => !paid.has(b.id))
    .flatMap((b) =>
      billDueDates(b, period).map((due_on) => ({
        kind: 'bill' as const,
        id: b.id,
        label: b.label,
        amount_mil: b.amount_mil,
        due_on,
      })),
    );
  const reserved = unpaidBills.reduce((sum, b) => sum + b.amount_mil, 0);

  const dueDebts: Upcoming[] = debts
    .filter(
      (d) =>
        d.settled_at === null && d.deleted_at === null && d.due_on !== null && isInPeriod(d.due_on, period),
    )
    .map((d) => ({
      kind: 'debt' as const,
      id: d.id,
      label: d.person,
      amount_mil: d.amount_mil,
      due_on: d.due_on as ISODate,
      direction: d.direction,
    }));

  const needs = pot(
    budgets.needs + (couple?.partnerNeeds ?? 0),
    spentIn('needs'),
    reserved,
    movedIn('needs'),
  );
  const wants = pot(budgets.wants, spentIn('wants'), 0, movedIn('wants'));
  const left = needs.left + wants.left;
  const daysLeft = daysLeftIn(today, period);

  return {
    period,
    daysLeft,
    salary: plan.salary_mil,
    split: plan.split,
    pots: { needs, wants, savings: { budget: budgets.savings } },
    left,
    perDay: Math.max(0, Math.floor(left / daysLeft)),
    upcoming: [...unpaidBills, ...dueDebts].sort((a, b) => a.due_on.localeCompare(b.due_on)),
    recent: [...live]
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at))
      .slice(0, 5),
    couple: couple !== null,
  };
}
