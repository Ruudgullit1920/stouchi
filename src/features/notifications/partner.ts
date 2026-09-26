/* A partner's request (plan D7): the row stores no text, so it is written here
 * from the action, the household and this device's copy of the expense. */
import type { Store } from '../../data/store';
import { categoryLabel } from '../../shared/categories';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { titleOf } from '../../shared/ledger';
import { formatTnd } from '../../shared/money';
import {
  NotificationAction,
  type Expense,
  type Notification,
  type PartnerChangeT,
} from '../../shared/schemas';

const what = (e: Pick<Expense, 'label' | 'category' | 'amount_mil'>) =>
  `${titleOf(e as Expense)} · ${formatTnd(e.amount_mil)}`;

/** The title and body of a partner_request row; null for any other row. */
export function partnerText(row: Notification, store: Store): { title: string; body: string } | null {
  const parsed = NotificationAction.safeParse(row.action);
  if (!parsed.success || parsed.data.kind !== 'partner_request') return null;
  const a = parsed.data;
  const h = store.household.value;
  const name =
    h?.status === 'on' && h.partner.user_id === a.from ? h.partner.first_name : t('notify.partner.someone');
  const title = t('notify.partner.title', { name });
  const e = store.expenses.value.find((x) => x.id === a.ref && x.deleted_at === null);
  if (!e) return { title, body: t('notify.done.partner_gone') };
  if (a.change.kind === 'delete') return { title, body: t('notify.partner.delete', { name, what: what(e) }) };
  return {
    title,
    body: t('notify.partner.edit', { name, what: what(e), changes: changes(e, a.change.fields) }),
  };
}

/** Each field the request changes, before → after: the partner consents to what they see. */
function changes(e: Expense, f: Extract<PartnerChangeT, { kind: 'edit' }>['fields']): string {
  const parts: string[] = [];
  if (f.amount_mil !== undefined)
    parts.push(`${formatTnd(e.amount_mil, { unit: false })} → ${formatTnd(f.amount_mil)}`);
  if (f.category !== undefined) parts.push(`${categoryLabel(e.category)} → ${categoryLabel(f.category)}`);
  if (f.pot !== undefined && f.pot !== e.pot) parts.push(`${t(`pot.${e.pot}`)} → ${t(`pot.${f.pot}`)}`);
  if (f.label !== undefined) parts.push(`« ${e.label} » → « ${f.label} »`);
  if (f.spent_on !== undefined) parts.push(`${shortDate(e.spent_on)} → ${shortDate(f.spent_on)}`);
  return parts.join(' · ');
}
