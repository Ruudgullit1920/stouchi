import type { Mil } from '../../shared/money';

export interface Segment {
  label: string;
  mil: Mil;
  color: string;
}

/** Chunky segmented bar. The colours are never the only carrier: aria-label says it in words. */
export function SegmentedBar({ segments, total }: { segments: Segment[]; total?: Mil }) {
  const sum = total ?? segments.reduce((s, x) => s + x.mil, 0);
  const share = (m: Mil) => (sum > 0 ? m / sum : 0);
  /* \u00a0 escape, not a raw NBSP, so eslint no-irregular-whitespace (which only
     skips regex literals here) does not flag it; same rendered character either way. */
  const label = segments.map((s) => `${s.label} ${Math.round(share(s.mil) * 100)}\u00a0%`).join(', ');
  return (
    <div class="segbar" role="img" aria-label={label}>
      {segments
        .filter((s) => s.mil > 0)
        .map((s) => (
          <span
            key={s.label}
            class="segbar__seg"
            style={{ width: `${share(s.mil) * 100}%`, background: s.color }}
          />
        ))}
    </div>
  );
}
