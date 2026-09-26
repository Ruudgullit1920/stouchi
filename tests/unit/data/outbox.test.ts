import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import {
  discard,
  discardHeld,
  flush,
  pendingFor,
  retry,
  rewritePending,
  type OutboxEntry,
} from '../../../src/data/outbox';
import { RemoteError } from '../../../src/data/remote';
import { writeRow } from '../../../src/data/write';
import { expense, goal, move, USER, uuidN } from '../fixtures';
import { FakeRemote } from './fakeRemote';

const OTHER = uuidN(2);
let db: LocalDb;
let remote: FakeRemote;
let n = 0;

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
  db = await openLocal(`outbox-${++n}`);
  remote = new FakeRemote();
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('outbox', () => {
  it('turns create → edit → delete made offline into one pushed row, soft-deleted', async () => {
    const e = expense({ label: 'Carrefour' });
    await writeRow(db, USER, 'expenses', e);
    await writeRow(db, USER, 'expenses', { ...e, label: 'Monoprix' });
    await writeRow(db, USER, 'expenses', {
      ...e,
      label: 'Monoprix',
      deleted_at: '2026-09-10T10:00:00+01:00',
    });
    expect(await pendingFor(db, USER)).toHaveLength(1);

    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(1);
    const [row] = [...remote.table('expenses').values()];
    expect(row).toMatchObject({ id: e.id, label: 'Monoprix', deleted_at: '2026-09-10T10:00:00+01:00' });
    expect(await pendingFor(db, USER)).toHaveLength(0);
  });

  it('pushes in first-write order, even after a later edit of an earlier row', async () => {
    const a = expense({ label: 'a' });
    const b = expense({ label: 'b' });
    await writeRow(db, USER, 'expenses', a);
    await writeRow(db, USER, 'expenses', b);
    await writeRow(db, USER, 'expenses', { ...a, label: 'a2' });
    await flush(db, remote, USER);
    expect(remote.calls.map((c) => c.rows[0].label)).toEqual(['a2', 'b']);
  });

  it('backs off on network errors: 1 s, 2 s, 4 s … capped at 60 s, and keeps the write', async () => {
    await writeRow(db, USER, 'expenses', expense());
    remote.failNext('network', 10);
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      await flush(db, remote, USER);
      const [entry] = await pendingFor(db, USER);
      waits.push(entry.nextAt - Date.now());
      await flush(db, remote, USER); // too early: must not call the remote
      vi.setSystemTime(entry.nextAt);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    expect(remote.calls).toHaveLength(8);
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it('stops at the first network error instead of hammering every entry', async () => {
    await writeRow(db, USER, 'expenses', expense());
    await writeRow(db, USER, 'expenses', expense());
    remote.failNext('server');
    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(1);
  });

  it('retries a foreign-key error later: the row it points to may still be on its way', async () => {
    await writeRow(db, USER, 'expenses', expense());
    remote.failNext('invalid', 1, '23503');
    const result = await flush(db, remote, USER);
    const [entry] = await pendingFor(db, USER);
    expect(entry.status).toBe('pending');
    expect(result.failed).toHaveLength(0);
  });

  it('keeps a write the server refuses as failed, then retries or discards it on request', async () => {
    const bad = expense({ label: 'refused' });
    const good = expense({ label: 'ok' });
    await writeRow(db, USER, 'expenses', bad);
    await writeRow(db, USER, 'expenses', good);
    remote.failNext('invalid', 1, '23514');
    const result = await flush(db, remote, USER);
    expect(result.failed.map((f) => f.row.label)).toEqual(['refused']);
    expect(remote.table('expenses').size).toBe(1); // the good one went through

    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(2); // failed entries are not retried on their own

    await retry(db, result.failed[0].key);
    await flush(db, remote, USER);
    expect(remote.table('expenses').size).toBe(2);

    await writeRow(db, USER, 'expenses', expense({ label: 'refused again' }));
    remote.failNext('invalid', 1, '23514');
    const again = await flush(db, remote, USER);
    await discard(db, again.failed[0].key);
    expect(await pendingFor(db, USER)).toHaveLength(0);
    expect(await db.get('expenses', again.failed[0].row.id as string)).toBeUndefined();
  });

  it('pauses on an expired session without dropping anything', async () => {
    await writeRow(db, USER, 'expenses', expense());
    remote.failNext('auth');
    const result = await flush(db, remote, USER);
    expect(result.authLost).toBe(true);
    expect(await pendingFor(db, USER)).toHaveLength(1);
  });

  it("never pushes one user's writes under another user's session, and never drops them", async () => {
    await writeRow(db, USER, 'expenses', expense({ label: 'from A' }));
    await flush(db, remote, OTHER);
    expect(remote.calls).toHaveLength(0);
    expect(await pendingFor(db, USER)).toHaveLength(1);
    await flush(db, remote, USER);
    expect(remote.table('expenses').size).toBe(1);
  });

  it('keeps a newer write made while the older one was being pushed', async () => {
    const e = expense({ label: 'v1' });
    await writeRow(db, USER, 'expenses', e);
    remote.onUpsert = async () => {
      remote.onUpsert = undefined;
      await writeRow(db, USER, 'expenses', { ...e, label: 'v2' });
    };
    await flush(db, remote, USER);
    expect(await pendingFor(db, USER)).toHaveLength(1);
    await flush(db, remote, USER);
    expect(remote.table('expenses').get(e.id)?.label).toBe('v2');
  });

  it('keeps a newer write made while a push that then fails was in flight', async () => {
    const e = expense({ label: 'v1' });
    await writeRow(db, USER, 'expenses', e);
    remote.onUpsert = async () => {
      remote.onUpsert = undefined;
      await writeRow(db, USER, 'expenses', { ...e, label: 'v2', deleted_at: '2026-09-10T10:00:00+01:00' });
      throw new RemoteError('network', '', 'timed out');
    };
    await flush(db, remote, USER);
    const [entry] = await pendingFor(db, USER);
    expect(entry.row).toMatchObject({ label: 'v2', deleted_at: '2026-09-10T10:00:00+01:00' });
    vi.setSystemTime(entry.nextAt);
    await flush(db, remote, USER);
    expect(remote.table('expenses').get(e.id)).toMatchObject({ label: 'v2' });
  });

  it('does not mark a newer write failed because the older version was refused', async () => {
    const e = expense({ label: 'v1' });
    await writeRow(db, USER, 'expenses', e);
    remote.onUpsert = async () => {
      remote.onUpsert = undefined;
      await writeRow(db, USER, 'expenses', { ...e, label: 'v2 fixed' });
      throw new RemoteError('invalid', '23514', 'check');
    };
    const { failed } = await flush(db, remote, USER);
    expect(failed).toEqual([]);
    const [entry] = await pendingFor(db, USER);
    expect(entry).toMatchObject({ status: 'pending', row: { label: 'v2 fixed' } });
  });

  it('holds a write for its undo window: not pushed before, pushed after, and undone without the server', async () => {
    const m = move({ from_pot: null });
    await writeRow(db, USER, 'savings_moves', m, undefined, { holdMs: 8_000 });
    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(0);
    vi.setSystemTime(Date.now() + 8_000);
    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(1);

    const undone = move({ from_pot: null });
    await writeRow(db, USER, 'savings_moves', undone, undefined, { holdMs: 8_000 });
    await discard(db, `${USER}:savings_moves:${undone.id}`);
    vi.setSystemTime(Date.now() + 8_000);
    await flush(db, remote, USER);
    expect(remote.calls).toHaveLength(1);
    expect(await db.get('savings_moves', undone.id)).toBeUndefined();
  });

  it('discardHeld undoes only a write still inside its window', async () => {
    const m = move({ from_pot: null });
    const key = `${USER}:savings_moves:${m.id}`;
    await writeRow(db, USER, 'savings_moves', m);
    expect(await discardHeld(db, key)).toBeUndefined();
    expect(await pendingFor(db, USER)).toHaveLength(1);

    const held = move({ from_pot: null });
    await writeRow(db, USER, 'savings_moves', held, undefined, { holdMs: 8_000 });
    expect(await discardHeld(db, `${USER}:savings_moves:${held.id}`)).toMatchObject({ rowKey: held.id });
    expect(await db.get('savings_moves', held.id)).toBeUndefined();
  });

  it('never sends a held write undone while an earlier push of the same flush was in flight', async () => {
    await writeRow(db, USER, 'expenses', expense());
    const m = move({ from_pot: null });
    await writeRow(db, USER, 'savings_moves', m, undefined, { holdMs: 8_000 });
    remote.onUpsert = async () => {
      remote.onUpsert = undefined;
      await discardHeld(db, `${USER}:savings_moves:${m.id}`);
      vi.setSystemTime(Date.now() + 8_000);
    };
    await flush(db, remote, USER);
    expect(remote.calls.map((c) => c.table)).toEqual(['expenses']);
  });

  it('inserts savings moves with ignore, so a repeat never overwrites', async () => {
    const move = {
      id: uuidN(77),
      user_id: USER,
      goal_id: uuidN(78),
      amount_mil: 400_000,
      kind: 'payday',
      from_pot: null,
      occurred_on: '2026-09-01',
      created_at: '2026-09-01T08:00:00+01:00',
    };
    remote.table('savings_moves').set(move.id, { ...move, amount_mil: 1 });
    await writeRow(db, USER, 'savings_moves', move);
    await flush(db, remote, USER);
    expect(remote.table('savings_moves').get(move.id)?.amount_mil).toBe(1);
  });
});

it('never sends a goal’s household_id: the server owns it (review I2)', async () => {
  await writeRow(db, USER, 'goals', goal({ household_id: null }));
  await flush(db, remote, USER);
  expect(remote.calls[0].rows[0]).not.toHaveProperty('household_id');
});

describe('rewritePending (couple mode re-stamp)', () => {
  const stamp = (_t: string, row: Record<string, unknown>) => ({ ...row, household_id: uuidN(778) });

  it('rewrites waiting rows and their copy, puts a refused one back in line, leaves patches alone', async () => {
    const e = expense({ pot: 'needs' });
    await writeRow(db, USER, 'expenses', e);
    const key = `${USER}:expenses:${e.id}`;
    const before = (await db.get('outbox', key)) as OutboxEntry;
    await db.put('outbox', { ...before, status: 'failed', attempts: 2, error: '23514' });
    await rewritePending(db, USER, stamp);
    const after = (await db.get('outbox', key)) as OutboxEntry;
    expect(after).toMatchObject({ rev: before.rev + 1, status: 'pending', attempts: 0, error: undefined });
    expect(after.row.household_id).toBe(uuidN(778));
    expect(((await db.get('expenses', e.id)) as Record<string, unknown>).household_id).toBe(uuidN(778));
  });

  it('skips unchanged rows and other users’ writes', async () => {
    const e = expense({ pot: 'needs' });
    await writeRow(db, OTHER, 'expenses', e);
    await writeRow(db, USER, 'expenses', { ...e, id: uuidN(9), household_id: uuidN(778) });
    await rewritePending(db, USER, stamp);
    const [mine] = await pendingFor(db, USER);
    const [theirs] = await pendingFor(db, OTHER);
    expect(mine.rev).toBe(1);
    expect(theirs.row.household_id).toBe(null);
  });
});
