/* The household's display currency (currency spec §2), set from my profile row by the store.
 * formatMoney, parseMoney and t() default to it; a component that formats an amount in
 * render reads the signal, so every figure follows a change without a reload.
 * Server code has no profile here: it passes the currency explicitly. */
import { signal } from '@preact/signals';
import type { CurrencyCode } from './currencies';

const current = signal<CurrencyCode>('TND');

export const currentCurrency = (): CurrencyCode => current.value;

export function setCurrentCurrency(code: CurrencyCode): void {
  current.value = code;
}

/** Run `fn` with `code` as the current currency, then put the previous one back.
 * For server code that builds text synchronously for one user (the carnet): no await
 * can run in between, so another request never sees it. */
export function withCurrency<T>(code: CurrencyCode, fn: () => T): T {
  const before = current.peek();
  current.value = code;
  try {
    return fn();
  } finally {
    current.value = before;
  }
}
