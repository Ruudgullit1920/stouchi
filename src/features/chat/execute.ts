/* Runs Aam Salah's actions on the device (plan Task 6). The server validated
 * them against the carnet; the device checks again, because the model's output
 * is untrusted and the rows may have moved since. Every write goes through the
 * local repositories, so chat writes behave like keypad writes, offline too.
 *
 * A confirm card is `prepare`d when it is shown: it gets the id of the row it
 * would create (so Oui twice creates once) and what the target row held (so
 * Oui on a row changed since — here or on another device — is refused as
 * stale instead of overwriting). Comparing the row with itself avoids any
 * dependence on the device clock. The stamps are left out: the server re-stamps
 * updated_at on every push, and a row that only synced has not changed. */
import { createExpensesRepo } from '../../data/expenses';
import type { LocalDb, Row, Table } from '../../data/localdb';
import { createRepos, payBill, settleDebt } from '../../data/repos';
import type { Store } from '../../data/store';
import { categoryLabel, isCategory, potOf, type Pot } from '../../shared/categories';
import { todayTunis } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { t, type StringKey } from '../../shared/i18n/t';
import { formatTnd, MAX_MIL, milFromTnd, type Mil } from '../../shared/money';
import { activeGoal, tunisInstant } from '../../shared/payday';
import { PartnerChange, type Bill, type Debt, type Expense, type Goal } from '../../shared/schemas';
import { CoupleError, type CoupleApi } from '../../data/couple';

/** An action as /api/aam returns it, plus what `prepare` adds for a card. */
export interface ServerAction {
  type: string;
  kind: 'direct' | 'confirm';
  /** the carnet's short id */
  id?: string;
  /** the real uuid behind `id` */
  ref?: string;
  /** set by prepare: the id of the row this action creates */
  newId?: string;
  /** set by prepare: the target row's content when the card was shown (null: not on the device) */
  seen?: string | null;
  [field: string]: unknown;
}

export interface ExecCtx {
  db: LocalDb;
  store: Store;
  uuid?: () => string;
  /** couple mode: sends a partner request (plan D7); needs the network */
  couple?: Pick<CoupleApi, 'request'> | null;
}

/** What the last chat action wrote, so it can be reverted within 10 minutes. */
export interface UndoRecord {
  type: string;
  /** the uuid of the row it wrote */
  ref: string;
  /** ISO instant */
  at: string;
  table: Table;
  /** the row before an edit (edit_expense, update_goal) */
  before: Row | null;
  summary: string;
}

export type ExecResult =
  | { ok: true; summary: string; undo: UndoRecord | null }
  | { ok: false; reason: 'stale' | 'invalid' }
  /* a partner request the server refused, or no connection: `key` says why */
  | { ok: false; reason: 'couple'; key: StringKey };

export const UNDO_MS = 10 * 60_000;
/** one action's cap in TND (spec §5) */
const MAX_TND = 50_000;
const POT: Record<string, Pot> = { besoins: 'needs', envies: 'wants' };
const POT_NAME: Record<Pot, string> = { needs: t('pot.needs'), wants: t('pot.wants') };

class Invalid extends Error {}
class Stale extends Error {}

/** TND from the model → millimes: whole millimes in (0, cap] only (12.5 yes, 0.0004 no). */
function mil(x: unknown, capTnd = MAX_TND): Mil {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > capTnd) throw new Invalid();
  const m = milFromTnd(x);
  if (m === null || Math.abs(x * 1000 - m) > 1e-6) throw new Invalid();
  return m;
}
const str = (x: unknown, fallback?: string): string => {
  if (typeof x === 'string') return x.trim();
  if (fallback !== undefined) return fallback;
  throw new Invalid();
};
const money = (m: Mil) => formatTnd(m);

/** The existing row an action works on: its table and key. */
function targetOf(a: ServerAction, store: Store): { table: Table; key: string } | null {
  const ref = typeof a.ref === 'string' ? a.ref : '';
  switch (a.type) {
    case 'edit_expense':
    case 'delete_expense':
    case 'partner_request':
      return { table: 'expenses', key: ref };
    case 'pay_bill':
      return { table: 'bills', key: ref };
    case 'settle_debt':
      return { table: 'debts', key: ref };
    case 'update_goal': {
      const goal = activeGoal(store.goals.value);
      return goal ? { table: 'goals', key: goal.id } : null;
    }
    default:
      return null;
  }
}

