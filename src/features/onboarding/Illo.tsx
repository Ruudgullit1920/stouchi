/* The first-run illustrations (prototype ILLO): decorative, hidden from
 * assistive tech, and still under reduced motion. */
import type { ComponentChildren } from 'preact';
import type { LucideIcon } from 'lucide-preact';

export function Orb(p: {
  x: number;
  y: number;
  size: 'sm' | 'md' | 'lg';
  icon: LucideIcon;
  color: string;
  delay: number;
}) {
  const Icon = p.icon;
  return (
    <div
      class={`orb o-${p.size}`}
      style={{ left: `${p.x}px`, top: `${p.y}px`, color: p.color, animationDelay: `-${p.delay}s` }}
    >
      <Icon />
    </div>
  );
}

export function Blob(p: { x: number; y: number; w: number; h: number; color: string }) {
  return (
    <div
      class="blob"
      style={{
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: `${p.w}px`,
        height: `${p.h}px`,
        background: p.color,
      }}
    />
  );
}

export function Paths({ viewBox, d, stretch = false }: { viewBox: string; d: string[]; stretch?: boolean }) {
  return (
    <svg class="path" viewBox={viewBox} preserveAspectRatio={stretch ? 'none' : undefined}>
      {d.map((x) => (
        <path key={x} d={x} />
      ))}
    </svg>
  );
}

export function Illo({ wide = false, children }: { wide?: boolean; children: ComponentChildren }) {
  return (
    <div class={wide ? 'illo illo-wide' : 'illo'} aria-hidden="true">
      {children}
    </div>
  );
}
