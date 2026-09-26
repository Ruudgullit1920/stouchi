/* Emptying the device's copy of the rows: when another user signs in, and when
 * the household changes (plan D8), since the rows this device may see change. */
import { TABLES, type LocalDb, type Row, type Table } from './localdb';
import type { OutboxEntry } from './outbox';
import { setRows, type ListTable, type Store } from './store';

/** Empty `tables` and their cursors (the next pull is a full one), in one
 * transaction. `keepFor`: that user's writes still waiting are put back, read
 * in the same transaction, so a write landing meanwhile is never lost. */
export async function clearMirror(
  db: LocalDb,
  tables: readonly Table[],
  {
    also = [],
    owner,
    keepFor,
  }: { also?: ('chat' | 'notifications')[]; owner?: string; keepFor?: string } = {},
): Promise<void> {
  const tx = db.transaction([...tables, ...also, 'meta', 'outbox'], 'readwrite');
  const meta = tx.objectStore('meta');
  const keep = keepFor
    ? ((await tx.objectStore('outbox').getAll()) as OutboxEntry[]).filter(
        (e) => e.userId === keepFor && e.op !== 'patch' && (tables as readonly string[]).includes(e.table),
      )
    : [];
  await Promise.all([
    ...tables.map((t) => tx.objectStore(t).clear()),
    ...also.map((s) => tx.objectStore(s).clear()),
    ...tables.map((t) => meta.delete(`cursor:${t}`)),
    ...(owner ? [meta.put(owner, 'owner')] : []),
    ...keep.map((e) => tx.objectStore(e.table).put(e.row, e.rowKey)),
    tx.done,
  ]);
}

const LISTED = TABLES.filter((t): t is ListTable => t !== 'profiles');

/** The household changed: drop every row but the profile, keep the writes
 * still waiting, and let the next pull bring what the user may now see. */
export async function rebuildMirror(db: LocalDb, store: Store): Promise<void> {
  const userId = store.userId.value;
  if (!userId) return;
  await clearMirror(db, LISTED, { keepFor: userId });
  for (const t of LISTED) setRows(store, t, (await db.getAll(t)) as Row[]);
}
