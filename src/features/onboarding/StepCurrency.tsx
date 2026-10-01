import { CurrencyPicker } from '../../design/components/CurrencyPicker';
import { guessCurrency } from '../../shared/currencies';
import { t } from '../../shared/i18n/t';
import type { StepProps } from './draft';

/** Currency spec §2: the suggestion from the time zone is already chosen, so most people just continue. */
export function StepCurrency({ draft, set, timeZone }: StepProps) {
  return (
    <>
      <p class="su-hint">{t('setup.currency.hint')}</p>
      <CurrencyPicker
        label={t('setup.currency.q')}
        value={draft.currency}
        suggested={guessCurrency(timeZone)}
        onChange={(currency) => set({ currency })}
      />
    </>
  );
}
