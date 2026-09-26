import { ChevronRight, Coins, House, Sparkles, type LucideIcon } from 'lucide-preact';
import type { PotFacts } from '../../shared/facts';
import { t } from '../../shared/i18n/t';
import { formatTnd, type Mil } from '../../shared/money';
import { HIDDEN } from './hideAmounts';

type Kind = 'needs' | 'wants' | 'savings';
const LOOK: Record<Kind, { icon: LucideIcon; color: string }> = {
  /* the *-ink shades: white text on them passes AA (spec §5.6) */
  needs: { icon: House, color: 'var(--need-ink)' },
  wants: { icon: Sparkles, color: 'var(--want-ink)' },
  savings: { icon: Coins, color: 'var(--save-ink)' },
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
  onOpen: () => void;
};

export function PotCard({ kind, pct, facts, budget, hidden, shared = false, onOpen }: Props) {
  const { icon: Icon, color } = LOOK[kind];
  const money = (m: Mil) => (hidden ? HIDDEN : formatTnd(m, { unit: false }));
  const over = facts && facts.left < 0;
  return (
    <button type="button" class="pot" style={{ background: color }} onClick={onOpen}>
      <span class="pot__tile" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span>
        <span class="pot__name">
          {t(`pot.${kind}`)}
          {shared && <span class="pot__tag">{t('budget.pot.shared')}</span>}
          {facts?.warn && !over && <span class="pot__tag">{t('budget.pot.warn')}</span>}
        </span>
        <span class="pot__desc">
          {pct} % · {t(`pot.${kind}.desc`)}
        </span>
      </span>
      <span class="pot__amt">
        {facts ? (
          <>
            <b class="num">{money(Math.max(0, facts.left))}</b>
            <span>
              {over
                ? t('budget.pot.over', { amount: hidden ? HIDDEN : formatTnd(-facts.left) })
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
