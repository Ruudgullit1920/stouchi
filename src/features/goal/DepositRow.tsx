import { AuthorBadge } from '../../design/components/AuthorBadge';
import { Coins, HandCoins } from 'lucide-preact';
import { HIDDEN } from '../../design/components/Amount';
import { monthName, shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import type { SavingsMove } from '../../shared/schemas';

/** "de septembre", "d’août" */
const ofMonth = (d: string) => {
  const m = monthName(d.slice(0, 7)).toLowerCase();
  return /^[aeiou]/.test(m) ? `d’${m}` : `de ${m}`;
};

/** One line of Versements: the payday share, a deposit, or a withdrawal (in warn colour). */
export function DepositRow({
  move,
  hidden,
  author,
}: {
  move: SavingsMove;
  hidden: boolean;
  /** couple mode: who made this move on the shared goal (plan D9) */
  author?: string | null;
}) {
  const Icon = move.kind === 'payday' ? Coins : HandCoins;
  return (
    <li class="goal-move">
      <span class="goal-move__lead">
        <span class="goal-move__ic" aria-hidden="true">
          <Icon size={18} />
        </span>
        {author && <AuthorBadge name={author} />}
      </span>
      <span>
        <span class="goal-move__t">{t(`goal.move.${move.kind}`, { month: ofMonth(move.occurred_on) })}</span>
        <span class="goal-move__s">
          {t(`goal.move.${move.kind}.sub`, { date: shortDate(move.occurred_on) })}
        </span>
      </span>
      <span class={move.amount_mil < 0 ? 'goal-move__a num goal-move__a--out' : 'goal-move__a num'}>
        {hidden ? HIDDEN : formatTnd(move.amount_mil, { unit: false, sign: true })}
      </span>
    </li>
  );
}
