// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/data/store';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { ExportSheet } from '../../../src/features/me/ExportSheet';
import type { ExportInput, ExportRange } from '../../../src/shared/exportCsv';
import { formatMoney } from '../../../src/shared/money';
import { expense, income, profile, USER } from '../fixtures';

const rows = (): ExportInput => ({
  expenses: [expense({ amount_mil: 12_500, label: 'Carrefour' }), expense({ amount_mil: 7_500 })],
  incomes: [income()],
  savingsMoves: [],
  bills: [],
  debts: [],
  goals: [],
});
const fetchRows = vi.fn<(r: ExportRange) => Promise<ExportInput>>();
const download = vi.fn<(name: string, csv: string) => void>();
const done = vi.fn();
let store: Store;

beforeEach(() => {
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile({ payday: 1 });
  fetchRows.mockReset().mockResolvedValue(rows());
  download.mockClear();
  done.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hideAmounts.value = false;
});

const open = () =>
  render(<ExportSheet store={store} fetchRows={fetchRows} download={download} onDone={done} />);
const go = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Exporter/ });

describe('ExportSheet', () => {
  it('reads the last 12 months first and sums them up', async () => {
    open();
    expect(fetchRows).toHaveBeenCalledWith({ from: '2025-10-01', to: '2026-09-30' });
    await waitFor(() => expect(screen.getByTestId('export-sum').textContent).toContain('3 lignes'));
    expect(screen.getByTestId('export-sum').textContent).toContain(formatMoney(20_000));
  });

  it('reads again when another period is picked', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ce mois' }));
    expect(fetchRows).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-09-30' });
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(fetchRows).toHaveBeenLastCalledWith({ from: null, to: '2026-09-30' });
    expect(screen.getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(go().disabled).toBe(false));
  });

  it('downloads the CSV under its dates', async () => {
    open();
    await waitFor(() => expect(go().disabled).toBe(false));
    fireEvent.click(go());
    const [name, csv] = download.mock.calls[0];
    expect(name).toBe('stouchi-2025-10-01-2026-09-30.csv');
    expect(csv.startsWith('﻿Date;Type;')).toBe(true);
    expect(csv).toContain('Carrefour');
    expect(done).toHaveBeenCalled();
  });

  it('offline, says why and reads nothing', () => {
    store.sync.value = { ...store.sync.value, online: false };
    open();
    expect(fetchRows).not.toHaveBeenCalled();
    expect(go().disabled).toBe(true);
    expect(screen.getByText('Connecte-toi pour exporter')).toBeTruthy();
  });

  it('shows a failed read inline and downloads nothing', async () => {
    fetchRows.mockRejectedValue(new Error('boom'));
    open();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/réessaie/i));
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
  });

  it('ignores a slow answer for a period no longer picked', async () => {
    let first!: (v: ExportInput) => void;
    fetchRows.mockReturnValueOnce(new Promise((r) => (first = r)));
    fetchRows.mockResolvedValueOnce({ ...rows(), incomes: [] });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Ce mois' }));
    await waitFor(() => expect(screen.getByTestId('export-sum').textContent).toContain('2 lignes'));
    first(rows());
    await Promise.resolve();
    expect(screen.getByTestId('export-sum').textContent).toContain('2 lignes');
  });

  it('hides the amount when amounts are hidden', async () => {
    hideAmounts.value = true;
    open();
    await waitFor(() => expect(screen.getByTestId('export-sum').textContent).toContain('3 lignes'));
    expect(screen.getByTestId('export-sum').textContent).not.toContain('20');
  });
});
