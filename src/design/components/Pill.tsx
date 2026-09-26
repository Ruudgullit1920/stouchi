type Props = { label: string; pressed: boolean; onToggle: () => void };

/** Filter pill: a toggle button, its state exposed with aria-pressed (spec §5.6). */
export function Pill({ label, pressed, onToggle }: Props) {
  return (
    <button type="button" class="pill" aria-pressed={pressed} onClick={onToggle}>
      {label}
    </button>
  );
}
