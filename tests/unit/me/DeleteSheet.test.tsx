// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/data/store';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { DeleteSheet } from '../../../src/features/me/DeleteSheet';
import { formatTnd } from '../../../src/shared/money';
import { expense, goal, move, profile, USER } from '../fixtures';

const remove = vi.fn<() => Promise<void>>();
const onExport = vi.fn();
const onDeleted = vi.fn();
let store: Store;

beforeEach(() => {
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile({ onboarded_at: '2026-03-02T10:00:00+01:00' });
  remove.mockReset().mockResolvedValue(undefined);
  onExport.mockClear();
  onDeleted.mockClear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-09-10T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hideAmounts.value = false;
});

const open = () =>
  render(<DeleteSheet store={store} remove={remove} onExport={onExport} onDeleted={onDeleted} />);
const hold = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /Maintenir pour supprimer|Continue/ });
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('DeleteSheet', () => {
  it('lists what goes: expenses since the first month, the goal and its savings, the chats', () => {
    const g = goal({ name: 'Voiture' });
    store.goals.value = [g];
    store.savingsMoves.value = [move({ goal_id: g.id, amount_mil: 450_000 })];
    store.expenses.value = [expense({ spent_on: '2026-01-15' })];
    open();
    const gone = screen.getByRole('list').textContent;
    expect(gone).toContain('depuis janvier 2026');
    expect(gone).toContain(formatTnd(450_000));
    expect(gone).toContain('Aam Salah');
  });

  it('hides the savings amount when amounts are hidden', () => {
    const g = goal();
    store.goals.value = [g];
    store.savingsMoves.value = [move({ goal_id: g.id, amount_mil: 450_000 })];
    hideAmounts.value = true;
    open();
    const gone = screen.getByRole('list').textContent;
    expect(gone).toContain('•••');
    expect(gone).not.toContain('450');
  });

  it('offers to export first', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'D’abord exporter mes données' }));
    expect(onExport).toHaveBeenCalled();
  });

  it('a hold shorter than 2 s does nothing', async () => {
    open();
    fireEvent.pointerDown(hold());
    await wait(1900);
    fireEvent.pointerUp(hold());
    await wait(500);
    expect(remove).not.toHaveBeenCalled();
    expect(hold().textContent).toContain('Maintenir pour supprimer');
  });

  it('a 2 s hold deletes, then leaves', async () => {
    open();
    fireEvent.pointerDown(hold());
    expect(hold().textContent).toContain('Continue d’appuyer');
    await wait(2000);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalled();
  });

  it('works from the keyboard: hold Space', async () => {
    open();
    fireEvent.keyDown(hold(), { key: ' ' });
    fireEvent.keyDown(hold(), { key: ' ', repeat: true });
    await wait(2000);
    fireEvent.keyUp(hold(), { key: ' ' });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('letting go of Enter early cancels', async () => {
    open();
    fireEvent.keyDown(hold(), { key: 'Enter' });
    await wait(1000);
    fireEvent.keyUp(hold(), { key: 'Enter' });
    await wait(2000);
    expect(remove).not.toHaveBeenCalled();
  });

  it('when the server refuses, says so and stays', async () => {
    remove.mockRejectedValue(new Error('boom'));
    open();
    fireEvent.pointerDown(hold());
    await wait(2000);
    expect(screen.getByRole('alert').textContent).toMatch(/Rien n’a été effacé/);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(hold().disabled).toBe(false);
  });

  it('offline, the button is disabled and says why', () => {
    store.sync.value = { ...store.sync.value, online: false };
    open();
    expect(hold().disabled).toBe(true);
    expect(screen.getByText(/Connecte-toi pour supprimer/)).toBeTruthy();
  });

  it('with unsent writes, warns first', () => {
    store.sync.value = { ...store.sync.value, pending: 2 };
    open();
    expect(screen.queryByRole('button', { name: /Maintenir/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/pas encore envoyées/);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(hold()).toBeTruthy();
  });
});
