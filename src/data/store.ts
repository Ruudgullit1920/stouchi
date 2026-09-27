/* What the screens read: one signal per table, filled from the device's copy
 * and kept current by writes and pulls. */
import { computed, signal } from '@preact/signals';
import { currencyOf } from '../shared/currencies';
import { setCurrentCurrency } from '../shared/currentCurrency';
import type { FactsInput } from '../shared/facts';
import type { ISODate } from '../shared/dates';
import type {
  Bill,
  BillPayment,
  CoupleStateT,
  Debt,
  Expense,
  Goal,
  Income,
  Notification,
  Profile,
  Reminder,
  SavingsMove,
} from '../shared/schemas';
import { rowKey, type PatchTable, type Row, type Table } from './localdb';
import type { OutboxEntry } from './outbox';

export interface SyncState {
  online: boolean;
  /** writes waiting to go out */
  pending: number;
  /** writes the server refused — shown with Réessayer / Supprimer */
  failed: OutboxEntry[];
  /** the session expired: writes are kept until the same user logs in again */
  authLost: boolean;
  /** first load: 'ready' once the device has the user's rows (from a pull or from before) */
  load: 'loading' | 'ready' | 'error';
  /** bumps on every local write, so the sync loop runs even when a write only
   * updates an entry already waiting (pending stays the same) */
  writes: number;
  /** a pull has succeeded since the app started: the device's copy is current,
   * not just what an earlier session left (payday waits for it) */
  pulled: boolean;
}

export function createStore() {
  /** newest first; the last 60 days (Phase 4) */
  const notifications = signal<Notification[]>([]);
  return {
    userId: signal<string | null>(null),
    /** the signed-in account's e-mail; null offline with an expired session */
    email: signal<string | null>(null),
    profile: signal<Profile | null>(null),
    expenses: signal<Expense[]>([]),
    bills: signal<Bill[]>([]),
    billPayments: signal<BillPayment[]>([]),
    debts: signal<Debt[]>([]),
    goals: signal<Goal[]>([]),
    savingsMoves: signal<SavingsMove[]>([]),
    reminders: signal<Reminder[]>([]),
    incomes: signal<Income[]>([]),
    /** couple mode (Phase 6): the last state the server gave, kept in meta for offline */
    household: signal<CoupleStateT | null>(null),
    notifications,
    /** rows acted on from this device: notification id → the done line shown instead of the body */
    actedOn: signal<Record<string, string>>({}),
    unreadCount: computed(() => notifications.value.filter((x) => !x.read_at).length),
    sync: signal<SyncState>({
      online: true,
      pending: 0,
      failed: [],
      authLost: false,
      load: 'loading',
      writes: 0,
      pulled: false,
    }),
  };
}
export type Store = ReturnType<typeof createStore>;

export type ListTable = Exclude<Table, 'profiles'>;
const LISTS: Record<
  ListTable,
  Exclude<keyof Store, 'userId' | 'email' | 'profile' | 'sync' | 'unreadCount' | 'actedOn' | 'household'>
> = {
  expenses: 'expenses',
  bills: 'bills',
  bill_payments: 'billPayments',
  debts: 'debts',
  goals: 'goals',
  savings_moves: 'savingsMoves',
  reminders: 'reminders',
  incomes: 'incomes',
};

/** What computeFacts reads, from the store: every screen passes the same rows.
 * In couple mode the partner's Besoins budget joins mine (plan D2). */
export const factsInput = (store: Store, profile: Profile, today: ISODate): FactsInput => {
  const h = store.household.value;
  return {
    profile,
    expenses: store.expenses.value,
    bills: store.bills.value,
    billPayments: store.billPayments.value,
    debts: store.debts.value,
    savingsMoves: store.savingsMoves.value,
    incomes: store.incomes.value,
    today,
    couple: h?.status === 'on' ? { me: profile.user_id, partnerNeeds: h.partner.needs_mil } : null,
  };
};

/** Merge rows into the table's signal, replacing rows with the same key. */
export function applyRows(store: Store, table: Table, rows: Row[]): void {
  if (!rows.length) return;
  if (table === 'profiles') {
    const mine = rows.find((r) => r.user_id === store.userId.value);
    if (mine) {
      store.profile.value = mine as unknown as Profile;
      /* my row carries the household's currency: a partner's change lands here too */
      setCurrentCurrency(currencyOf(mine.currency as string | undefined).code);
    }
    return;
  }
  const sig = store[LISTS[table]] as { value: Row[] };
  const byKey = new Map(sig.value.map((r) => [rowKey(table, r), r]));
  for (const r of rows) byKey.set(rowKey(table, r), r);
  sig.value = [...byKey.values()];
}

/** Replace a table's rows with what the device holds (after a rebuild). */
export function setRows(store: Store, table: ListTable, rows: Row[]): void {
  (store[LISTS[table]] as { value: Row[] }).value = rows;
}

/** Replace the notifications, newest first. */
export function setNotifications(store: Store, rows: Notification[]): void {
  store.notifications.value = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function removeRow(store: Store, table: Table | PatchTable, key: string): void {
  if (table === 'profiles') return;
  if (table === 'notifications') {
    store.notifications.value = store.notifications.value.filter((n) => n.id !== key);
    return;
  }
  const sig = store[LISTS[table]] as { value: Row[] };
  sig.value = sig.value.filter((r) => rowKey(table, r) !== key);
}

export function clearRows(store: Store): void {
  store.profile.value = null;
  setCurrentCurrency('TND');
  for (const name of Object.values(LISTS)) (store[name] as { value: Row[] }).value = [];
  store.notifications.value = [];
  store.actedOn.value = {};
  store.household.value = null;
}
