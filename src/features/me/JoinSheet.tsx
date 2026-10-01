import { useState } from 'preact/hooks';
import { CoupleError } from '../../data/couple';
import type { CurrencyCode } from '../../shared/currencies';
import { t, type StringKey } from '../../shared/i18n/t';

const PREFIX = 'STC';
const BODY = 6;
const ERR_ID = 'join-code-err';

/** What the code field shows, and the code once it is whole. Lower case,
 * spaces and a missing `STC-` are all fine (Review Focus 4). A code whose own
 * symbols begin with STC must be typed with its prefix. */
export function codeInput(typed: string): { shown: string; code: string | null } {
  const c = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (PREFIX.startsWith(c)) return { shown: c, code: null };
  const body = (c.startsWith(PREFIX) ? c.slice(PREFIX.length) : c).slice(0, BODY);
  if (body.length === BODY) return { shown: `${PREFIX}-${body}`, code: `${PREFIX}-${body}` };
  return { shown: c.startsWith(PREFIX) ? `${PREFIX}-${body}` : body, code: null };
}

type Props = {
  join: (code: string) => Promise<{ currency: CurrencyCode | null } | void>;
  /** `currency`: mine changed to the host's */
  onJoined: (currency: CurrencyCode | null) => void;
};

/** J'ai reçu un code (prototype `joincode`): the partner's code, and why it was refused. */
export function JoinSheet({ join, onJoined }: Props) {
  const [shown, setShown] = useState('');
  const [error, setError] = useState<StringKey | null>(null);
  const [busy, setBusy] = useState(false);
  const { code } = codeInput(shown);

  const go = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const joined = await join(code);
      onJoined(joined?.currency ?? null);
    } catch (err) {
      setError(err instanceof CoupleError ? err.key : 'couple.err.generic');
      setBusy(false);
    }
  };

  return (
    <div class="me-sheet">
      <p class="hint">{t('couple.join.lead')}</p>
      <input
        class="tin codein"
        value={shown}
        aria-label={t('couple.join.label')}
        placeholder={t('couple.join.placeholder')}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        aria-invalid={error !== null}
        aria-describedby={error ? ERR_ID : undefined}
        onInput={(e) => {
          const next = codeInput(e.currentTarget.value).shown;
          e.currentTarget.value = next;
          setShown(next);
          setError(null);
        }}
      />
      {error && (
        <p id={ERR_ID} class="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="button" class="cta" disabled={!code || busy} onClick={() => void go()}>
        {t('couple.join.go')}
      </button>
    </div>
  );
}
