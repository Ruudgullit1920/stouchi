import { t } from '../../shared/i18n/t';
import { formatTnd, MIL_PER_TND } from '../../shared/money';
import { AmountInput } from './AmountInput';
import { MIN_SALARY, potsOf, type StepProps } from './draft';

const QUICK = [1200, 1500, 2000, 2500, 3000];
const POTS = [
  { key: 'needs', name: 'pot.needs', pct: 50, color: 'var(--need)' },
  { key: 'wants', name: 'pot.wants', pct: 30, color: 'var(--want)' },
  { key: 'savings', name: 'pot.savings', pct: 20, color: 'var(--save)' },
] as const;

export function StepSalary({ draft, set }: StepProps) {
  const salary = draft.salary_mil;
  const pots = potsOf(salary);
  const tooLow = salary > 0 && salary < MIN_SALARY;
  return (
    <>
      <p class="su-hint">{t('setup.salary.hint')}</p>
      <AmountInput
        label={t('setup.salary.label')}
        value={salary}
        unit={t('setup.currency')}
        onChange={(salary_mil) => set({ salary_mil })}
      />
      {tooLow && (
        <p class="ferr" role="alert">
          {t('setup.salary.min')}
        </p>
      )}
      <div class="qchips">
        {QUICK.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={salary === v * MIL_PER_TND}
            class={salary === v * MIL_PER_TND ? 'on' : undefined}
            onClick={() => set({ salary_mil: v * MIL_PER_TND })}
          >
            {formatTnd(v * MIL_PER_TND, { unit: false })}
          </button>
        ))}
      </div>
      <div class={salary ? 'splitprev' : 'splitprev empty'} data-testid="split-preview">
        <div class="sp-bar" aria-hidden="true">
          {POTS.map((p) => (
            <i key={p.key} style={{ flex: p.pct, background: p.color }} />
          ))}
        </div>
        {POTS.map((p) => (
          <div key={p.key} class="sp-row">
            <i style={{ background: p.color }} aria-hidden="true" />
            <span>
              {t(p.name)} <small>{p.pct} %</small>
            </span>
            <b class="num">{formatTnd(pots[p.key])}</b>
          </div>
        ))}
      </div>
    </>
  );
}
