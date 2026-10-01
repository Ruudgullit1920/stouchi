import {
  CalendarHeart,
  Car,
  Heart,
  House,
  PartyPopper,
  Plane,
  Shield,
  Sparkles,
  type LucideIcon,
} from 'lucide-preact';
import { monthName } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { formatMoney } from '../../shared/money';
import { goalEta } from '../../shared/payday';
import { AmountInput } from './AmountInput';
import { GOAL_PRESETS, goalLabel, goalTarget, potsOf, type GoalKey, type StepProps } from './draft';

const ICONS: Record<GoalKey, LucideIcon> = {
  maison: House,
  voiture: Car,
  mariage: Heart,
  voyage: Plane,
  secu: Shield,
  autre: Sparkles,
};

export function StepGoal({ draft, set, today }: StepProps) {
  const goal = draft.goal;
  const rate = potsOf(draft.salary_mil).savings;
  const choose = (key: GoalKey) =>
    set({ goal: { key, target_mil: goalTarget(key, draft.salary_mil), saved_mil: goal?.saved_mil ?? 0 } });

  return (
    <>
      <div class="goals">
        {GOAL_PRESETS.map(({ key }) => {
          const Icon = ICONS[key];
          return (
            <button
              key={key}
              type="button"
              class={goal?.key === key ? 'on' : undefined}
              aria-pressed={goal?.key === key}
              onClick={() => choose(key)}
            >
              <span class="gi" aria-hidden="true">
                <Icon />
              </span>
              {t(goalLabel(key))}
            </button>
          );
        })}
      </div>
      {goal && (
        <div class="gfields">
          <div class="gfield">
            <span aria-hidden="true">{t('setup.goal.target')}</span>
            <AmountInput
              label={t('setup.goal.target')}
              value={goal.target_mil}
              digits={7}
              unit={t('setup.currency')}
              onChange={(target_mil) => set({ goal: { ...goal, target_mil } })}
            />
          </div>
          <div class="gfield">
            <span aria-hidden="true">{t('setup.goal.saved')}</span>
            <AmountInput
              label={t('setup.goal.saved')}
              value={goal.saved_mil}
              digits={7}
              unit={t('setup.currency')}
              onChange={(saved_mil) => set({ goal: { ...goal, saved_mil } })}
            />
          </div>
          <Eta target={goal.target_mil} saved={goal.saved_mil} rate={rate} today={today} />
        </div>
      )}
    </>
  );
}

function Eta({ target, saved, rate, today }: { target: number; saved: number; rate: number; today: string }) {
  if (!target)
    return (
      <p class="eta">
        <CalendarHeart aria-hidden="true" />
        {t('setup.goal.etaEmpty')}
      </p>
    );
  if (saved >= target)
    return (
      <p class="eta">
        <PartyPopper aria-hidden="true" />
        {t('setup.goal.etaReached')}
      </p>
    );
  const when = goalEta(target, saved, rate, today);
  return (
    <p class="eta">
      <CalendarHeart aria-hidden="true" />
      {when &&
        t('setup.goal.eta', {
          rate: formatMoney(rate),
          when: `${monthName(when.slice(0, 7)).toLowerCase()} ${when.slice(0, 4)}`,
        })}
    </p>
  );
}
