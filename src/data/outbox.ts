/* Writes waiting for the server. One entry per (user, table, row): a later
 * write replaces the row but keeps the entry's place in line. Nothing is ever
 * dropped silently — a refused write stays as `failed` until the user retries
 * or discards it (spec §8.3). */
import type { LocalDb, PatchTable, Row, Table } from './localdb';
import { RemoteError, type Remote } from './remote';

export interface OutboxEntry {
  key: string;
  /** first-write order */
  seq: number;
  /** bumped on every write, so a push only clears the version it sent */
  rev: number;
  userId: string;
  table: Table | PatchTable;
  rowKey: string;
  /** the whole row, or for a patch only the columns it changes */
  row: Row;
  /** absent on entries queued before Phase 4: an upsert */
  op?: 'upsert' | 'patch';
  mode: 'merge' | 'ignore';
  attempts: number;
  /** epoch ms before which the entry is not retried */
  nextAt: number;
  status: 'pending' | 'failed';
  error?: string;
}

const BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** foreign key: the row this one points to may simply not have arrived yet */
const FK_VIOLATION = '23503';

export async function pendingFor(db: LocalDb, userId: string): Promise<OutboxEntry[]> {
  const all = (await db.getAll('outbox')) as OutboxEntry[];
  return all.filter((e) => e.userId === userId).sort((a, b) => a.seq - b.seq);
}

/** The server doesn't take updated_at from clients: its trigger sets it. Nor a
 * goal's household_id: it is set on insert and by a join or a leave (Phase 6). */
function forServer(table: Table, row: Row): Row {
  const rest = { ...row };
  delete rest.updated_at;
  if (table === 'goals') delete rest.household_id;
  return rest;
}

/** Change an entry only if it is still the version that was pushed: a write
 * made meanwhile (a newer rev) must be neither dropped nor marked failed.
 * The check and the change share one transaction, so nothing can slip between. */
async function settle(
  db: LocalDb,
  pushed: OutboxEntry,
  next: (current: OutboxEntry) => OutboxEntry | null,
): Promise<void> {
  const tx = db.transaction('outbox', 'readwrite');
  const current = (await tx.store.get(pushed.key)) as OutboxEntry | undefined;
  if (current?.rev === pushed.rev) {
    const changed = next(current);
    if (changed) await tx.store.put(changed);
    else await tx.store.delete(pushed.key);
  }
  await tx.done;
}

export async function flush(
  db: LocalDb,
  remote: Remote,
  userId: string,
): Promise<{ failed: OutboxEntry[]; authLost: boolean }> {
  let authLost = false;
  for (const listed of await pendingFor(db, userId)) {
    /* read it again: while an earlier push was in flight it may have been
       discarded (an undone Verser) or rewritten */
    const entry = (await db.get('outbox', listed.key)) as OutboxEntry | undefined;
    if (!entry || entry.status !== 'pending' || entry.nextAt > Date.now()) continue;
    try {
      if (entry.op === 'patch') await remote.patch(entry.table as PatchTable, entry.rowKey, entry.row);
      else
        await remote.upsert(entry.table as Table, [forServer(entry.table as Table, entry.row)], entry.mode);
      await settle(db, entry, () => null);
    } catch (err) {
      if (!(err instanceof RemoteError)) throw err;
      if (err.kind === 'auth') {
        authLost = true;
        break;
      }
      const later = err.kind !== 'invalid' || err.code === FK_VIOLATION;
      if (!later && entry.op === 'patch') {
        /* a refused read mark loses nothing the user wrote: drop it */
        await settle(db, entry, () => null);
        continue;
      }
      const attempts = entry.attempts + 1;
      await settle(db, entry, (current) =>
        later
          ? {
              ...current,
              attempts,
              nextAt: Date.now() + Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (attempts - 1)),
            }
          : { ...current, attempts, status: 'failed', error: err.code || err.message },
      );
      if (err.kind === 'network' || err.kind === 'server') break;
    }
  }
  const failed = (await pendingFor(db, userId)).filter((e) => e.status === 'failed');
  return { failed, authLost };
}

/** Rewrite the rows of the writes still waiting (the household stamp, after a
 * join or a leave: plan D8). A refused one goes back in line, since the change
 * may be what the server wanted; the device's copy follows. A write made
 * meanwhile (a newer rev) is left alone: it was stamped when it was made. */
export async function rewritePending(
  db: LocalDb,
  userId: string,
  change: (table: Table, row: Row) => Row,
): Promise<void> {
  for (const entry of await pendingFor(db, userId)) {
    if (entry.op === 'patch') continue;
    const table = entry.table as Table;
    const row = change(table, entry.row);
    if (JSON.stringify(row) === JSON.stringify(entry.row)) continue;
    const tx = db.transaction(['outbox', table], 'readwrite');
    const current = (await tx.objectStore('outbox').get(entry.key)) as OutboxEntry | undefined;
    if (current?.rev === entry.rev) {
      const local = (await tx.objectStore(table).get(entry.rowKey)) as Row | undefined;
      await tx
        .objectStore('outbox')
        .put({ ...current, row, rev: current.rev + 1, status: 'pending', attempts: 0, error: undefined });
      if (local) await tx.objectStore(table).put(row, entry.rowKey);
    }
    await tx.done;
  }
}

export async function retry(db: LocalDb, key: string): Promise<void> {
  const entry = (await db.get('outbox', key)) as OutboxEntry | undefined;
  if (entry)
    await db.put('outbox', { ...entry, status: 'pending', attempts: 0, nextAt: 0, error: undefined });
}

/** Drop a refused write and the device's copy of its row; the next pull
 * brings back whatever the server has. */
export async function discard(db: LocalDb, key: string): Promise<OutboxEntry | undefined> {
  const entry = (await db.get('outbox', key)) as OutboxEntry | undefined;
  if (!entry) return undefined;
  const tx = db.transaction(['outbox', entry.table, 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('outbox').delete(key),
    tx.objectStore(entry.table).delete(entry.rowKey),
    tx.objectStore('meta').delete(`cursor:${entry.table}`),
    tx.done,
  ]);
  return entry;
}

/** Undo a held write (writeRow's holdMs) while it is still inside its window:
 * nothing has reached the server, so dropping it is the whole undo. A write
 * already due or sent is left alone (undefined). */
export async function discardHeld(db: LocalDb, key: string): Promise<OutboxEntry | undefined> {
  const entry = (await db.get('outbox', key)) as OutboxEntry | undefined;
  if (!entry || entry.status !== 'pending' || entry.nextAt <= Date.now() || entry.attempts > 0)
    return undefined;
  return discard(db, key);
}