/** When a card is shown: the id it will create and its target's current version. */
export async function prepare(action: ServerAction, ctx: ExecCtx): Promise<ServerAction> {
  const target = targetOf(action, ctx.store);
  const row =
    target && target.key ? ((await ctx.db.get(target.table, target.key)) as Row | undefined) : undefined;
  return {
    ...action,
    newId: newUuid(ctx),
    seen: row ? content(row) : null,
  };
}

const newUuid = (ctx: ExecCtx) => (ctx.uuid ?? (() => crypto.randomUUID()))();

/** What a row holds, stamps aside, in a fixed key order. */
const content = (row: Row): string =>
  JSON.stringify(
    Object.keys(row)
      .filter((k) => k !== 'updated_at' && k !== 'created_at')
      .sort()
      .map((k) => [k, row[k]]),
  );

/** Loads the target, refusing it when it is gone, deleted, or not the version the card showed. */
async function live<T extends Row>(a: ServerAction, ctx: ExecCtx): Promise<T> {
  const target = targetOf(a, ctx.store);
  if (!target) throw new Invalid();
  const row = target.key ? ((await ctx.db.get(target.table, target.key)) as T | undefined) : undefined;
  if (!row || row.deleted_at || row.archived_at || row.active === false || row.settled_at) throw new Stale();
  if ('seen' in a && a.seen !== content(row)) throw new Stale();
  return row;
}

export async function execute(a: ServerAction, ctx: ExecCtx): Promise<ExecResult> {
  try {
    return await run(a, ctx);
  } catch (e) {
    if (e instanceof Stale) return { ok: false, reason: 'stale' };
    if (e instanceof Invalid || (e instanceof Error && e.name === 'ZodError'))
      return { ok: false, reason: 'invalid' };
    throw e;
  }
}

