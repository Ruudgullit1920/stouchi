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
  /* another window tapped: the new worker runs this page too, whose files are
     the old version's, so the offer stays and the tap now simply reloads */
  let takenElsewhere = false;
  container.addEventListener('controllerchange', () => {
    if (!tapped) {
      takenElsewhere = true;
      updateReady.value = true;
      return;
    }
    tapped = false;
    reload();
  });
  apply = () => {
    if (takenElsewhere) return reload();
    if (!reg.waiting) return;
    tapped = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
}

/** A resumed app doesn't navigate, so the browser doesn't look for a new
 * worker: ask when it comes back to the screen, at most once per `everyMs`. */
export function checkForUpdates(
  reg: { update(): Promise<unknown> },
  everyMs = 60 * 60_000,
): (now: number) => void {
  let last = -Infinity;
  return (now) => {
    if (now - last < everyMs) return;
    last = now;
    reg.update().catch(() => undefined);
  };
}
