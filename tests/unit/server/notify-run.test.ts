import { describe, expect, it, vi } from 'vitest';
import type { UserSnapshot } from '../../../src/shared/notify/rules';
import { paydayId, tunisInstant } from '../../../src/shared/payday';
import type { NewSavingsMove } from '../../../src/shared/schemas';
import {
  runNotify,
  type NotifyDb,
  type NotificationInsert,
  type RunDeps,
} from '../../../src/server/notify/run';
import type { PushSub, SendPush } from '../../../src/server/notify/push';
import { bill, expense, goal, profile } from '../fixtures';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-0000000000b0';
const NOW = tunisInstant('2026-09-24', 10); // Thursday, period 1–30 Sept

const recent = (user: string) =>
  expense({ user_id: user, spent_on: '2026-09-23', created_at: '2026-09-23T10:00:00+01:00' });
function snap(user: string, name: string, p: Partial<UserSnapshot> = {}): UserSnapshot {
  return {
    profile: profile({ user_id: user, first_name: name, onboarded_at: '2026-08-10T10:00:00+01:00' }),
    expenses: [recent(user)],
    bills: [],
    billPayments: [],
    debts: [],
    savingsMoves: [],
    incomes: [],
    goals: [],
    reminders: [],
    ...p,
  };
}
/** Envies over by `over` TND */
const overspent = (user: string, over: number) =>
  expense({ user_id: user, amount_mil: 600_000 + over * 1000, category: 'resto', pot: 'wants' });

interface Stored extends NotificationInsert {
  id: string;
  created_at: string;
}

/** An in-memory NotifyDb: unique (user_id, dedupe_key), insert-ignore deposits. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeDb(snaps: Record<string, UserSnapshot>, subs: Record<string, PushSub[]> = {}) {
  const notifications: Stored[] = [];
  const deposits = new Map<string, NewSavingsMove>();
  let seq = 0;
  const db: NotifyDb = {
    /* like Postgres: user_id is a uuid column, so the cursor must be a uuid */
    listUsers: (after, limit) =>
      after !== null && !UUID.test(after)
        ? Promise.reject(new Error(`profiles: invalid input syntax for type uuid`))
        : Promise.resolve(
            Object.keys(snaps)
              .filter((id) => snaps[id].profile.onboarded_at && (after === null || id > after))
              .sort()
              .slice(0, limit),
          ),
    loadSnapshot: (userId) => Promise.resolve(snaps[userId] ?? null),
    recentNotifications: (userId) =>
      Promise.resolve(
        notifications
          .filter((n) => n.user_id === userId)
          .map(({ trigger, dedupe_key, created_at }) => ({ trigger, dedupe_key, created_at })),
      ),
    insertDeposit: (move) => {
      if (!deposits.has(move.id)) deposits.set(move.id, move);
      return Promise.resolve();
    },
    insertNotification: (row) => {
      if (notifications.some((n) => n.user_id === row.user_id && n.dedupe_key === row.dedupe_key))
        return Promise.resolve(null);
      const stored = { ...row, id: `n${++seq}`, created_at: NOW.toISOString() };
      notifications.push(stored);
      return Promise.resolve({ id: stored.id });
    },
    subscriptions: (userId) => Promise.resolve(subs[userId] ?? []),
    deleteSubscription: (userId, endpoint) => {
      subs[userId] = (subs[userId] ?? []).filter((s) => s.endpoint !== endpoint);
      return Promise.resolve();
    },
  };
  return { db, notifications, deposits, subs };
}

const sub = (endpoint: string): PushSub => ({ endpoint, p256dh: 'k', auth: 'a' });
function deps(db: NotifyDb, over: Partial<RunDeps> = {}): RunDeps {
  return { db, now: NOW, sendPush: vi.fn().mockResolvedValue(201), log: vi.fn(), ...over };
}

describe('runNotify — per-user scoping (Review Focus 1)', () => {
  it('each user gets notifications from their own rows, pushed only to their own devices', async () => {
    const steg = bill({ user_id: BOB, day: 27, label: 'STEG', amount_mil: 120_000 });
    const f = fakeDb(
      {
        [ALICE]: snap(ALICE, 'Alice', { expenses: [recent(ALICE), overspent(ALICE, 25)] }),
        [BOB]: snap(BOB, 'Bob', { bills: [steg] }),
      },
      { [ALICE]: [sub('https://push.example/alice')], [BOB]: [sub('https://push.example/bob')] },
    );
    const sendPush = vi.fn<SendPush>().mockResolvedValue(201);
    const report = await runNotify(deps(f.db, { sendPush }));

    const alice = f.notifications.filter((n) => n.user_id === ALICE);
    const bob = f.notifications.filter((n) => n.user_id === BOB);
    expect(alice.map((n) => n.trigger)).toEqual(['pot_over']);
    expect(alice[0].body).toContain('25');
    expect(alice[0].body).not.toContain('STEG');
    expect(bob.map((n) => n.trigger)).toEqual(['bill_due']);
    expect(bob[0].body).toContain('120');

    const pushed = sendPush.mock.calls.map(([s, payload]) => [
      s.endpoint,
      (JSON.parse(payload) as { id: string }).id,
    ]);
    expect(pushed).toEqual(
      expect.arrayContaining([
        ['https://push.example/alice', alice[0].id],
        ['https://push.example/bob', bob[0].id],
      ]),
    );
    expect(pushed).toHaveLength(2);
    expect(report).toMatchObject({ users: 2, inserted: 2, pushed: 2, errors: 0 });
  });

  it('a payday deposit for another user is never written', async () => {
    const g = goal({ user_id: ALICE });
    const s = snap(ALICE, 'Alice', { goals: [g], expenses: [] });
    const f = fakeDb({ [ALICE]: { ...s, profile: { ...s.profile, user_id: BOB } } });
    const report = await runNotify(deps(f.db, { now: tunisInstant('2026-09-01', 9) }));
    expect(f.deposits.size).toBe(0);
    expect(report.errors).toBe(1);
  });
});

