/* Couple mode on the device (plan D8): the household state the server gives,
 * the stamp that shares a write, and the rebuild when the household changes.
 * The server decides who is in a household; the device only follows. */
import { payPeriod, todayTunis, type ISODate } from '../shared/dates';
import type { StringKey } from '../shared/i18n/t';
import { CoupleState, type CoupleStateT, type PartnerChangeT } from '../shared/schemas';
import type { LocalDb, Row, Table } from './localdb';
import { rebuildMirror } from './mirror';
import { rewritePending } from './outbox';
import { RemoteError, type Remote } from './remote';
import type { Store } from './store';

/** what a household shares (plan D1): Besoins expenses and incomes, and bills */
const STAMPED: readonly Table[] = ['expenses', 'incomes', 'bills'];

/** Rows are shared only while two are in the household, not while an invite waits. */
export const householdOf = (s: CoupleStateT | null): string | null =>
  s?.status === 'on' ? s.household_id : null;

/** The household_id a write carries. Envies are never shared; goals are left
 * as the server set them (it moves the goal into the household on a join). */
export function stampHousehold(table: Table, row: Row, householdId: string | null): Row {
  if (!STAMPED.includes(table)) return row;
  const shared = table === 'bills' || row.pot === 'needs';
  return { ...row, household_id: shared ? householdId : null };
}

const ERRORS: Record<string, StringKey> = {
  CODE_INVALID: 'couple.err.invalid',
  CODE_EXPIRED: 'couple.err.expired',
  OWN_CODE: 'couple.err.own',
  HOUSEHOLD_FULL: 'couple.err.full',
  ALREADY_PAIRED: 'couple.err.paired',
  TOO_MANY_TRIES: 'couple.err.tries',
  REQUEST_INVALID: 'couple.err.request',
  TOO_MANY_REQUESTS: 'couple.err.requests',
};

/** A couple action that didn't go through; `key` is the message to show. */
export class CoupleError extends Error {
  constructor(readonly key: StringKey) {
    super(key);
  }
}

/** the last state the server gave, and the household the device's rows were pulled for */
const STATE = (userId: string) => `couple:${userId}`;
const MIRROR = (userId: string) => `couple-mirror:${userId}`;

export async function loadCouple(db: LocalDb, userId: string): Promise<CoupleStateT | null> {
  const got = CoupleState.safeParse(await db.get('meta', STATE(userId)));
  return got.success ? got.data : null;
}

/** The partner's Besoins amount is their plan at my period start (plan D2). */
const periodStart = (store: Store): ISODate => {
  const today = todayTunis();
  const payday = store.profile.value?.payday;
  return payday === undefined ? today : payPeriod(today, payday).start;
};

async function remember(db: LocalDb, store: Store, userId: string, state: CoupleStateT): Promise<void> {
  await db.put('meta', state, STATE(userId));
  if (store.userId.value === userId) store.household.value = state;
}

/** Each sync, before the push: the household may have changed on another
 * device. A new household re-stamps the writes still waiting and rebuilds the
 * device's copy, once. No answer (offline, a server without the couple
 * functions): the last known state stands. */
export async function syncCouple(db: LocalDb, remote: Remote, store: Store): Promise<void> {
  const userId = store.userId.value;
  if (!userId) return;
  let answer: unknown;
  try {
    answer = await remote.rpc('couple_state', { p_on: periodStart(store) });
  } catch (err) {
    if (err instanceof RemoteError) return;
    throw err;
  }
  const got = CoupleState.safeParse(answer);
  if (!got.success) return;
  await remember(db, store, userId, got.data);
  const household = householdOf(got.data);
  const built = ((await db.get('meta', MIRROR(userId))) as string | null | undefined) ?? null;
  if (household === built) return;
  await rewritePending(db, userId, (table, row) => stampHousehold(table, row, household));
  await rebuildMirror(db, store);
  await db.put('meta', household, MIRROR(userId));
}

export function coupleApi(db: LocalDb, remote: Remote, store: Store) {
  async function call(fn: string, args: Row = {}): Promise<Row> {
    let answer: unknown;
    try {
      answer = await remote.rpc(fn, args);
    } catch (err) {
      if (!(err instanceof RemoteError)) throw err;
      throw new CoupleError(err.kind === 'network' ? 'couple.err.offline' : 'couple.err.generic');
    }
    const row = (answer ?? {}) as Row;
    if (typeof row.error === 'string') throw new CoupleError(ERRORS[row.error] ?? 'couple.err.generic');
    return row;
  }

  /** the state on `on`; my current period's is remembered (another period's partner budget may differ) */
  async function fetchState(on: ISODate): Promise<CoupleStateT> {
    const got = CoupleState.safeParse(await call('couple_state', { p_on: on }));
    if (!got.success) throw new CoupleError('couple.err.generic');
    const userId = store.userId.value;
    if (userId && on === periodStart(store)) await remember(db, store, userId, got.data);
    return got.data;
  }

  /** After a change: the new state at once, and a sync round, which re-stamps
   * and rebuilds (a rebuild never runs beside a pull that is on the network). */
  async function changed(): Promise<void> {
    await fetchState(periodStart(store)).catch((err: unknown) => {
      if (!(err instanceof CoupleError)) throw err;
    });
    store.sync.value = { ...store.sync.value, writes: store.sync.value.writes + 1 };
  }

  return {
    /** offline: the last state known on this device */
    async state(on: ISODate): Promise<CoupleStateT> {
      try {
        return await fetchState(on);
      } catch (err) {
        const userId = store.userId.value;
        if (err instanceof CoupleError && err.key === 'couple.err.offline' && userId) {
          const known = await loadCouple(db, userId);
          if (known) return known;
        }
        throw err;
      }
    },
    async invite(): Promise<{ code: string; expires_at: string }> {
      const row = await call('couple_invite');
      await changed();
      return { code: String(row.code), expires_at: String(row.expires_at) };
    },
    async cancel(): Promise<void> {
      await call('couple_cancel');
      await changed();
    },
    async join(code: string): Promise<void> {
      await call('couple_join', { p_code: code.trim().toUpperCase() });
      await changed();
    },
    async leave(): Promise<void> {
      await call('couple_leave');
      await changed();
    },
    /** ask the partner to change or delete their shared expense (plan D7) */
    async request(expenseId: string, change: PartnerChangeT): Promise<void> {
      await call('couple_request', { p_expense: expenseId, p_change: change });
    },
  };
}
export type CoupleApi = ReturnType<typeof coupleApi>;
