/* Dates are 'YYYY-MM-DD' strings in Africa/Tunis (spec §7); they compare as strings.
 * The budget period is the pay period (spec §3): payday 1–28, or 0 = last day. */

export type ISODate = string;
export type Payday = number;
export interface PayPeriod {
  start: ISODate;
  end: ISODate;
  /** YYYY-MM of the month holding most of the period's days */
  label: string;
}

const TUNIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Tunis',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayTunis(now: Date = new Date()): ISODate {
  const p = Object.fromEntries(TUNIS.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toUtc = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const fromUtc = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function isValidISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The payday falling in (year, month); month may be 0 or 13 when stepping. */
function paydayIn(year: number, month: number, payday: Payday): ISODate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  return `${y}-${pad(m)}-${pad(payday === 0 ? daysInMonth(y, m) : payday)}`;
}

function check(date: ISODate, payday: Payday): void {
  if (!isValidISODate(date)) throw new RangeError(`not a date: ${date}`);
  if (!Number.isInteger(payday) || payday < 0 || payday > 28)
    throw new RangeError(`payday must be 0–28: ${payday}`);
}

export function payPeriod(date: ISODate, payday: Payday): PayPeriod {
  check(date, payday);
  const [y, m] = date.split('-').map(Number);
  const here = paydayIn(y, m, payday);
  const start = date >= here ? here : paydayIn(y, m - 1, payday);
  const [sy, sm] = start.split('-').map(Number);
  const end = addDays(paydayIn(sy, sm + 1, payday), -1);
  const inFirstMonth = daysBetween(start, `${start.slice(0, 7)}-${pad(daysInMonth(sy, sm))}`) + 1;
  const total = daysBetween(start, end) + 1;
  return { start, end, label: inFirstMonth > total - inFirstMonth ? start.slice(0, 7) : end.slice(0, 7) };
}

export function periodsBack(today: ISODate, payday: Payday, n: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriod(today, payday);
  for (let i = 0; i < n; i++) {
    out.push(p);
    p = payPeriod(addDays(p.start, -1), payday);
  }
  return out;
}

/** How many pay periods from the one holding `from` to today's, both counted; at least 1. */
export function periodsSince(from: ISODate, today: ISODate, payday: Payday): number {
  const first = payPeriod(from, payday).start;
  let p = payPeriod(today, payday);
  let n = 1;
  while (p.start > first) {
    p = payPeriod(addDays(p.start, -1), payday);
    n++;
  }
  return n;
}

export const daysLeft = (today: ISODate, p: PayPeriod): number => daysBetween(today, p.end) + 1;
export const nextPayday = (today: ISODate, payday: Payday): ISODate =>
  addDays(payPeriod(today, payday).end, 1);
export const isInPeriod = (d: ISODate, p: PayPeriod): boolean => d >= p.start && d <= p.end;

/** ISO 8601 week, Monday to Sunday: "2026-W39". Its year is the year of its Thursday. */
export function isoWeek(d: ISODate): string {
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, day));
  const thursday = new Date(date.getTime() + (3 - ((date.getUTCDay() + 6) % 7)) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000)) + 1;
  return `${year}-W${pad(week)}`;
}
