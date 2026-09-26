import { t } from '../../shared/i18n/t';

type Props = { items: string[]; disabled: boolean; onTap: (text: string) => void };

/** Suggestions under the thread: the reply's chips, or first ideas while it is empty. */
export function Chips({ items, disabled, onTap }: Props) {
  if (!items.length) return null;
  return (
    <div class="sugg" role="group" aria-label={t('chat.suggestions')}>
      {items.map((text) => (
        <button key={text} type="button" disabled={disabled} onClick={() => onTap(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}
