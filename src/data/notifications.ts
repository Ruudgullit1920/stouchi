/* Reading notifications: read_at is set on the device at once and goes out as
 * a patch through the outbox, so marking read works offline (Phase 4). */
import type { LocalDb } from './localdb';
import type { Store } from './store';
import { patchRow } from './write';

export async function markRead(db: LocalDb, store: Store, ids: string[]): Promise<void> {
  const userId = store.userId.value;
  if (!userId) return;
  const at = new Date().toISOString();
  const unread = new Set(store.notifications.value.filter((n) => !n.read_at).map((n) => n.id));
  for (const id of ids)
    if (unread.has(id)) await patchRow(db, userId, 'notifications', id, { read_at: at }, store);
}

export const markAllRead = (db: LocalDb, store: Store): Promise<void> =>
  markRead(
    db,
    store,
    store.notifications.value.filter((n) => !n.read_at).map((n) => n.id),
  );
