// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../../src/app/ui';
import { CoupleError } from '../../../src/data/couple';
import { createStore, type Store } from '../../../src/data/store';
import { CurrencySheet } from '../../../src/features/me/CurrencySheet';
import type { CurrencyCode } from '../../../src/shared/currencies';
import { currentCurrency, setCurrentCurrency } from '../../../src/shared/currentCurrency';
import { coupleOn, profile, SOLO } from '../fixtures';

let store: Store;
let setCurrency: ReturnType<typeof vi.fn<(code: CurrencyCode) => Promise<void>>>;
let done: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  store = createStore();
  store.profile.value = profile();
  store.household.value = SOLO;
  setCurrency = vi.fn<(code: CurrencyCode) => Promise<void>>().mockResolvedValue(undefined);
  done = vi.fn<() => void>();
});
afterEach(() => {
  cleanup();
  toast.value = null;
  setCurrentCurrency('TND');
});

const open = () => render(<CurrencySheet store={store} setCurrency={setCurrency} onDone={done} />);
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Enregistrer' });

describe('CurrencySheet', () => {
  it('says amounts are not converted, starts on the current currency, nothing to save', () => {
    open();
    expect(screen.getByText('Tes montants ne sont pas convertis.')).toBeTruthy();
    expect(screen.queryByText(/ton ou ta partenaire/)).toBeNull();
    expect(screen.getByRole('radio', { name: /Dinar tunisien/ }).getAttribute('aria-checked')).toBe('true');
    expect(save().disabled).toBe(true);
  });

  it('in a couple, says the change is for both', () => {
    store.household.value = coupleOn();
    open();
    expect(screen.getByText(/ton ou ta partenaire/)).toBeTruthy();
  });

  it('saves once, and the currency changes only once the server said yes', async () => {
    let answer!: () => void;
    setCurrency.mockImplementation(
      (code) =>
        new Promise<void>((resolve) => {
          answer = () => {
            setCurrentCurrency(code);
            resolve();
          };
        }),
    );
    open();
    fireEvent.click(screen.getByRole('radio', { name: /Euro/ }));
    expect(currentCurrency()).toBe('TND');
    fireEvent.click(save());
    fireEvent.click(save());
    expect(setCurrency).toHaveBeenCalledOnce();
    expect(setCurrency).toHaveBeenCalledWith('EUR');
    expect(currentCurrency()).toBe('TND');
    answer();
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });

  it('a refusal shows the error toast and keeps the old currency', async () => {
    setCurrency.mockRejectedValue(new CoupleError('couple.err.offline'));
    open();
    fireEvent.click(screen.getByRole('radio', { name: /Euro/ }));
    fireEvent.click(save());
    await waitFor(() =>
      expect(toast.value?.message).toBe('Pas de connexion. Réessaie quand tu es en ligne.'),
    );
    expect(done).not.toHaveBeenCalled();
    expect(currentCurrency()).toBe('TND');
    expect(save().disabled).toBe(false);
  });
});
