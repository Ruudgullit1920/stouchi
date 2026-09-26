/* A confirm card (spec §5, prototype `confirmCard`): nothing changes until Oui.
 * One component, a variant per action type: the "12 → 21 TND" diff, the
 * struck-through receipt for a delete, "Envies → Épargne", the income card with
 * its Épargne / Ce mois switch. */
import {
  Check,
  Coins,
  Gift,
  HandCoins,
  Receipt,
  Send,
  Target,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import type { Store } from '../../data/store';
import { categoryLabel, isCategory } from '../../shared/categories';
import { shortDate } from '../../shared/format';
import { t, type StringKey } from '../../shared/i18n/t';
import { titleOf } from '../../shared/ledger';
import { formatTnd } from '../../shared/money';
import { activeGoal } from '../../shared/payday';
import type { Card } from './history';
import { receiptLook } from './ReceiptCard';
import { amount, dayName, milOf, POT_COLOR, potName } from './view';

interface Look {
  Icon: LucideIcon;
  color: string;
  title: string;
  sub: string;
  value?: ComponentChildren;
}

const FREQ = new Set(['monthly', 'bimonthly', 'quarterly', 'yearly']);
const str = (x: unknown) => (typeof x === 'string' ? x : '');

function look(card: Card, store: Store): Look | null {
  const a = card.action;
  const ref = str(a.ref);
  switch (a.type) {
    case 'edit_expense': {
      const e = store.expenses.value.find((x) => x.id === ref);
      if (!e) return null;
      const ch = (a.changes ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (ch.amount !== undefined)
        parts.push(`${formatTnd(e.amount_mil, { unit: false })} → ${formatTnd(milOf(ch.amount))}`);
      const cat = str(ch.category);
      if (isCategory(cat)) parts.push(`${categoryLabel(e.category)} → ${categoryLabel(cat)}`);
      if (ch.label !== undefined) parts.push(`« ${str(ch.label)} »`);
      if (ch.date !== undefined) parts.push(`${shortDate(e.spent_on)} → ${shortDate(str(ch.date))}`);
      return {
        Icon: CATEGORY_ICON[e.category],
        color: POT_COLOR[e.pot],
        title: t('chat.card.edit', { label: titleOf(e) }),
        sub: parts.join(' · '),
      };
    }
    case 'delete_expense': {
      const e = store.expenses.value.find((x) => x.id === ref);
      if (!e) return null;
      return {
        Icon: Trash2,
        color: 'var(--danger)',
        title: t('chat.card.delete', { label: titleOf(e) }),
        sub: `${categoryLabel(e.category)} · ${dayName(e.spent_on)}`,
        value: <s>{amount(-e.amount_mil)}</s>,
      };
    }
    case 'partner_request': {
      /* the partner's expense: the card asks to send them the request (plan D7) */
      const e = store.expenses.value.find((x) => x.id === ref);
      const h = store.household.value;
      if (!e || h?.status !== 'on') return null;
      const change = (a.change ?? {}) as { kind?: string; changes?: Record<string, unknown> };
      const ch = change.changes ?? {};
      const parts: string[] = [];
      if (change.kind === 'delete') parts.push(t('chat.card.delete', { label: titleOf(e) }));
      if (ch.amount !== undefined)
        parts.push(`${formatTnd(e.amount_mil, { unit: false })} → ${formatTnd(milOf(ch.amount))}`);
      const cat = str(ch.category);
      if (isCategory(cat)) parts.push(`${categoryLabel(e.category)} → ${categoryLabel(cat)}`);
      if (ch.label !== undefined) parts.push(`« ${str(ch.label)} »`);
      if (ch.date !== undefined) parts.push(`${shortDate(e.spent_on)} → ${shortDate(str(ch.date))}`);
      return {
        Icon: Send,
        color: POT_COLOR[e.pot],
        title: t('chat.card.partner', { name: h.partner.first_name }),
        sub: parts.join(' · '),
      };
    }
    case 'savings_deposit':
    case 'savings_withdraw': {
      const deposit = a.type === 'savings_deposit';
      const goal = activeGoal(store.goals.value);
      return {
        Icon: Coins,
        color: deposit ? 'var(--save)' : 'var(--warn)',
        title: t(deposit ? 'chat.card.deposit' : 'chat.card.withdraw', {
          pot: potName(deposit ? a.from : a.to),
        }),
        sub: str(a.reason) || (goal?.name ?? ''),
        value: amount(deposit ? milOf(a.amount) : -milOf(a.amount), true),
      };
    }
    case 'add_income':
      return {
        Icon: Gift,
        color: 'var(--save)',
        title: str(a.label),
        sub: t('chat.card.income'),
        value: amount(milOf(a.amount), true),
      };
    case 'add_bill': {
      const freq = str(a.frequency);
      return {
        Icon: Receipt,
        color: 'var(--need)',
        title: str(a.label),
        sub: t('chat.card.bill', {
          day: typeof a.day === 'number' ? a.day : '',
          freq: FREQ.has(freq) ? t(`chat.card.freq.${freq}` as StringKey) : '',
        }),
        value: amount(milOf(a.amount)),
      };
    }
    case 'pay_bill': {
      const b = store.bills.value.find((x) => x.id === ref);
      if (!b) return null;
      return {
        Icon: Zap,
        color: 'var(--need)',
        title: t('chat.card.payBill', { label: b.label }),
        sub: t('chat.card.payBill.sub'),
        value: amount(-b.amount_mil),
      };
    }
    case 'settle_debt': {
      const d = store.debts.value.find((x) => x.id === ref);
      if (!d) return null;
      return {
        Icon: HandCoins,
        color: 'var(--save)',
        title: t(d.direction === 'owed_to_me' ? 'chat.receipt.owed' : 'chat.receipt.iOwe', {
          person: d.person,
        }),
        sub: t('chat.card.settle'),
        value: amount(d.amount_mil),
      };
    }
    case 'update_goal': {
      const goal = activeGoal(store.goals.value);
      if (!goal) return null;
      const name = str(a.name);
      return {
        Icon: Target,
        color: 'var(--save)',
        title: name ? t('chat.card.goal', { name }) : goal.name,
        sub:
          a.target !== undefined
            ? `${formatTnd(goal.target_mil, { unit: false })} → ${formatTnd(milOf(a.target))}`
            : t('chat.card.goal.rename'),
      };
    }
    default:
      /* add_expense / add_debt / set_reminder, confirmed in couple mode */
      return receiptLook(a);
  }
}

type Props = {
  card: Card;
  store: Store;
  onAnswer: (yes: boolean) => void;
  onSwitch: (to: 'epargne' | 'envies') => void;
};

const STATE: Record<Exclude<Card['state'], 'open'>, StringKey> = {
  yes: 'chat.card.done',
  no: 'chat.card.refused',
  stale: 'chat.card.stale',
  expired: 'chat.card.expired',
};

export function ConfirmCard({ card, store, onAnswer, onSwitch }: Props) {
  const l = look(card, store);
  const title = l?.title ?? t('chat.card.missing');
  const toSavings = card.action.to === 'epargne';
  return (
    <div class={`ccard ${card.state}`}>
      <div class="cc-head">
        <div class="ic" style={{ background: l?.color ?? 'var(--mut)' }}>
          {l && <l.Icon size={19} aria-hidden="true" />}
        </div>
        <div>
          <div class="t">{title}</div>
          <div class="s">{l?.sub}</div>
        </div>
        <div class="a num">{l?.value}</div>
      </div>
      {card.state === 'open' && card.action.type === 'add_income' && (
        <div class="seg2 cc-to">
          <button
            type="button"
            class={toSavings ? 'on' : ''}
            aria-pressed={toSavings}
            onClick={() => onSwitch('epargne')}
          >
            {t('chat.card.income.savings')}
          </button>
          <button
            type="button"
            class={toSavings ? '' : 'on'}
            aria-pressed={!toSavings}
            onClick={() => onSwitch('envies')}
          >
            {t('chat.card.income.month')}
          </button>
        </div>
      )}
      {card.state === 'open' ? (
        <div class="cc-btns">
          <button
            type="button"
            class="cc-no"
            aria-label={t('chat.card.noLabel', { title })}
            onClick={() => onAnswer(false)}
          >
            {t('chat.card.no')}
          </button>
          <button
            type="button"
            class="cc-yes"
            aria-label={t('chat.card.yesLabel', { title })}
            onClick={() => onAnswer(true)}
          >
            {t('chat.card.yes')}
          </button>
        </div>
      ) : (
        <div class="cc-state">
          {card.state === 'yes' && <Check size={16} aria-hidden="true" />}
          {t(STATE[card.state])}
        </div>
      )}
    </div>
  );
}
