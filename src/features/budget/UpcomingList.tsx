import { CalendarCheck } from 'lucide-preact';
import { Amount } from '../../design/components/Amount';
import { Icon3D, billI3d, i3dFile } from '../../design/i3d';
import type { Upcoming } from '../../shared/facts';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { HIDDEN } from './hideAmounts';

/** Bills not yet paid and debts due before payday. Read-only until Phase 4's "Marquer payée". */
export function UpcomingList({ items, hidden }: { items: Upcoming[]; hidden: boolean }) {
  if (!items.length)
    return (
      <div class="list">
        <p class="empty-row">
          <CalendarCheck size={18} aria-hidden="true" />
          {t('budget.nothingDue')}
        </p>
      </div>
    );
  return (
    <ul class="list rows">
      {items.map((u) => {
        const incoming = u.kind === 'debt' && u.direction === 'owed_to_me';
        const src = u.kind === 'bill' ? billI3d(u.label) : i3dFile('money_with_wings');
        const title =
          u.kind === 'bill'
            ? u.label
            : t(incoming ? 'budget.debt.owed' : 'budget.debt.owe', { person: u.label });
        return (
          <li key={`${u.kind}-${u.id}-${u.due_on}`} class="ledger-row ledger-row--static">
            <span class="ledger-row__avatar ledger-row__avatar--3d" aria-hidden="true">
              <Icon3D src={src} />
            </span>
            <span class="ledger-row__text">
              <span class="ledger-row__title">{title}</span>
              <span class="ledger-row__sub">{t('budget.due', { date: shortDate(u.due_on) })}</span>
            </span>
            {hidden ? (
              <span class="ledger-row__amount">{HIDDEN}</span>
            ) : (
              <Amount mil={incoming ? u.amount_mil : -u.amount_mil} sign class="ledger-row__amount" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
