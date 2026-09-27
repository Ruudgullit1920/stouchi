import { CalendarHeart, PartyPopper, Plus } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { closeSheet, openSheet } from '../../app/ui';
import { HIDDEN } from '../../design/components/Amount';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { ErrorState } from '../../design/components/ErrorState';
import { Pill } from '../../design/components/Pill';
import { Skeleton } from '../../design/components/Skeleton';
import { syncNow, undoHeld, writeMine } from '../../data/app';
import type { Row } from '../../data/localdb';
import { nextPayday, payPeriod, todayTunis } from '../../shared/dates';
import { monthYear, shortDate } from '../../shared/format';
import { goalView, sooner } from '../../shared/goal';
import { t } from '../../shared/i18n/t';
import { MIL_PER_TND, formatMoney, splitSalary } from '../../shared/money';
import { activeGoal } from '../../shared/payday';
import { planFor } from '../../shared/plan';
import { hideAmounts } from '../budget/hideAmounts';
import type { Goal } from '../../shared/schemas';
import { DepositRow } from './DepositRow';
import { DepositSheet } from './DepositSheet';
import { GoalSheet } from './GoalSheet';
import { authorOf } from '../../shared/couple';
import { goalIcon } from './goalIcon';
import './goal.css';

const EXTRAS = [50, 100, 200];
const SHOWN = 6;
/** a Verser stays on the device this long, so its undo (the 6 s toast) never reaches the server */
const UNDO_HOLD_MS = 8_000;
const writeGoal = (table: 'goals', row: Row) => writeMine(table, row);

/** Objectif (spec §3): when do I reach my goal? */
export function GoalScreen({ store }: ScreenProps) {
  const [extra, setExtra] = useState<number | null>(null);
  const profile = store.profile.value;
  const { load } = store.sync.value;
  if (!profile && load === 'loading') return <Skeleton lines={6} />;
  if (!profile && load === 'error') return <ErrorState onRetry={() => void syncNow()} />;

  const goal = activeGoal(store.goals.value);
  const verser = (g: Goal) =>
    openSheet(
      t('goal.deposit.title'),
      <DepositSheet
        store={store}
        goal={g}
        write={(row) => writeMine('savings_moves', row, { holdMs: UNDO_HOLD_MS })}
        undo={(id) => undoHeld('savings_moves', id)}
        onDone={closeSheet}
      />,
    );
  const edit = (g: Goal) =>
    openSheet(t('goal.edit'), <GoalSheet store={store} goal={g} write={writeGoal} onDone={closeSheet} />);
  const create = () =>
    openSheet(
      t('goal.new'),
      <GoalSheet store={store} current={goal} write={writeGoal} onDone={closeSheet} />,
    );
  const header = (
    <header class="top">
      <h1>{t('nav.goal')}</h1>
      {goal && (
        <button type="button" class="pill goal-verser" onClick={() => verser(goal)}>
          <Plus size={16} aria-hidden="true" />
          {t('goal.verser')}
        </button>
      )}
    </header>
  );
  if (!profile || !goal)
    return (
      <>
        {header}
        <EmptyState
          title={t('goal.none.title')}
          body={t('goal.none.body')}
          action={<Button onClick={create}>{t('goal.none.cta')}</Button>}
        />
      </>
    );

  const today = todayTunis();
  const { salary_mil, split } = planFor(profile, payPeriod(today, profile.payday));
  const monthly = splitSalary(salary_mil, split).savings;
  const v = goalView(goal, store.savingsMoves.value, monthly, today);
  const hidden = hideAmounts.value;
  const money = (m: number, unit = true) => (hidden ? HIDDEN : formatMoney(m, { unit }));
  const Icon = goalIcon(goal.icon);
  const gain = extra === null ? null : sooner(goal, v.saved, monthly, extra * MIL_PER_TND, today);

  return (
    <>
      {header}
      <button type="button" class="goal-card" onClick={() => edit(goal)}>
        <span class="goal-card__head">
          <span class="goal-card__name">
            <Icon size={16} aria-hidden="true" />
            {goal.name}
          </span>
          <span class="goal-card__pct num">{`${v.pct} %`}</span>
        </span>
        <span class="goal-card__saved num">
          {money(v.saved, false)}
          <span class="unit">{t('unit.money')}</span>
        </span>
        <span class="goal-card__target">{t('goal.of', { amount: money(goal.target_mil) })}</span>
        <span class="goal-card__bar" aria-hidden="true">
          <i style={{ width: `${v.pct}%` }} />
        </span>
        <span class="goal-card__foot">
          <span>{monthly > 0 ? t('goal.rate', { amount: money(monthly) }) : t('goal.noRate')}</span>
          <b>{v.reached ? t('goal.reached') : v.eta ? monthYear(v.eta) : t('goal.noEta')}</b>
        </span>
        <span class="visually-hidden">{t('goal.edit')}</span>
      </button>

      {v.reached ? (
        <div class="goal-next">
          <p>
            <PartyPopper size={18} aria-hidden="true" />
            {t('goal.reached')}
          </p>
          <Button onClick={create}>{t('goal.new')}</Button>
        </div>
      ) : (
        <section class="goal-whatif">
          <h2>{t('goal.whatIf')}</h2>
          <div class="filters">
            {EXTRAS.map((n) => (
              <Pill
                key={n}
                label={t('goal.whatIf.extra', { n })}
                pressed={extra === n}
                onToggle={() => setExtra(extra === n ? null : n)}
              />
            ))}
          </div>
          <p class="goal-whatif__box" aria-live="polite">
            {extra === null
              ? t('goal.whatIf.hint')
              : !gain
                ? t('goal.whatIf.same')
                : gain.months === null
                  ? t('goal.whatIf.date', { when: monthYear(gain.eta) })
                  : t('goal.whatIf.sooner', { when: monthYear(gain.eta), n: gain.months })}
          </p>
        </section>
      )}

      <div class="sec">
        <h2>{t('goal.deposits')}</h2>
        {v.deposits.length > 0 && (
          <span class="meta">
            {t('goal.deposits.meta', { n: v.deposits.length, amount: money(v.saved) })}
          </span>
        )}
      </div>
      {v.deposits.length ? (
        <ul class="list">
          {v.deposits.slice(0, SHOWN).map((m) => (
            <DepositRow
              key={m.id}
              move={m}
              hidden={hidden}
              author={authorOf(
                { user_id: m.user_id, household_id: goal.household_id },
                profile,
                store.household.value,
              )}
            />
          ))}
        </ul>
      ) : (
        <div class="list">
          <p class="empty-row">
            <CalendarHeart size={18} aria-hidden="true" />
            {t('goal.deposits.first', { date: shortDate(nextPayday(today, profile.payday)) })}
          </p>
        </div>
      )}
    </>
  );
}
