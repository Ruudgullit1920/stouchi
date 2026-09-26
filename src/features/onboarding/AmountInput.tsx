import { MIL_PER_TND, type Mil } from '../../shared/money';

/** Whole dinars, digits only (the setup answers are round figures). */
export function AmountInput({
  label,
  value,
  onChange,
  digits = 6,
  class: cls = 'amt-in',
  unit,
  disabled = false,
}: {
  label: string;
  value: Mil;
  onChange: (mil: Mil) => void;
  digits?: number;
  class?: string;
  unit?: string;
  disabled?: boolean;
}) {
  const input = (
    <input
      inputMode="numeric"
      enterKeyHint="next"
      placeholder="0"
      aria-label={label}
      disabled={disabled}
      value={value ? String(Math.floor(value / MIL_PER_TND)) : ''}
      onInput={(e) => {
        const clean = e.currentTarget.value.replace(/\D/g, '').slice(0, digits);
        e.currentTarget.value = clean;
        onChange(Number(clean || 0) * MIL_PER_TND);
      }}
    />
  );
  if (!unit) return input;
  return (
    <div class={cls}>
      {input}
      <span aria-hidden="true">{unit}</span>
    </div>
  );
}
