import { describe, expect, it } from 'vitest';
import {
  addDays,
  periodsSince,
  daysBetween,
  daysLeft,
  isInPeriod,
  isoWeek,
  isValidISODate,
  nextPayday,
  payPeriod,
  periodsBack,
  todayTunis,
} from '../../src/shared/dates';

describe('todayTunis', () => {
  it('is the date in Tunis (UTC+1), not in UTC', () => {
    expect(todayTunis(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23');
    expect(todayTunis(new Date('2026-09-22T22:59:59Z'))).toBe('2026-09-22');
  });
});

describe('ISO date maths', () => {
  it('knows real dates', () => {
    expect(isValidISODate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-9-1', '', '2026-02-30'])
      expect(isValidISODate(bad)).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
  });
});

describe('payPeriod', () => {
  it('payday 1 is the calendar month', () => {
    expect(payPeriod('2026-09-23', 1)).toEqual({ start: '2026-09-01', end: '2026-09-30', label: '2026-09' });
  });

  it('payday 25 runs 25 → 24; the payday itself opens the new period', () => {
    expect(payPeriod('2026-09-23', 25)).toEqual({ start: '2026-08-25', end: '2026-09-24', label: '2026-09' });
    expect(payPeriod('2026-09-25', 25)).toEqual({ start: '2026-09-25', end: '2026-10-24', label: '2026-10' });
  });

  it('payday 0 is the last day of each month, February and leap years included', () => {
    expect(payPeriod('2026-03-15', 0)).toEqual({ start: '2026-02-28', end: '2026-03-30', label: '2026-03' });
    expect(payPeriod('2028-02-29', 0)).toEqual({ start: '2028-02-29', end: '2028-03-30', label: '2028-03' });
    expect(payPeriod('2026-12-31', 0)).toEqual({ start: '2026-12-31', end: '2027-01-30', label: '2027-01' });
  });

  it('payday 28 across February', () => {
    expect(payPeriod('2026-03-01', 28)).toEqual({ start: '2026-02-28', end: '2026-03-27', label: '2026-03' });
  });

  it('is named after the month holding most of its days; an even split names the later month', () => {
    expect(payPeriod('2026-10-20', 15)).toEqual({ start: '2026-10-15', end: '2026-11-14', label: '2026-10' });
    expect(payPeriod('2026-09-20', 16)).toEqual({ start: '2026-09-16', end: '2026-10-15', label: '2026-10' });
  });

  it('refuses impossible dates and paydays', () => {
    expect(() => payPeriod('2026-02-30', 1)).toThrow(RangeError);
    expect(() => payPeriod('2026-09-01', 29)).toThrow(RangeError);
    expect(() => payPeriod('2026-09-01', 1.5)).toThrow(RangeError);
  });
});

describe('around a period', () => {
  it('lists the last n periods, newest first, back to back', () => {
    const list = periodsBack('2026-09-23', 25, 12);
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual(payPeriod('2026-09-23', 25));
    for (let i = 1; i < list.length; i++) expect(addDays(list[i].end, 1)).toBe(list[i - 1].start);
    expect(list[11].start).toBe('2025-09-25');
  });

  it('counts days left including today, and finds the next payday', () => {
    const p = payPeriod('2026-09-23', 25);
    expect(daysLeft('2026-09-23', p)).toBe(2);
    expect(daysLeft(p.end, p)).toBe(1);
    expect(nextPayday('2026-09-23', 25)).toBe('2026-09-25');
    expect(nextPayday('2026-09-25', 25)).toBe('2026-10-25');
    expect(nextPayday('2026-02-10', 0)).toBe('2026-02-28');
    expect(isInPeriod('2026-09-24', p)).toBe(true);
    expect(isInPeriod('2026-09-25', p)).toBe(false);
  });
});

describe('isoWeek', () => {
  it('numbers weeks Monday to Sunday, across year ends', () => {
    expect(isoWeek('2026-09-21')).toBe('2026-W39'); // Monday
    expect(isoWeek('2026-09-27')).toBe('2026-W39'); // Sunday
    expect(isoWeek('2026-09-28')).toBe('2026-W40');
    expect(isoWeek('2027-01-01')).toBe('2026-W53'); // Friday, in 2026's last week
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
  });
});

describe('periodsSince', () => {
  it('counts the pay periods from the one holding `from` to today’s, both included', () => {
    expect(periodsSince('2026-09-10', '2026-09-20', 1)).toBe(1);
    expect(periodsSince('2026-08-31', '2026-09-01', 1)).toBe(2);
    expect(periodsSince('2026-01-15', '2026-09-20', 25)).toBe(9);
  });

  it('is at least 1, even for a date after today', () => {
    expect(periodsSince('2026-10-05', '2026-09-20', 1)).toBe(1);
  });
});