async function run(a: ServerAction, ctx: ExecCtx): Promise<ExecResult> {
  const { db, store } = ctx;
  const userId = store.userId.value;
  const profile = store.profile.value;
  if (!userId || !profile) throw new Invalid();
  const repos = createRepos(db, store);
  const expenses = createExpensesRepo(db, store);
  const id = a.newId ?? newUuid(ctx);
  const today = todayTunis();
  const done = (summary: string, table: Table | null, ref = id, before: Row | null = null): ExecResult => ({
    ok: true,
    summary,
    undo: table ? { type: a.type, ref, at: new Date().toISOString(), table, before, summary } : null,
  });
  const goal = () => {
    const g = activeGoal(store.goals.value);
    if (!g) throw new Invalid();
    return g;
  };

  switch (a.type) {
    case 'add_expense': {
      const category = str(a.category);
      const pot = POT[str(a.pot)];
      if (!isCategory(category) || !pot) throw new Invalid();
      const amount_mil = mil(a.amount);
      const label = str(a.label, '') || categoryLabel(category);
      await expenses.create({
        id,
        user_id: userId,
        household_id: null,
        amount_mil,
        category,
        pot,
        label,
        spent_on: typeof a.date === 'string' ? a.date : today,
        source: 'chat',
        bill_id: null,
      });
      return done(t('chat.done.add_expense', { label, amount: money(amount_mil) }), 'expenses');
    }

    case 'edit_expense': {
      const ch = (a.changes && typeof a.changes === 'object' ? a.changes : {}) as Record<string, unknown>;
      const patch: Partial<Expense> = {};
      if ('amount' in ch) patch.amount_mil = mil(ch.amount);
      if ('category' in ch) {
        const c = str(ch.category);
        if (!isCategory(c)) throw new Invalid();
        patch.category = c;
        patch.pot = potOf(c);
      }
      if ('label' in ch) patch.label = str(ch.label);
      if ('date' in ch) patch.spent_on = str(ch.date);
      if (!Object.keys(patch).length) throw new Invalid();
      const before = await live<Expense>(a, ctx);
      /* the partner's expense is only ever asked about (plan D7) */
      if (before.user_id !== userId) throw new Invalid();
      /* a shared expense moved to Envies comes back as a private copy (plan D7) */
      const after = await expenses.update(before.id, patch);
      const label = before.label || categoryLabel(before.category);
      const summary =
        patch.amount_mil !== undefined
          ? t('chat.done.edit_expense.amount', {
              label,
              from: formatTnd(before.amount_mil, { unit: false }),
              to: money(patch.amount_mil),
            })
          : t('chat.done.edit_expense', { label });
      return done(summary, 'expenses', after.id, before);
    }

    case 'delete_expense': {
      const e = await live<Expense>(a, ctx);
      if (e.user_id !== userId) throw new Invalid();
      await expenses.remove(e.id);
      const label = e.label || categoryLabel(e.category);
      return done(t('chat.done.delete_expense', { label, amount: money(e.amount_mil) }), 'expenses', e.id);
    }

    case 'partner_request': {
      /* the partner's expense: never changed here, only asked about (plan D7) */
      const e = await live<Expense>(a, ctx);
      if (!ctx.couple) throw new Invalid();
      const change = PartnerChange.parse(partnerChange(a.change));
      try {
        await ctx.couple.request(e.id, change);
      } catch (err) {
        if (err instanceof CoupleError) return { ok: false, reason: 'couple', key: err.key };
        throw err;
      }
      const h = store.household.value;
      return done(
        t('chat.done.partner_request', { name: h?.status === 'on' ? h.partner.first_name : '' }),
        null,
      );
    }

    case 'pay_bill': {
      const b = await live<Bill>(a, ctx);
      const paid = await payBill(db, repos, expenses, userId, b, today, profile.payday);
      if (paid.status === 'already') throw new Stale();
      return done(
        t('chat.done.pay_bill', { label: b.label, amount: money(paid.amount_mil) }),
        'expenses',
        paid.expenseId,
      );
    }

    case 'add_bill': {
      const amount_mil = mil(a.amount);
      const label = str(a.label);
      await repos.bills.create({
        id,
        user_id: userId,
        household_id: null,
        label,
        amount_mil,
        frequency: a.frequency,
        day: a.day,
        starts_on: today,
        active: true,
      });
      return done(t('chat.done.add_bill', { label, amount: money(amount_mil) }), 'bills');
    }

    case 'savings_deposit':
    case 'savings_withdraw': {
      const amount_mil = mil(a.amount);
      const pot = POT[str(a.type === 'savings_deposit' ? a.from : a.to)];
      if (!pot) throw new Invalid();
      const deposit = a.type === 'savings_deposit';
      await repos.savingsMoves.create({
        id,
        user_id: userId,
        goal_id: goal().id,
        amount_mil: deposit ? amount_mil : -amount_mil,
        kind: deposit ? 'deposit' : 'withdraw',
        from_pot: pot,
        occurred_on: today,
      });
      /* savings moves are hard-delete only: not undoable in Phase 3 */
      return done(t(`chat.done.${a.type}`, { amount: money(amount_mil), pot: POT_NAME[pot] }), null);
    }

    case 'add_income': {
      const amount_mil = mil(a.amount);
      const label = str(a.label, '');
      if (a.to === 'epargne') {
        const g = goal();
        await repos.savingsMoves.create({
          id,
          user_id: userId,
          goal_id: g.id,
          amount_mil,
          kind: 'deposit',
          from_pot: null,
          occurred_on: today,
        });
        return done(
          t('chat.done.add_income.savings', { label, amount: money(amount_mil), goal: g.name }),
          null,
        );
      }
      const pot = POT[str(a.to)];
      if (!pot) throw new Invalid();
      await repos.incomes.create({
        id,
        user_id: userId,
        household_id: null,
        amount_mil,
        pot,
        label,
        received_on: today,
      });
      return done(
        t('chat.done.add_income.pot', { label, amount: money(amount_mil), pot: POT_NAME[pot] }),
        'incomes',
      );
    }

    case 'add_debt': {
      const amount_mil = mil(a.amount);
      const person = str(a.person);
      const direction =
        a.direction === 'owed_to_me' ? 'owed_to_me' : a.direction === 'i_owe' ? 'i_owe' : null;
      if (!direction) throw new Invalid();
      await repos.debts.create({
        id,
        user_id: userId,
        direction,
        person,
        amount_mil,
        due_on: typeof a.due === 'string' ? a.due : null,
        note: str(a.note, ''),
        settled_at: null,
      });
      return done(t(`chat.done.add_debt.${direction}`, { person, amount: money(amount_mil) }), 'debts');
    }

    case 'settle_debt': {
      const d = await live<Debt>(a, ctx);
      if ((await settleDebt(repos, d.id)) === 'already') throw new Stale();
      return done(
        t('chat.done.settle_debt', { person: d.person, amount: money(d.amount_mil) }),
        'debts',
        d.id,
      );
    }

    case 'set_reminder': {
      const text = str(a.text);
      const date = str(a.date);
      const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(str(a.time, '09:00'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) throw new Invalid();
      await repos.reminders.create({
        id,
        user_id: userId,
        text,
        remind_at: tunisInstant(date, Number(time[1]), Number(time[2])).toISOString(),
        done_at: null,
      });
      return done(t('chat.done.set_reminder', { text, date: shortDate(date), time: time[0] }), 'reminders');
    }

    case 'update_goal': {
      const patch: Partial<Goal> = {};
      if (a.target != null) patch.target_mil = mil(a.target, MAX_MIL / 1000);
      if (a.name != null) patch.name = str(a.name);
      if (!Object.keys(patch).length) throw new Invalid();
      const before = await live<Goal>(a, ctx);
      const after = await repos.goals.change(before.id, patch);
      const summary =
        patch.target_mil !== undefined
          ? t('chat.done.update_goal', { name: after.name, amount: money(after.target_mil) })
          : t('chat.done.update_goal.name', { name: after.name });
      return done(summary, 'goals', before.id, before);
    }

    default:
      /* open and undo are the chat's own; anything else is unknown */
      throw new Invalid();
  }
}

/** Reverts the last chat action while it is under 10 minutes old. Returns what
 * was undone, or null when there is nothing (left) to undo. */
export async function undoLast(record: UndoRecord, ctx: ExecCtx): Promise<string | null> {
  const age = Date.now() - Date.parse(record.at);
  if (!(age >= 0 && age < UNDO_MS)) return null;
  const repos = createRepos(ctx.db, ctx.store);
  const expenses = createExpensesRepo(ctx.db, ctx.store);
  if (!(await ctx.db.get(record.table, record.ref))) return null;
  const now = new Date().toISOString();
  const before = record.before ?? {};
  switch (record.type) {
    case 'add_expense':
    case 'pay_bill':
      await expenses.remove(record.ref);
      break;
    case 'edit_expense': {
      const e = before as Partial<Expense>;
      if (e.id && e.id !== record.ref) {
        /* the edit moved a shared expense to Envies: drop the copy, the shared row comes back */
        await expenses.remove(record.ref);
        await expenses.restore(e.id);
        break;
      }
      await expenses.update(record.ref, {
        amount_mil: e.amount_mil,
        category: e.category,
        pot: e.pot,
        label: e.label,
        spent_on: e.spent_on,
      });
      break;
    }
    case 'delete_expense':
      await expenses.restore(record.ref);
      break;
    case 'add_debt':
      await repos.debts.change(record.ref, { deleted_at: now });
      break;
    case 'settle_debt':
      await repos.debts.change(record.ref, { settled_at: null });
      break;
    case 'set_reminder':
      await repos.reminders.change(record.ref, { deleted_at: now });
      break;
    case 'add_income':
      await repos.incomes.change(record.ref, { deleted_at: now });
      break;
    case 'add_bill':
      await repos.bills.change(record.ref, { active: false });
      break;
    case 'update_goal': {
      const g = before as Partial<Goal>;
      await repos.goals.change(record.ref, { target_mil: g.target_mil, name: g.name });
      break;
    }
    default:
      return null;
  }
  return record.summary;
}

/** The model's change (TND, besoins / envies, date) in the database's terms. */
function partnerChange(c: unknown): unknown {
  const change = (c ?? {}) as { kind?: unknown; changes?: Record<string, unknown> };
  if (change.kind !== 'edit') return { kind: change.kind };
  const ch = change.changes ?? {};
  const fields: Row = {};
  if (ch.amount !== undefined) fields.amount_mil = mil(ch.amount);
  if (ch.category !== undefined) fields.category = ch.category;
  if (typeof ch.pot === 'string') fields.pot = POT[ch.pot] ?? ch.pot;
  if (ch.label !== undefined) fields.label = ch.label;
  if (ch.date !== undefined) fields.spent_on = ch.date;
  return { kind: 'edit', fields };
}
