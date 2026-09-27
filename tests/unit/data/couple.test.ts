import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoupleError, coupleApi, householdOf, stampHousehold, syncCouple } from '../../../src/data/couple';
import { openLocal, type LocalDb } from '../../../src/data/localdb';
import { pendingFor, type OutboxEntry } from '../../../src/data/outbox';
import { RemoteError } from '../../../src/data/remote';
import { createStore, type Store } from '../../../src/data/store';
import { pushOnce, syncOnce, useUser } from '../../../src/data/sync';
import { writeRow } from '../../../src/data/write';
import { payPeriod, todayTunis } from '../../../src/shared/dates';
import { currentCurrency, setCurrentCurrency } from '../../../src/shared/currentCurrency';
import type { CoupleStateT } from '../../../src/shared/schemas';
import { bill, debt, expense, goal, income, profile, USER, uuidN } from '../fixtures';
import { FakeRemote } from './fakeRemote';

const HOME = uuidN(778);
const PARTNER = uuidN(777);
const SOLO: CoupleStateT = { household_id: null, status: 'solo', invite: null, partner: null };
const PENDING: CoupleStateT = {
  household_id: HOME,
  status: 'pending',
  invite: { code: 'STC-ABCDEF', expires_at: '2026-09-12T10:00:00+00:00' },
  partner: null,
};
const ON: CoupleStateT = {
  household_id: HOME,
  status: 'on',
  invite: null,
  partner: { user_id: PARTNER, first_name: 'Amel', needs_mil: 900_000 },
};

let db: LocalDb;
let remote: FakeRemote;
let store: Store;
let n = 0;

beforeEach(async () => {
  db = await openLocal(`couple-${++n}`);
  remote = new FakeRemote();
  store = createStore();
  await useUser(db, store, USER);
});
afterEach(() => db.close());

const waiting = async (id: string): Promise<OutboxEntry | undefined> =>
  (await pendingFor(db, USER)).find((e) => e.rowKey === id);

describe('stampHousehold', () => {
  it('shares Besoins expenses and incomes, and bills; keeps Envies private', () => {
    expect(stampHousehold('expenses', expense({ pot: 'needs' }), HOME).household_id).toBe(HOME);
    expect(stampHousehold('expenses', expense({ pot: 'wants', household_id: HOME }), HOME).household_id).toBe(
      null,
    );
    expect(stampHousehold('incomes', income({ pot: 'needs' }), HOME).household_id).toBe(HOME);
    expect(stampHousehold('incomes', income({ pot: 'wants' }), HOME).household_id).toBe(null);
    expect(stampHousehold('bills', bill(), HOME).household_id).toBe(HOME);
    expect(stampHousehold('expenses', expense({ household_id: HOME }), null).household_id).toBe(null);
  });

  it('never touches the other tables: goals keep what the server set, debts have no column', () => {
    const shared = goal({ household_id: HOME });
    expect(stampHousehold('goals', shared, null)).toBe(shared);
    const d = debt();
    expect(stampHousehold('debts', d, HOME)).toBe(d);
  });

  it('stamps only while two are in the household', () => {
    expect(householdOf(ON)).toBe(HOME);
    expect(householdOf(PENDING)).toBe(null);
    expect(householdOf(SOLO)).toBe(null);
    expect(householdOf(null)).toBe(null);
  });
});

describe('new writes', () => {
  it('carry the household from the store', async () => {
    store.household.value = ON;
    const needs = expense({ pot: 'needs' });
    const wants = expense({ pot: 'wants' });
    await writeRow(db, USER, 'expenses', needs, store);
    await writeRow(db, USER, 'expenses', wants, store);
    expect((await waiting(needs.id))?.row.household_id).toBe(HOME);
    expect((await waiting(wants.id))?.row.household_id).toBe(null);
    expect(store.expenses.value.find((e) => e.id === needs.id)?.household_id).toBe(HOME);
  });

  it('stay private while the invite is pending', async () => {
    store.household.value = PENDING;
    const needs = expense({ pot: 'needs' });
    await writeRow(db, USER, 'expenses', needs, store);
    expect((await waiting(needs.id))?.row.household_id).toBe(null);
  });
});

