/* "Nouvelle version — Recharger" (spec §8.3). A deploy installs a new worker
 * that waits (public/sw.js). This offers it, and only the user's tap lets it
 * take over and reloads the page — never under the user. */
import { signal } from '@preact/signals';

interface Worker_ {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', fn: () => void): void;
}
interface Registration {
  waiting: Worker_ | null;
  installing: Worker_ | null;
  addEventListener(type: 'updatefound', fn: () => void): void;
}
interface Container {
  /** null on the very first install: no page runs an older version then */
  controller: object | null;
  addEventListener(type: 'controllerchange', fn: () => void): void;
}

export const updateReady = signal(false);

let apply: (() => void) | null = null;

/** The "Recharger" tap. */
export function applyUpdate(): void {
  apply?.();
}

export function watchUpdates(reg: Registration, container: Container, reload: () => void): void {
  let tapped = false;
  const offer = () => {
    if (container.controller) updateReady.value = true;
  };
  if (reg.waiting) offer();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') offer();
    });
  });
  container.addEventListener('controllerchange', () => {
    if (!tapped) return;
    tapped = false;
    reload();
  });
  apply = () => {
    if (!reg.waiting) return;
    tapped = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
}
