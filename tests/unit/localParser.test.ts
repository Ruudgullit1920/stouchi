import { describe, expect, it } from 'vitest';
import { isUndo, parseLocal } from '../../src/shared/localParser';

const TODAY = '2026-09-10';

describe('parseLocal — expenses', () => {
  it('"50 courses hier" → courses · needs · yesterday', () => {
    expect(parseLocal('50 courses hier', TODAY)).toEqual({
      action: {
        type: 'add_expense',
        kind: 'direct',
        amount: 50,
        category: 'courses',
        pot: 'besoins',
        label: 'Courses',
        date: '2026-09-09',
      },
    });
  });

  it('"5allast 30 9ahwa" (derja in Latin letters) → café · envies, labelled in French', () => {
    expect(parseLocal('5allast 30 9ahwa', TODAY)).toMatchObject({
      action: { amount: 30, category: 'cafe', pot: 'envies', label: 'Café', date: TODAY },
    });
  });

  it('English: "coffee 4"', () => {
    expect(parseLocal('coffee 4', TODAY)).toMatchObject({ action: { category: 'cafe', amount: 4 } });
  });

  it('"12,5 taxi" → 12.5 TND exactly (12 500 mil)', () => {
    expect(parseLocal('12,5 taxi', TODAY)).toMatchObject({
      action: { amount: 12.5, category: 'transport', pot: 'besoins' },
    });
  });

  it('"avant-hier" and "le 3"', () => {
    expect(parseLocal('20 resto avant-hier', TODAY)).toMatchObject({ action: { date: '2026-09-08' } });
    expect(parseLocal('20 resto le 3', TODAY)).toMatchObject({ action: { amount: 20, date: '2026-09-03' } });
  });

  it('accents and capitals do not matter: "Pharmacie 35,200 DT"', () => {
    expect(parseLocal('Pharmacie 35,200 DT', TODAY)).toMatchObject({
      action: { amount: 35.2, category: 'sante' },
    });
  });
});

describe('parseLocal — asks instead of guessing', () => {
  it('"50" → asks what it was for, keeping 50 000 mil', () => {
    expect(parseLocal('50', TODAY)).toEqual({ ask: 'what', amount: 50_000 });
  });

  it('"courses" → asks the amount', () => {
    expect(parseLocal('courses', TODAY)).toEqual({ ask: 'amount' });
  });
});

describe('parseLocal — everything else', () => {
  it.each(['bonjour', '', 'il me reste combien ?'])('%s → unknown', (text) => {
    expect(parseLocal(text, TODAY)).toEqual({ unknown: true });
  });

  it.each(['50001 courses', '0 courses', '60000'])('%s (0 or over 50 000) → unknown', (text) => {
    expect(parseLocal(text, TODAY)).toEqual({ unknown: true });
  });

  /* offline, a correction logged as a new expense would count it twice */
  it.each([
    "en fait le café c'était 19",
    'corrige le taxi, 12',
    'supprime le resto de 30',
    'annule le café 4',
    'Sami me doit 40',
    "j'ai reçu une prime de 200",
    'mets 100 de côté',
    'je peux dépenser 50 en resto ?',
  ])('%s is not a new expense → unknown', (text) => {
    expect(parseLocal(text, TODAY)).toEqual({ unknown: true });
  });
});

describe('isUndo', () => {
  it.each(['annule', 'Annule !', 'annuler', 'oups', 'efface ça', 'non annule'])('%s → undo', (text) => {
    expect(isUndo(text)).toBe(true);
  });

  it.each(['annule le café de lundi', '50 courses', 'bonjour'])('%s → not a plain undo', (text) => {
    expect(isUndo(text)).toBe(false);
  });
});
