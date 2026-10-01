import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencyOf, guessCurrency, isCurrencyCode } from '../../src/shared/currencies';
import { formatMoney, maxDecimals, parseMoney } from '../../src/shared/money';

const NB = '[ ]';

describe('the currency table', () => {
  it('lists the nine codes in the spec order', () => {
    expect(CURRENCIES.map((c) => c.code)).toEqual([
      'TND',
      'EUR',
      'USD',
      'GBP',
      'CAD',
      'CHF',
      'MAD',
      'DZD',
      'LYD',
    ]);
  });

  it('gives TND and LYD three decimals and the rest two', () => {
    for (const c of CURRENCIES) expect(maxDecimals(c.code)).toBe(['TND', 'LYD'].includes(c.code) ? 3 : 2);
  });

  it('recognises only the nine codes', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('eur')).toBe(false);
    expect(isCurrencyCode('XXX')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });

  it('falls back to TND for an unknown or missing code', () => {
    expect(currencyOf('XXX').code).toBe('TND');
    expect(currencyOf(null).code).toBe('TND');
    expect(currencyOf(undefined).code).toBe('TND');
    expect(currencyOf('GBP').code).toBe('GBP');
  });

  it('guesses from the time zone, TND when unknown', () => {
    expect(guessCurrency('Africa/Tunis')).toBe('TND');
    expect(guessCurrency('Europe/Paris')).toBe('EUR');
    expect(guessCurrency('Europe/London')).toBe('GBP');
    expect(guessCurrency('America/Toronto')).toBe('CAD');
    expect(guessCurrency('America/New_York')).toBe('USD');
    expect(guessCurrency('Europe/Zurich')).toBe('CHF');
    expect(guessCurrency('Africa/Casablanca')).toBe('MAD');
    expect(guessCurrency('Africa/Algiers')).toBe('DZD');
    expect(guessCurrency('Africa/Tripoli')).toBe('LYD');
    expect(guessCurrency('Asia/Tokyo')).toBe('TND');
    expect(guessCurrency('')).toBe('TND');
  });
});

describe('formatMoney in each currency', () => {
  it.each([
    ['TND', '1 200,5', 'TND'],
    ['EUR', '1 200,50', '€'],
    ['USD', '1 200,50', '$'],
    ['GBP', '1 200,50', '£'],
    ['CAD', '1 200,50', '$ CA'],
    ['CHF', '1 200,50', 'CHF'],
    ['MAD', '1 200,50', 'DH'],
    ['DZD', '1 200,50', 'DA'],
    ['LYD', '1 200,5', 'LYD'],
  ] as const)('%s: 1 200 500 mil → %s %s', (currency, figure, suffix) => {
    const re = figure.replace(/ /g, NB);
    expect(formatMoney(1_200_500, { currency, unit: false })).toMatch(new RegExp(`^${re}$`));
    expect(formatMoney(1_200_500, { currency })).toBe(
      formatMoney(1_200_500, { currency, unit: false }) + ' ' + suffix,
    );
    expect(formatMoney(-1_200_500, { currency, unit: false })).toMatch(new RegExp(`^−${re}$`));
    expect(formatMoney(1_200_500, { currency, unit: false, sign: true })).toMatch(new RegExp(`^\\+${re}$`));
  });

  it('rounds an old third decimal half-up to cents, for display only', () => {
    expect(formatMoney(12_345, { currency: 'EUR' })).toBe('12,35 €');
    expect(formatMoney(12_344, { currency: 'EUR' })).toBe('12,34 €');
    expect(formatMoney(-12_345, { currency: 'EUR', unit: false })).toBe('−12,35');
    expect(formatMoney(12_345, { currency: 'TND', unit: false })).toBe('12,345');
  });

  it('shows whole amounts without decimals', () => {
    expect(formatMoney(0, { currency: 'EUR' })).toBe('0 €');
    expect(formatMoney(12_000, { currency: 'EUR', unit: false })).toBe('12');
  });

  it('defaults to TND', () => {
    expect(formatMoney(45_000)).toBe('45 TND');
  });
});

describe('parseMoney in each currency', () => {
  it.each([
    ['EUR', '4,50 €', 4_500],
    ['EUR', '4.5€', 4_500],
    ['EUR', '12 EUR', 12_000],
    ['EUR', '3 euros', 3_000],
    ['EUR', '1 200,75', 1_200_750],
    ['USD', '9,99 $', 9_990],
    ['USD', '2 Dollars', 2_000],
    ['GBP', '5 £', 5_000],
    ['GBP', '5 livres', 5_000],
    ['CAD', '7 $ CA', 7_000],
    ['CAD', '7 cad', 7_000],
    ['CHF', '8 chf', 8_000],
    ['CHF', '8 francs', 8_000],
    ['MAD', '10 DH', 10_000],
    ['MAD', '10 dirhams', 10_000],
    ['DZD', '100 DA', 100_000],
    ['DZD', '100 dinars', 100_000],
    ['LYD', '1,250 LD', 1_250],
    ['LYD', '1,250 LYD', 1_250],
    ['TND', '12,345 TND', 12_345],
    ['TND', '12,345', 12_345],
  ] as const)('%s: %j → %i', (currency, input, mil) => {
    expect(parseMoney(input, currency)).toBe(mil);
  });

  it.each([
    ['EUR', '12,345 €'],
    ['EUR', '12,345'],
    ['EUR', '1.200'],
    ['EUR', '12 TND'],
    ['TND', '4 €'],
    ['GBP', '4 dollars'],
  ] as const)('%s refuses %j', (currency, input) => {
    expect(parseMoney(input, currency)).toBeNull();
  });
});
