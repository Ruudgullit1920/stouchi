/* Money is integer millimes: 1 TND = 1 000 millimes. Never floats (spec §7). */

export type Mil = number;
export const MIL_PER_TND = 1000;
/** 1 000 000 TND — the same cap as today's app. */
export const MAX_MIL = 1_000_000_000;

const GROUP = '[ \\u00a0\\u202f]';
/* "1 200" (groups of three) or "1200", then optional "," or "." and 1–3 decimals.
   Both separators are decimal: Tunisian prices read "1.200 DT" = 1 dinar 200. */
const AMOUNT = new RegExp(`^(\\d{1,3}(?:${GROUP}\\d{3})+|\\d+)(?:[.,](\\d{1,3}))?$`);

/** What a person types → millimes, or null when it can't be read without guessing. */
export function parseTnd(input: string): Mil | null {
  const s = input.trim().replace(/\s*(?:tnd|dt|dinars?)$/i, '');
  const m = AMOUNT.exec(s);
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

const NUMBER = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 3 });

/** "1 200 TND" with non-breaking spaces; "−8" for negatives; "+200" when `sign`.
 * Groups take a full no-break space, as in the prototype: Intl's narrow one
 * all but disappears in the tight .num figures ("4800"). */
export function formatTnd(
  mil: Mil,
  { unit = true, sign = false }: { unit?: boolean; sign?: boolean } = {},
): string {
  const prefix = mil < 0 ? '−' : sign && mil > 0 ? '+' : '';
  const figure = NUMBER.format(Math.abs(mil) / MIL_PER_TND).replace(/\u202f/g, '\u00a0');
  return prefix + figure + (unit ? ' TND' : '');
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
