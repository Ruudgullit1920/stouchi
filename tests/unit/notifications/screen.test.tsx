// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../src/app/router';
import { data } from '../../../src/data/app';
import { openLocal } from '../../../src/data/localdb';
import { createStore, setNotifications, type Store } from '../../../src/data/store';
import { Bell } from '../../../src/features/notifications/Bell';
import { NotificationsScreen } from '../../../src/features/notifications/NotificationsScreen';
import type { Notification, PartnerChangeT } from '../../../src/shared/schemas';
import { coupleOn, expense, notification, PARTNER, profile } from '../fixtures';

let store: Store;
let n = 0;

const seed = async (rows: Notification[]) => {
  for (const r of rows) await data.db?.put('notifications', r, r.id);
  setNotifications(store, rows);
};

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-24T09:00:00Z'), toFake: ['Date'] });
  store = createStore();
  store.userId.value = profile().user_id;
  store.profile.value = profile();
  store.sync.value = { ...store.sync.value, load: 'ready' };
  data.db = await openLocal(`screen-${++n}`);
});
afterEach(() => {
  cleanup();
  data.db?.close();
  data.db = null;
  vi.useRealTimers();
});

const rows = () => [
  notification({ trigger: 'pot_over', title: 'Envies dépassées', created_at: '2026-09-24T08:00:00+01:00' }),
  notification({
    trigger: 'weekly_recap',
    title: 'Ta semaine en bref',
    action: { kind: 'open_history' },
    created_at: '2026-09-20T19:00:00+01:00',
  }),
  notification({
    trigger: 'user_reminder',
    title: 'Rappel · 10:00',
    action: null,
    read_at: '2026-09-02T10:00:00+01:00',
    created_at: '2026-09-01T10:00:00+01:00',
  }),
];

