/* The device's copy of the user's rows (IndexedDB), plus the outbox of writes
 * not yet on the server and a small meta store (owner, pull cursors, seq).
 * Screens read this copy, so the app works offline (spec §8.3). */
import { openDB, type IDBPDatabase } from 'idb';

export const TABLES = [
  'profiles',
  'expenses',
  'bills',
  'bill_payments',
  'debts',
  'goals',
  'savings_moves',
  'reminders',
  'incomes',
] as const;
export type Table = (typeof TABLES)[number];
export type Row = Record<string, unknown>;
export type LocalDb = IDBPDatabase;

const KEYS: Partial<Record<Table, string[]>> = {
  profiles: ['user_id'],
  bill_payments: ['bill_id', 'period_start'],
};

/** A row's primary key as one string: `id` for most tables. */
export const rowKey = (table: Table, row: Row): string =>
  (KEYS[table] ?? ['id']).map((k) => String(row[k])).join('|');

/** Tables the device only patches (the server writes their rows), with the
 * columns a patch may send: exactly what the server grants a user to update. */
export const PATCHABLE = { notifications: ['read_at'] } as const;
export type PatchTable = keyof typeof PATCHABLE;

/** v1: the Phase 1 tables, outbox, meta. v2 (Phase 3): reminders, incomes.
 * v3: chat (Aam Salah's history on this device, keyed by user, never synced).
 * v4 (Phase 4): notifications (the last 60 days, pulled as a window).
 * Upgrades only add stores, so rows and unsent writes survive. */
export function openLocal(
  name = 'stouchi',
  { onBlocking = () => location.reload() }: { onBlocking?: () => void } = {},
): Promise<LocalDb> {
  const opening = openDB(name, 4, {
    /* a newer app (another tab, after a deploy) wants to upgrade: this copy is
       old, so let go of the database and reload into the new version, instead
       of leaving that tab on its skeleton */
    blocking() {
      void opening.then((db) => {
        db.close();
        onBlocking();
      });
    },
    upgrade(db) {
      for (const t of [...TABLES, 'meta', 'chat', 'notifications']) {
        if (!db.objectStoreNames.contains(t)) db.createObjectStore(t);
      }
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
    },
  });
  return opening;
}
