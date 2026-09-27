/* Shared bits of the Onboarding v2 screens (prototype/onboarding-v2.html). */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/* the prototype draws every scene on a 322 × 400 stage */
const W = 322;
const H = 400;

/** The animated scene above the sheet: the prototype's fixed 322 × 400 stage,
 * centred, and scaled down when the phone leaves it less room (never up). */
export function Stage({ children, h = H }: { children: ComponentChildren; h?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const fit = () => setK(Math.min(1, el.clientWidth / W, el.clientHeight / h));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [h]);
  return (
    <div class="onb-stage" ref={box} aria-hidden="true">
      <div
        class="onb-scene"
        style={{ width: `${W}px`, height: `${h}px`, transform: `translate(-50%, -50%) scale(${k})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** A two-line title whose last line is in the screen's gradient. */
export function Title({ text }: { text: string }) {
  const lines = text.split('\n');
  const last = lines.pop();
  return (
    <h1>
      {lines.map((l) => [l, <br key={l} />])}
      <em>{last}</em>
    </h1>
  );
}

/** stouchi, with the orange dot */
export function Wordmark() {
  return (
    <span class="wordmark">
      stouchi
      <i aria-hidden="true" />
    </span>
  );
}
