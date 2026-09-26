import { Delete } from 'lucide-preact';
import { t } from '../../shared/i18n/t';
import { pressKey, type Key } from '../../shared/keypad';

const KEYS: Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

/** The number pad under the amount. Every key is a real button (keyboard and screen readers). */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div class="pad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          aria-label={k === ',' ? t('keypad.comma') : k === 'del' ? t('keypad.delete') : undefined}
          onClick={() => onChange(pressKey(value, k))}
        >
          {k === 'del' ? <Delete size={22} aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  );
}