describe('runNotify — idempotency (Review Focus 3)', () => {
  const world = () =>
    fakeDb(
      { [ALICE]: snap(ALICE, 'Alice', { expenses: [recent(ALICE), overspent(ALICE, 25)] }) },
      { [ALICE]: [sub('https://push.example/alice')] },
    );
  it('a second run at the same time inserts and pushes nothing', async () => {
    const f = world();
    await runNotify(deps(f.db));
    const sendPush = vi.fn().mockResolvedValue(201);
    expect(await runNotify(deps(f.db, { sendPush }))).toMatchObject({ inserted: 0, pushed: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(f.notifications).toHaveLength(1);
  });
  it('two overlapping runs write one row and push once', async () => {
    const f = world();
    const sendPush = vi.fn().mockResolvedValue(201);
    await Promise.all([runNotify(deps(f.db, { sendPush })), runNotify(deps(f.db, { sendPush }))]);
    expect(f.notifications).toHaveLength(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
  it('payday: the deposit already written by the device stays one row, the notification is written once', async () => {
    const g = goal({ user_id: ALICE });
    const f = fakeDb({ [ALICE]: snap(ALICE, 'Alice', { goals: [g], expenses: [] }) });
    const id = paydayId(ALICE, '2026-09-01');
    const device = { id, user_id: ALICE, goal_id: g.id, amount_mil: 400_000 } as NewSavingsMove;
    f.deposits.set(id, device);
    const now = tunisInstant('2026-09-01', 8, 15);
    await runNotify(deps(f.db, { now }));
    await runNotify(deps(f.db, { now }));
    expect(f.deposits.size).toBe(1);
    expect(f.deposits.get(id)).toBe(device);
    expect(f.notifications.filter((n) => n.trigger === 'payday').map((n) => n.dedupe_key)).toEqual([
      'payday:2026-09-01',
    ]);
  });
  it('payday with no deposit yet writes it before the notification', async () => {
    const g = goal({ user_id: ALICE });
    const f = fakeDb({ [ALICE]: snap(ALICE, 'Alice', { goals: [g], expenses: [] }) });
    await runNotify(deps(f.db, { now: tunisInstant('2026-09-01', 8, 15) }));
    expect(f.deposits.get(paydayId(ALICE, '2026-09-01'))).toMatchObject({ kind: 'payday', goal_id: g.id });
  });
});

describe('runNotify — push and failures', () => {
  const one = (endpoints: string[]) =>
    fakeDb(
      { [ALICE]: snap(ALICE, 'Alice', { expenses: [recent(ALICE), overspent(ALICE, 5)] }) },
      { [ALICE]: endpoints.map(sub) },
    );
  it('a 410 or 404 deletes that subscription; a 500 is counted and kept', async () => {
    const f = one(['https://a/gone', 'https://a/missing', 'https://a/flaky', 'https://a/ok']);
    const status: Record<string, number> = {
      'https://a/gone': 410,
      'https://a/missing': 404,
      'https://a/flaky': 500,
      'https://a/ok': 201,
    };
    const sendPush = vi.fn((s: PushSub) => Promise.resolve(status[s.endpoint]));
    const report = await runNotify(deps(f.db, { sendPush }));
    expect(f.subs[ALICE].map((s) => s.endpoint)).toEqual(['https://a/flaky', 'https://a/ok']);
    expect(report).toMatchObject({ pushed: 1, expiredSubs: 2, errors: 1 });
  });
  it('a push that throws is counted and the run goes on', async () => {
    const f = one(['https://a/1']);
    const sendPush = vi.fn().mockRejectedValue(new Error('network'));
    expect(await runNotify(deps(f.db, { sendPush }))).toMatchObject({ inserted: 1, errors: 1 });
  });
  it('a user whose load throws is skipped and the next one runs', async () => {
    const f = fakeDb({
      [ALICE]: snap(ALICE, 'Alice'),
      [BOB]: snap(BOB, 'Bob', { expenses: [recent(BOB), overspent(BOB, 5)] }),
    });
    const loadSnapshot = f.db.loadSnapshot.bind(f.db);
    f.db.loadSnapshot = (id, today) =>
      id === ALICE ? Promise.reject(new Error('boom')) : loadSnapshot(id, today);
    const log = vi.fn();
    const report = await runNotify(deps(f.db, { log }));
    expect(report).toMatchObject({ users: 2, errors: 1, inserted: 1 });
    expect(f.notifications[0].user_id).toBe(BOB);
    /* the log says what kind of error, never whose or what data */
    expect(log).toHaveBeenCalledWith('notify_user_error', { Error_none: 1 });
  });
  it('stops taking new users once the time budget is spent', async () => {
    const f = fakeDb({ [ALICE]: snap(ALICE, 'Alice'), [BOB]: snap(BOB, 'Bob') });
    let t = 0;
    const clock = () => (t += 70_000);
    const report = await runNotify(deps(f.db, { clock }));
    expect(report).toMatchObject({ users: 1, stoppedEarly: true });
  });
  it('a run cut short starts elsewhere next time, so no user is always last', async () => {
    const early = '40000000-0000-4000-8000-000000000001';
    const late = 'c0000000-0000-4000-8000-000000000002';
    const f = fakeDb({ [early]: snap(early, 'E'), [late]: snap(late, 'L') });
    const firsts = new Set<string>();
    const load = f.db.loadSnapshot.bind(f.db);
    for (let slot = 0; slot < 16; slot++) {
      let first: string | null = null;
      f.db.loadSnapshot = (id, today) => ((first ??= id), load(id, today));
      let t = 0;
      const clock = () => (t += 70_000);
      await runNotify(deps(f.db, { clock, now: new Date(NOW.getTime() + slot * 15 * 60_000) }));
      if (first) firsts.add(first);
    }
    expect([...firsts].sort()).toEqual([early, late]);
  });

  it('whatever the start, a full run visits every user exactly once', async () => {
    const ids = ['1', '5', '9', 'd'].map((h) => `${h}0000000-0000-4000-8000-000000000000`);
    const f = fakeDb(Object.fromEntries(ids.map((id) => [id, snap(id, 'U')])));
    const load = f.db.loadSnapshot.bind(f.db);
    for (let slot = 0; slot < 8; slot++) {
      const seen: string[] = [];
      f.db.loadSnapshot = (id, today) => (seen.push(id), load(id, today));
      await runNotify(deps(f.db, { now: new Date(NOW.getTime() + slot * 15 * 60_000) }));
      expect(seen.sort()).toEqual(ids);
    }
  });

  it('pages through users', async () => {
    const snaps = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
        return [id, snap(id, 'U')];
      }),
    );
    expect((await runNotify(deps(fakeDb(snaps).db))).users).toBe(150);
  });
});

describe('runNotify — writer', () => {
  it('uses the model at most 40 times per run; the 41st advice uses its template', async () => {
    const snaps = Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
        return [id, snap(id, 'U', { expenses: [recent(id), overspent(id, 5)] })];
      }),
    );
    const f = fakeDb(snaps);
    const callModel = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ titre: 'Oups, Envies', texte: 'De 5 TND.' }));
    const report = await runNotify(deps(f.db, { callModel }));
    expect(callModel).toHaveBeenCalledTimes(40);
    expect(report.writerCalls).toBe(40);
    expect(f.notifications.filter((n) => n.title === 'Oups, Envies')).toHaveLength(40);
    expect(f.notifications).toHaveLength(41);
  });
  it('passes the first name to the prompt', async () => {
    const f = fakeDb({ [ALICE]: snap(ALICE, 'Alice', { expenses: [recent(ALICE), overspent(ALICE, 5)] }) });
    const callModel = vi.fn().mockResolvedValue('nope');
    await runNotify(deps(f.db, { callModel }));
    expect(callModel.mock.calls[0][0]).toContain('carnet de Alice');
  });
});

describe('runNotify — the log holds counts only', () => {
  it('no names, amounts, labels or text reach the report or the log', async () => {
    const f = fakeDb(
      {
        [ALICE]: snap(ALICE, 'Alice', {
          expenses: [recent(ALICE), overspent(ALICE, 77)],
          bills: [bill({ user_id: ALICE, day: 27, label: 'STEG', amount_mil: 123_000 })],
        }),
      },
      { [ALICE]: [sub('https://push.example/alice')] },
    );
    f.db.subscriptions = () => Promise.reject(new Error('Alice STEG 123 https://push.example/alice'));
    const log = vi.fn();
    const report = await runNotify(deps(f.db, { log }));
    const out = JSON.stringify([report, log.mock.calls]);
    for (const secret of ['Alice', 'STEG', '123', '77', 'push.example', ALICE])
      expect(out).not.toContain(secret);
    for (const [, data] of log.mock.calls)
      for (const v of Object.values(data as object)) expect(['number', 'boolean']).toContain(typeof v);
  });
});
