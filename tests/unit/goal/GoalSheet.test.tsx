// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRows, createStore, type Store } from '../../../src/data/store';
import { GoalSheet } from '../../../src/features/goal/GoalSheet';
import { activeGoal } from '../../../src/shared/payday';
import type { Row } from '../../../src/data/localdb';
import { goal, profile, USER } from '../fixtures';

let store: Store;
const G = goal({ name: 'Mon voyage', icon: 'plane', target_mil: 3_000_000 });
const onDone = vi.fn();
const write = vi.fn((table: 'goals', row: Row) => {
  applyRows(store, table, [row]);
  return Promise.resolve();
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = USER;
  store.profile.value = profile();
  store.goals.value = [G];
  write.mockClear();
  onDone.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GoalSheet', () => {
  it('edits the target of the same goal', async () => {
    render(<GoalSheet store={store} goal={G} write={write} onDone={onDone} />);
    fireEvent.input(screen.getByLabelText('Il te faut combien ? (TND)'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).toMatchObject({ id: G.id, name: 'Mon voyage', target_mil: 4_000_000 });
  });

  it('refuses an empty name, inline, and writes nothing', () => {
    render(<GoalSheet store={store} goal={G} write={write} onDone={onDone} />);
    fireEvent.input(screen.getByLabelText('Nom'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByRole('alert').textContent).toBe('Donne un nom à ton objectif.');
    expect(write).not.toHaveBeenCalled();
  });

  it('a new goal archives the current one and becomes the active goal', async () => {
    render(<GoalSheet store={store} current={G} write={write} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voiture' }));
    expect(screen.getByLabelText<HTMLInputElement>('Nom').value).toBe('Ma voiture');
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’objectif' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(store.goals.value.find((g) => g.id === G.id)?.archived_at).toBeTruthy();
    expect(activeGoal(store.goals.value)).toMatchObject({
      name: 'Ma voiture',
      icon: 'car',
      target_mil: 15_000_000,
    });
  });

  it('refuses a target above the largest amount the database takes', () => {
    render(<GoalSheet store={store} goal={G} write={write} onDone={onDone} />);
    fireEvent.input(screen.getByLabelText('Il te faut combien ? (TND)'), { target: { value: '2000000' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Enregistrer' }).disabled).toBe(true);
  });
});
