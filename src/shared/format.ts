/* French date and name formatting for the screens. Dates are Africa/Tunis
 * calendar days, so they are formatted as UTC midnights: no shifting. */
import type { ISODate } from './dates';

const at = (d: ISODate) => new Date(`${d}T00:00:00Z`);
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'YYYY-MM' (a pay period's label) → "Septembre" */
export const monthName = (label: string): string => capitalise(MONTH.format(at(`${label}-01`)));

/** 'YYYY-MM-DD' → "Mars 2028" (a goal's date) */
export const monthYear = (d: ISODate): string => `${monthName(d.slice(0, 7))} ${d.slice(0, 4)}`;

/** "15 sept." */
export const shortDate = (d: ISODate): string => SHORT.format(at(d));

/** The parts of a ledger day header (spec §5.4): big date, weekday pill, MM.YYYY. */
export const dayHeader = (d: ISODate) => ({
  day: String(Number(d.slice(8, 10))),
  weekday: WEEKDAY.format(at(d)),
  monthYear: `${d.slice(5, 7)}.${d.slice(0, 4)}`,
});

/** "Sofiene" → "S", "Zeineb Ben Ali" → "ZB" */
export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
