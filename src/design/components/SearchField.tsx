import { Search, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { t } from '../../shared/i18n/t';

type Props = {
  value: string;
  onInput: (v: string) => void;
  label: string;
  placeholder: string;
  /** quick searches shown while the field has focus and is empty */
  chips?: string[];
};

/** Search field with a clear button and quick chips on focus (spec §4.3). */
export function SearchField({ value, onInput, label, placeholder, chips = [] }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <div class="searchfield">
      <label class="hsearch">
        <Search size={18} aria-hidden="true" />
        <span class="visually-hidden">{label}</span>
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          autocomplete="off"
          enterKeyHint="search"
          onInput={(e) => onInput(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
        />
        {value && (
          <button type="button" aria-label={t('search.clear')} onClick={() => onInput('')}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
      {focused && !value && chips.length > 0 && (
        <div class="quick">
          {chips.map((c) => (
            <button key={c} type="button" class="quick__chip" onClick={() => onInput(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
