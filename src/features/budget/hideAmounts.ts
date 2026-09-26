/* The eye on Budget: hide amounts on this device (a per-viewer convenience). */
import { signal } from '@preact/signals';

const KEY = 'stouchi.hideAmounts';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const hideAmounts = signal(read());

export function toggleHideAmounts(): void {
  hideAmounts.value = !hideAmounts.value;
  try {
    localStorage.setItem(KEY, hideAmounts.value ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts this session only */
  }
}

export { HIDDEN } from '../../design/components/Amount';
