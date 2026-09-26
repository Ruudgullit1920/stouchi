import { Sparkles } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ScreenProps } from '../../app/Shell';
import { navigate, route } from '../../app/router';
import { CATEGORY_ICON } from '../../design/components/CategoryIcon';
import { DayHeader } from '../../design/components/DayHeader';
import { EmptyState } from '../../design/components/EmptyState';
import { Highlight } from '../../design/components/Highlight';
import { LedgerRow } from '../../design/components/LedgerRow';
import { MonthBars } from '../../design/components/MonthBars';
import { SearchField } from '../../design/components/SearchField';
import { Skeleton } from '../../design/components/Skeleton';
import { PERIODS_KEPT } from '../../data/app';
import { categoryLabel, isCategory, type CategoryKey } from '../../shared/categories';
import { authorOf } from '../../shared/couple';
import { addDays, isInPeriod, payPeriod, periodsBack, todayTunis } from '../../shared/dates';
import { monthName } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { groupByDay, historyLine, periodTotals, potBreakdown, titleOf } from '../../shared/ledger';
import { formatTnd, splitSalary } from '../../shared/money';
import { searchExpenses } from '../../shared/search';
import type { Expense } from '../../shared/schemas';
import '../pot/pot.css';
import './history.css';

const SOFT = { needs: 'var(--need-soft)', wants: 'var(--want-soft)' } as const;
const COLOR = { needs: 'var(--need)', wants: 'var(--want)' } as const;