describe('NotificationsScreen', () => {
  it('groups rows into Aujourd’hui / Cette semaine / Plus tôt', async () => {
    await seed(rows());
    render(<NotificationsScreen store={store} />);
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Aujourd'hui", 'Cette semaine', 'Plus tôt']);
    expect(screen.getByText('dim.')).toBeTruthy();
    expect(screen.getByText('1 sept.')).toBeTruthy();
  });

  it('each filter shows only its triggers', async () => {
    await seed(rows());
    render(<NotificationsScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alertes' }));
    expect(screen.getByText('Envies dépassées')).toBeTruthy();
    expect(screen.queryByText('Ta semaine en bref')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Conseils' }));
    expect(screen.getByText('Ta semaine en bref')).toBeTruthy();
    expect(screen.queryByText('Envies dépassées')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rappels' }));
    expect(screen.getByText('Rappel · 10:00')).toBeTruthy();
    expect(screen.queryByText('Ta semaine en bref')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('“Tout lire” marks every row read and becomes disabled', async () => {
    await seed(rows());
    render(<NotificationsScreen store={store} />);
    const all = screen.getByRole<HTMLButtonElement>('button', { name: 'Tout lire' });
    expect(all.disabled).toBe(false);
    fireEvent.click(all);
    await waitFor(() => expect(store.unreadCount.value).toBe(0));
    expect(all.disabled).toBe(true);
  });

  it('tapping a row marks it read', async () => {
    const [a] = rows();
    await seed([a]);
    render(<NotificationsScreen store={store} />);
    fireEvent.click(screen.getByRole('button', { name: /Envies dépassées/ }));
    await waitFor(() => expect(store.unreadCount.value).toBe(0));
  });

  it('opened from a push, marks that row read once it arrives', async () => {
    const [a, b] = rows();
    route.value = { name: 'notifications', params: { read: b.id } };
    await seed([a]);
    render(<NotificationsScreen store={store} />);
    await seed([a, b]);
    await waitFor(() => expect(store.notifications.value.find((x) => x.id === b.id)?.read_at).not.toBeNull());
    expect(store.unreadCount.value).toBe(1);
    route.value = { name: 'notifications', params: {} };
  });

  it('renders a body with markup as text', async () => {
    await seed([notification({ body: 'Attention <b>gras</b> & co' })]);
    const { container } = render(<NotificationsScreen store={store} />);
    expect(screen.getByText('Attention <b>gras</b> & co')).toBeTruthy();
    expect(container.querySelector('.notif b:not(.notif__title)')).toBeNull();
  });

  it('shows the action’s button, and none for an unknown kind', async () => {
    const odd = notification({ title: 'Bizarre' });
    (odd as unknown as { action: unknown }).action = { kind: 'launch_rocket' };
    await seed([notification({ title: 'Pot' }), odd]);
    render(<NotificationsScreen store={store} />);
    const [pot, weird] = screen.getAllByRole('listitem');
    expect(within(pot).getByRole('button', { name: 'Voir Envies' })).toBeTruthy();
    expect(within(weird).queryAllByRole('button')).toHaveLength(1); // the row itself
  });

  it('Marquer payée only on a row from the current pay period', async () => {
    const ref = '00000000-0000-4000-8000-000000000077';
    await seed([
      notification({ title: 'Now', trigger: 'bill_due', action: { kind: 'pay_bill', ref } }),
      notification({
        title: 'Then',
        trigger: 'bill_due',
        action: { kind: 'pay_bill', ref },
        created_at: '2026-08-28T08:00:00+01:00',
      }),
    ]);
    render(<NotificationsScreen store={store} />);
    const [now, then] = screen.getAllByRole('listitem');
    expect(within(now).getByRole('button', { name: 'Marquer payée' })).toBeTruthy();
    expect(within(then).queryByRole('button', { name: 'Marquer payée' })).toBeNull();
  });

  it('an acted-on row shows its done line and no buttons', async () => {
    const row = notification({ title: 'Pot' });
    await seed([row]);
    store.actedOn.value = { [row.id]: 'Déjà réglé.' };
    render(<NotificationsScreen store={store} />);
    const [item] = screen.getAllByRole('listitem');
    expect(within(item).getByText('Déjà réglé.')).toBeTruthy();
    expect(within(item).queryByText(row.body)).toBeNull();
    expect(within(item).queryAllByRole('button')).toHaveLength(1);
  });

  it('shows Aam Salah’s empty line, and a skeleton while loading', () => {
    const { unmount } = render(<NotificationsScreen store={store} />);
    expect(screen.getByText('Rien de neuf pour l’instant')).toBeTruthy();
    unmount();
    store.sync.value = { ...store.sync.value, load: 'loading' };
    render(<NotificationsScreen store={store} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('Bell', () => {
  it('its label carries the unread count, and the dot hides at 0', async () => {
    await seed(rows());
    const { container } = render(<Bell store={store} />);
    expect(screen.getByRole('button', { name: 'Notifications, 2 non lues' })).toBeTruthy();
    expect(container.querySelector('.bdot')?.hasAttribute('hidden')).toBe(false);
    store.notifications.value = store.notifications.value.map((x) => ({ ...x, read_at: x.created_at }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy());
    expect(container.querySelector('.bdot')?.hasAttribute('hidden')).toBe(true);
  });

  it('rings when the unread count rises, unless motion is reduced', async () => {
    const reduce = { matches: false };
    vi.stubGlobal('matchMedia', () => reduce);
    const { container } = render(<Bell store={store} />);
    const bell = () => container.querySelector('.bell') as HTMLElement;
    expect(bell().classList.contains('ring')).toBe(false);
    setNotifications(store, rows());
    await waitFor(() => expect(bell().classList.contains('ring')).toBe(true));

    cleanup();
    reduce.matches = true;
    store.notifications.value = [];
    const again = render(<Bell store={store} />);
    setNotifications(store, rows());
    await waitFor(() => expect(screen.getByRole('button', { name: /2 non lues/ })).toBeTruthy());
    expect(again.container.querySelector('.bell')?.classList.contains('ring')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('a partner request (Task 9)', () => {
  it('reads from fr.json with the partner and the expense, and offers Accepter / Refuser', async () => {
    const e = expense({ label: 'Carrefour', amount_mil: 45_000 });
    store.expenses.value = [e];
    store.household.value = coupleOn('Amira');
    await seed([
      notification({
        trigger: 'partner_request',
        title: '',
        body: '',
        action: { kind: 'partner_request', ref: e.id, from: PARTNER, change: { kind: 'delete' } },
        created_at: '2026-09-24T08:00:00+01:00',
      }),
      notification({
        trigger: 'partner_request',
        title: '',
        body: '',
        action: {
          kind: 'partner_request',
          ref: e.id,
          from: PARTNER,
          change: { kind: 'edit', fields: { amount_mil: 40_000 } },
        },
        created_at: '2026-09-24T07:00:00+01:00',
      }),
    ]);
    render(<NotificationsScreen store={store} />);
    expect(screen.getAllByText('Demande de Amira')).toHaveLength(2);
    expect(screen.getByText('Amira propose de supprimer « Carrefour · 45 TND »')).toBeTruthy();
    expect(screen.getByText(/Amira propose de changer « Carrefour · 45 TND » : 45 → 40 TND/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Accepter' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Refuser' })).toHaveLength(2);
  });
});

describe('review I2: a partner request shows what it changes', () => {
  it.each<[Extract<PartnerChangeT, { kind: 'edit' }>['fields'], string]>([
    [{ category: 'maison' }, 'Courses → Maison'],
    [{ spent_on: '2026-09-03' }, '→ 3 sept.'],
    [{ label: 'Aziza' }, '« Carrefour » → « Aziza »'],
  ])('%j', async (fields, shown) => {
    const e = expense({
      label: 'Carrefour',
      category: 'courses',
      amount_mil: 45_000,
      spent_on: '2026-09-04',
    });
    store.expenses.value = [e];
    store.household.value = coupleOn('Amira');
    await seed([
      notification({
        trigger: 'partner_request',
        title: '',
        body: '',
        action: { kind: 'partner_request', ref: e.id, from: PARTNER, change: { kind: 'edit', fields } },
      }),
    ]);
    render(<NotificationsScreen store={store} />);
    expect(screen.getByText(/Amira propose de changer/).textContent).toContain(shown);
  });
});
