/* The one-tap actions on a notification (spec §4.5). Every action marks its row
 * read. The ones that write (pay, settle, remind) replace the row's body on this
 * device with a done line and drop its buttons; the server row is never edited.
 * A partner's request (plan D7) is answered Accepter or Refuser; nothing goes
 * back to the partner. */
import { h } from 'preact';
import { navigate } from '../../app/router';
import { closeSheet, openSheet, showToast } from '../../app/ui';
import { createExpensesRepo } from '../../data/expenses';
import type { LocalDb } from '../../data/localdb';
import { markRead } from '../../data/notifications';
import { createRepos, payBill, settleDebt } from '../../data/repos';
import type { Store } from '../../data/store';
import { potOf } from '../../shared/categories';
import { addDays, payPeriod, todayTunis } from '../../shared/dates';
import { t } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import { tunisInstant } from '../../shared/payday';
import {
  PartnerChange,
  type Bill,
  type Expense,
  type Notification,
  type NotificationActionT,
} from '../../shared/schemas';
import { STOUCHI_NS, uuidv5 } from '../../shared/uuid5';
import { AddSheet } from '../add/AddSheet';

export interface ActionCtx {
  db: LocalDb;
  store: Store;
}

/** Next Sunday at 10:00 Tunis; on a Sunday, the Sunday after. */
export function nextSundayTen(now: Date): string {
  const today = todayTunis(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return tunisInstant(addDays(today, 7 - weekday), 10).toISOString();
}

/** A bill notice pays the period it was written in: once that period is over,
 * Marquer payée would record the wrong one (this period's bill would leave À venir). */
export const inCurrentPeriod = (row: Notification, payday: number, now = new Date()): boolean =>
  payPeriod(todayTunis(new Date(row.created_at)), payday).start === payPeriod(todayTunis(now), payday).start;

async function remember(ctx: ActionCtx, id: string, line: string): Promise<void> {
  const userId = ctx.store.userId.value;
  if (!userId) return;
  const acted = { ...ctx.store.actedOn.value, [id]: line };
  ctx.store.actedOn.value = acted;
  await ctx.db.put('meta', acted, `acted:${userId}`);
}

export async function runAction(
  row: Notification,
  action: NotificationActionT,
  ctx: ActionCtx,
  /** a partner request's answer */
  answer?: 'accept' | 'refuse',
): Promise<void> {
  const { db, store } = ctx;
  await markRead(db, store, [row.id]);
  const userId = store.userId.value;
  const profile = store.profile.value;
  if (!userId || !profile) return;
  const repos = createRepos(db, store);
  const expenses = createExpensesRepo(db, store);

  switch (action.kind) {
    case 'open_pot':
      return navigate(`#/pot/${action.ref}`);
    case 'open_goal':
      return navigate('#/goal');
    case 'open_history':
      return navigate('#/history');
    case 'open_category':
      return navigate(`#/history/${action.ref}`);
    case 'log_expense':
      navigate('#/budget');
      return openSheet(t('add.title'), h(AddSheet, { store, repo: expenses, onDone: closeSheet }));

    case 'pay_bill': {
      if (!inCurrentPeriod(row, profile.payday)) return remember(ctx, row.id, t('notify.done.pay_bill_past'));
      const b = (await db.get('bills', action.ref)) as Bill | undefined;
      const paid = b?.active
        ? await payBill(db, repos, expenses, userId, b, todayTunis(), profile.payday)
        : { status: 'already' as const };
      return remember(
        ctx,
        row.id,
        t(paid.status === 'paid' ? 'notify.done.pay_bill' : 'notify.done.pay_bill_already'),
      );
    }

    case 'settle_debt': {
      const done = await settleDebt(repos, action.ref);
      return remember(
        ctx,
        row.id,
        t(done === 'settled' ? 'notify.done.settle_debt' : 'notify.done.settle_debt_already'),
      );
    }

    case 'partner_request': {
      if (answer !== 'accept') return remember(ctx, row.id, t('notify.done.partner_refused'));
      /* re-read from this device: the expense may have changed since the request */
      const e = (await db.get('expenses', action.ref)) as Expense | undefined;
      if (!e || e.deleted_at) return remember(ctx, row.id, t('notify.done.partner_gone'));
      const change = PartnerChange.safeParse(action.change);
      if (!change.success || e.user_id !== userId)
        return remember(ctx, row.id, t('notify.done.partner_invalid'));
      /* no longer current: I stopped sharing, the row went private, or it was
         edited after the request (both stamps are the server's) */
      const home = store.household.value;
      if (
        home?.status !== 'on' ||
        e.household_id !== home.household_id ||
        Date.parse(e.updated_at) > Date.parse(row.created_at)
      )
        return remember(ctx, row.id, t('notify.done.partner_stale'));
      if (change.data.kind === 'delete') {
        await expenses.remove(e.id);
        showToast({
          text: t('detail.deleted'),
          action: { label: t('action.undo'), run: () => void expenses.restore(e.id) },
        });
        return remember(ctx, row.id, t('notify.done.partner_deleted'));
      }
      try {
        const { fields } = change.data;
        /* a new category without a pot takes its category's pot, as in the chat */
        await expenses.update(
          e.id,
          fields.category && !fields.pot ? { ...fields, pot: potOf(fields.category) } : fields,
        );
      } catch {
        return remember(ctx, row.id, t('notify.done.partner_invalid'));
      }
      return remember(ctx, row.id, t('notify.done.partner_applied'));
    }

    case 'remind_debt': {
      const d = await repos.debts.get(action.ref);
      if (!d || d.settled_at || d.deleted_at)
        return remember(ctx, row.id, t('notify.done.settle_debt_already'));
      const remind_at = nextSundayTen(new Date());
      await repos.reminders.create({
        id: uuidv5(`remind-debt:${userId}:${d.id}:${remind_at}`, STOUCHI_NS),
        user_id: userId,
        text: t('notify.reminder.debt', {
          person: d.person,
          amount: formatTnd(d.amount_mil, { unit: false }),
        }),
        remind_at,
        done_at: null,
      });
      return remember(ctx, row.id, t('notify.done.remind_debt'));
    }
  }
}