/** What happened, and when? (spec §3, §4.3) — browse by pay period, or search them all. */
export function HistoryScreen({ store, onOpenExpense }: ScreenProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  /* #/history/<category> (a notification's Voir la catégorie) opens filtered */
  const [cat, setCat] = useState<CategoryKey | null>(() => {
    const c = route.value.params.category;
    return c && isCategory(c) ? c : null;
  });
  /* couple mode: Tout, or only the rows I logged (plan D9) */
  const [mine, setMine] = useState(false);

  const profile = store.profile.value;
  if (!profile) return <Skeleton lines={8} />;

  const couple = store.household.value;
  const paired = couple?.status === 'on';
  const expenses =
    paired && mine ? store.expenses.value.filter((e) => e.user_id === profile.user_id) : store.expenses.value;
  const today = todayTunis();
  const newestFirst = periodsBack(today, profile.payday, PERIODS_KEPT);
  const periods = [...newestFirst].reverse();
  const index = picked ?? periods.length - 1;
  const period = periods[index];
  const previous = periods[index - 1] ?? payPeriod(addDays(period.start, -1), profile.payday);
  const totals = periodTotals(expenses, periods);
  /* quick searches: the pots, then the three biggest categories across the year kept */
  const year = { start: periods[0].start, end: newestFirst[0].end, label: '' };
  const topCats = [
    ...potBreakdown(expenses, 'needs', year).categories,
    ...potBreakdown(expenses, 'wants', year).categories,
  ]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((c) => categoryLabel(c.key));
  const chips = [t('pot.needs'), t('pot.wants'), ...topCats];

  const openRow = (e: Expense, title: ComponentChildren = titleOf(e)) => (
    <LedgerRow
      key={e.id}
      icon={CATEGORY_ICON[e.category]}
      tint={SOFT[e.pot]}
      title={title}
      subtitle={`${categoryLabel(e.category)} · ${t(`pot.${e.pot}`)}`}
      mil={-e.amount_mil}
      author={authorOf(e, profile, couple)}
      onClick={() => onOpenExpense?.(e)}
    />
  );

  const field = (
    <SearchField
      value={query}
      onInput={setQuery}
      label={t('history.search')}
      placeholder={t('history.searchPlaceholder')}
      chips={chips}
    />
  );
  const who = paired && (
    <div class="whopills" role="group" aria-label={t('history.who')}>
      {[false, true].map((m) => (
        <button key={String(m)} type="button" aria-pressed={mine === m} onClick={() => setMine(m)}>
          {t(m ? 'history.who.me' : 'history.who.all')}
        </button>
      ))}
    </div>
  );

  if (query.trim()) {
    const groups = searchExpenses(expenses, query, newestFirst);
    return (
      <>
        <header class="top">
          <h1>{t('nav.history')}</h1>
        </header>
        {field}
        {who}
        {groups.length ? (
          groups.map((g) => (
            <section key={g.period.start} class="sgroup">
              <div class="sec">
                <h2>{monthName(g.period.label)}</h2>
                <span class="meta">{t('history.count', { count: g.count, amount: formatTnd(g.total) })}</span>
              </div>
              <div class="list">
                {g.items.map(({ expense, ranges }) =>
                  openRow(expense, <Highlight text={titleOf(expense)} ranges={ranges} />),
                )}
              </div>
            </section>
          ))
        ) : (
          <EmptyState title={t('history.noResult', { q: query.trim() })} />
        )}
      </>
    );
  }

  const inPeriod = expenses.filter((e) => e.deleted_at === null && isInPeriod(e.spent_on, period));
  const total = totals[index].needs + totals[index].wants;
  const budgets = splitSalary(profile.salary_mil, {
    needs: profile.split_needs,
    wants: profile.split_wants,
    savings: profile.split_savings,
  });
  const saved = store.savingsMoves.value
    .filter((m) => isInPeriod(m.occurred_on, period))
    .reduce((s, m) => s + m.amount_mil, 0);
  const cats = [
    ...potBreakdown(expenses, 'needs', period).categories,
    ...potBreakdown(expenses, 'wants', period).categories,
  ].sort((a, b) => b.total - a.total);
  const active = cat && cats.some((c) => c.key === cat) ? cat : null;
  const shown = inPeriod.filter((e) => !active || e.category === active);
  const line = historyLine(expenses, period, previous);
  const current = index === periods.length - 1;

  return (
    <>
      <header class="top">
        <h1>{t('nav.history')}</h1>
      </header>
      {field}
      {who}

      <section class="dark monthcard">
        <p class="monthcard__k">
          {monthName(period.label)}
          {current && ` · ${t('history.current')}`}
        </p>
        <p class="big num monthcard__total">
          {formatTnd(total, { unit: false })}
          <span class="unit">{t('unit.tnd')}</span>
        </p>
        <MonthBars
          label={t('history.pick')}
          selected={index}
          onSelect={(i) => {
            setPicked(i);
            setCat(null);
          }}
          bars={periods.map((p, i) => ({
            key: p.start,
            label: `${monthName(p.label)} ${p.label.slice(0, 4)}`,
            tick: monthName(p.label).slice(0, 3),
            value: totals[i].needs + totals[i].wants,
          }))}
        />
      </section>

      <div class="potmini">
        {(['needs', 'wants'] as const).map((p) => (
          <button key={p} type="button" onClick={() => navigate(`#/pot/${p}`)}>
            <span class="potmini__name">
              <i style={{ background: COLOR[p] }} aria-hidden="true" />
              {t(`pot.${p}`)}
            </span>
            <b class="num">{formatTnd(totals[index][p], { unit: false })}</b>
            <small>{t('budget.of', { amount: formatTnd(budgets[p], { unit: false }) })}</small>
          </button>
        ))}
        <button type="button" onClick={() => navigate('#/goal')}>
          <span class="potmini__name">
            <i style={{ background: 'var(--save)' }} aria-hidden="true" />
            {t('pot.savings')}
          </span>
          <b class="num">{formatTnd(saved, { unit: false })}</b>
          <small>{t('budget.pot.saved')}</small>
        </button>
      </div>

      <div class="insight">
        <span class="insight__m" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <p>
          {line ? t(line.key, line.vars) : t('history.line.empty')}
          <small>{t('history.aam')}</small>
        </p>
      </div>

      {inPeriod.length > 0 && (
        <>
          <div class="sec">
            <h2>{t('history.byCategory')}</h2>
            <span class="meta">{t('history.tapToFilter')}</span>
          </div>
          <div class="list catlist">
            {cats.map((c) => {
              const Icon = CATEGORY_ICON[c.key];
              const pot = inPeriod.find((e) => e.category === c.key)?.pot ?? 'needs';
              return (
                <button
                  key={c.key}
                  type="button"
                  class="catrow"
                  aria-pressed={active === c.key}
                  onClick={() => setCat(active === c.key ? null : c.key)}
                >
                  <span class="catrow__ic" style={{ background: SOFT[pot] }} aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span>
                    <span class="catrow__nm">
                      {categoryLabel(c.key)}
                      <small>{Math.round((c.total / Math.max(1, total)) * 100)} %</small>
                    </span>
                    <span class="catrow__tr" aria-hidden="true">
                      <i style={{ width: `${(c.total / cats[0].total) * 100}%`, background: COLOR[pot] }} />
                    </span>
                  </span>
                  <span class="catrow__v num">{formatTnd(c.total, { unit: false })}</span>
                </button>
              );
            })}
          </div>

          <div class="sec">
            <h2>{t('history.expenses')}</h2>
            <span class="meta">
              {t('history.count', {
                count: shown.length,
                amount: formatTnd(shown.reduce((s, e) => s + e.amount_mil, 0)),
              })}
            </span>
          </div>
          <div class="list">
            {groupByDay(shown).map((d) => (
              <section key={d.date}>
                <DayHeader date={d.date} />
                {d.items.map((e) => openRow(e))}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
