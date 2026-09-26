import { describe, expect, it } from 'vitest';
import { dayHeader, initials, monthName, monthYear, shortDate } from '../../src/shared/format';

describe('format', () => {
  it('monthYear names a goal date by month and year', () => {
    expect(monthYear('2028-03-10')).toBe('Mars 2028');
  });

  it('names the month a period is labelled by, capitalised', () => {
    expect(monthName('2026-09')).toBe('Septembre');
    expect(monthName('2027-02')).toBe('Février');
  });

  it('writes a short French date', () => {
    expect(shortDate('2026-09-15')).toBe('15 sept.');
    expect(shortDate('2026-08-01')).toBe('1 août');
  });

  it('splits a day into the parts of a day header', () => {
    expect(dayHeader('2026-09-15')).toEqual({ day: '15', weekday: 'mar.', monthYear: '09.2026' });
  });

  it('makes initials from a first name, or from two names', () => {
    expect(initials('Sofiene')).toBe('S');
    expect(initials('  zeineb ben ali ')).toBe('ZB');
    expect(initials('')).toBe('');
  });
});
