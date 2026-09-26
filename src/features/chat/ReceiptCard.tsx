/* What a direct action just did, as in the prototype's `receipt`: an expense,
 * a debt or a reminder. */
import { Bell, Check, HandCoins, type LucideIcon } from 'lucide-preact';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import { isCategory } from '../../shared/categories';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import type { ServerAction } from './execute';
import { amount, dayName, milOf, POT_COLOR, potName, potOf } from './view';

interface Look {
  Icon: LucideIcon;
  color: string;
  title: string;
  sub: string;
  value: string | null;
}

/** Also the confirm card's look for these three, which wait for Oui in couple mode. */
export function receiptLook(a: ServerAction): Look | null {
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  switch (a.type) {
    case 'add_expense': {
      const category = str(a.category);
      if (!isCategory(category)) return null;
      return {
        Icon: CATEGORY_ICON[category],
        color: POT_COLOR[potOf(a.pot)],
        title: str(a.label),
        sub: t('chat.receipt.expense', { pot: potName(a.pot), day: dayName(str(a.date)) }),
        value: amount(-milOf(a.amount)),
      };
    }
    case 'add_debt': {
      const owed = a.direction === 'owed_to_me';
      const person = str(a.person);
      const due = str(a.due);
      return {
        Icon: HandCoins,
        color: owed ? 'var(--save)' : 'var(--warn)',
        title: t(owed ? 'chat.receipt.owed' : 'chat.receipt.iOwe', { person }),
        sub: due
          ? t('chat.receipt.due', { date: shortDate(due) })
          : t(owed ? 'chat.receipt.collect' : 'chat.receipt.repay'),
        value: amount(owed ? milOf(a.amount) : -milOf(a.amount), true),
      };
    }
    case 'set_reminder':
      return {
        Icon: Bell,
        color: 'var(--acc)',
        title: str(a.text),
        sub: t('chat.receipt.reminder', { date: dayName(str(a.date)), time: str(a.time) }),
        value: null,
      };
    default:
      return null;
  }
}

export function ReceiptCard({ action }: { action: ServerAction }) {
  const l = receiptLook(action);
  if (!l) return null;
  return (
    <div class="receipt">
      <div class="ic" style={{ background: l.color }}>
        <l.Icon size={19} aria-hidden="true" />
      </div>
      <div>
        <div class="t">{l.title}</div>
        <div class="s">{l.sub}</div>
      </div>
      <div class="a num">{l.value ?? <Check size={18} aria-hidden="true" class="receipt__ok" />}</div>
    </div>
  );
}
