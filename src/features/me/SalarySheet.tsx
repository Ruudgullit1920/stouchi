import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { billsDueTotal } from '../../shared/bills';
import { nextPayday, payPeriod, todayTunis } from '../../shared/dates';
import { monthName, shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { MIL_PER_TND, formatTnd, splitSalary } from '../../shared/money';
import { currentPlan, nextPlanPatch, pendingPlan } from '../../shared/plan';
import { AmountInput } from '../onboarding/AmountInput';
import { WhenSwitch, changes, type When } from './When';

const MIN_MIL = 100 * MIL_PER_TND;
const WARN_AT = 0.8;
const POTS = ['needs', 'wants', 'savings'] as const;

type Props = {
  store: Store;
  write: (table: 'profiles', row: Row) => Promise<void>;
  onDone: () => void;
};

/** Salaire mensuel: now (the default, as in the prototype), or from the next payday (spec §4.6). */
export function SalarySheet({ store, write, onDone }: Props) {
  const p = store.profile.value;
  const today = todayTunis();
  /* "dès ce mois" by default; a salary already waiting for the next payday opens as it
     stands, so saving without a change never applies it early */
  const [when, setWhen] = useState<When>(() => {
    const next = p && pendingPlan(p);
    return p && next && next.salary_mil !== p.salary_mil ? 'next' : 'now';
  });
  const [salary, setSalary] = useState(() => (p && (pendingPlan(p)?.salary_mil ?? p.salary_mil)) || 0);
  if (!p) return null;

  const current = currentPlan(p);
  const split = when === 'next' ? (pendingPlan(p) ?? current).split : current.split;
  const ok = salary >= MIN_MIL;
  const before = splitSalary(current.salary_mil, current.split);
  const after = splitSalary(ok ? salary : current.salary_mil, split);
  const bills = billsDueTotal(
    store.bills.value.filter((b) => b.active),
    payPeriod(today, p.payday),
  );
  const warn = ok && bills > after.needs * WARN_AT;
  const patch = ok ? nextPlanPatch(p, { salary_mil: salary }, when, today) : {};
  const month = monthName(payPeriod(today, p.payday).label);
  const next = shortDate(nextPayday(today, p.payday));

  const save = async () => {
    await write('profiles', { ...p, ...patch });
    onDone();
    showToast(
      when === 'now'
        ? {
            text: t('me.salary.saved', { amount: formatTnd(salary) }),
            action: { label: t('action.undo'), run: () => void write('profiles', p) },
          }
        : { text: t('me.salary.savedNext', { amount: formatTnd(salary), date: next }) },
    );
  };

  return (
    <div class="me-sheet">
      <p class="hint">{t('setup.salary.hint')}</p>
      <AmountInput label={t('me.salary')} value={salary} onChange={setSalary} unit={t('unit.tnd')} />
      {salary > 0 && !ok && (
        <p class="field-error" role="alert">
          {t('setup.salary.min')}
        </p>
      )}
      <div class="splitprev" data-testid="split-preview">
        <div class="sp-bar" aria-hidden="true">
          {POTS.map((k) => (
            <i key={k} class={`bg-${k}`} style={{ flex: split[k] }} />
          ))}
        </div>
        {POTS.map((k) => {
          const d = after[k] - before[k];
          return (
            <div key={k} class="sp-row">
              <i class={`bg-${k}`} aria-hidden="true" />
              <span>{t(`pot.${k}`)}</span>
              <span>
                <b class="num">{formatTnd(after[k], { unit: false })}</b>
                {d !== 0 && (
                  <small class={d > 0 ? 'd up' : 'd down'}>{formatTnd(d, { unit: false, sign: true })}</small>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {warn && (
        <p class="aamtip warn" data-testid="bills-warn">
          <span class="sal" aria-hidden="true">
            S
          </span>
          <span>
            {t('me.salary.warn', {
              salary: formatTnd(salary),
              bills: formatTnd(bills),
              pct: Math.round((bills * 100) / after.needs),
            })}
          </span>
        </p>
      )}
      <WhenSwitch value={when} onChange={setWhen} today={today} payday={p.payday} />
      <p class="hint">
        {when === 'now'
          ? t('me.when.nowHint', { month: month.toLowerCase() })
          : t('me.salary.nextHint', { month, date: next })}
      </p>
      <button type="button" class="cta" disabled={!ok || !changes(p, patch)} onClick={() => void save()}>
        {t('me.save')}
      </button>
    </div>
  );
}
