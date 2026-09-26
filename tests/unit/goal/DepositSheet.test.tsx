// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../../src/app/ToastHost';
import { toast } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import { DepositSheet } from '../../../src/features/goal/DepositSheet';
import { goal, profile, USER } from '../fixtures';

/* 400 TND a month to savings, nothing saved yet, target 6 000 */
let store: Store;
const G = goal({ name: 'Mon voyage', target_mil: 6_000_000 });
const write = vi.fn<(row: unknown) => Promise<void>>(() => Promise.resolve());
const undo = vi.fn<(id: string) => Promise<boolean>>(() => Promise.resolve(true));
const onDone = vi.fn();
const text = () => (document.body.textContent ?? '').replace(/\s/g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  store.goals.value = [G];
  [write, undo, onDone].forEach((f) => f.mockClear());
  toast.value = null;
  render(
    <>
      <DepositSheet store={store} goal={G} write={write} undo={undo} onDone={onDone} />
      <ToastHost />
    </>,
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DepositSheet', () => {
  it('cannot verser nothing', () => {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Verser' }).disabled).toBe(true);
  });

  it('says what the deposit changes', () => {
    fireEvent.input(screen.getByLabelText('Montant à verser'), { target: { value: '1200' } });
    expect(text()).toContain('3 mois plus tôt : Septembre 2027');
  });

  it('writes a deposit that leaves no pot, dated today, and offers undo', async () => {
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verser' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const row = write.mock.calls[0][0] as { id: string };
    expect(row).toMatchObject({
      user_id: USER,
      goal_id: G.id,
      amount_mil: 100_000,
      kind: 'deposit',
      from_pot: null,
      occurred_on: '2026-09-10',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(undo).toHaveBeenCalledWith(row.id);
  });

  it('says when the deposit reaches the goal', () => {
    fireEvent.input(screen.getByLabelText('Montant à verser'), { target: { value: '6000' } });
    expect(text()).toContain('mon voyage est atteint');
  });
});