describe('a write that crosses a membership change (Review Focus 1)', () => {
  it('logged before a join, it lands shared; an Envies one stays private', async () => {
    remote.whoAmI = USER;
    const needs = expense({ pot: 'needs' });
    const wants = expense({ pot: 'wants' });
    await writeRow(db, USER, 'expenses', needs, store);
    await writeRow(db, USER, 'expenses', wants, store);
    remote.rpcAnswers.couple_state = ON; // joined on another device meanwhile
    await syncOnce(db, remote, store);
    const pushed = remote.calls.flatMap((c) => c.rows);
    expect(pushed.find((r) => r.id === needs.id)?.household_id).toBe(HOME);
    expect(pushed.find((r) => r.id === wants.id)?.household_id).toBe(null);
    expect(store.household.value).toEqual(ON);
  });

  it('logged before a leave, it lands private (the old household is gone)', async () => {
    remote.rpcAnswers.couple_state = ON;
    await syncCouple(db, remote, store);
    const needs = expense({ pot: 'needs' });
    await writeRow(db, USER, 'expenses', needs, store);
    expect((await waiting(needs.id))?.row.household_id).toBe(HOME);
    remote.rpcAnswers.couple_state = SOLO;
    await syncOnce(db, remote, store);
    expect(remote.calls.flatMap((c) => c.rows).find((r) => r.id === needs.id)?.household_id).toBe(null);
  });

  it('a chat push checks the household first (review M1)', async () => {
    const needs = expense({ pot: 'needs' });
    await writeRow(db, USER, 'expenses', needs, store);
    remote.rpcAnswers.couple_state = ON;
    await pushOnce(db, remote, store);
    expect(remote.calls.flatMap((c) => c.rows).find((r) => r.id === needs.id)?.household_id).toBe(HOME);
  });

  it('a write the server refused goes back in line once re-stamped', async () => {
    const needs = expense({ pot: 'needs' });
    await writeRow(db, USER, 'expenses', needs, store);
    const key = `${USER}:expenses:${needs.id}`;
    const before = (await db.get('outbox', key)) as OutboxEntry;
    await db.put('outbox', { ...before, status: 'failed', error: '42501', attempts: 1 });
    remote.rpcAnswers.couple_state = ON;
    await syncCouple(db, remote, store);
    const after = (await db.get('outbox', key)) as OutboxEntry;
    expect(after).toMatchObject({ status: 'pending', attempts: 0, rev: before.rev + 1 });
    expect(after.row.household_id).toBe(HOME);
    expect(((await db.get('expenses', needs.id)) as { household_id: string }).household_id).toBe(HOME);
  });
});

describe('rebuilding the mirror', () => {
  it('runs once per household change, keeps the outbox and pulls everything again', async () => {
    const old = expense({ label: 'already here' });
    remote.serverWrite('expenses', old);
    await syncOnce(db, remote, store);
    const mine = expense({ pot: 'wants', label: 'offline' });
    await writeRow(db, USER, 'expenses', mine, store);
    const down = () => Promise.reject(new RemoteError('network', '', 'down'));
    remote.onUpsert = down;
    remote.onPull = down;

    remote.rpcAnswers.couple_state = ON;
    remote.serverWrite('expenses', expense({ user_id: PARTNER, household_id: HOME, label: 'hers' }));
    remote.pulls = [];
    await syncOnce(db, remote, store);
    // offline: the rows are gone until a pull brings them back; the waiting write stays
    expect(store.expenses.value.map((e) => e.label)).toEqual(['offline']);
    expect(await waiting(mine.id)).toBeDefined();

    remote.onUpsert = undefined;
    remote.onPull = undefined;
    await syncOnce(db, remote, store);
    expect(remote.pulls.find((p) => p.table === 'expenses')?.cursor).toBe(null);
    expect(store.expenses.value.map((e) => e.label).sort()).toEqual(['already here', 'hers', 'offline']);

    remote.pulls = [];
    await syncOnce(db, remote, store);
    expect(remote.pulls.find((p) => p.table === 'expenses')?.cursor).not.toBe(null);
  });

  it('keeps the profile on screen', async () => {
    store.profile.value = { user_id: USER } as never;
    remote.rpcAnswers.couple_state = ON;
    await syncCouple(db, remote, store);
    expect(store.profile.value).not.toBe(null);
  });

  it('does nothing without an answer: offline, or a server without the couple functions', async () => {
    const e = expense();
    remote.serverWrite('expenses', e);
    await syncOnce(db, remote, store);
    remote.rpcAnswers.couple_state = new RemoteError('network', '', 'down');
    await syncCouple(db, remote, store);
    remote.rpcAnswers.couple_state = { nonsense: true };
    await syncCouple(db, remote, store);
    expect(store.expenses.value).toHaveLength(1);
    expect(store.household.value).toEqual(SOLO);
  });
});

describe('the partner’s budget date (review M2)', () => {
  afterEach(() => vi.useRealTimers());

  it('is asked for my period start, not today', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-10T09:00:00Z'), toFake: ['Date'] });
    store.profile.value = profile({ payday: 25 });
    await syncCouple(db, remote, store);
    await coupleApi(db, remote, store).join('STC-ABCDEF');
    const asked = remote.rpcCalls.filter((c) => c.fn === 'couple_state').map((c) => c.args.p_on);
    const start = payPeriod(todayTunis(), 25).start; // 2026-08-25
    expect(asked).toEqual([start, start]);
  });
});

