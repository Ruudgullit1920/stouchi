/* The add sheet's keypad: what each key does to the amount being typed.
 * The value is what the person sees ("12,5"); keypadMil reads it. */
import type { CurrencyCode } from './currencies';
import { currentCurrency } from './currentCurrency';
import { maxDecimals, parseMoney, type Mil } from './money';

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'del';

/** A third decimal is refused in a 2-decimal currency (currency spec §4). */
export function pressKey(value: string, key: Key, currency: CurrencyCode = currentCurrency()): string {
  if (key === 'del') return value.slice(0, -1);
  if (key === ',') return value.includes(',') ? value : `${value || '0'},`;
  const decimals = value.split(',')[1];
  if (decimals !== undefined && decimals.length >= maxDecimals(currency)) return value;
  const next = value === '0' ? key : value + key;
  return parseMoney(next, currency) === null ? value : next;
}

/** Test and replay helper: type a whole string of keys. */
export const typeAll = (keys: string): string => [...keys].reduce((v, k) => pressKey(v, k as Key), '');

/** The typed amount in millimes (0 while nothing valid is typed). */
export const keypadMil = (value: string): Mil => parseMoney(value.replace(/,$/, '')) ?? 0;
