import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPLIT,
  MAX_MIL,
  floorTenth,
  formatMoney,
  isValidSplit,
  milFromTnd,
  parseMoney,
  splitSalary,
} from '../../src/shared/money';

describe('parseMoney', () => {
  it.each([
    ['12', 12_000],
    ['12,5', 12_500],
    ['12.5', 12_500],
    ['1.200', 1_200], // Tunisian price tags: 1 dinar 200 millimes
    ['12,500', 12_500],
    ['1 200', 1_200_000],
    ['1 200,75', 1_200_750],
    ['1 200', 1_200_000],
    ['0', 0],
    [' 45 dt', 45_000],
    ['45 TND', 45_000],
    ['7 dinars', 7_000],
  ])('%j → %i millimes', (input, mil) => {
    expect(parseMoney(input)).toBe(mil);
  });

  it.each(['', 'abc', '-5', '1,2,3', '12.3456', '1 20', '12 5', '1e3', '١٢'])('%j is refused', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('refuses amounts above the cap', () => {
    expect(parseMoney('1 000 000')).toBe(MAX_MIL);
    expect(parseMoney('1 000 001')).toBeNull();
  });
});

describe('milFromTnd', () => {
  it('rounds float dinars to whole millimes', () => {
    expect(milFromTnd(12.345)).toBe(12_345);
    expect(milFromTnd(0.1 + 0.2)).toBe(300);
    expect(milFromTnd(-5)).toBe(-5_000);
  });

  it('refuses NaN, Infinity and amounts above the cap', () => {
    expect(milFromTnd(Number.NaN)).toBeNull();
    expect(milFromTnd(Number.POSITIVE_INFINITY)).toBeNull();
    expect(milFromTnd(1_000_001)).toBeNull();
  });
});

describe('formatMoney', () => {
  it('groups thousands with a non-breaking space and keeps the unit attached', () => {
    const s = formatMoney(1_200_000);
    expect(s).toMatch(/^1[  ]200 TND$/);
    expect(s).not.toContain(' ');
  });

  it('shows millimes only when there are some', () => {
    expect(formatMoney(12_500, { unit: false })).toBe('12,5');
    expect(formatMoney(12_000, { unit: false })).toBe('12');
    expect(formatMoney(1, { unit: false })).toBe('0,001');
  });

  it('uses a real minus sign, and a plus only when asked', () => {
    expect(formatMoney(-8_000, { unit: false })).toBe('−8');
    expect(formatMoney(200_000, { unit: false, sign: true })).toBe('+200');
    expect(formatMoney(0, { unit: false, sign: true })).toBe('0');
  });
});

describe('splitSalary', () => {
  it('splits 50/30/20 and never loses a millime', () => {
    expect(splitSalary(2_500_000, DEFAULT_SPLIT)).toEqual({
      needs: 1_250_000,
      wants: 750_000,
      savings: 500_000,
    });
    const odd = splitSalary(1_001, DEFAULT_SPLIT);
    expect(odd.needs + odd.wants + odd.savings).toBe(1_001);
    expect(odd).toEqual({ needs: 501, wants: 300, savings: 200 });
  });

  it('breaks equal remainders towards Besoins, like couple_needs_mil in SQL', () => {
    // 4 × 60 % and 4 × 10 % both leave 40/100 of a millime; floats saw 0.3999… vs 0.4.
    expect(splitSalary(4, { needs: 60, wants: 30, savings: 10 })).toEqual({
      needs: 3,
      wants: 1,
      savings: 0,
    });
    expect(splitSalary(44, { needs: 60, wants: 30, savings: 10 })).toEqual({
      needs: 27,
      wants: 13,
      savings: 4,
    });
  });

  it('handles a zero salary and a 100/0/0 split', () => {
    expect(splitSalary(0, DEFAULT_SPLIT)).toEqual({ needs: 0, wants: 0, savings: 0 });
    expect(splitSalary(999, { needs: 100, wants: 0, savings: 0 })).toEqual({
      needs: 999,
      wants: 0,
      savings: 0,
    });
  });

  it('accepts only whole percentages that add up to 100', () => {
    expect(isValidSplit(DEFAULT_SPLIT)).toBe(true);
    expect(isValidSplit({ needs: 50, wants: 30, savings: 30 })).toBe(false);
    expect(isValidSplit({ needs: 50.5, wants: 29.5, savings: 20 })).toBe(false);
    expect(isValidSplit({ needs: -10, wants: 90, savings: 20 })).toBe(false);
  });
});

describe('floorTenth', () => {
  it('cuts to one decimal, never rounds up', () => {
    expect(formatMoney(floorTenth(84_666), { unit: false })).toBe('84,6');
    expect(formatMoney(floorTenth(2_485_649), { unit: false })).toBe('2 485,6');
    expect(formatMoney(floorTenth(84_099), { unit: false })).toBe('84');
  });

  it('a negative goes further down, never shows less overspend', () => {
    expect(formatMoney(floorTenth(-1_234), { unit: false })).toBe('−1,3');
  });
});