describe('coupleApi', () => {
  const api = () => coupleApi(db, remote, store);

  it('maps each refusal to its message key', async () => {
    const cases: [string, string][] = [
      ['CODE_INVALID', 'couple.err.invalid'],
      ['CODE_EXPIRED', 'couple.err.expired'],
      ['OWN_CODE', 'couple.err.own'],
      ['HOUSEHOLD_FULL', 'couple.err.full'],
      ['ALREADY_PAIRED', 'couple.err.paired'],
      ['TOO_MANY_TRIES', 'couple.err.tries'],
      ['SOMETHING_NEW', 'couple.err.generic'],
    ];
    for (const [code, key] of cases) {
      remote.rpcAnswers.couple_join = { error: code };
      await expect(api().join('stc-abcdef')).rejects.toMatchObject({ key });
    }
    remote.rpcAnswers.couple_request = { error: 'TOO_MANY_REQUESTS' };
    await expect(api().request(uuidN(1), { kind: 'delete' })).rejects.toMatchObject({
      key: 'couple.err.requests',
    });
    remote.rpcAnswers.couple_invite = new RemoteError('network', '', 'down');
    const offline = await api()
      .invite()
      .catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(CoupleError);
    expect(offline).toMatchObject({ key: 'couple.err.offline' });
  });

  it('after a join: the new state at once, and a sync to rebuild', async () => {
    remote.rpcAnswers.couple_join = {};
    remote.rpcAnswers.couple_state = ON;
    const writes = store.sync.value.writes;
    await api().join('STC-ABCDEF');
    expect(remote.rpcCalls.map((c) => c.fn)).toEqual(['couple_join', 'couple_state']);
    expect(remote.rpcCalls[0].args).toEqual({ p_code: 'STC-ABCDEF' });
    expect(store.household.value).toEqual(ON);
    expect(store.sync.value.writes).toBe(writes + 1);
  });

  it('invite answers the code and its expiry', async () => {
    remote.rpcAnswers.couple_invite = { code: 'STC-ABCDEF', expires_at: '2026-09-12T10:00:00+00:00' };
    remote.rpcAnswers.couple_state = PENDING;
    expect(await api().invite()).toEqual({ code: 'STC-ABCDEF', expires_at: '2026-09-12T10:00:00+00:00' });
    expect(store.household.value).toEqual(PENDING);
  });

  it('offline, state answers the last one known, kept across a restart', async () => {
    remote.rpcAnswers.couple_state = ON;
    expect(await api().state(todayTunis())).toEqual(ON);
    remote.rpcAnswers.couple_state = new RemoteError('network', '', 'down');
    const again = createStore();
    await useUser(db, again, USER);
    expect(again.household.value).toEqual(ON);
    expect(await coupleApi(db, remote, again).state('2026-09-10')).toEqual(ON);
  });

  it('offline with nothing known, state says so', async () => {
    remote.rpcAnswers.couple_state = new RemoteError('network', '', 'down');
    await expect(api().state('2026-09-10')).rejects.toMatchObject({ key: 'couple.err.offline' });
  });
});

describe('the household currency', () => {
  const api = () => coupleApi(db, remote, store);
  beforeEach(() => {
    store.profile.value = profile();
  });
  afterEach(() => setCurrentCurrency('TND'));

  it('a join that changed my currency says so and shows it at once', async () => {
    remote.rpcAnswers.couple_join = { currency: 'EUR' };
    remote.rpcAnswers.couple_state = ON;
    expect(await api().join('STC-ABCDEF')).toEqual({ currency: 'EUR' });
    expect(currentCurrency()).toBe('EUR');
    expect(store.profile.value?.currency).toBe('EUR');
  });

  it('a join that kept it changes nothing', async () => {
    remote.rpcAnswers.couple_join = {};
    remote.rpcAnswers.couple_state = ON;
    expect(await api().join('STC-ABCDEF')).toEqual({ currency: null });
    expect(currentCurrency()).toBe('TND');
  });

  it('setCurrency asks the server once, then switches, and syncs', async () => {
    remote.rpcAnswers.set_currency = {};
    const writes = store.sync.value.writes;
    await api().setCurrency('GBP');
    expect(remote.rpcCalls).toEqual([{ fn: 'set_currency', args: { p_code: 'GBP' } }]);
    expect(currentCurrency()).toBe('GBP');
    expect(store.profile.value?.currency).toBe('GBP');
    expect(store.sync.value.writes).toBe(writes + 1);
  });

  it('a refused or unsent change keeps the old currency', async () => {
    remote.rpcAnswers.set_currency = { error: 'CURRENCY_INVALID' };
    await expect(api().setCurrency('GBP')).rejects.toMatchObject({ key: 'couple.err.generic' });
    remote.rpcAnswers.set_currency = new RemoteError('network', '', 'down');
    await expect(api().setCurrency('GBP')).rejects.toMatchObject({ key: 'couple.err.offline' });
    expect(currentCurrency()).toBe('TND');
    expect(store.profile.value?.currency).toBe('TND');
  });
});
