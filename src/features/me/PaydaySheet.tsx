import { CalendarCheck } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import type { Row } from '../../data/localdb';
import type { Store } from '../../data/store';
import { nextPayday, payPeriod, todayTunis } from '../../shared/dates';
import { shortDate } from '../../shared/format';
import { t } from '../../shared/i18n/t';
import { paydayPatch } from '../../shared/plan';

/** 0 = the last day of the month */
const DAYS = [1, 5, 10, 15, 20, 25, 28, 0];

type Props = {
  store: Store;
  write: (table: 'profiles', row: Row) => Promise<void>;
  onDone: () => void;
};

/** Jour de paie: takes effect at once; a pending plan change moves with it. */
export function PaydaySheet({ store, write, onDone }: Props) {
  const p = store.profile.value;
  const [day, setDay] = useState(p?.payday ?? 1);
  if (!p) return null;
  const today = todayTunis();
  const next = nextPayday(today, day);
  const period = payPeriod(next, day);

  const save = async () => {
    await write('profiles', { ...p, ...paydayPatch(p, day, today) });
    onDone();
    showToast({ text: t('me.payday.saved', { date: shortDate(next) }) });
  };

  return (
    <div class="me-sheet">
      <p class="hint">{t('me.payday.hint')}</p>
      <div class="days">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            class={day === d ? 'on' : undefined}
            aria-pressed={day === d}
            onClick={() => setDay(d)}
          >
            {d === 0 ? <CalendarCheck aria-hidden="true" /> : d === 1 ? t('setup.payday.first') : d}
            <small>{d === 0 ? t('setup.payday.end') : t('setup.payday.ofMonth')}</small>
          </button>
        ))}
      </div>
      <p class="aamtip" data-testid="payday-tip" aria-live="polite">
        <span class="sal" aria-hidden="true">
          S
        </span>
        <span>
          {t('me.payday.tip', {
            date: shortDate(next),
            start: shortDate(period.start),
            end: shortDate(period.end),
          })}
        </span>
      </p>
      <button type="button" class="cta" disabled={day === p.payday} onClick={() => void save()}>
        {t('me.save')}
      </button>
    </div>
  );
}
