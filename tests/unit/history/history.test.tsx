// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/data/store';
import { HistoryScreen } from '../../../src/features/history/HistoryScreen';
import { formatTnd, splitSalary } from '../../../src/shared/money';
import { coupleOn, expense, HOUSEHOLD, move, PARTNER, profile, SOLO } from '../fixtures';

let store: Store;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = profile().user_id;
  store.profile.value = profile(); // payday 1
  store.sync.value = { ...store.sync.value, load: 'ready' };
  store.expenses.value = [
    expense({
      label: 'Café Chez Ali',
      category: 'cafe',
      pot: 'wants',
      amount_mil: 4_500,
      spent_on: '2026-09-05',
    }),
    expense({ label: 'Carrefour', category: 'courses', amount_mil: 80_000, spent_on: '2026-09-02' }),
    expense({
      label: 'Café du coin',
      category: 'cafe',
      pot: 'wants',
      amount_mil: 3_000,
      spent_on: '2026-08-12',
    }),
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const search = () => screen.getByRole('searchbox', { name: 'Rechercher dans l’historique' });
const months = () => screen.getByRole('listbox', { name: 'Choisir une période' });
const selected = () => within(months()).getByRole('option', { selected: true });

describe('HistoryScreen', () => {
  it('browses the current period: total, pots, Aam Salah’s line, categories and the list', () => {
    render(<HistoryScreen store={store} />);
    expect(selected().getAttribute('aria-label')).toBe('Septembre 2026');
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(screen.queryByText('Café du coin')).toBeNull();
    expect(screen.getByText(/Courses/, { selector: '.insight p' })).toBeTruthy();
  });

  it('moves between periods with the arrow keys, Home and End', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.keyDown(selected(), { key: 'ArrowLeft' });
    expect(selected().getAttribute('aria-label')).toBe('Août 2026');
    expect(screen.getByText('Café du coin')).toBeTruthy();
    fireEvent.keyDown(selected(), { key: 'Home' });
    expect(selected().getAttribute('aria-label')).toBe('Octobre 2025');
    fireEvent.keyDown(selected(), { key: 'End' });
    expect(selected().getAttribute('aria-label')).toBe('Septembre 2026');
    fireEvent.keyDown(selected(), { key: 'ArrowRight' });
    expect(selected().getAttribute('aria-label')).toBe('Septembre 2026');
  });

  it('filters the list by tapping a category', () => {
    render(<HistoryScreen store={store} />);
    const cafe = screen.getByRole('button', { name: /^Café/, pressed: false });
    fireEvent.click(cafe);
    expect(cafe.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Carrefour')).toBeNull();
    fireEvent.click(cafe);
    expect(screen.getByText('Carrefour')).toBeTruthy();
  });

  it('narrows the list to one pot with its pills, and marks the day of the period', () => {
    render(<HistoryScreen store={store} />);
    expect(screen.getByText('J10')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dépenses : Envies' }));
    expect(screen.queryByText('Carrefour')).toBeNull();
    expect(screen.getByText('Café Chez Ali')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dépenses : Tout' }));
    expect(screen.getByText('Carrefour')).toBeTruthy();
  });

  it('searches every period, grouped by month, with the match highlighted', () => {
    const { container } = render(<HistoryScreen store={store} />);
    fireEvent.input(search(), { target: { value: 'cafe' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    const groups = container.querySelectorAll('.sgroup');
    expect([...groups].map((g) => g.querySelector('h2')?.textContent)).toEqual(['Septembre', 'Août']);
    const marks = [...container.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['Café', 'Café']);
  });

  it('clearing the search goes back to browsing', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.input(search(), { target: { value: 'cafe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(months()).toBeTruthy();
    expect((search() as HTMLInputElement).value).toBe('');
  });

  it('says so when nothing matches', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.input(search(), { target: { value: 'zzz' } });
    expect(screen.getByText('Aucun résultat pour « zzz ».')).toBeTruthy();
  });

  it('offers quick searches on focus', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.focus(search());
    fireEvent.click(screen.getByRole('button', { name: 'Envies' }));
    expect((search() as HTMLInputElement).value).toBe('Envies');
  });

  it('shows an empty period plainly', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.keyDown(selected(), { key: 'Home' });
    expect(screen.getByText('Aucune dépense notée pour cette période.')).toBeTruthy();
  });
});

describe('HistoryScreen — couple mode', () => {
  const total = () => document.querySelector('.monthcard__total')?.textContent ?? '';
  beforeEach(() => {
    store.profile.value = profile({ first_name: 'Sami' });
    store.household.value = coupleOn('Amira');
    store.expenses.value = [
      ...store.expenses.value.map((e) => (e.pot === 'needs' ? { ...e, household_id: HOUSEHOLD } : e)),
      expense({
        user_id: PARTNER,
        household_id: HOUSEHOLD,
        label: 'Monoprix',
        category: 'courses',
        amount_mil: 50_000,
        spent_on: '2026-09-03',
      }),
    ];
  });

  it('in solo mode there are no pills and no badges', () => {
    store.household.value = SOLO;
    render(<HistoryScreen store={store} />);
    expect(screen.queryByRole('button', { name: 'Tout' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('badges each shared row with its author, never a private one', () => {
    render(<HistoryScreen store={store} />);
    expect(
      screen
        .getByRole('button', { name: /Monoprix/ })
        .querySelector('[role=img]')
        ?.getAttribute('aria-label'),
    ).toBe('Noté par Amira');
    expect(
      screen
        .getByRole('button', { name: /Carrefour/ })
        .querySelector('[role=img]')
        ?.getAttribute('aria-label'),
    ).toBe('Noté par Sami');
    expect(screen.getByRole('button', { name: /Café Chez Ali/ }).querySelector('[role=img]')).toBeNull();
  });

  it('Moi keeps my rows: the list, the categories and the month total follow', () => {
    render(<HistoryScreen store={store} />);
    expect(screen.getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('true');
    expect(total()).toContain(formatTnd(134_500, { unit: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Moi' }));
    expect(screen.getByRole('button', { name: 'Moi' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Monoprix')).toBeNull();
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(total()).toContain(formatTnd(84_500, { unit: false }));
  });

  describe('the pot cards (M1)', () => {
    const p = () => profile();
    const myNeeds = () =>
      splitSalary(p().salary_mil, {
        needs: p().split_needs,
        wants: p().split_wants,
        savings: p().split_savings,
      }).needs;
    const card = (name: string) =>
      screen.getByRole('button', { name: new RegExp(`^${name}`) }).textContent ?? '';
    beforeEach(() => {
      store.savingsMoves.value = [
        move({ amount_mil: 100_000, occurred_on: '2026-09-02' }),
        move({ user_id: PARTNER, amount_mil: 70_000, occurred_on: '2026-09-04' }),
      ];
    });

    it('Tout compares shared Besoins with the household budget, like the Budget screen', () => {
      render(<HistoryScreen store={store} />);
      expect(card('Besoins')).toContain(formatTnd(myNeeds() + 900_000, { unit: false }));
    });

    it('Moi compares my Besoins with my own budget', () => {
      render(<HistoryScreen store={store} />);
      fireEvent.click(screen.getByRole('button', { name: 'Moi' }));
      expect(card('Besoins')).toContain(formatTnd(myNeeds(), { unit: false }));
      expect(card('Besoins')).not.toContain(formatTnd(myNeeds() + 900_000, { unit: false }));
    });

    it('a period before the pairing (no shared row) keeps my own budget in Tout (review I1)', () => {
      render(<HistoryScreen store={store} />);
      fireEvent.click(screen.getByRole('option', { name: /^Août 2026/ }));
      expect(card('Besoins')).toContain(formatTnd(myNeeds(), { unit: false }));
    });

    it('a past period holding a shared row counts as the household’s', () => {
      store.expenses.value = [
        ...store.expenses.value,
        expense({ user_id: PARTNER, household_id: HOUSEHOLD, amount_mil: 20_000, spent_on: '2026-08-20' }),
      ];
      render(<HistoryScreen store={store} />);
      fireEvent.click(screen.getByRole('option', { name: /^Août 2026/ }));
      expect(card('Besoins')).toContain(formatTnd(myNeeds() + 900_000, { unit: false }));
    });

    it('uses the plan in force for the period, like Budget (review m2)', () => {
      store.household.value = SOLO;
      store.profile.value = profile({
        next_salary_mil: 3_000_000,
        next_split_needs: 50,
        next_split_wants: 30,
        next_split_savings: 20,
        next_from: '2026-09-01',
      });
      render(<HistoryScreen store={store} />);
      expect(card('Besoins')).toContain(formatTnd(1_500_000, { unit: false }));
    });

    it('Épargne counts my deposits only, in Tout and in Moi', () => {
      render(<HistoryScreen store={store} />);
      expect(card('Épargne')).toContain(formatTnd(100_000, { unit: false }));
      fireEvent.click(screen.getByRole('button', { name: 'Moi' }));
      expect(card('Épargne')).toContain(formatTnd(100_000, { unit: false }));
    });
  });

  it('Moi also narrows the search', () => {
    render(<HistoryScreen store={store} />);
    fireEvent.input(search(), { target: { value: 'Monoprix' } });
    expect(screen.getByText('Monoprix', { selector: 'mark' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Moi' }));
    expect(screen.queryByText('Monoprix', { selector: 'mark' })).toBeNull();
    expect(screen.getByText(/Aucun|Rien/)).toBeTruthy();
  });
});
