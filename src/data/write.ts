/* The one way rows are written on the device: the row and its outbox entry
 * land in the same IndexedDB transaction, then the screens see it at once. */
import type { IDBPTransaction } from 'idb';
import { householdOf, stampHousehold } from './couple';
import { PATCHABLE, rowKey, type LocalDb, type PatchTable, type Row, type Table } from './localdb';
import type { OutboxEntry } from './outbox';
import { applyRows, setNotifications, type Store } from './store';
import { refreshSyncState } from './sync';

/** insert-only tables: a repeat must never overwrite (payday moves, bill payments) */
const MODE: Partial<Record<Table, 'ignore'>> = { savings_moves: 'ignore', bill_payments: 'ignore' };

type Tx = IDBPTransaction<unknown, string[], 'readwrite'>;

/** The entry for this row: a repeat keeps the first write's place in line. */
async function nextEntry(
  tx: Tx,
  key: string,
  fields: Omit<OutboxEntry, 'key' | 'seq' | 'rev' | 'attempts' | 'nextAt' | 'status'>,
  merge: (existing: OutboxEntry) => Row,
  nextAt = 0,
): Promise<OutboxEntry> {
  const meta = tx.objectStore('meta');
  const existing = (await tx.objectStore('outbox').get(key)) as OutboxEntry | undefined;
  const seq = existing?.seq ?? (((await meta.get('seq')) as number | undefined) ?? 0) + 1;
  if (!existing) await meta.put(seq, 'seq');
  return {
    ...fields,
    key,
    seq,
    rev: (existing?.rev ?? 0) + 1,
    row: existing ? merge(existing) : fields.row,
    attempts: 0,
    nextAt,
    status: 'pending',
  };
}

async function written(db: LocalDb, store: Store): Promise<void> {
  await refreshSyncState(db, store);
  store.sync.value = { ...store.sync.value, writes: store.sync.value.writes + 1 };
}

/** `holdMs` keeps the write on the device that long before it is pushed: the
 * undo window of a write whose table has no soft delete (a Verser). Undo is
 * then a discard, and the server never sees the row. With a store, the row
 * carries the household's stamp (couple mode); the row written is returned. */
export async function writeRow(
  db: LocalDb,
  userId: string,
  table: Table,
  row: Row,
  store?: Store,
  { holdMs = 0 }: { holdMs?: number } = {},
): Promise<Row> {
  if (store) row = stampHousehold(table, row, householdOf(store.household.value));
  const rk = rowKey(table, row);
  const tx = db.transaction([table, 'outbox', 'meta'], 'readwrite');
  const entry = await nextEntry(
    tx,
    `${userId}:${table}:${rk}`,
    { userId, table, rowKey: rk, row, mode: MODE[table] ?? 'merge', op: 'upsert' },
    () => row,
    holdMs > 0 ? Date.now() + holdMs : 0,
  );
  await Promise.all([tx.objectStore(table).put(row, rk), tx.objectStore('outbox').put(entry), tx.done]);
  if (store) {
    applyRows(store, table, [row]);
    await written(db, store);
  }
  return row;
}

/** Change a few columns of a row the server wrote (a notification's read_at).
 * Only the allow-listed columns are accepted, and only they are ever sent. */
export async function patchRow(
  db: LocalDb,
  userId: string,
  table: PatchTable,
  id: string,
  fields: Row,
  store?: Store,
) {
  const allowed: readonly string[] = PATCHABLE[table];
  const cols = Object.keys(fields);
  if (!cols.length || cols.some((c) => !allowed.includes(c)))
    throw new Error(`patch on ${table} may only set ${allowed.join(', ')}`);
  const before = (await db.get(table, id)) as Row | undefined;
  if (!before) throw new Error(`${table} ${id} is not on this device`);
  const tx = db.transaction([table, 'outbox', 'meta'], 'readwrite');
  const current = ((await tx.objectStore(table).get(id)) as Row | undefined) ?? before;
  const entry = await nextEntry(
    tx,
    `${userId}:${table}:${id}`,
    { userId, table, rowKey: id, row: fields, mode: 'merge', op: 'patch' },
    (existing) => ({ ...existing.row, ...fields }),
  );
  await Promise.all([
    tx.objectStore(table).put({ ...current, ...fields }, id),
    tx.objectStore('outbox').put(entry),
    tx.done,
  ]);
  if (store) {
    setNotifications(
      store,
      store.notifications.value.map((n) => (n.id === id ? { ...n, ...fields } : n)),
    );
    await written(db, store);
  }
}
