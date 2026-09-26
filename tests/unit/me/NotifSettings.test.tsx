// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../../src/app/ui';
import type { Row } from '../../../src/data/localdb';
import type { PushApi, PushEnv } from '../../../src/data/push';
import { createStore, type Store } from '../../../src/data/store';
import { NotifSettings } from '../../../src/features/me/NotifSettings';
import { reminder, USER } from '../fixtures';

const write = vi.fn<(table: 'reminders', row: Row) => Promise<void>>().mockResolvedValue(undefined);
const ask = vi.fn();
let store: Store;

const env = (e: Partial<PushEnv> = {}): PushEnv => ({
  now: new Date(),
  onboardedAt: null,
  permission: 'default',
  pushManager: true,
  ios: false,
  standalone: false,
  laterAt: null,
  ...e,
});
const api = (on: boolean, e: Partial<PushEnv> = {}) => ({
  env: () => env(e),
  isOn: vi.fn<PushApi['isOn']>().mockResolvedValue(on),
  enable: vi.fn<PushApi['enable']>().mockResolvedValue('on'),
  disable: vi.fn<PushApi['disable']>().mockResolvedValue(undefined),
});
const checked = (v: string) => waitFor(() => expect(pushSwitch().getAttribute('aria-checked')).toBe(v));

beforeEach(() => {
  store = createStore();
  store.userId.value = USER;
  write.mockClear();
  ask.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T10:00:00+01:00'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toast.value = null;
});

const open = (push: PushApi | null) =>
  render(<NotifSettings store={store} push={push} write={write} onAsk={ask} onBack={() => undefined} />);
const pushSwitch = () => screen.getByRole('switch', { name: 'Notifications sur ce téléphone' });

describe('NotifSettings — push', () => {
  it('shows the subscription and turns it off', async () => {
    const push = api(true);
    open(push);
    await checked('true');
    fireEvent.click(pushSwitch());
    await checked('false');
    expect(push.disable).toHaveBeenCalled();
  });

  it('subscribes when off, even before the first week', async () => {
    const push = api(false, { onboardedAt: '2026-09-09T10:00:00+01:00' });
    open(push);
    await waitFor(() => expect((pushSwitch() as HTMLButtonElement).disabled).toBe(false));
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(pushSwitch());
    await checked('true');
    expect(push.enable).toHaveBeenCalled();
  });

  it('says why when the browser refused', async () => {
    const push = api(false);
    push.enable.mockResolvedValue('denied');
    open(push);
    await waitFor(() => expect((pushSwitch() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pushSwitch());
    await waitFor(() => expect(screen.getByText(/bloquées/)).toBeTruthy());
    expect(pushSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('is disabled with the reason where push cannot work', () => {
    open(api(false, { ios: true, standalone: false, permission: null, pushManager: false }));
    expect((pushSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/écran d’accueil/)).toBeTruthy();
  });

  it('is disabled when the permission is blocked', () => {
    open(api(false, { permission: 'denied' }));
    expect((pushSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/bloquées/)).toBeTruthy();
  });

  it('is disabled when push is not set up on this app', () => {
    open(null);
    expect((pushSwitch() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('NotifSettings — reminders', () => {
  it('lists the upcoming reminders only, soonest first', () => {
    store.reminders.value = [
      reminder({ text: 'Assurance', remind_at: '2026-09-20T09:00:00+01:00' }),
      reminder({ text: 'STEG', remind_at: '2026-09-12T18:30:00+01:00' }),
      reminder({ text: 'Fait', done_at: '2026-09-05T10:00:00+01:00' }),
      reminder({ text: 'Effacé', deleted_at: '2026-09-05T10:00:00+01:00' }),
    ];
    open(null);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('STEG');
    expect(items[0]).toContain('12 sept.');
    expect(items[0]).toContain('18:30');
    expect(items[1]).toContain('Assurance');
    expect(screen.queryByText('Fait')).toBeNull();
    expect(screen.queryByText('Effacé')).toBeNull();
  });

  it('deletes softly, and undo brings it back', async () => {
    const r = reminder({ text: 'STEG' });
    store.reminders.value = [r];
    open(null);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le rappel STEG' }));
    await waitFor(() => expect(toast.value?.message).toBe('Rappel supprimé'));
    const [table, row] = write.mock.calls[0];
    expect(table).toBe('reminders');
    expect(row).toMatchObject({ id: r.id, text: 'STEG', deleted_at: '2026-09-10T09:00:00.000Z' });
    toast.value?.onAction?.();
    expect(write.mock.calls[1][1]).toMatchObject({ id: r.id, deleted_at: null });
  });

  it('with none, explains how to ask Aam Salah', () => {
    open(null);
    expect(screen.getByText(/rappelle-moi/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Demander un rappel à Aam Salah' }));
    expect(ask).toHaveBeenCalled();
  });
});
