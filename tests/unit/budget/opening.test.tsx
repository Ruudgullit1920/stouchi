// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSheet, sheet } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import {
  asksOpening,
  maybeAskOpening,
  OpeningSheet,
  resetOpeningAsk,
} from '../../../src/features/budget/OpeningSheet';
import { expense, profile } from '../fixtures';

/* the fixture user joined on 2026-09-01 (payday 1, 2 000 TND at 50/30/20) */
let store: Store;
const norm = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-25T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = profile().user_id;
  store.profile.value = profile();
  resetOpeningAsk();
  closeSheet();
});
afterEach(() => {
  cleanup();
  closeSheet();
  vi.useRealTimers();
});

describe('asksOpening', () => {
  it('asks a new user in the period they joined in', () => {
    expect(asksOpening(profile(), [], '2026-09-25')).toBe(true);
  });

  it('never asks once answered, after the next payday, or before onboarding', () => {
    expect(asksOpening(profile({ opening_mil: 0 }), [], '2026-09-25')).toBe(false);
    expect(asksOpening(profile(), [], '2026-10-01')).toBe(false);
    expect(asksOpening(profile({ onboarded_at: null }), [], '2026-09-25')).toBe(false);
  });

  it('never asks a user moved over from the old app (expenses dated before joining)', () => {
    expect(asksOpening(profile(), [expense({ spent_on: '2026-08-20' })], '2026-09-25')).toBe(false);
    expect(asksOpening(profile(), [expense({ spent_on: '2026-09-02' })], '2026-09-25')).toBe(true);
  });
});

describe('maybeAskOpening', () => {
  const write = vi.fn(async () => {});

  it('opens the sheet once per launch: « Plus tard » asks again next time', () => {
    maybeAskOpening(store, write);
    expect(sheet.value?.title).toBe('Il te reste combien sur ton compte ?');
    closeSheet();
    maybeAskOpening(store, write);
    expect(sheet.value).toBeNull();
    resetOpeningAsk(); // a new launch
    maybeAskOpening(store, write);
    expect(sheet.value).not.toBeNull();
  });

  it('never covers another sheet', () => {
    sheet.value = { title: 'Autre', body: null };
    maybeAskOpening(store, write);
    expect(sheet.value.title).toBe('Autre');
  });
});

describe('OpeningSheet', () => {
  it('previews Reste as they type, then saves the balance as this period’s budget', async () => {
    store.expenses.value = [expense({ amount_mil: 100_000, spent_on: '2026-09-20' })];
    const write = vi.fn(async () => {});
    const onDone = vi.fn();
    render(<OpeningSheet store={store} write={write} onDone={onDone} />);

    const go = screen.getByRole('button', { name: 'C’est parti' });
    expect(go).toHaveProperty('disabled', true);
    fireEvent.input(screen.getByLabelText('Ce qu’il reste sur ton compte'), { target: { value: '700' } });

    /* 700 left, 6 days to the 1 October payday */
    expect(norm(screen.getByTestId('opening-preview').textContent)).toMatch(/700.*TND/);
    fireEvent.click(go);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith('profiles', expect.objectContaining({ opening_mil: 800_000 }));
  });

  it('« Plus tard » closes without writing', () => {
    const write = vi.fn(async () => {});
    const onDone = vi.fn();
    render(<OpeningSheet store={store} write={write} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onDone).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
