// @vitest-environment jsdom
/* The current currency: fed by my profile row, read by formatMoney and t() (currency spec §5). */
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Amount } from '../../src/design/components/Amount';
import { applyRows, clearRows, createStore } from '../../src/data/store';
import type { Row } from '../../src/data/localdb';
import { currentCurrency, setCurrentCurrency } from '../../src/shared/currentCurrency';
import { formatMoney } from '../../src/shared/money';
import { USER, profile } from './fixtures';

afterEach(() => {
  cleanup();
  setCurrentCurrency('TND');
});

function signedIn() {
  const store = createStore();
  store.userId.value = USER;
  return store;
}
const row = (patch: Record<string, unknown>) => ({ ...profile(), ...patch }) as unknown as Row;

describe('currentCurrency', () => {
  it('is TND until a profile says otherwise', () => {
    expect(currentCurrency()).toBe('TND');
  });

  it('follows my profile row', () => {
    const store = signedIn();
    applyRows(store, 'profiles', [row({ currency: 'EUR' })]);
    expect(currentCurrency()).toBe('EUR');
    expect(formatMoney(4_500)).toBe('4,50 €');
  });

  it("ignores the partner's row", () => {
    const store = signedIn();
    applyRows(store, 'profiles', [row({ user_id: '00000000-0000-4000-8000-00000000beef', currency: 'GBP' })]);
    expect(currentCurrency()).toBe('TND');
  });

  it('falls back to TND for an unknown or missing code (Review Focus 2)', () => {
    const store = signedIn();
    applyRows(store, 'profiles', [row({ currency: 'EUR' })]);
    applyRows(store, 'profiles', [row({ currency: 'XXX' })]);
    expect(currentCurrency()).toBe('TND');
    applyRows(store, 'profiles', [row({ currency: 'EUR' })]);
    applyRows(store, 'profiles', [row({ currency: undefined })]);
    expect(currentCurrency()).toBe('TND');
  });

  it('changes when a later row arrives — a partner switched it (Review Focus 4)', () => {
    const store = signedIn();
    applyRows(store, 'profiles', [row({ currency: 'TND' })]);
    applyRows(store, 'profiles', [row({ currency: 'CHF' })]);
    expect(currentCurrency()).toBe('CHF');
    expect(store.profile.value?.currency).toBe('CHF');
  });

  it('goes back to TND when the rows are cleared (sign-out, another user)', () => {
    const store = signedIn();
    applyRows(store, 'profiles', [row({ currency: 'EUR' })]);
    clearRows(store);
    expect(currentCurrency()).toBe('TND');
  });
});

describe('the screens follow the currency', () => {
  it('re-renders an amount in the new unit without a reload', async () => {
    const { container } = render(<Amount mil={12_500} />);
    expect(container.textContent).toBe('12,5 TND');
    await act(() => setCurrentCurrency('EUR'));
    expect(container.textContent).toBe('12,50 €');
  });
});
