import { useEffect, useRef, useState } from 'preact/hooks';

type Props = {
  label: string;
  holdingLabel: string;
  /** how long it must be held */
  ms?: number;
  disabled?: boolean;
  onHeld: () => void;
};

/** A button that acts only once held (the prototype's `.hold`): by finger or
 * mouse, or from the keyboard by holding Space or Enter (spec §5.6). */
export function HoldButton({ label, holdingLabel, ms = 2000, disabled, onHeld }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onHeld();
    }, ms);
  };
  useEffect(() => stop, []);

  const isKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';
  return (
    <button
      type="button"
      class={holding ? 'cta red hold go' : 'cta red hold'}
      style={{ '--hold-ms': `${ms}ms` }}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (isKey(e)) stop();
      }}
      onBlur={stop}
    >
      <span class="fill" aria-hidden="true" />
      <span>{holding ? holdingLabel : label}</span>
    </button>
  );
}
