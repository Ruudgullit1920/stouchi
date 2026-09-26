import type { ISODate } from './dates';

/** The first of the month four months back: the start of the pay period three
 * periods back, whatever the payday, is never earlier — so everything loads in
 * one parallel round without knowing the payday first. Its own module so that
 * notify-run's bundle doesn't pull in aam/load's zod schemas. */
export function floorFor(today: ISODate): ISODate {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - 4, 1));
  return first.toISOString().slice(0, 10);
}
