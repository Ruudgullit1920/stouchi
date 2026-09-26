import { describe, expect, it } from 'vitest';
import { periodsBack } from '../../src/shared/dates';
import { normalize, searchExpenses } from '../../src/shared/search';
import { expense } from './fixtures';

const periods = periodsBack('2026-09-10', 1, 12); // 2026-09 back to 2025-10

describe('normalize', () => {
  it('drops case and accents', () => {
    expect(normalize('Café ÉTÉ')).toBe('cafe ete');
  });
});

describe('searchExpenses', () => {
  const cafe = expense({ label: 'Café Chez Ali', category: 'cafe', pot: 'wants', amount_mil: 4_500 });
  const courses = expense({ label: 'Monoprix', amount_mil: 12_000, spent_on: '2026-08-20' });
  const half = expense({ label: 'Pharmacie', category: 'sante', amount_mil: 12_500 });
  const deleted = expense({ label: 'Café supprimé', deleted_at: '2026-09-05T10:00:00+01:00' });
  const ancient = expense({ label: 'Café ancien', spent_on: '2025-09-15' });
  const all = [cafe, courses, half, deleted, ancient];
  const ids = (q: string) => searchExpenses(all, q, periods).flatMap((g) => g.items.map((i) => i.expense.id));

  it('matches the label without caring about case or accents', () => {
    expect(ids('cafe')).toEqual([cafe.id]);
    expect(ids('CAFÉ')).toEqual([cafe.id]);
  });

  it('matches the category name and the pot name', () => {
    expect(ids('santé')).toEqual([half.id]);
    expect(ids('envies')).toEqual([cafe.id]);
  });

  it('matches an exact amount however it is typed', () => {
    for (const q of ['12', '12,000', '12.000', '12 TND']) expect(ids(q)).toEqual([courses.id]);
    for (const q of ['12,5', '12.500']) expect(ids(q)).toEqual([half.id]);
  });

  it('returns nothing for an empty or blank query', () => {
    expect(searchExpenses(all, '', periods)).toEqual([]);
    expect(searchExpenses(all, '   ', periods)).toEqual([]);
  });

  it('skips deleted expenses and anything older than the periods given', () => {
    expect(ids('ancien')).toEqual([]);
    expect(ids('supprimé')).toEqual([]);
  });

  it('groups by period, newest first, with count and total', () => {
    const groups = searchExpenses(all, 'i', periods); // Ali, Monoprix, Pharmacie
    expect(groups.map((g) => [g.period.label, g.count, g.total])).toEqual([
      ['2026-09', 2, 17_000],
      ['2026-08', 1, 12_000],
    ]);
  });

  it('marks where the query sits in the title, on the original accented text', () => {
    const [group] = searchExpenses(all, 'chez', periods);
    expect(group.items[0].ranges).toEqual([[5, 9]]);
    const [accented] = searchExpenses(all, 'cafe', periods);
    expect(accented.items[0].ranges).toEqual([[0, 4]]);
    const [byAmount] = searchExpenses(all, '4,5', periods);
    expect(byAmount.items[0].ranges).toEqual([]);
  });
});
