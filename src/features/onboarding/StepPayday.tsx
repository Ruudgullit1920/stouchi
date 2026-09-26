import { CalendarCheck } from 'lucide-preact';
import { t } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import { potsOf, type StepProps } from './draft';

/** 0 = the last day of the month */
const DAYS = [1, 5, 10, 15, 20, 25, 28, 0];

export const dayLabel = (d: number): string =>
  d === 0 ? t('setup.payday.endLong') : d === 1 ? t('setup.payday.first') : String(d);

export function StepPayday({ draft, set }: StepProps) {
  const pots = potsOf(draft.salary_mil);
  return (
    <>
      <div class="days">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            class={draft.payday === d ? 'on' : undefined}
            aria-pressed={draft.payday === d}
            onClick={() => set({ payday: d })}
          >
            {d === 0 ? <CalendarCheck aria-hidden="true" /> : d === 1 ? t('setup.payday.first') : d}
            <small>{d === 0 ? t('setup.payday.end') : t('setup.payday.ofMonth')}</small>
          </button>
        ))}
      </div>
      <p class="su-hint day-hint">
        {draft.payday === null
          ? t('setup.payday.hintEmpty')
          : t('setup.payday.hint', {
              day: dayLabel(draft.payday),
              salary: formatTnd(draft.salary_mil),
              needs: formatTnd(pots.needs, { unit: false }),
              wants: formatTnd(pots.wants, { unit: false }),
              savings: formatTnd(pots.savings, { unit: false }),
            })}
      </p>
    </>
  );
}
