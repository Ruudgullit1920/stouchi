// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sheet, toast } from '../../../src/app/ui';
import type { Row } from '../../../src/data/localdb';
import { createStore, factsInput, type Store } from '../../../src/data/store';
import { BillSheet } from '../../../src/features/me/BillSheet';
import { BillsScreen } from '../../../src/features/me/BillsScreen';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { computeFacts } from '../../../src/shared/facts';
import { formatMoney } from '../../../src/shared/money';
import { bill, profile, USER } from '../fixtures';

const write = vi.fn<(table: 'bills', row: Row) => Promise<void>>().mockResolvedValue(undefined);
const done = vi.fn();
let store: Store;
beforeEach(() => {
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  write.mockClear();
  done.mockClear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-09-10T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sheet.value = null;
  toast.value = null;
});

const openScreen = () => render(<BillsScreen store={store} write={write} onBack={() => undefined} />);
const openSheet = (b?: ReturnType<typeof bill>) =>
  render(<BillSheet store={store} bill={b} write={write} onDone={done} />);

describe('BillsScreen', () => {
  it('with no bill, offers to add one', () => {
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une facture' }));
    expect(sheet.value?.title).toBe('Nouvelle facture');
  });

  it('lists the active bills and opens one to edit', () => {
    store.bills.value = [
      bill({ label: 'STEG', amount_mil: 80_000, day: 15 }),
      bill({ label: 'Ancienne', active: false }),
    ];
    openScreen();
    const row = screen.getByRole('button', { name: /STEG/ });
    expect(row.textContent).toContain('Le 15 · Chaque mois');
    expect(row.textContent).toContain(formatMoney(80_000, { unit: false }));
    expect(screen.queryByText('Ancienne')).toBeNull();
    fireEvent.click(row);
    expect(sheet.value?.title).toBe('Modifier la facture');
  });

  it('hides the amounts when asked', () => {
    hideAmounts.value = true;
    store.bills.value = [bill({ label: 'STEG', amount_mil: 80_000 })];
    openScreen();
    expect(document.body.textContent).not.toContain(formatMoney(80_000, { unit: false }));
    hideAmounts.value = false;
  });

  it('colours the meter above 80 % of Besoins and explains above 100 %', () => {
    store.bills.value = [bill({ amount_mil: 800_000 })];
    const { unmount } = openScreen();
    expect(screen.getByTestId('bills-meter').className).not.toContain('warn');
    unmount();
    store.bills.value = [bill({ amount_mil: 850_000 })];
    const second = openScreen();
    expect(screen.getByTestId('bills-meter').className).toContain('warn');
    expect(screen.getByTestId('bills-meter').textContent).toContain('85 %');
    second.unmount();
    store.bills.value = [bill({ amount_mil: 1_100_000 })];
    openScreen();
    expect(screen.getByTestId('bills-meter').textContent).toContain(
      `dépassent tes Besoins de ${formatMoney(100_000)}`,
    );
  });
});

describe('BillSheet', () => {
  it('adds a bill with its frequency and day', async () => {
    openSheet();
    fireEvent.input(screen.getByLabelText('Nom'), { target: { value: ' Crèche ' } });
    fireEvent.input(screen.getByLabelText('Montant de la facture'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tous les 2 mois' }));
    fireEvent.click(screen.getByRole('button', { name: '10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la facture' }));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write.mock.calls[0][0]).toBe('bills');
    expect(write.mock.calls[0][1]).toMatchObject({
      user_id: USER,
      household_id: null,
      label: 'Crèche',
      amount_mil: 300_000,
      frequency: 'bimonthly',
      day: 10,
      starts_on: '2026-09-10',
      active: true,
    });
  });

  it('fills the name and amount from a suggestion', () => {
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Internet/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Nom').value).toBe('Internet');
    expect(screen.getByLabelText<HTMLInputElement>('Montant de la facture').value).toBe('45');
  });

  it('refuses an empty name inline', () => {
    openSheet();
    fireEvent.input(screen.getByLabelText('Montant de la facture'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la facture' }));
    expect(screen.getByRole('alert').textContent).toContain('nom');
    expect(write).not.toHaveBeenCalled();
  });

  it('edits a bill in place', async () => {
    const b = bill({ amount_mil: 80_000 });
    openSheet(b);
    fireEvent.input(screen.getByLabelText('Montant de la facture'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toEqual({ ...b, amount_mil: 95_000 });
  });

  it('deactivates on a second tap within 3 s, and the toast brings it back', async () => {
    const b = bill();
    openSheet(b);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la facture' }));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Toucher encore pour supprimer' }));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toEqual({ ...b, active: false });
    toast.value?.onAction?.();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toEqual({ ...b, active: true });
  });

  it('disarms after 3 s', () => {
    openSheet(bill());
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la facture' }));
    void act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole('button', { name: 'Supprimer la facture' })).toBeTruthy();
  });

  it('a deactivated bill leaves "À venir"', () => {
    const b = bill({ day: 15 });
    store.bills.value = [b];
    const p = store.profile.value!;
    expect(computeFacts(factsInput(store, p, '2026-09-10')).upcoming.map((u) => u.id)).toEqual([b.id]);
    store.bills.value = [{ ...b, active: false }];
    expect(computeFacts(factsInput(store, p, '2026-09-10')).upcoming).toEqual([]);
  });
});
