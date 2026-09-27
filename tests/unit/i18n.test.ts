import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentCurrency } from '../../src/shared/currentCurrency';
import fr from '../../src/shared/i18n/fr.json';
import { t } from '../../src/shared/i18n/t';

describe('t', () => {
  it('returns the French string', () => {
    expect(t('pot.needs')).toBe('Besoins');
  });

  it('fills {placeholders} and leaves unknown ones visible', () => {
    expect(t('period.daysLeft', { n: 3 })).toBe('3 jours restants');
    expect(t('period.daysLeft', {})).toBe('{n} jours restants');
  });
});

describe('t and the currency', () => {
  afterEach(() => setCurrentCurrency('TND'));

  it('has no literal TND left in the strings', () => {
    expect(Object.entries(fr).filter(([, v]) => /\bTND\b/.test(v))).toEqual([]);
  });

  it('fills {unit} from the current currency', () => {
    expect(t('pot.rest')).toBe('TND restants');
    setCurrentCurrency('EUR');
    expect(t('pot.rest')).toBe('€ restants');
    expect(t('export.col.amount')).toBe('Montant (EUR)');
  });

  it('lets an explicit unit win', () => {
    setCurrentCurrency('EUR');
    expect(t('pot.rest', { unit: 'DH' })).toBe('DH restants');
    expect(t('export.col.amount', { code: 'MAD' })).toBe('Montant (MAD)');
  });
});
