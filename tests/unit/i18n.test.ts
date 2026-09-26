import { describe, expect, it } from 'vitest';
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
