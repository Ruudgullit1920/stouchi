// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import { SalarySheet } from '../../../src/features/me/SalarySheet';
import { shortDate } from '../../../src/shared/format';
import { formatMoney } from '../../../src/shared/money';
import type { Row } from '../../../src/data/localdb';
import { bill, profile } from '../fixtures';

const write = vi.fn<(table: 'profiles', row: Row) => Promise<void>>().mockResolvedValue(undefined);
const done = vi.fn();
let store: Store;
beforeEach(() => {
  store = createStore();
  store.profile.value = profile();
  write.mockClear();
  done.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toast.value = null;
});

const open = () => render(<SalarySheet store={store} write={write} onDone={done} />);
const type = (tnd: string) =>
  fireEvent.input(screen.getByLabelText('Salaire mensuel'), { target: { value: tnd } });
const save = () => screen.getByRole('button', { name: 'Enregistrer' });
const saved = async () => {
  await vi.waitFor(() => expect(done).toHaveBeenCalled());
  return write.mock.calls[0][1];
};

describe('SalarySheet', () => {
  it('starts on today’s salary with "dès ce mois" picked (prototype) and nothing to save', () => {
    open();
    expect(screen.getByLabelText<HTMLInputElement>('Salaire mensuel').value).toBe('2000');
    expect(screen.getByRole('button', { name: 'Dès ce mois' }).getAttribute('aria-pressed')).toBe('true');
    expect(save()).toHaveProperty('disabled', true);
  });

  it('refuses a salary under 100 TND', () => {
    open();
    type('90');
    expect(screen.getByRole('alert').textContent).toContain('100 TND');
    expect(save()).toHaveProperty('disabled', true);
  });

  it('previews the new pots with their change', () => {
    open();
    type('3000');
    const preview = screen.getByTestId('split-preview').textContent;
    expect(preview).toContain(formatMoney(1_500_000, { unit: false }));
    expect(preview).toContain(`+${formatMoney(500_000, { unit: false })}`);
  });

  it('"dès ce mois" writes the main salary, and the toast undoes it', async () => {
    open();
    type('3000');
    fireEvent.click(screen.getByRole('button', { name: 'Dès ce mois' }));
    fireEvent.click(save());
    const row = await saved();
    expect(row).toMatchObject({ salary_mil: 3_000_000, next_from: null, next_salary_mil: null });
    expect(toast.value?.message).toBe(`Salaire : ${formatMoney(3_000_000)}`);
    toast.value?.onAction?.();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toEqual(profile());
  });

  it('"au prochain paie" writes only next_*', async () => {
    open();
    type('3000');
    fireEvent.click(screen.getByRole('button', { name: `Au ${shortDate('2026-10-01')}` }));
    fireEvent.click(save());
    const row = await saved();
    expect(row).toMatchObject({
      salary_mil: 2_000_000,
      next_salary_mil: 3_000_000,
      next_split_needs: 50,
      next_from: '2026-10-01',
    });
    expect(toast.value?.onAction).toBeUndefined();
  });

  it('opens on a pending salary, "au prochain paie" picked, so saving unchanged is not possible', () => {
    store.profile.value = profile({
      next_salary_mil: 2_500_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
    open();
    expect(
      screen.getByRole('button', { name: `Au ${shortDate('2026-10-01')}` }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(save()).toHaveProperty('disabled', true);
  });

  it('"dès ce mois" clears a pending salary change', async () => {
    store.profile.value = profile({
      next_salary_mil: 2_500_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
    open();
    expect(screen.getByLabelText<HTMLInputElement>('Salaire mensuel').value).toBe('2500');
    fireEvent.click(screen.getByRole('button', { name: 'Dès ce mois' }));
    fireEvent.click(save());
    const row = await saved();
    expect(row).toMatchObject({ salary_mil: 2_500_000, next_salary_mil: null, next_from: null });
  });

  it('warns when the bills take over 80 % of the new Besoins', () => {
    store.bills.value = [bill({ amount_mil: 700_000 })];
    open();
    expect(screen.queryByTestId('bills-warn')).toBeNull();
    type('1500');
    expect(screen.getByTestId('bills-warn').textContent).toContain('93 %');
  });
});
