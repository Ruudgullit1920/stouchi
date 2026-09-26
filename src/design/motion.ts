/** Spec §5.6: every §5.5 motion goes off when the user asks for less. */
export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
