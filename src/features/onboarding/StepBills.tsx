import { Icon3D, i3d } from '../../design/i3d';
import { t, type StringKey } from '../../shared/i18n/t';
import { formatTnd } from '../../shared/money';
import { AmountInput } from './AmountInput';
import { billLabel, meter, type BillKey, type DraftBill, type StepProps } from './draft';

const ICONS: Record<BillKey, string> = {
  loyer: 'key-round',
  steg: 'zap',
  sonede: 'droplet',
  net: 'wifi',
  tel: 'smartphone',
  credit: 'landmark',
};

export function StepBills({ draft, set }: StepProps) {
  const change = (key: BillKey, patch: Partial<DraftBill>) =>
    set({ bills: draft.bills.map((b) => (b.key === key ? { ...b, ...patch } : b)) });
  const m = meter(draft);
  const left = formatTnd(m.need - m.used);

  return (
    <>
      <p class="su-hint">{t('setup.bills.hint')}</p>
      <div class="bills">
        {draft.bills.map((b) => {
          const label = t(billLabel(b.key));
          return (
            <div key={b.key} class={b.on ? 'bill on' : 'bill'}>
              <button
                type="button"
                class="bill__toggle"
                aria-pressed={b.on}
                onClick={() => change(b.key, { on: !b.on })}
              >
                <span class="ic d3" aria-hidden="true">
                  <Icon3D src={i3d(ICONS[b.key])} />
                </span>
                <span class="n">
                  {label}
                  <small>{t(`${billLabel(b.key)}.sub` as StringKey)}</small>
                </span>
              </button>
              <AmountInput
                label={t('setup.bills.amount', { label })}
                value={b.amount_mil}
                digits={5}
                disabled={!b.on}
                onChange={(amount_mil) => change(b.key, { amount_mil })}
              />
              <span class="tick" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            </div>
          );
        })}
      </div>
      <div class={m.level === 'ok' ? 'meter' : 'meter warn'} data-testid="meter" aria-live="polite">
        <div class="mh">
          <span>{t('setup.meter.title')}</span>
          <span class="num">
            {t('setup.meter.of', { used: formatTnd(m.used, { unit: false }), need: formatTnd(m.need) })}
          </span>
        </div>
        <div class="mt" aria-hidden="true">
          <i style={{ width: `${Math.min(m.pct, 100)}%` }} />
        </div>
        <p>
          {m.level === 'over'
            ? t('setup.meter.over', { over: formatTnd(m.used - m.need) })
            : m.level === 'warn'
              ? t('setup.meter.warn', { pct: m.pct, left })
              : t('setup.meter.ok', { left })}
        </p>
      </div>
    </>
  );
}
