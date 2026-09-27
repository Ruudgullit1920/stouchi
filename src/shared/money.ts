/* Money is integer millimes: 1 TND = 1 000 millimes. Never floats (spec §7).
   Other currencies keep the same unit, thousandths (currency spec §4). */

import { CURRENCIES, currencyOf, type CurrencyCode } from './currencies';

export type Mil = number;
export const MIL_PER_TND = 1000;
/** 1 000 000 TND — the same cap as today's app. */
export const MAX_MIL = 1_000_000_000;

const GROUP = '[ \u00a0\u202f]';

/** How many decimals an amount may have in this currency (the rest of the thousandths stay 0). */
export function maxDecimals(currency: CurrencyCode = 'TND'): 2 | 3 {
  return currencyOf(currency).decimals;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
const PARSERS = new Map(
  CURRENCIES.map((c) => {
    const words = [c.suffix, c.code, ...c.aliases]
      .map((w) => w.toLowerCase())
      .sort((a, b) => b.length - a.length);
    /* "1 200" (groups of three) or "1200", then optional "," or "." and up to the currency's
       decimals. Both separators are decimal: Tunisian prices read "1.200 DT" = 1 dinar 200. */
    const amount = new RegExp(`^(\\d{1,3}(?:${GROUP}\\d{3})+|\\d+)(?:[.,](\\d{1,${c.decimals}}))?$`);
    const suffix = new RegExp(`\\s*(?:${words.map(escape).join('|')})$`, 'i');
    return [c.code, { amount, suffix }];
  }),
);

/** What a person types → millimes, or null when it can't be read without guessing.
 * "12,345" is refused in a 2-decimal currency rather than read as 12 345. */
export function parseMoney(input: string, currency: CurrencyCode = 'TND'): Mil | null {
  const { amount, suffix } = PARSERS.get(currencyOf(currency).code)!;
  const m = amount.exec(input.trim().replace(suffix, ''));
  if (!m) return null;
  const whole = Number(m[1].replace(/[   ]/g, ''));
  const mil = whole * MIL_PER_TND + Number((m[2] ?? '').padEnd(3, '0'));
  return mil > MAX_MIL ? null : mil;
}

/** A dinar amount stored as a float (today's documents) → millimes. */
export function milFromTnd(x: number): Mil | null {
  if (!Number.isFinite(x)) return null;
  const mil = Math.round(x * MIL_PER_TND);
  return Math.abs(mil) > MAX_MIL ? null : mil;
}

const WHOLE = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });
const FRACTION = {
  2: new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  3: new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 3 }),
};

/** "1 200 TND", "1 200,50 €" with non-breaking spaces; "−8" for negatives; "+200" when `sign`.
 * Groups take a full no-break space, as in the prototype: Intl's narrow one
 * all but disappears in the tight .num figures ("4800").
 * In a 2-decimal currency an old third decimal is rounded half-up for display only
 * (12,345 → "12,35 €"): callers sum `Mil` first and format once. */
export function formatMoney(
  mil: Mil,
  {
    unit = true,
    sign = false,
    currency = 'TND',
  }: { unit?: boolean; sign?: boolean; currency?: CurrencyCode } = {},
): string {
  const c = currencyOf(currency);
  const prefix = mil < 0 ? '−' : sign && mil > 0 ? '+' : '';
  const step = 10 ** (3 - c.decimals);
  const units = Math.round(Math.abs(mil) / step); // half-up on the magnitude
  const value = (units * step) / MIL_PER_TND;
  const format = units % (MIL_PER_TND / step) === 0 ? WHOLE : FRACTION[c.decimals];
  const figure = format.format(value).replace(/ /g, ' ');
  return prefix + figure + (unit ? ' ' + c.suffix : '');
}

export interface Split {
  needs: number;
  wants: number;
  savings: number;
}
export const DEFAULT_SPLIT: Split = { needs: 50, wants: 30, savings: 20 };

export function isValidSplit(s: Split): boolean {
  const parts = [s.needs, s.wants, s.savings];
  return (
    parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 100) && s.needs + s.wants + s.savings === 100
  );
}

/** Salary → three pots that add up to the salary exactly (largest remainder; ties go to needs). */
export function splitSalary(salary: Mil, split: Split): { needs: Mil; wants: Mil; savings: Mil } {
  // Integer remainders (hundredths of a millime), so ties are exact and go to the lowest index.
  const rest = [split.needs, split.wants, split.savings].map((p) => (salary * p) % 100);
  const parts = [split.needs, split.wants, split.savings].map((p, i) => (salary * p - rest[i]) / 100);
  let left = salary - parts.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2].sort((a, b) => rest[b] - rest[a] || a - b);
  for (const i of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return { needs: parts[0], wants: parts[1], savings: parts[2] };
}
