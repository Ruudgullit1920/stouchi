import { useState } from 'preact/hooks';
import { showToast } from '../../app/ui';
import { CurrencyPicker } from '../../design/components/CurrencyPicker';
import { CoupleError } from '../../data/couple';
import type { Store } from '../../data/store';
import { currencyOf, type CurrencyCode } from '../../shared/currencies';
import { t } from '../../shared/i18n/t';

type Props = {
  store: Store;
  /** set_currency: mine and my partner's; the display switches once the server said yes */
  setCurrency: (code: CurrencyCode) => Promise<void>;
  onDone: () => void;
};

/** Moi → Devise (currency spec §2): the same list as the onboarding step. Display only:
 * nothing is converted, and the sheet says so. */
export function CurrencySheet({ store, setCurrency, onDone }: Props) {
  const now = currencyOf(store.profile.value?.currency).code;
  const [code, setCode] = useState<CurrencyCode>(now);
  const [busy, setBusy] = useState(false);
  const paired = store.household.value?.status === 'on';

  const save = async () => {
    if (busy || code === now) return;
    setBusy(true);
    try {
      await setCurrency(code);
      onDone();
    } catch (err) {
      showToast({ text: t(err instanceof CoupleError ? err.key : 'couple.err.generic') });
      setBusy(false);
    }
  };

  return (
    <div class="me-sheet">
      <p class="hint">
        {t('currency.notice')}
        {paired && <> {t('currency.notice.couple')}</>}
      </p>
      <CurrencyPicker label={t('me.currency')} value={code} onChange={setCode} />
      <button type="button" class="cta" disabled={busy || code === now} onClick={() => void save()}>
        {t('me.save')}
      </button>
    </div>
  );
}
