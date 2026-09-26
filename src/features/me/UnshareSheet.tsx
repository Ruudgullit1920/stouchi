import { Unlink } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { CoupleError } from '../../data/couple';
import { t, type StringKey } from '../../shared/i18n/t';

type Props = {
  name: string;
  leave: () => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
};

/** Arrêter le partage (prototype `unshare`): confirm, then leave (plan D6). */
export function UnshareSheet({ name, leave, onDone, onCancel }: Props) {
  const [error, setError] = useState<StringKey | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await leave();
      onDone();
    } catch (err) {
      setError(err instanceof CoupleError ? err.key : 'couple.err.generic');
      setBusy(false);
    }
  };

  return (
    <div class="me-sheet">
      <div class="del-confirm">
        <div class="big-ic tone-danger" aria-hidden="true">
          <Unlink />
        </div>
        <h4>{t('couple.unshare.title', { name })}</h4>
        <p>{t('couple.unshare.body')}</p>
      </div>
      {error && (
        <p class="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="button" class="cta red" disabled={busy} onClick={() => void go()}>
        {t('couple.stop')}
      </button>
      <button type="button" class="btn2" onClick={onCancel}>
        {t('couple.cancel')}
      </button>
    </div>
  );
}
