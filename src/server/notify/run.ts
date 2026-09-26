/* One notify-run (every 15 minutes, spec §8.1): for each onboarded user, load
 * THEIR rows, evaluate the rules, write the payday deposit and the
 * notifications, and push each new row to their devices.
 *
 * Runs with the service key (spec §8.5), so scoping is in code: every NotifyDb
 * method but listUsers takes the user id and filters on it (load.ts), and a
 * row built for one user is never written for another. The report and the
 * log hold counts only — no names, amounts or text. */
import { todayTunis } from '../../shared/dates';
import { evaluate } from '../../shared/notify/rules';
import type { UserSnapshot } from '../../shared/notify/rules';
import { TRIGGERS } from '../../shared/notify/triggers';
import { compose, type AiCallContext, type CallModel } from '../../shared/notify/writer';
import type { ISODate } from '../../shared/dates';
import type { NewSavingsMove, NotificationActionT } from '../../shared/schemas';
import { isDelivered, isExpired, payloadFor, type PushSub, type SendPush } from './push';

export interface NotificationInsert {
  user_id: string;
  trigger: string;
  dedupe_key: string;
  title: string;
  body: string;
  action: NotificationActionT | null;
}

export interface NotifyDb {
  /** onboarded users after `after`, by id — the only query not scoped to one user */
  listUsers(after: string | null, limit: number): Promise<string[]>;
  loadSnapshot(userId: string, today: ISODate): Promise<UserSnapshot | null>;
  /** the user's notifications since `since` (keys for dedupe, today's for the cap) */
  recentNotifications(
    userId: string,
    since: string,
  ): Promise<{ trigger: string; dedupe_key: string; created_at: string }[]>;
  /** insert-ignore on id */
  insertDeposit(move: NewSavingsMove): Promise<void>;
  /** insert-ignore on (user_id, dedupe_key); null when the row already existed */
  insertNotification(row: NotificationInsert): Promise<{ id: string } | null>;
  subscriptions(userId: string): Promise<PushSub[]>;
  deleteSubscription(userId: string, endpoint: string): Promise<void>;
}

export interface RunDeps {
  db: NotifyDb;
  now: Date;
  callModel?: CallModel;
  sendPush: SendPush;
  log: (event: string, data: Record<string, number | boolean>) => void;
  /** ms since some origin; injected for tests */
  clock?: () => number;
}

export interface RunReport {
  users: number;
  inserted: number;
  pushed: number;
  expiredSubs: number;
  writerCalls: number;
  errors: number;
  stoppedEarly: boolean;
}

const PAGE = 100;
const BUDGET_MS = 120_000;
const MAX_WRITER_CALLS = 40;
/** longer than any dedupe key's window (a pay period, a week) */
const KEYS_DAYS = 40;

export async function runNotify(deps: RunDeps): Promise<RunReport> {
  const clock = deps.clock ?? (() => Date.now());
  const started = clock();
  const report: RunReport = {
    users: 0,
    inserted: 0,
    pushed: 0,
    expiredSubs: 0,
    writerCalls: 0,
    errors: 0,
    stoppedEarly: false,
  };
  /* Users after the slot's start point first, then wrap round to the ones
     before it: a run cut short by the budget starts elsewhere next time. */
  const start = startPoint(deps.now);
  const visit = async (id: string): Promise<boolean> => {
    if (clock() - started > BUDGET_MS) {
      report.stoppedEarly = true;
      return false;
    }
    report.users++;
    try {
      await runUser(deps, id, report);
    } catch (e) {
      report.errors++;
      deps.log('notify_user_error', errorKind(e));
    }
    return true;
  };
  for (const wrapped of [false, true]) {
    let after: string | null = wrapped ? null : start;
    for (;;) {
      const ids = await deps.db.listUsers(after, PAGE);
      const mine = wrapped ? ids.filter((id) => id <= start) : ids;
      for (const id of mine) if (!(await visit(id))) return done(deps, report);
      if (ids.length < PAGE || mine.length < ids.length) break;
      after = ids[ids.length - 1];
    }
  }
  return done(deps, report);
}

function done(deps: RunDeps, report: RunReport): RunReport {
  deps.log('notify_run', { ...report });
  return report;
}

const SLOT_MS = 15 * 60_000;

/** A point in the user-id space that moves with each 15-minute slot. It is a
 * whole uuid: user_id is a uuid column, and Postgres refuses any other cursor.
 * uuids order bytewise, the same as their lowercase text. */
export function startPoint(now: Date): string {
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const head = (Math.imul(slot, 2654435761) >>> 0).toString(16).padStart(8, '0');
  return `${head}-0000-0000-0000-000000000000`;
}

/** What went wrong, without any user data: the error's class, and the table
 * when it came from a query (load.ts prefixes "table: "). */
export function errorKind(e: unknown): Record<string, number | boolean> {
  const name = e instanceof Error ? e.name : 'unknown';
  const table = e instanceof Error ? (/^([a-z_]+):/.exec(e.message)?.[1] ?? 'none') : 'none';
  return { [`${name.replace(/\W/g, '')}_${table}`]: 1 };
}

async function runUser(deps: RunDeps, userId: string, report: RunReport): Promise<void> {
  const { db, now } = deps;
  const today = todayTunis(now);
  const snap = await db.loadSnapshot(userId, today);
  if (!snap) return;
  if (snap.profile.user_id !== userId) throw new Error('snapshot for another user');
  const since = new Date(now.getTime() - KEYS_DAYS * 86_400_000).toISOString();
  const recent = await db.recentNotifications(userId, since);
  const sentToday = recent
    .filter((r) => todayTunis(new Date(r.created_at)) === today)
    .map((r) => ({ trigger: r.trigger, dedupeKey: r.dedupe_key }));
  const candidates = evaluate(snap, now, sentToday, new Set(recent.map((r) => r.dedupe_key)));

  for (const c of candidates) {
    if (c.paydayDeposit) {
      if (c.paydayDeposit.user_id !== userId) throw new Error('deposit for another user');
      await db.insertDeposit(c.paydayDeposit);
    }
    const useModel =
      Boolean(deps.callModel) && TRIGGERS[c.trigger].writer && report.writerCalls < MAX_WRITER_CALLS;
    if (useModel) report.writerCalls++;
    const aiContext: AiCallContext | undefined = useModel
      ? { distinctId: userId, sessionId: null, traceId: crypto.randomUUID() }
      : undefined;
    const text = await compose(c, snap.profile.first_name, useModel ? deps.callModel : undefined, aiContext);
    const row = await db.insertNotification({
      user_id: userId,
      trigger: c.trigger,
      dedupe_key: c.dedupeKey,
      title: text.title,
      body: text.body,
      action: c.action,
    });
    if (!row) continue;
    report.inserted++;
    await pushAll(deps, userId, payloadFor({ id: row.id, title: text.title, body: text.body }), report);
  }
}

async function pushAll(deps: RunDeps, userId: string, payload: string, report: RunReport): Promise<void> {
  let subs: PushSub[];
  try {
    subs = await deps.db.subscriptions(userId);
  } catch {
    report.errors++;
    return;
  }
  for (const sub of subs) {
    try {
      const status = await deps.sendPush(sub, payload);
      if (isDelivered(status)) report.pushed++;
      else if (isExpired(status)) {
        await deps.db.deleteSubscription(userId, sub.endpoint);
        report.expiredSubs++;
      } else report.errors++;
    } catch {
      report.errors++;
    }
  }
}
