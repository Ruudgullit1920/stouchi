import { ChevronLeft, Search } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { back, route } from '../../app/router';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import { DayHeader } from '../../design/components/DayHeader';
import { EmptyState } from '../../design/components/EmptyState';
import { LedgerRow } from '../../design/components/LedgerRow';
import { MonthSwitcher } from '../../design/components/MonthSwitcher';
import { Pill } from '../../design/components/Pill';
import { Skeleton } from '../../design/components/Skeleton';
import { PERIODS_KEPT } from '../../data/app';
import { categoryLabel, type CategoryKey, type Pot } from '../../shared/categories';
import { authorOf } from '../../shared/couple';
import { isInPeriod, periodsBack, todayTunis } from '../../shared/dates';
import { factsInput } from '../../data/store';
import { computeFacts } from '../../shared/facts';
import { monthName } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { groupByDay, potBreakdown, titleOf } from '../../shared/ledger';
import { formatTnd } from '../../shared/money';
import { normalize } from '../../shared/search';
import './pot.css';

const COLOR: Record<Pot, string> = { needs: 'var(--need)', wants: 'var(--want)' };
const SOFT: Record<Pot, string> = { needs: 'var(--need-soft)', wants: 'var(--want-soft)' };
const INK: Record<Pot, string> = { needs: 'var(--need-ink)', wants: 'var(--want-ink)' };
const tint = (pot: Pot, pct: number) => `color-mix(in srgb, ${COLOR[pot]} ${pct}%, white)`;

/** Where did this pot go? (spec §3) — one pay period at a time. */
export function PotScreen({ store, onOpenExpense }: ScreenProps) {
  const pot: Pot = route.value.params.pot === 'wants' ? 'wants' : 'needs';
  const [back_, setBack] = useState(0); // 0 = current period
  const [filter, setFilter] = useState<CategoryKey | 'all'>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const profile = store.profile.value;
  if (!profile) return <Skeleton lines={8} />;

  const today = todayTunis();
  const periods = periodsBack(today, profile.payday, PERIODS_KEPT);
  const period = periods[back_];
  const current = back_ === 0;
  const facts = computeFacts(factsInput(store, profile, today));
  const budget = facts.pots[pot].budget;
  const { total, categories } = potBreakdown(store.expenses.value, pot, period);
  const active = filter !== 'all' && categories.some((c) => c.key === filter) ? filter : 'all';
  const left = current ? facts.pots[pot].left : budget - total;
  const q = normalize(query.trim());

  const items = store.expenses.value.filter(
    (e) =>
      e.pot === pot &&
      isInPeriod(e.spent_on, period) &&
      (active === 'all' || e.category === active) &&
      (!q || normalize(`${titleOf(e)} ${categoryLabel(e.category)}`).includes(q)),
  );
  const days = groupByDay(items);
  const step = (by: number) => {
    setBack((b) => Math.min(PERIODS_KEPT - 1, Math.max(0, b + by)));
    setFilter('all');
  };

  return (
    <>
      <header class="top">
        <button type="button" class="icon-btn line" aria-label={t('action.back')} onClick={back}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <MonthSwitcher
          label={monthName(period.label)}
          onPrev={() => step(1)}
          onNext={() => step(-1)}
          canPrev={back_ < PERIODS_KEPT - 1}
          canNext={back_ > 0}
        />
        <button
          type="button"
          class="icon-btn line"
          aria-label={t('pot.search')}
          aria-expanded={searching}
          onClick={() => {
            setSearching((s) => !s);
            setQuery('');
          }}
        >
          <Search size={18} aria-hidden="true" />
        </button>
      </header>

      {searching && (
        <label class="searchbar">
          <Search size={18} aria-hidden="true" />
          <span class="visually-hidden">{t('pot.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('pot.searchPlaceholder')}
            autocomplete="off"
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
      )}

      {categories.length > 1 && (
        <div class="filters">
          <Pill label={t('pot.all')} pressed={active === 'all'} onToggle={() => setFilter('all')} />
          {categories.map((c) => (
            <Pill
              key={c.key}
              label={categoryLabel(c.key)}
              pressed={active === c.key}
              onToggle={() => setFilter(active === c.key ? 'all' : c.key)}
            />
          ))}
        </div>
      )}

      <section class="sumcard" aria-label={t(`pot.${pot}`)}>
        <div class="sumcard__head">
          <span>
            <i style={{ background: COLOR[pot] }} aria-hidden="true" />
            {t('pot.head', {
              pot: t(`pot.${pot}`),
              pct: facts.split[pot],
            })}
          </span>
          <b class="num">
            {formatTnd(total, { unit: false })}{' '}
            <small>{t('pot.ofBudget', { amount: formatTnd(budget) })}</small>
          </b>
        </div>
        <div class="chunks" aria-hidden="true">
          {categories.map((c) => (
            <i
              key={c.key}
              class={active !== 'all' && active !== c.key ? 'dim' : undefined}
              style={{ flex: c.total, background: tint(pot, c.tint) }}
            />
          ))}
          {left > 0 && <i style={{ flex: left, background: 'var(--line)' }} />}
        </div>
        <ul class="legend2">
          {categories.map((c) => (
            <li key={c.key}>
              <i style={{ background: tint(pot, c.tint) }} aria-hidden="true" />
              {categoryLabel(c.key)}
              <b class="num">{formatTnd(c.total, { unit: false })}</b>
            </li>
          ))}
          {left > 0 && (
            <li>
              <i style={{ background: 'var(--line)' }} aria-hidden="true" />
              {t('pot.available')}
              <b class="num">{formatTnd(left, { unit: false })}</b>
            </li>
          )}
        </ul>
        <p class="sumfoot" style={{ background: SOFT[pot], color: INK[pot] }}>
          <span>{left < 0 ? t('pot.over') : current ? t('pot.left') : t('pot.unspent')}</span>
          <b class="num">
            {formatTnd(Math.abs(left))}
            {current &&
              left >= 0 &&
              ` · ${t('pot.perDay', { amount: formatTnd(Math.floor(left / facts.daysLeft), { unit: false }) })}`}
          </b>
        </p>
      </section>

      {days.length ? (
        days.map((d) => (
          <section key={d.date} class="day">
            <DayHeader date={d.date} />
            {d.items.map((e) => (
              <LedgerRow
                key={e.id}
                icon={CATEGORY_ICON[e.category]}
                tint={SOFT[pot]}
                title={titleOf(e)}
                subtitle={categoryLabel(e.category)}
                mil={-e.amount_mil}
                author={authorOf(e, profile, store.household.value)}
                onClick={() => onOpenExpense?.(e)}
              />
            ))}
          </section>
        ))
      ) : (
        <EmptyState title={t('pot.empty')} />
      )}
    </>
  );
}
