import { useRef, useState } from 'preact/hooks';
import { t } from '../../shared/i18n/t';
import type { Split } from '../../shared/money';
import { moveHandle } from '../../shared/split';

const KEYS: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 };
const POTS = ['needs', 'wants', 'savings'] as const;

/** One bar, two handles (spec §5.6: sliders, arrow keys ±5). */
export function SplitEditor({ value, onChange }: { value: Split; onChange: (s: Split) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);
  const pos = { 1: value.needs, 2: value.needs + value.wants };

  const move = (which: 1 | 2, v: number) => {
    const next = moveHandle(value, which, v);
    if (next.needs !== value.needs || next.wants !== value.wants) onChange(next);
  };

  const handle = (which: 1 | 2) => (
    <span
      class={dragging === which ? 'h drag' : 'h'}
      role="slider"
      tabIndex={0}
      style={{ left: `${pos[which]}%` }}
      aria-label={t(which === 1 ? 'me.split.h1' : 'me.split.h2')}
      aria-valuemin={which === 1 ? 5 : 10}
      aria-valuemax={which === 1 ? 90 : 95}
      aria-valuenow={pos[which]}
      aria-valuetext={
        which === 1
          ? t('me.split.h1Text', { n: value.needs })
          : t('me.split.h2Text', { wants: value.wants, savings: value.savings })
      }
      onKeyDown={(e) => {
        const d = KEYS[e.key];
        if (!d) return;
        e.preventDefault();
        move(which, pos[which] + d);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(which);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId) || !bar.current) return;
        const r = bar.current.getBoundingClientRect();
        move(which, ((e.clientX - r.left) / r.width) * 100);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    />
  );

  return (
    <div ref={bar} class={dragging ? 'split-ed dragging' : 'split-ed'}>
      {POTS.map((k) => (
        <div key={k} class={`seg bg-${k}`} style={{ flex: value[k] }}>
          {value[k] >= 12 ? `${value[k]} %` : ''}
        </div>
      ))}
      {handle(1)}
      {handle(2)}
    </div>
  );
}
