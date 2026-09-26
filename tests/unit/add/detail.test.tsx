// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../../src/app/ToastHost';
import { toast } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import { ExpenseDetailSheet } from '../../../src/features/add/ExpenseDetailSheet';
import { CoupleError } from '../../../src/data/couple';
import { coupleOn, expense, HOUSEHOLD, PARTNER, profile, USER } from '../fixtures';

let store: Store;
const e = expense({ label: 'Carrefour', amount_mil: 12_000, spent_on: '2026-09-08' });
const repo = {
  update: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  restore: vi.fn(() => Promise.resolve()),
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  store.expenses.value = [e];
  Object.values(repo).forEach((f) => f.mockClear());
  toast.value = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderSheet = (onDone = vi.fn()) =>
  render(
    <>
      <ExpenseDetailSheet store={store} expense={e} repo={repo} onDone={onDone} />
      <ToastHost />
    </>,
  );

describe('ExpenseDetailSheet', () => {
  it('opens on the expense and saves an edit to that same row', async () => {
    const onDone = vi.fn();
    renderSheet(onDone);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Note').value).toBe('Carrefour');
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(repo.update).toHaveBeenCalledWith(
      e.id,
      expect.objectContaining({ amount_mil: 125_000, label: 'Carrefour' }),
    );
  });

  it('asks before deleting; Non keeps it', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const yes = screen.getByRole('button', { name: 'Oui, supprimer' });
    expect(document.activeElement).toBe(yes);
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    expect(screen.queryByRole('button', { name: 'Oui, supprimer' })).toBeNull();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('deletes, then Annuler in the toast brings it back', async () => {
    const onDone = vi.fn();
    renderSheet(onDone);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    await waitFor(() => expect(repo.remove).toHaveBeenCalledWith(e.id));
    expect(onDone).toHaveBeenCalled();
    expect(await screen.findByText('Dépense supprimée')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(repo.restore).toHaveBeenCalledWith(e.id);
  });

  it('the undo toast is gone after 6 seconds', async () => {
    vi.useFakeTimers({
      now: new Date('2026-09-10T09:00:00Z'),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, supprimer' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy();
    await act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });
});

describe('ExpenseDetailSheet — couple mode', () => {
  const shared = expense({
    label: 'Aziza',
    amount_mil: 20_000,
    spent_on: '2026-09-08',
    household_id: HOUSEHOLD,
  });
  const open = (row = shared, onDone = vi.fn()) => {
    render(<ExpenseDetailSheet store={store} expense={row} repo={repo} onDone={onDone} />);
    return onDone;
  };
  beforeEach(() => {
    store.household.value = coupleOn('Amira');
  });

  it('says who logged a shared expense', () => {
    open({ ...shared, user_id: PARTNER });
    expect(screen.getByText('Noté par Amira')).toBeTruthy();
  });

  it('no author line on a private expense or in solo mode', () => {
    open(e);
    expect(screen.queryByText(/Noté par/)).toBeNull();
    cleanup();
    store.household.value = null;
    open();
    expect(screen.queryByText(/Noté par/)).toBeNull();
  });

  it('moving a shared expense to Envies goes through the repo’s update (which calls moveToWants)', async () => {
    const onDone = open();
    fireEvent.click(screen.getByRole('button', { name: /^Envies/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(repo.update).toHaveBeenCalledWith(shared.id, expect.objectContaining({ pot: 'wants' }));
  });

  it('a move the database refuses (the partner’s expense) says why and keeps the sheet', async () => {
    repo.update.mockImplementationOnce(() => Promise.reject(new CoupleError('couple.err.not_author')));
    const onDone = open({ ...shared, user_id: PARTNER });
    fireEvent.click(screen.getByRole('button', { name: /^Envies/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Seul l'auteur de cette dépense peut la passer en Envies.",
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
