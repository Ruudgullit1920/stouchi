// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailedWrites } from '../../../src/app/FailedWrites';
import { OfflineBadge } from '../../../src/app/OfflineBadge';
import { SessionLost } from '../../../src/app/SessionLost';
import { route } from '../../../src/app/router';
import { SheetHost } from '../../../src/app/SheetHost';
import { TabBar } from '../../../src/app/TabBar';
import { ToastHost } from '../../../src/app/ToastHost';
import { closeSheet, openSheet, showToast, toast } from '../../../src/app/ui';
import { createStore, type Store } from '../../../src/data/store';
import type { OutboxEntry } from '../../../src/data/outbox';

let store: Store;
beforeEach(() => {
  store = createStore();
  route.value = { name: 'budget', params: {} };
  location.hash = '';
});
afterEach(() => {
  cleanup();
  closeSheet();
  toast.value = null;
});

describe('TabBar', () => {
  it('marks the current place and moves between them', () => {
    render(<TabBar onAdd={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Budget' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Historique' }).hasAttribute('aria-current')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    expect(location.hash).toBe('#/history');
  });

  it('the + button asks to add', () => {
    const onAdd = vi.fn();
    render(<TabBar onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une dépense' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});

describe('SheetHost', () => {
  it('shows the sheet asked for, focus inside, and closes it', async () => {
    render(<SheetHost />);
    openSheet('Nouvelle dépense', <button type="button">Dedans</button>);
    const dialog = await screen.findByRole('dialog', { name: 'Nouvelle dépense' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    closeSheet();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('ToastHost', () => {
  it('announces toasts in a live region and runs their action', async () => {
    const run = vi.fn();
    render(<ToastHost />);
    showToast({ text: 'Dépense supprimée', action: { label: 'Annuler', run } });
    const region = await screen.findByRole('status');
    expect(region.textContent).toContain('Dépense supprimée');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('OfflineBadge', () => {
  it('shows only while offline', async () => {
    render(<OfflineBadge store={store} />);
    expect(screen.queryByText(/hors ligne/i)).toBeNull();
    store.sync.value = { ...store.sync.value, online: false, pending: 2 };
    expect(await screen.findByText(/hors ligne/i)).toBeTruthy();
  });
});

describe('FailedWrites', () => {
  const entry = { key: 'k1', row: { label: 'Café' } } as unknown as OutboxEntry;

  it('offers Réessayer and Supprimer for a write the server refused', async () => {
    const retry = vi.fn();
    const discard = vi.fn();
    render(<FailedWrites store={store} onRetry={retry} onDiscard={discard} />);
    expect(screen.queryByRole('alert')).toBeNull();
    store.sync.value = { ...store.sync.value, failed: [entry] };
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(retry).toHaveBeenCalledWith('k1');
    expect(discard).toHaveBeenCalledWith('k1');
  });
});

describe('SessionLost', () => {
  it('says the session expired and that the writes are kept', async () => {
    render(<SessionLost store={store} />);
    expect(screen.queryByText(/session a expiré/)).toBeNull();
    store.sync.value = { ...store.sync.value, authLost: true };
    expect(await screen.findByText(/session a expiré/)).toBeTruthy();
  });

  it('leads to login to reconnect', () => {
    store.sync.value = { ...store.sync.value, authLost: true };
    render(<SessionLost store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se reconnecter' }));
    expect(route.value.name).toBe('login');
  });
});
