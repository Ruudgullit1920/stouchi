import { useEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from './motion';

/** A number that rolls to its new value (spec §5.5: 500–750 ms, ease-out cubic).
 * The first value shows at once; reduced motion jumps straight to the new one. */
export function useRolling(target: number, ms = 600): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const start = current.current;
    if (start === target) return;
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      current.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const v = Math.round(start + (target - start) * (1 - (1 - p) ** 3));
      current.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return shown;
}
