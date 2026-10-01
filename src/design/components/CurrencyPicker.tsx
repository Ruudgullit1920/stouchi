/* The currency list shared by the onboarding step and the Settings sheet
 * (currency spec §2.1): one glance, one tap. A real radiogroup: the arrow keys
 * move and select, only the chosen row is in the tab order. */
import { Check } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import { CURRENCIES, type CurrencyCode } from '../../shared/currencies';
import { t, type StringKey } from '../../shared/i18n/t';
import { formatMoney } from '../../shared/money';
import './CurrencyPicker.css';

/* Round flags from HatScripts/circle-flags (MIT, src/assets/flags/LICENSE), hashed
   files under /assets/ like the 3D icons: out of the first-load JS, precached. */
const FLAGS = import.meta.glob<string>('../../assets/flags/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const FLAG_OF: Record<CurrencyCode, string> = {
  TND: 'tn',
  EUR: 'eu',
  USD: 'us',
  GBP: 'gb',
  CAD: 'ca',
  CHF: 'ch',
  MAD: 'ma',
  DZD: 'dz',
  LYD: 'ly',
};
export const flagOf = (code: CurrencyCode): string | undefined =>
  FLAGS[`../../assets/flags/${FLAG_OF[code]}.svg`];

export const currencyName = (code: CurrencyCode): string => t(`currency.name.${code}` as StringKey);

/** The example under the list: 1 250,50 in the chosen currency. */
const EXAMPLE = 1_250_500;

export function CurrencyPicker({
  label,
  value,
  suggested,
  onChange,
}: {
  label: string;
  value: CurrencyCode;
  suggested?: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
}) {
  const list = suggested
    ? [...CURRENCIES.filter((c) => c.code === suggested), ...CURRENCIES.filter((c) => c.code !== suggested)]
    : [...CURRENCIES];
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, by: number) => {
    const i = (from + by + list.length) % list.length;
    onChange(list[i].code);
    rows.current[i]?.focus();
  };
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const by = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (by) {
      e.preventDefault();
      move(i, by);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      move(e.key === 'Home' ? 0 : list.length - 1, 0);
    }
  };

  return (
    <div class="cur-pick">
      <div class="cur-list" role="radiogroup" aria-label={label}>
        {list.map((c, i) => {
          const on = c.code === value;
          return (
            <button
              key={c.code}
              ref={(el) => {
                rows.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              class={on ? 'cur on' : 'cur'}
              onClick={() => onChange(c.code)}
              onKeyDown={onKey(i)}
            >
              <img class="cur__flag" src={flagOf(c.code)} alt="" width={32} height={32} />
              <span class="cur__text">
                <span class="cur__name">
                  {currencyName(c.code)}
                  {c.code === suggested && <span class="cur__tag">{t('currency.suggested')}</span>}
                </span>
                <small class="cur__sub">
                  {c.suffix} · {c.code}
                </small>
              </span>
              <span class="cur__tick" aria-hidden="true">
                <Check />
              </span>
            </button>
          );
        })}
      </div>
      <p class="cur-example" aria-live="polite">
        {t('currency.example', { amount: formatMoney(EXAMPLE, { currency: value }) })}
      </p>
    </div>
  );
}
