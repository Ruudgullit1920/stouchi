// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../src/app/router';
import { sheet } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import { hideAmounts } from '../../../src/features/budget/hideAmounts';
import { shortDate } from '../../../src/shared/format';
import { formatMoney } from '../../../src/shared/money';
import {
  bill,
  coupleOn,
  couplePending,
  expense,
  goal,
  HOUSEHOLD,
  move,
  PARTNER,
  profile,
  reminder,
  SOLO,
} from '../fixtures';

const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const coupleActions = vi.fn((): unknown => null);
vi.mock('../../../src/data/app', () => ({
  signOut: () => signOut(),
  pushApi: () => null,
  exportRows: () => new Promise(() => undefined),
  deleteAccount: () => Promise.resolve(),
  coupleActions: () => coupleActions(),
}));
const { MeScreen } = await import('../../../src/features/me/MeScreen');
const { ProfileSheet } = await import('../../../src/features/me/ProfileSheet');

let store: Store;
beforeEach(() => {
  store = createStore();
  store.profile.value = profile();
  signOut.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hideAmounts.value = false;
  sheet.value = null;
  route.value = { name: 'me', params: {} };
});

const open = () => render(<MeScreen store={store} onOpenExpense={() => undefined} />);

describe('Moi — sign out', () => {
  it('signs out at once when nothing is waiting to be sent', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('warns first when writes are pending, and lets the user stay', () => {
    store.sync.value = { ...store.sync.value, pending: 2 };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('pas encore envoyées');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out after the warning is confirmed', () => {
    store.sync.value = { ...store.sync.value, pending: 1 };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter quand même' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('Moi — the screen', () => {
  beforeEach(() => {
    store.profile.value = profile({ onboarded_at: '2026-07-10T09:00:00+01:00' });
    store.email.value = 'sofiene@example.tn';
    const g = goal();
    store.goals.value = [g];
    store.savingsMoves.value = [move({ goal_id: g.id, amount_mil: 150_000 })];
    store.expenses.value = [expense(), expense(), expense({ deleted_at: '2026-09-11T10:00:00+01:00' })];
    store.bills.value = [bill({ amount_mil: 80_000 }), bill({ amount_mil: 45_000, day: 3 })];
    store.reminders.value = [reminder(), reminder({ done_at: '2026-09-19T10:00:00+01:00' })];
  });

  it('shows the profile card with initials, first name and e-mail', () => {
    open();
    const card = row(/Sofiene/);
    expect(card.textContent).toContain('S');
    expect(card.textContent).toContain('sofiene@example.tn');
  });

  it('shows the stats from the store', () => {
    open();
    const stats = screen.getByTestId('me-stats').textContent;
    expect(stats).toContain('3mois suivis');
    expect(stats).toContain('150TND épargnés');
    expect(stats).toContain('2dépenses');
  });

  it("counts only my own expenses, not the partner's shared ones (M8)", () => {
    store.household.value = coupleOn();
    store.expenses.value = [
      ...store.expenses.value,
      expense({ user_id: PARTNER, household_id: HOUSEHOLD, pot: 'needs' }),
    ];
    open();
    expect(screen.getByTestId('me-stats').textContent).toContain('2dépenses');
  });

  it('shows the plan rows with their values', () => {
    open();
    expect(row(/Salaire mensuel/).textContent).toContain(formatMoney(2_000_000));
    expect(row(/Répartition/).textContent).toContain('50 / 30 / 20');
    expect(row(/Factures fixes/).textContent).toContain(`${formatMoney(125_000)} réservés ce mois`);
    expect(row(/Factures fixes/).textContent).toMatch(/2$/);
    expect(row(/Jour de paie/).textContent).toContain('Le 1er');
    expect(row(/Jour de paie/).textContent).toContain(`Prochaine paie : ${shortDate('2026-10-01')}`);
    expect(row(/Notifications et rappels/).textContent).toContain('1 rappel prévu');
  });

  it('says "fin du mois" for payday 0 and "aucune" with no bills', () => {
    store.profile.value = profile({ payday: 0 });
    store.bills.value = [];
    open();
    expect(row(/Jour de paie/).textContent).toContain('Fin du mois');
    expect(row(/Factures fixes/).textContent).toContain('Aucune pour l’instant');
  });

  it('shows a pending change as the sub-line of the rows it changes', () => {
    store.profile.value = profile({
      next_salary_mil: 2_500_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
    open();
    expect(row(/Salaire mensuel/).textContent).toContain(
      `Passe à ${formatMoney(2_500_000)} le ${shortDate('2026-10-01')}`,
    );
    expect(row(/Répartition/).textContent).not.toContain('Passe à');
  });

  it('shows a pending split on the Répartition row', () => {
    store.profile.value = profile({
      next_salary_mil: 2_000_000,
      next_split_needs: 60,
      next_split_wants: 20,
      next_split_savings: 20,
      next_from: '2026-10-01',
    });
    open();
    expect(row(/Répartition/).textContent).toContain(`Passe à 60 / 20 / 20 le ${shortDate('2026-10-01')}`);
    expect(row(/Salaire mensuel/).textContent).not.toContain('Passe à');
  });

  it('hides the amounts when asked, and the switch toggles it', () => {
    open();
    const sw = screen.getByRole('switch', { name: 'Masquer les montants' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(hideAmounts.value).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(row(/Salaire mensuel/).textContent).not.toContain(formatMoney(2_000_000));
    expect(screen.getByTestId('me-stats').textContent).not.toContain('150');
  });

  it('opens the salary and payday sheets from their rows', () => {
    open();
    fireEvent.click(row(/Salaire mensuel/));
    expect(sheet.value?.title).toBe('Salaire mensuel');
    fireEvent.click(row(/Jour de paie/));
    expect(sheet.value?.title).toBe('Jour de paie');
  });

  it('shows Répartition for #/me/split', () => {
    route.value = { name: 'me', params: { sub: 'split' } };
    open();
    expect(screen.getByRole('heading', { name: 'Répartition' })).toBeTruthy();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('shows Factures fixes for #/me/bills', () => {
    route.value = { name: 'me', params: { sub: 'bills' } };
    open();
    expect(screen.getByRole('heading', { name: 'Factures fixes' })).toBeTruthy();
    expect(screen.getByTestId('bills-meter')).toBeTruthy();
  });

  it('opens the export sheet from its row', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Exporter mes données/ }));
    expect(sheet.value?.title).toBe('Exporter mes données');
  });

  it('opens the delete sheet from the footer, and its export link opens the export sheet', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer mon compte' }));
    expect(sheet.value?.title).toBe('Supprimer mon compte');
    render(<>{sheet.value?.body}</>);
    fireEvent.click(screen.getByRole('button', { name: 'D’abord exporter mes données' }));
    expect(sheet.value?.title).toBe('Exporter mes données');
  });

  it('shows Notifications et rappels for #/me/notifications', () => {
    route.value = { name: 'me', params: { sub: 'notifications' } };
    open();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Notifications sur ce téléphone' })).toBeTruthy();
  });

  it('opens the profile sheet from the card', () => {
    open();
    fireEvent.click(row(/Sofiene/));
    expect(sheet.value?.title).toBe('Mon profil');
  });
});

describe('Moi — profile sheet', () => {
  const write = vi.fn<(table: 'profiles', row: object) => Promise<void>>().mockResolvedValue(undefined);
  const done = vi.fn();
  beforeEach(() => {
    write.mockClear();
    done.mockClear();
    store.email.value = 'sofiene@example.tn';
  });
  const openSheet = () => render(<ProfileSheet store={store} write={write} onDone={done} />);

  it('saves a new first name, trimmed', async () => {
    openSheet();
    fireEvent.input(screen.getByLabelText('Prénom'), { target: { value: '  Zeineb ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith('profiles', { ...profile(), first_name: 'Zeineb' });
  });

  it('refuses an empty name inline', () => {
    openSheet();
    fireEvent.input(screen.getByLabelText('Prénom'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByRole('alert').textContent).toContain('prénom');
    expect(write).not.toHaveBeenCalled();
  });

  it('shows the e-mail read-only', () => {
    openSheet();
    const email = screen.getByLabelText<HTMLInputElement>(/E-mail/);
    expect(email.value).toBe('sofiene@example.tn');
    expect(email.readOnly).toBe(true);
  });
});

describe('Moi — Partager à deux', () => {
  it.each([
    ['solo', SOLO, 'Désactivé', 'Un budget commun pour le foyer'],
    ['unknown', null, 'Désactivé', 'Un budget commun pour le foyer'],
    ['pending', couplePending(), 'En attente', 'Un budget commun pour le foyer'],
    ['on', coupleOn('Amira'), 'Activé', 'Avec Amira'],
  ] as const)('the row says %s', (_, state, value, sub) => {
    store.household.value = state;
    open();
    const row = screen.getByRole('button', { name: /Partager à deux/ });
    expect(row.textContent).toContain(value);
    expect(row.textContent).toContain(sub);
    fireEvent.click(row);
    expect(route.value).toEqual({ name: 'me', params: { sub: 'couple' } });
  });

  it('#/me/couple opens the couple screen', () => {
    route.value = { name: 'me', params: { sub: 'couple' } };
    open();
    expect(screen.getByRole('heading', { name: 'Partager à deux' })).toBeTruthy();
  });

  it('picks up the couple actions once the device has opened its data', () => {
    route.value = { name: 'me', params: { sub: 'couple' } };
    const { rerender } = open();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Inviter mon partenaire/ }).disabled).toBe(
      true,
    );
    coupleActions.mockReturnValue({ invite: vi.fn(), cancel: vi.fn(), join: vi.fn(), leave: vi.fn() });
    rerender(<MeScreen store={store} onOpenExpense={() => undefined} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Inviter mon partenaire/ }).disabled).toBe(
      false,
    );
    coupleActions.mockReturnValue(null);
  });
});

describe('Moi — Devise', () => {
  it('shows the currency with its flag and opens the sheet', () => {
    coupleActions.mockReturnValue({});
    store.profile.value = profile({ currency: 'EUR' });
    open();
    const row = screen.getByRole('button', { name: /Devise/ });
    expect(row.textContent).toContain('EUR');
    expect(row.querySelector('img')?.getAttribute('alt')).toBe('');
    fireEvent.click(row);
    expect(sheet.value?.title).toBe('Devise');
    coupleActions.mockReturnValue(null);
  });

  it('offline, the row is disabled and says why', () => {
    coupleActions.mockReturnValue({});
    store.sync.value = { ...store.sync.value, online: false };
    open();
    const row = screen.getByRole<HTMLButtonElement>('button', { name: /Devise/ });
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain('Connecte-toi pour changer de devise.');
    coupleActions.mockReturnValue(null);
  });
});
