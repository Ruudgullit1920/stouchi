import { ChevronLeft, Search } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { back, route } from '../../app/router';
import { CATEGORY_ICON, categoryI3d } from '../../design/components/CategoryIcon';
import { DayHeader } from '../../design/components/DayHeader';
import { EmptyState } from '../../design/components/EmptyState';
import { LedgerRow } from '../../design/components/LedgerRow';
import { MonthSwitcher } from '../../design/components/MonthSwitcher';
import { Pill } from '../../design/components/Pill';
import { Skeleton } from '../../design/components/Skeleton';
import { Icon3D } from '../../design/i3d';
import { PERIODS_KEPT } from '../../data/app';
import { categoryLabel, type CategoryKey, type Pot } from '../../shared/categories';
import { authorOf } from '../../shared/couple';
import { daysBetween, isInPeriod, periodsBack, todayTunis } from '../../shared/dates';
import { factsInput } from '../../data/store';
import { computeFacts } from '../../shared/facts';
import { monthName } from '../../shared/format';
import { t, type StringKey } from '../../shared/i18n/t';
import { groupByDay, potBreakdown, titleOf } from '../../shared/ledger';
import { formatTnd } from '../../shared/money';
import { normalize } from '../../shared/search';
import './pot.css';

const COLOR: Record<Pot, string> = { needs: 'var(--need)', wants: 'var(--want)' };
const SOFT: Record<Pot, string> = { needs: 'var(--need-soft)', wants: 'var(--want-soft)' };
const INK: Record<Pot, string> = { needs: 'var(--need-ink)', wants: 'var(--want-ink)' };
const tint = (pot: Pot, pct: number) => `color-mix(in srgb, ${COLOR[pot]} ${pct}%, white)`;
/* the hero's bar: one white per category, fading (prototype renderPot) */
const WHITES = [1, 0.72, 0.5, 0.34, 0.22];
const GOOD = '#3DDC97';
const WARN = '#FFC53D';
const BAD = '#FF6B6B';

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
  /* the chip: over, kept (a past period), or how the spending keeps pace with the days gone */
  const used = budget > 0 ? total / budget : 0;
  const pace = Math.min(1, daysBetween(period.start, today) / (daysBetween(period.start, period.end) + 1));
  const status: { key: StringKey; dot: string } =
    left < 0
      ? { key: 'pot.status.over', dot: BAD }
      : !current
        ? { key: 'pot.status.kept', dot: GOOD }
        : used >= 0.8
          ? { key: 'pot.status.warn', dot: WARN }
          : used > pace + 0.1
            ? { key: 'pot.status.fast', dot: WARN }
            : { key: 'pot.status.onPace', dot: GOOD };
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
          label={`${monthName(period.label)} ${period.label.slice(0, 4)}`}
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

      <section class="sumcard" aria-label={t(`pot.${pot}`)} style={{ '--c': INK[pot], '--s': SOFT[pot] }}>
        <div class="ps-hero">
          <div class="ps-top">
            <span class="ps-pot">{t(`pot.${pot}`)}</span>
            <span class="ps-chip" style={{ '--d': status.dot }}>
              <i aria-hidden="true" />
              {t(status.key)}
            </span>
          </div>
          <div class="ps-big">
            <b class="num">{formatTnd(left, { unit: false })}</b>
            <span>{t(left < 0 ? 'pot.unit' : current ? 'pot.rest' : 'pot.restPast')}</span>
            {current && left >= 0 && (
              <em class="num">
                {t('pot.perDay', { amount: formatTnd(Math.floor(left / facts.daysLeft), { unit: false }) })}
              </em>
            )}
          </div>
          <div class="ps-track">
            <div class="ps-bar" aria-hidden="true">
              {categories.map((c, i) => (
                <i
                  key={c.key}
                  class={active !== 'all' && active !== c.key ? 'dim' : undefined}
                  style={{
                    flex: c.total,
                    background: `rgba(255, 255, 255, ${WHITES[Math.min(i, WHITES.length - 1)]})`,
                  }}
                />
              ))}
              {left > 0 && <i style={{ flex: left, background: 'transparent' }} />}
            </div>
            {current && left >= 0 && (
              <div
                class="ps-tick"
                style={{ left: `${pace * 100}%` }}
                title={t('pot.today')}
                aria-hidden="true"
              />
            )}
          </div>
          <div class="ps-cap">
            <span class="num">
              {t('pot.spentOf', {
                spent: formatTnd(total, { unit: false }),
                budget: formatTnd(budget, { unit: false }),
              })}
            </span>
            <span>{current ? t('pot.daysLeft', { n: facts.daysLeft }) : monthName(period.label)}</span>
          </div>
        </div>
        {categories.length > 1 && (
          <div class="ps-list">
            {categories.map((c) => {
              const on = active === c.key;
              const share = total ? c.total / total : 0;
              return (
                <button
                  key={c.key}
                  type="button"
                  class={on ? 'bk on' : active !== 'all' ? 'bk dim' : 'bk'}
                  aria-pressed={on}
                  aria-label={t('pot.share', { label: categoryLabel(c.key), pct: Math.round(share * 100) })}
                  onClick={() => setFilter(on ? 'all' : c.key)}
                >
                  <span class="bk-ic" aria-hidden="true">
                    <Icon3D src={categoryI3d(c.key)} />
                  </span>
                  <span>
                    <span class="bk-top">
                      <b>{categoryLabel(c.key)}</b>
                      <b class="bk-amt num">{formatTnd(c.total, { unit: false })}</b>
                    </span>
                    <span class="bk-bar">
                      <i style={{ width: `${share * 100}%`, background: tint(pot, c.tint) }} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {days.length ? (
        days.map((d) => (
          <section key={d.date} class="day">
            <DayHeader date={d.date} />
            {d.items.map((e) => (
              <LedgerRow
                key={e.id}
                icon={CATEGORY_ICON[e.category]}
                img={categoryI3d(e.category)}
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
