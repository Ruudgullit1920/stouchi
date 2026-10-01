// @vitest-environment jsdom
/* An old 3-decimal amount shown in a 2-decimal currency (currency spec §4, review Important 2):
 * it stays as stored unless the person edits the amount itself. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../src/data/store';
import { ExpenseForm, type ExpenseFields } from '../../../src/features/add/ExpenseForm';
import { setCurrentCurrency } from '../../../src/shared/currentCurrency';
import { todayTunis } from '../../../src/shared/dates';
import { profile } from '../fixtures';

const initial = (): ExpenseFields => ({
  amount_mil: 12_345,
  category: 'cafe',
  pot: 'wants',
  label: 'Café',
  spent_on: todayTunis(),
});
let onSubmit: ReturnType<typeof vi.fn<(f: ExpenseFields) => Promise<unknown>>>;

beforeEach(() => {
  setCurrentCurrency('EUR');
  onSubmit = vi.fn<(f: ExpenseFields) => Promise<unknown>>().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  setCurrentCurrency('TND');
});

const open = () => {
  const store = createStore();
  store.profile.value = profile({ currency: 'EUR' });
  render(<ExpenseForm store={store} initial={initial()} onSubmit={onSubmit} />);
};

describe('editing an old amount in a 2-decimal currency', () => {
  it('shows it rounded but saves it unchanged when only the note changes', async () => {
    open();
    expect(screen.getByLabelText('Montant').textContent).toBe('12,35');
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'Café du coin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount_mil: 12_345, label: 'Café du coin' });
  });

  it('saves what is typed once the amount is edited', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].amount_mil).toBe(12_300);
  });
});
