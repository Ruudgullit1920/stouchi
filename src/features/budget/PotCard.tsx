import { ChevronRight, CircleCheck } from 'lucide-preact';
import { Icon3D, i3dFile } from '../../design/i3d';
import type { PotFacts } from '../../shared/facts';
import { t } from '../../shared/i18n/t';
import { formatMoney, type Mil } from '../../shared/money';
import { HIDDEN } from './hideAmounts';

type Kind = 'needs' | 'wants' | 'savings';
const LOOK: Record<Kind, { icon: string; color: string }> = {
  /* the prototype's pot colours, as the owner asked (spec §5.6 notes the contrast) */
  needs: { icon: 'house', color: 'var(--need)' },
  wants: { icon: 'sparkles', color: 'var(--want)' },
  savings: { icon: 'money_bag', color: 'var(--save)' },
};

type Props = {
  kind: Kind;
  pct: number;
  /** Besoins and Envies; Épargne only has a budget */
  facts?: PotFacts;
  budget: Mil;
  hidden: boolean;
  /** couple mode: Besoins are the household's (plan D9) */
  shared?: boolean;
  /** Épargne: the goal it goes to, shown as "→ Notre maison" (prototype) */
  goal?: string;
  onOpen: () => void;
};

export function PotCard({ kind, pct, facts, budget, hidden, shared = false, goal, onOpen }: Props) {
  const { icon, color } = LOOK[kind];
  const money = (m: Mil) => (hidden ? HIDDEN : formatMoney(m, { unit: false }));
  const over = facts && facts.left < 0;
  return (
    <button type="button" class="pot" style={{ background: color }} onClick={onOpen}>
      <span class="pot__tile" aria-hidden="true">
        <Icon3D src={i3dFile(icon)} />
      </span>
      <span>
        <span class="pot__name">
          {t(`pot.${kind}`)}
          {shared && <span class="pot__tag">{t('budget.pot.shared')}</span>}
          {facts?.warn && !over && <span class="pot__tag">{t('budget.pot.warn')}</span>}
          {kind === 'savings' && <CircleCheck size={16} aria-hidden="true" />}
        </span>
        <span class="pot__desc">
          {pct} % · {goal ? t('budget.pot.toGoal', { goal }) : t(`pot.${kind}.desc`)}
        </span>
      </span>
      <span class="pot__amt">
        {facts ? (
          <>
            <b class="num">{money(Math.max(0, facts.left))}</b>
            <span>
              {over
                ? t('budget.pot.over', { amount: hidden ? HIDDEN : formatMoney(-facts.left) })
                : t('budget.of', { amount: money(facts.budget) })}
            </span>
          </>
        ) : (
          <>
            <b class="num">{money(budget)}</b>
            <span>{t('budget.pot.saved')}</span>
          </>
        )}
      </span>
      <ChevronRight size={18} class="pot__chev" aria-hidden="true" />
      <span class="pot__minibar" aria-hidden="true">
        <i style={{ width: `${Math.min(1, facts?.ratio ?? 1) * 100}%` }} />
      </span>
    </button>
  );
}
