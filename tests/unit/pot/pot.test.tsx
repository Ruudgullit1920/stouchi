// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../src/app/router';
import { createStore, type Store } from '../../../src/data/store';
import { PotScreen } from '../../../src/features/pot/PotScreen';
import { coupleOn, expense, HOUSEHOLD, PARTNER, profile } from '../fixtures';

let store: Store;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = profile().user_id;
  store.profile.value = profile(); // payday 1
  store.sync.value = { ...store.sync.value, load: 'ready' };
  route.value = { name: 'pot', params: { pot: 'needs' } };
  store.expenses.value = [
    expense({ label: 'Carrefour', category: 'courses', amount_mil: 60_000, spent_on: '2026-09-08' }),
    expense({ label: 'Loyer', category: 'loyer', amount_mil: 400_000, spent_on: '2026-09-01' }),
    expense({ label: 'Café', category: 'cafe', pot: 'wants', amount_mil: 4_000 }),
    expense({ label: 'Monoprix août', category: 'courses', amount_mil: 30_000, spent_on: '2026-08-20' }),
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const prev = () => screen.getByRole('button', { name: 'Période précédente' });
const next = () => screen.getByRole('button', { name: 'Période suivante' });

describe('PotScreen', () => {
  it("lists this pot's expenses for the current period, grouped by day", () => {
    render(<PotScreen store={store} />);
    expect(screen.getByRole('heading', { name: 'Septembre' })).toBeTruthy();
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(screen.getByText('Loyer', { selector: '.ledger-row__title' })).toBeTruthy();
    expect(screen.queryByText('Café')).toBeNull();
    expect(screen.queryByText('Monoprix août')).toBeNull();
    expect(screen.getAllByText('8').length).toBeGreaterThan(0); // day header
  });

  it('switches periods, never into the future and not past 12 periods back', () => {
    render(<PotScreen store={store} />);
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(prev());
    expect(screen.getByRole('heading', { name: 'Août' })).toBeTruthy();
    expect(screen.getByText('Monoprix août')).toBeTruthy();
    for (let i = 0; i < 20; i++) fireEvent.click(prev());
    expect(screen.getByRole('heading', { name: 'Octobre' })).toBeTruthy(); // 2025-10, 11 back
    expect((prev() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows what is left per day only for the current period', () => {
    render(<PotScreen store={store} />);
    expect(screen.getByText('Il te reste')).toBeTruthy();
    expect(screen.getByText(/\/ jour/)).toBeTruthy();
    fireEvent.click(prev());
    expect(screen.getByText('Non dépensé')).toBeTruthy();
    expect(screen.queryByText(/\/ jour/)).toBeNull();
  });

  it('narrows the list with a category pill', () => {
    render(<PotScreen store={store} />);
    const loyer = screen.getByRole('button', { name: 'Loyer' });
    expect(loyer.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(loyer);
    expect(loyer.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Carrefour')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getByText('Carrefour')).toBeTruthy();
  });

  it('searches within the pot', () => {
    render(<PotScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'carre' } });
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(screen.queryByText('Loyer', { selector: '.ledger-row__title' })).toBeNull();
  });

  it('shows the empty state for a period with nothing in it', () => {
    render(<PotScreen store={store} />);
    fireEvent.click(prev());
    fireEvent.click(prev());
    expect(screen.getByText('Aucune dépense ici.')).toBeTruthy();
  });

  it('opens an expense', () => {
    const onOpenExpense = vi.fn();
    render(<PotScreen store={store} onOpenExpense={onOpenExpense} />);
    fireEvent.click(screen.getByText('Carrefour'));
    expect(onOpenExpense).toHaveBeenCalledWith(expect.objectContaining({ label: 'Carrefour' }));
  });
});

describe('PotScreen — couple mode', () => {
  it('badges the partner’s shared expense with their name', () => {
    store.household.value = coupleOn('Amira');
    store.expenses.value = [
      ...store.expenses.value,
      expense({
        user_id: PARTNER,
        household_id: HOUSEHOLD,
        label: 'Aziza',
        category: 'courses',
        amount_mil: 20_000,
        spent_on: '2026-09-07',
      }),
    ];
    render(<PotScreen store={store} />);
    expect(screen.getByRole('img', { name: 'Noté par Amira' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
