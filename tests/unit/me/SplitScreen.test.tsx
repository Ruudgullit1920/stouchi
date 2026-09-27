// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sheet, toast } from '../../../src/app/ui';
import type { Row } from '../../../src/data/localdb';
import { createStore, type Store } from '../../../src/data/store';
import { SplitScreen } from '../../../src/features/me/SplitScreen';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { shortDate } from '../../../src/shared/format';
import { formatMoney } from '../../../src/shared/money';
import { profile } from '../fixtures';

const write = vi.fn<(table: 'profiles', row: Row) => Promise<void>>().mockResolvedValue(undefined);
const onBack = vi.fn();
let store: Store;
beforeEach(() => {
  store = createStore();
  store.profile.value = profile();
  write.mockClear();
  onBack.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sheet.value = null;
  toast.value = null;
});

const open = () => render(<SplitScreen store={store} write={write} onBack={onBack} />);
const handles = () => screen.getAllByRole('slider');
const apply = () => screen.getByRole('button', { name: 'Appliquer' });
const header = () => screen.queryByRole('button', { name: 'Enregistrer' });

describe('SplitScreen — the editor', () => {
  it('starts on today’s split, with nothing to save', () => {
    open();
    expect(handles().map((h) => h.getAttribute('aria-valuenow'))).toEqual(['50', '80']);
    expect(screen.getByRole('button', { name: 'Dès ce mois' }).getAttribute('aria-pressed')).toBe('true');
    expect(apply()).toHaveProperty('disabled', true);
    expect(header()).toBeNull();
  });

  it('moves a handle ±5 with the arrow keys', () => {
    open();
    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' });
    expect(handles()[0].getAttribute('aria-valuenow')).toBe('55');
    fireEvent.keyDown(handles()[1], { key: 'ArrowLeft' });
    expect(handles()[1].getAttribute('aria-valuenow')).toBe('75');
    fireEvent.keyDown(handles()[1], { key: 'ArrowDown' });
    expect(handles()[1].getAttribute('aria-valuenow')).toBe('70');
    expect(screen.getByTestId('split-rows').textContent).toContain('15 %');
    expect(apply()).toHaveProperty('disabled', false);
    expect(header()).not.toBeNull();
  });

  it('sets the values from a preset', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /70 \/ 20 \/ 10/ }));
    expect(handles().map((h) => h.getAttribute('aria-valuenow'))).toEqual(['70', '90']);
  });
});

describe('SplitScreen — a pending split', () => {
  beforeEach(() => {
    store.profile.value = profile({
      next_salary_mil: 2_000_000,
      next_split_needs: 60,
      next_split_wants: 20,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
  });

  it('opens on it, from the next payday, with nothing to save', () => {
    open();
    expect(handles().map((h) => h.getAttribute('aria-valuenow'))).toEqual(['60', '80']);
    expect(
      screen.getByRole('button', { name: `Au ${shortDate('2026-10-01')}` }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(apply()).toHaveProperty('disabled', true);
    expect(header()).toBeNull();
  });
});

describe('SplitScreen — hidden amounts', () => {
  afterEach(() => (hideAmounts.value = false));
  it('hides the pot amounts and the salary', () => {
    hideAmounts.value = true;
    open();
    expect(screen.getByTestId('split-rows').textContent).not.toContain(
      formatMoney(1_000_000, { unit: false }),
    );
    expect(document.body.textContent).not.toContain(formatMoney(2_000_000));
  });
});

describe('SplitScreen — saving', () => {
  it('"dès ce mois" writes the main split, then goes back; the toast undoes it', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /60 \/ 20 \/ 20/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dès ce mois' }));
    fireEvent.click(apply());
    await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toMatchObject({
      split_needs: 60,
      split_wants: 20,
      split_savings: 20,
      next_from: null,
    });
    toast.value?.onAction?.();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toEqual(profile());
  });

  it('"au prochain paie" writes only next_*', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /60 \/ 20 \/ 20/ }));
    fireEvent.click(screen.getByRole('button', { name: `Au ${shortDate('2026-10-01')}` }));
    fireEvent.click(apply());
    await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toMatchObject({
      split_needs: 50,
      next_split_needs: 60,
      next_salary_mil: 2_000_000,
      next_from: '2026-10-01',
    });
  });
});

describe('SplitScreen — leaving', () => {
  it('goes straight back when nothing changed', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(onBack).toHaveBeenCalled();
    expect(sheet.value).toBeNull();
  });

  it('asks first when something changed; "Ne pas garder" leaves without writing', () => {
    open();
    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(onBack).not.toHaveBeenCalled();
    cleanup();
    render(<>{sheet.value?.body}</>);
    expect(screen.getByText(/55 \/ 25 \/ 20/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ne pas garder' }));
    expect(onBack).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('"Appliquer" in the discard sheet saves, then leaves', async () => {
    open();
    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    cleanup();
    render(<>{sheet.value?.body}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toMatchObject({
      split_needs: 55,
      split_wants: 25,
      next_from: null,
    });
  });
});
