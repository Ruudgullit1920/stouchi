// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../src/app/router';
import { createStore, type Store } from '../../../src/data/store';
import { BudgetScreen } from '../../../src/features/budget/BudgetScreen';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { computeFacts } from '../../../src/shared/facts';
import { formatTnd } from '../../../src/shared/money';
import { bill, coupleOn, expense, HOUSEHOLD, PARTNER, profile } from '../fixtures';

let store: Store;
const ready = (s: Store) => (s.sync.value = { ...s.sync.value, load: 'ready' });
const norm = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  try {
    localStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
  hideAmounts.value = false;
  store = createStore();
  store.userId.value = profile().user_id;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BudgetScreen', () => {
  it('shows a skeleton until the first load', () => {
    render(<BudgetScreen store={store} />);
    expect(screen.getByRole('status', { name: 'Chargement…' })).toBeTruthy();
  });

  it('the first-expense "+" is a button that opens the add menu, named apart from the tab bar +', () => {
    store.profile.value = profile();
    ready(store);
    const onAdd = vi.fn();
    render(<BudgetScreen store={store} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ma première dépense' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Ajouter une dépense' })).toBeNull();
  });

  it('shows the error state when the first load fails', () => {
    store.sync.value = { ...store.sync.value, load: 'error' };
    render(<BudgetScreen store={store} />);
    expect(screen.getByRole('alert').textContent).toContain('Réessayer');
  });

  it('shows the figures computeFacts gives, with pot names next to their colours', () => {
    store.profile.value = profile();
    store.expenses.value = [
      expense({ amount_mil: 120_000, label: 'Carrefour' }),
      expense({ amount_mil: 30_000, category: 'cafe', pot: 'wants', label: 'Café Ali' }),
    ];
    store.bills.value = [bill({ amount_mil: 80_000, day: 15 })];
    ready(store);
    const f = computeFacts({
      profile: store.profile.value,
      expenses: store.expenses.value,
      bills: store.bills.value,
      billPayments: [],
      debts: [],
      savingsMoves: [],
      incomes: [],
      today: '2026-09-10',
    });
    const { container } = render(<BudgetScreen store={store} />);
    expect(norm(container.querySelector('.hero')?.textContent ?? '')).toContain(
      norm(formatTnd(f.left, { unit: false })),
    );
    expect(screen.getByText('21 jours restants')).toBeTruthy();
    const pots = container.querySelectorAll('.pot');
    expect(
      [...pots].map((p) => within(p as HTMLElement).getByText(/Besoins|Envies|Épargne/).textContent),
    ).toEqual(['Besoins', 'Envies', 'Épargne']);
    expect(screen.getByText('STEG')).toBeTruthy();
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(screen.getByText('Septembre')).toBeTruthy();
  });

  it('invites a first expense when there is none, and says when nothing is due', () => {
    store.profile.value = profile();
    ready(store);
    render(<BudgetScreen store={store} />);
    expect(screen.getByText('Note ta première dépense')).toBeTruthy();
    expect(screen.getByText('Rien à payer d’ici ta paie.')).toBeTruthy();
  });

  it('says by how much an overspent pot is over', () => {
    store.profile.value = profile();
    store.expenses.value = [expense({ amount_mil: 650_000, category: 'cafe', pot: 'wants' })];
    ready(store);
    render(<BudgetScreen store={store} />);
    expect(norm(screen.getByText(/dépassé de/).textContent)).toContain(norm(formatTnd(50_000)));
  });

  it('hides and shows the amounts with the eye, and remembers it', () => {
    store.profile.value = profile();
    ready(store);
    const { container } = render(<BudgetScreen store={store} />);
    const eye = screen.getByRole('button', { name: 'Masquer les montants' });
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(eye);
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.hero')?.textContent).toContain('•••');
    cleanup();
    const again = render(<BudgetScreen store={store} />);
    expect(again.container.querySelector('.hero')?.textContent).toContain('•••');
  });

  it('has a bell that opens Notifications', () => {
    store.profile.value = profile();
    ready(store);
    render(<BudgetScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(route.value.name).toBe('notifications');
  });

  it('opens a pot ledger, and Épargne goes to Objectif', () => {
    store.profile.value = profile();
    ready(store);
    const { container } = render(<BudgetScreen store={store} />);
    const [needs, , savings] = [...container.querySelectorAll<HTMLElement>('.pot')];
    fireEvent.click(needs);
    expect(route.value).toEqual({ name: 'pot', params: { pot: 'needs' } });
    fireEvent.click(savings);
    expect(route.value.name).toBe('goal');
  });

  it('opens an expense from Récent', () => {
    store.profile.value = profile();
    const e = expense({ label: 'Carrefour' });
    store.expenses.value = [e];
    ready(store);
    const onOpenExpense = vi.fn();
    render(<BudgetScreen store={store} onOpenExpense={onOpenExpense} />);
    fireEvent.click(screen.getByText('Carrefour'));
    expect(onOpenExpense).toHaveBeenCalledWith(e);
  });
});

describe('BudgetScreen — couple mode', () => {
  it('Récent badges a shared expense with its author', () => {
    store.profile.value = profile();
    store.sync.value = { ...store.sync.value, load: 'ready' };
    store.household.value = coupleOn('Amira');
    store.expenses.value = [
      expense({
        user_id: PARTNER,
        household_id: HOUSEHOLD,
        label: 'Aziza',
        category: 'courses',
        amount_mil: 20_000,
        spent_on: '2026-09-07',
      }),
    ];
    render(<BudgetScreen store={store} />);
    expect(screen.getByRole('img', { name: 'Noté par Amira' })).toBeTruthy();
  });
});

describe('BudgetScreen — Commun', () => {
  const needsCard = () => screen.getByRole('button', { name: /Besoins/ });
  beforeEach(() => {
    store.profile.value = profile();
    store.sync.value = { ...store.sync.value, load: 'ready' };
  });

  it('tags the Besoins card in couple mode', () => {
    store.household.value = coupleOn('Amira');
    render(<BudgetScreen store={store} />);
    expect(needsCard().textContent).toContain('Commun');
    expect(screen.getByRole('button', { name: /Envies/ }).textContent).not.toContain('Commun');
  });

  it('no tag in solo mode', () => {
    render(<BudgetScreen store={store} />);
    expect(needsCard().textContent).not.toContain('Commun');
  });
});
