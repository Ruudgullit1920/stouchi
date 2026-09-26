import { useEffect, useRef } from 'preact/hooks';

export interface MonthBar {
  key: string;
  /** full name for screen readers, e.g. "Septembre 2026" */
  label: string;
  /** short tick under the bar, e.g. "sept." */
  tick: string;
  value: number;
}

type Props = { bars: MonthBar[]; selected: number; onSelect: (index: number) => void; label: string };

/** The 12-bar chart that is also the month picker (spec §3, §5.6): a listbox with
 * one tab stop; arrows, Home and End move the selection. Oldest bar on the left. */
export function MonthBars({ bars, selected, onSelect, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && box.current?.contains(document.activeElement)) el.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [selected]);

  const onKey = (e: KeyboardEvent) => {
    const to =
      e.key === 'ArrowLeft'
        ? selected - 1
        : e.key === 'ArrowRight'
          ? selected + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? bars.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    onSelect(Math.min(bars.length - 1, Math.max(0, to)));
  };

  return (
    <div ref={box} class="mbars" role="listbox" aria-label={label} aria-orientation="horizontal">
      {bars.map((b, i) => (
        <div
          key={b.key}
          class={i === selected ? 'mbar on' : 'mbar'}
          role="option"
          aria-selected={i === selected}
          aria-label={b.label}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onSelect(i)}
          onKeyDown={onKey}
        >
          <span class="mbar__col" aria-hidden="true">
            <i style={{ height: `${Math.max(6, (b.value / max) * 84)}px` }} />
          </span>
          <span class="mbar__tick" aria-hidden="true">
            {b.tick}
          </span>
        </div>
      ))}
    </div>
  );
}
