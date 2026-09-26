/* Row builders: one legacy entry → one spec §7 row, or an Issue when it can't
 * be built. Split out of convert.ts so convertAll's own orchestration (which
 * document owns which entry, who the anchor is, when the household goal gets
 * built) stays readable on its own — this half is just "given a Ctx and a
 * record, what row comes out". */
import { categoryLabel } from '../../src/shared/categories';
import { isValidISODate } from '../../src/shared/dates';
import { t } from '../../src/shared/i18n/t';
import { DEFAULT_SPLIT } from '../../src/shared/money';
import type { NewExpense, NewProfile } from '../../src/shared/schemas';
import {
  clampDay,
  legacyAmount,
  legacyBillLabel,
  legacyCategory,
  legacyDate,
  legacyPot,
  legacySettledAt,
} from './legacy';
import { recordEpargneDeposit } from './savings';
import { codeTrim, detail, idFor, rawEntries, skip, str, type Ctx, type LegacyRow, type Rec } from './shared';

/** Runs `fn` over every usable record in `v`; reports what it couldn't use
 *  instead of dropping it. `name` is the collection's key, e.g. 'expenses'. */
export function eachRecord(ctx: Ctx, name: string, v: unknown, fn: (r: Rec, ref: string) => void): void {
  if (v === undefined) return;
  const { recs, refs, badCount, isArray } = rawEntries(v);
  if (!isArray) return skip(ctx, 'bad_collection', name, { detail: name });
  recs.forEach((r, i) => fn(r, refs[i]));
  if (badCount > 0) skip(ctx, 'bad_entry', name, { detail: String(badCount) });
}

function pushExpense(
  ctx: Ctx,
  ref: string,
  mil: number,
  category: NewExpense['category'],
  pot: NewExpense['pot'],
  label: string,
  spent: string,
): void {
  /* plan D1: a household shares Besoins only; an Envies entry stays its author's */
  const shared = ctx.householdId !== null && pot === 'needs';
  if (ctx.householdId !== null && !shared) ctx.sharedWants = (ctx.sharedWants ?? 0) + 1;
  const row: NewExpense = {
    id: idFor(ctx.source, 'expense', ref),
    user_id: ctx.userId,
    household_id: shared ? ctx.householdId : null,
    amount_mil: mil,
    category,
    pot,
    label: codeTrim(label, 60),
    spent_on: spent,
    source: 'manual',
    bill_id: null,
  };
  ctx.out.expenses.push(row);
  ctx.out.origin[row.id] = ctx.source;
}

export function convertExpense(
  ctx: Ctx,
  e: Rec,
  ref: string,
  seen: Set<string>,
  goalEpargne: Map<string, number>,
): void {
  if (e.deleted === true) return; // tombstone: no row, no issue
  const pot = legacyPot(e);
  const mil = legacyAmount(e.amount);
  const spent = legacyDate(e);
  const where = {
    pot,
    ...(mil !== null && mil > 0 ? { mil } : {}),
    ...(spent ? { month: spent.slice(0, 7) } : {}),
  };
  if (seen.has(ref)) return skip(ctx, 'duplicate_id', ref, where);
  seen.add(ref);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_amount', ref, { ...where, detail: detail(e.amount) });
  if (!spent) return skip(ctx, 'bad_date', ref, { ...where, detail: detail(e.date) });

  const category = legacyCategory(e.category);
  if (category === 'epargne') {
    /* R4: a non-anchor member doesn't own the household goal, so their own
       "épargne" expense can't become a deposit on it — RLS requires the mover
       to own the goal (see recordEpargneDeposit). It stays an expense instead,
       recategorised 'autre', with an issue so the reclassification is visible. */
    if (ctx.isNonAnchorMember) {
      pushExpense(ctx, ref, mil, 'autre', pot, str(e.label) || t('goal.type.epargne'), spent);
      /* rowKept: the amount is already in the expense row just pushed — verify()
         must not also add it back as "skipped" (fix round 3, was double-counted). */
      skip(ctx, 'epargne_kept_as_expense', ref, { ...where, rowKept: true });
      return;
    }
    if (!ctx.goalId || !ctx.goalOwnerId) return skip(ctx, 'savings_without_goal', ref, where);
    recordEpargneDeposit(ctx, ref, mil, pot, spent, goalEpargne);
    return;
  }
  pushExpense(ctx, ref, mil, category, pot, str(e.label) || categoryLabel(category), spent);
}

export function convertBill(ctx: Ctx, b: Rec, ref: string, seen: Set<string>): void {
  if (b.deleted === true) return;
  if (seen.has(ref)) return skip(ctx, 'duplicate_id', `bill:${ref}`);
  seen.add(ref);
  const mil = legacyAmount(b.amount);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_bill', `bill:${ref}`, { detail: detail(b.amount) });
  const anchor = str(b.anchor);
  const fallback = legacyBillLabel(b.key) ?? t('bill.default');
  ctx.out.bills.push({
    id: idFor(ctx.source, 'bill', ref),
    user_id: ctx.userId,
    household_id: ctx.householdId,
    label: codeTrim(str(b.label) || fallback, 60),
    amount_mil: mil,
    frequency: b.freq === 'quarterly' ? 'quarterly' : 'monthly',
    day: clampDay(b.day),
    starts_on: /^\d{4}-(0[1-9]|1[0-2])$/.test(anchor) ? `${anchor}-01` : `${ctx.today.slice(0, 7)}-01`,
    active: true,
  });
}

export function convertDebt(ctx: Ctx, d: Rec, ref: string, seen: Set<string>): void {
  if (d.deleted === true) return;
  if (seen.has(ref)) return skip(ctx, 'duplicate_id', `debt:${ref}`);
  seen.add(ref);
  const mil = legacyAmount(d.amount);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_debt', `debt:${ref}`, { detail: detail(d.amount) });
  const oldSchema = !d.type; // migrateDebt() in app.js: {kind, who, note, dueDate}
  const due = str(oldSchema ? d.dueDate : d.date);
  ctx.out.debts.push({
    id: idFor(ctx.source, 'debt', ref),
    user_id: ctx.userId,
    direction: d.type === 'due' || d.kind === 'recevoir' ? 'owed_to_me' : 'i_owe',
    person: codeTrim(str(oldSchema ? d.who : d.person) || t('debt.someone'), 40),
    amount_mil: mil,
    due_on: isValidISODate(due) ? due : null,
    note: codeTrim(str(oldSchema ? d.note : d.label), 120),
    settled_at: legacySettledAt(d, ctx.nowIso),
  });
}

export function convertProfile(row: LegacyRow, s: Rec, nowIso: string): NewProfile {
  const rb = Number(s.rb);
  const rp = Number(s.rp);
  const kept = Number.isInteger(rb) && Number.isInteger(rp) && rb >= 0 && rp >= 0 && rb + rp <= 100;
  return {
    user_id: row.user_id,
    first_name: codeTrim(str(s.n1), 40),
    salary_mil: Math.max(0, legacyAmount(s.s1) ?? 0),
    payday: 1, // today's app budgets by calendar month; payday 1 keeps every figure identical
    split_needs: kept ? rb : DEFAULT_SPLIT.needs,
    split_wants: kept ? rp : DEFAULT_SPLIT.wants,
    split_savings: kept ? 100 - rb - rp : DEFAULT_SPLIT.savings,
    /* The run, not the legacy sign-up: payday deposits are owed for every period
       after onboarded_at, and the opening deposit already holds what was saved. */
    onboarded_at: nowIso,
  };
}
