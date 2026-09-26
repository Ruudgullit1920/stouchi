// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../../../src/data/store';
import { PaydaySheet } from '../../../src/features/me/PaydaySheet';
import { shortDate } from '../../../src/shared/format';
import type { Row } from '../../../src/data/localdb';
import { profile } from '../fixtures';

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
});

const open = () => render(<PaydaySheet store={store} write={write} onDone={done} />);
const save = () => screen.getByRole('button', { name: 'Enregistrer' });

describe('PaydaySheet', () => {
  it('marks today’s payday and has nothing to save yet', () => {
    open();
    expect(screen.getByRole('button', { name: /^1er/ }).getAttribute('aria-pressed')).toBe('true');
    expect(save()).toHaveProperty('disabled', true);
  });

  it('shows the next payday for the day picked', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /^25/ }));
    expect(screen.getByTestId('payday-tip').textContent).toContain(shortDate('2026-09-25'));
  });

  it('saves 0 for "fin du mois"', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /fin du mois/ }));
    fireEvent.click(save());
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toMatchObject({ payday: 0 });
  });

  it('moves a pending change to the new next payday', async () => {
    store.profile.value = profile({
      next_salary_mil: 2_500_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: /^25/ }));
    fireEvent.click(save());
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write.mock.calls[0][1]).toMatchObject({ payday: 25, next_from: '2026-09-25' });
  });
});
