// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sheet, toast } from '../../../src/app/ui';
import { CoupleError } from '../../../src/data/couple';
import { createStore, type Store } from '../../../src/data/store';
import { CoupleScreen, type CoupleActions } from '../../../src/features/me/CoupleScreen';
import { coupleOn, couplePending, profile, SOLO } from '../fixtures';

let store: Store;
let api: { [K in keyof CoupleActions]: ReturnType<typeof vi.fn> };
beforeEach(() => {
  store = createStore();
  store.profile.value = profile({ first_name: 'Sami' });
  api = {
    invite: vi.fn().mockResolvedValue({ code: 'STC-NEW567', expires_at: '2026-09-22T10:00:00+01:00' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sheet.value = null;
  toast.value = null;
});

const open = () => render(<CoupleScreen store={store} api={api as CoupleActions} onBack={() => undefined} />);
/** the sheet the screen opened, rendered on its own */
const openedSheet = () => {
  expect(sheet.value).not.toBeNull();
  cleanup();
  return render(<>{sheet.value?.body}</>);
};
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Partager à deux — off', () => {
  it('shows the benefits, what is shared and the two ways in', () => {
    store.household.value = SOLO;
    open();
    expect(screen.getByRole('heading', { name: 'Un budget pour deux' })).toBeTruthy();
    expect(screen.getByText('Des Besoins communs')).toBeTruthy();
    expect(screen.getByText('Partagé')).toBeTruthy();
    expect(screen.getByText('Reste à toi')).toBeTruthy();
    expect(button(/Inviter mon partenaire/)).toBeTruthy();
    expect(button(/J'ai reçu un code/)).toBeTruthy();
  });

  it('reads an unknown state (never synced) as off', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Un budget pour deux' })).toBeTruthy();
  });

  it('asks the server for a code, then shows it in the invite sheet', async () => {
    store.household.value = SOLO;
    open();
    fireEvent.click(button(/Inviter mon partenaire/));
    await waitFor(() => expect(sheet.value?.title).toBe('Inviter mon partenaire'));
    expect(api.invite).toHaveBeenCalledOnce();
    openedSheet();
    expect(screen.getByText('STC-NEW567')).toBeTruthy();
  });

  it('opens the join sheet', () => {
    store.household.value = SOLO;
    open();
    fireEvent.click(button(/J'ai reçu un code/));
    expect(sheet.value?.title).toBe('Rejoindre un foyer');
  });

  it('offline, every action is disabled and says why', () => {
    store.household.value = SOLO;
    store.sync.value = { ...store.sync.value, online: false };
    open();
    expect((button(/Inviter mon partenaire/) as HTMLButtonElement).disabled).toBe(true);
    expect((button(/J'ai reçu un code/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Connecte-toi pour/)).toBeTruthy();
  });

  it('shows why an invite failed', async () => {
    store.household.value = SOLO;
    api.invite.mockRejectedValue(new CoupleError('couple.err.generic'));
    open();
    fireEvent.click(button(/Inviter mon partenaire/));
    expect((await screen.findByRole('alert')).textContent).toContain("Ça n'a pas marché");
    expect(sheet.value).toBeNull();
  });
});

describe('Partager à deux — pending', () => {
  it('shows the code and the hours left', () => {
    store.household.value = couplePending();
    open();
    expect(screen.getByText('Invitation envoyée')).toBeTruthy();
    expect(screen.getByText('STC-ABC234')).toBeTruthy();
    expect(screen.getByText(/expire dans 47 h/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Inviter mon partenaire/ })).toBeNull();
  });

  it('Renvoyer shows the same code again, without a new one', () => {
    store.household.value = couplePending();
    open();
    fireEvent.click(button(/Renvoyer/));
    expect(api.invite).not.toHaveBeenCalled();
    openedSheet();
    expect(screen.getByText('STC-ABC234')).toBeTruthy();
  });

  it('Annuler cancels the invite and says so', async () => {
    store.household.value = couplePending();
    open();
    fireEvent.click(button('Annuler'));
    await waitFor(() => expect(toast.value?.message).toBe('Invitation annulée'));
    expect(api.cancel).toHaveBeenCalledOnce();
  });

  it('an expired code offers a new one', async () => {
    store.household.value = couplePending(null);
    open();
    expect(screen.getByText('Invitation expirée')).toBeTruthy();
    fireEvent.click(button(/Nouveau code/));
    await waitFor(() => expect(sheet.value).not.toBeNull());
    expect(api.invite).toHaveBeenCalledOnce();
  });
});

describe('Partager à deux — on', () => {
  it('shows the duo, the fixed split hint and the Aam Salah promise', () => {
    store.household.value = coupleOn('Amira');
    open();
    expect(screen.getByRole('heading', { name: 'Vous gérez le foyer à deux' })).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText(/Amira voit les Besoins communs/)).toBeTruthy();
    expect(screen.getByText('Selon les salaires')).toBeTruthy();
    expect(screen.queryByText('Moitié-moitié')).toBeNull();
    expect(screen.getByText('Aam Salah ne modifie jamais les dépenses de Amira.')).toBeTruthy();
  });

  it('Arrêter le partage asks first, then leaves', async () => {
    store.household.value = coupleOn('Amira');
    open();
    fireEvent.click(button(/Arrêter le partage/));
    expect(api.leave).not.toHaveBeenCalled();
    openedSheet();
    expect(screen.getByRole('heading', { name: 'Arrêter le partage avec Amira ?' })).toBeTruthy();
    fireEvent.click(button(/Arrêter le partage/));
    await waitFor(() => expect(toast.value?.message).toBe('Partage arrêté'));
    expect(api.leave).toHaveBeenCalledOnce();
    expect(sheet.value).toBeNull();
  });

  it('a leave that fails keeps the sheet open and says why', async () => {
    store.household.value = coupleOn('Amira');
    api.leave.mockRejectedValue(new CoupleError('couple.err.offline'));
    open();
    fireEvent.click(button(/Arrêter le partage/));
    openedSheet();
    fireEvent.click(button(/Arrêter le partage/));
    expect((await screen.findByRole('alert')).textContent).toContain('Pas de connexion');
    expect(sheet.value).not.toBeNull();
  });

  it('offline, stopping is disabled', () => {
    store.household.value = coupleOn('Amira');
    store.sync.value = { ...store.sync.value, online: false };
    open();
    expect((button(/Arrêter le partage/) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Invite sheet', () => {
  const inviteSheet = () => {
    store.household.value = couplePending();
    open();
    fireEvent.click(button(/Renvoyer/));
    openedSheet();
  };

  it('Copier puts the code on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    inviteSheet();
    fireEvent.click(button(/Copier/));
    expect(writeText).toHaveBeenCalledWith('STC-ABC234');
    expect(await screen.findByRole('button', { name: /Copié/ })).toBeTruthy();
  });

  it('Partager uses the phone share sheet when there is one', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    inviteSheet();
    fireEvent.click(button(/Partager/));
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining('STC-ABC234') as string });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('without a share sheet, Partager copies the message and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    inviteSheet();
    fireEvent.click(button(/Partager/));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('STC-ABC234'));
    await waitFor(() => expect(toast.value?.message).toContain('colle-le dans WhatsApp'));
  });

  it("C'est envoyé closes the sheet", () => {
    inviteSheet();
    fireEvent.click(button("C'est envoyé"));
    expect(sheet.value).toBeNull();
    expect(toast.value?.message).toBe('Invitation envoyée');
  });
});
