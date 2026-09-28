import { Eye, EyeOff, Plus } from 'lucide-preact';
import type { ScreenProps } from '../../app/Shell';
import { navigate } from '../../app/router';
import { CATEGORY_ICON, categoryI3d } from '../../design/components/CategoryIcon';
import { EmptyState } from '../../design/components/EmptyState';
import { ErrorState } from '../../design/components/ErrorState';
import { LedgerRow } from '../../design/components/LedgerRow';
import { SegmentedBar } from '../../design/components/SegmentedBar';
import { Skeleton } from '../../design/components/Skeleton';
import { useRolling } from '../../design/useRolling';
import { syncNow } from '../../data/app';
import { categoryLabel } from '../../shared/categories';
import { authorOf } from '../../shared/couple';
import { todayTunis } from '../../shared/dates';
import { factsInput } from '../../data/store';
import { computeFacts } from '../../shared/facts';
import { initials, monthName, shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { titleOf } from '../../shared/ledger';
import { formatTnd } from '../../shared/money';
import { Bell } from '../notifications/Bell';
import { HIDDEN, hideAmounts, toggleHideAmounts } from './hideAmounts';
import { activeGoal } from '../../shared/payday';
import { PotCard } from './PotCard';
import { UpcomingList } from './UpcomingList';
import './budget.css';

/** Home (spec §3): what can I still spend? */
export function BudgetScreen({ store, onOpenExpense, onAdd }: ScreenProps) {
  const profile = store.profile.value;
  const { load } = store.sync.value;
  const facts = profile ? computeFacts(factsInput(store, profile, todayTunis())) : null;
  const left = useRolling(facts?.left ?? 0);

  if (!profile && load === 'loading') return <Skeleton lines={8} />;
  if (!profile && load === 'error') return <ErrorState onRetry={() => void syncNow()} />;
  if (!profile || !facts)
    return <EmptyState title={t('budget.noProfile.title')} body={t('budget.noProfile.body')} />;

  const hidden = hideAmounts.value;
  const money = (m: number, unit = false) => (hidden ? HIDDEN : formatTnd(m, { unit }));
  const { needs, wants, savings } = facts.pots;

  return (
    <>
      <header class="top">
        <h1>{t('nav.budget')}</h1>
        <div class="top-actions">
          <span class="period-pill">{monthName(facts.period.label)}</span>
          <Bell store={store} />
          <button type="button" class="avatar" aria-label={t('nav.me')} onClick={() => navigate('#/me')}>
            {initials(profile.first_name)}
          </button>
        </div>
      </header>

      <div class="label lab-eye">
        {t('budget.remaining')}
        <button
          type="button"
          class="eye"
          aria-label={t('budget.hide')}
          aria-pressed={hidden}
          onClick={toggleHideAmounts}
        >
          {hidden ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      <div class="hero">
        <p class={facts.left < 0 ? 'big num big--over' : 'big num'}>
          {money(left)}
          <span class="unit">{t('unit.tnd')}</span>
        </p>
        <p class="perday">
          <b class="num">{t('budget.perDay', { amount: money(facts.perDay) })}</b>
          <span>{t('period.daysLeft', { n: facts.daysLeft })}</span>
        </p>
      </div>
      <SegmentedBar
        segments={[
          { label: t('pot.needs'), mil: needs.spent, color: 'var(--need)' },
          { label: t('pot.wants'), mil: wants.spent, color: 'var(--want)' },
          { label: t('budget.bar.reserved'), mil: needs.reserved, color: 'var(--need-soft)' },
          { label: t('budget.bar.left'), mil: Math.max(0, facts.left), color: 'var(--line)' },
        ]}
      />
      <p class="legend">
        <span>{t('budget.spent', { amount: money(needs.spent + wants.spent) })}</span>
        <span>{t('budget.of', { amount: money(needs.budget + wants.budget, true) })}</span>
      </p>

      <div class="sec">
        <h2>{t('budget.split')}</h2>
        <span class="meta">
          {facts.split.needs} · {facts.split.wants} · {facts.split.savings}
        </span>
      </div>
      <div class="pots">
        <PotCard
          kind="needs"
          pct={facts.split.needs}
          facts={needs}
          budget={needs.budget}
          hidden={hidden}
          shared={store.household.value?.status === 'on'}
          onOpen={() => navigate('#/pot/needs')}
        />
        <PotCard
          kind="wants"
          pct={facts.split.wants}
          facts={wants}
          budget={wants.budget}
          hidden={hidden}
          onOpen={() => navigate('#/pot/wants')}
        />
        <PotCard
          kind="savings"
          pct={facts.split.savings}
          budget={savings.budget}
          hidden={hidden}
          goal={activeGoal(store.goals.value)?.name}
          onOpen={() => navigate('#/goal')}
        />
      </div>

      <div class="sec">
        <h2>{t('budget.upcoming')}</h2>
        <button type="button" class="link" onClick={() => navigate('#/me/bills')}>
          {t('budget.bills')}
        </button>
      </div>
      <UpcomingList items={facts.upcoming} hidden={hidden} />

      <div class="sec">
        <h2>{t('budget.recent')}</h2>
        <button type="button" class="link" onClick={() => navigate('#/history')}>
          {t('budget.seeAll')}
        </button>
      </div>
      <div class="list rows">
        {facts.recent.length ? (
          facts.recent.map((e) => (
            <LedgerRow
              key={e.id}
              icon={CATEGORY_ICON[e.category]}
              img={categoryI3d(e.category)}
              tint={e.pot === 'needs' ? 'var(--need-soft)' : 'var(--want-soft)'}
              title={titleOf(e)}
              subtitle={`${categoryLabel(e.category)} · ${shortDate(e.spent_on)}`}
              mil={-e.amount_mil}
              hidden={hidden}
              author={authorOf(e, profile, store.household.value)}
              onClick={() => onOpenExpense?.(e)}
            />
          ))
        ) : (
          <div class="first-exp">
            <button type="button" class="first-exp__ic" aria-label={t('nav.add')} onClick={onAdd}>
              <Plus size={20} aria-hidden="true" />
            </button>
            <span>
              <b>{t('budget.first.title')}</b>
              <span>{t('budget.first.body')}</span>
            </span>
          </div>
        )}
      </div>
    </>
  );
}
