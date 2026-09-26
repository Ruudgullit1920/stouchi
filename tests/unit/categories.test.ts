import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS, categoriesIn, categoryLabel, isCategory, potOf } from '../../src/shared/categories';

/* The assistant's server validator forces the pot from the category; if the two
   lists drift, a chat expense lands in a different pot than a manual one. */
const { CAT_POT } = createRequire(import.meta.url)('../../lib/aam-salah/validate.js') as {
  CAT_POT: Record<string, 'besoins' | 'envies'>;
};

describe('categories', () => {
  it('the assistant and the app agree on every category and its pot', () => {
    expect(Object.keys(CAT_POT).sort()).toEqual([...CATEGORY_KEYS].sort());
    for (const k of CATEGORY_KEYS) expect(CAT_POT[k]).toBe(potOf(k) === 'needs' ? 'besoins' : 'envies');
  });

  it('every category has a French label', () => {
    for (const k of CATEGORY_KEYS) {
      expect(categoryLabel(k)).toEqual(expect.any(String));
      expect(categoryLabel(k)).not.toBe('');
    }
    expect(categoryLabel('cafe')).toBe('Café');
  });

  it('splits into 9 needs and 10 wants; unknown keys are refused', () => {
    expect(categoriesIn('needs')).toHaveLength(9);
    expect(categoriesIn('wants')).toHaveLength(10);
    expect(isCategory('abonnement')).toBe(true);
    expect(isCategory('abo')).toBe(false);
  });
});
