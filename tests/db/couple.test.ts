/* Phase 6 — couple mode (plan D1, D4–D7): invites, join, leave, the shared
 * rows' policies, the household_id trigger and partner requests. Each test
 * pairs its own users, since an account belongs to at most one household. */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, payPeriod, todayTunis } from '../../src/shared/dates';
import { splitSalary } from '../../src/shared/money';
import { planFor } from '../../src/shared/plan';
import { ProfileRow } from '../../src/shared/schemas';
import { asUser, freshDb } from './harness';

let db: PGlite;
type Row = Record<string, unknown>;
const RLS = { code: '42501' };
const CHECK = { code: '23514' };

let next = 0x100;
/** A fresh auth user with a profile (payday 1, salary 2 000 TND, 50/30/20 unless patched). */
async function user(profile: Row = {}): Promise<string> {
  const id = `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`;
  await asOwner('insert into auth.users (id) values ($1)', [id]);
  const p = { user_id: id, first_name: 'X', salary_mil: 2_000_000, payday: 1, ...profile };
  const cols = Object.keys(p);
  await asOwner(
    `insert into public.profiles (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(p),
  );
  return id;
}
const asOwner = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
const as = (who: string | null, sql: string, params: unknown[] = []) => asUser<Row>(db, who, sql, params);
async function rpc(who: string | null, call: string, params: unknown[] = []): Promise<Row> {
  return (await as(who, `select public.${call} as r`, params))[0].r as Row;
}
async function insert(who: string, table: string, row: Row): Promise<Row> {
  const cols = Object.keys(row);
  const sql = `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  return (await as(who, sql, Object.values(row)))[0];
}
const today = todayTunis();
const expense = (patch: Row = {}): Row => ({
  amount_mil: 10_000,
  category: 'courses',
  pot: 'needs',
  label: 'Carrefour',
  spent_on: today,
  ...patch,
});
async function pair(a: string, b: string): Promise<string> {
  const { code } = (await rpc(a, 'couple_invite()')) as { code: string };
  expect(await rpc(b, 'couple_join($1)', [code])).toEqual({});
  return (await as(a, 'select household_id from public.household_members where user_id = $1', [a]))[0]
    .household_id as string;
}
const household = async (who: string) =>
  (await asOwner('select household_id from public.household_members where user_id = $1', [who]))[0]
    ?.household_id ?? null;

beforeAll(async () => {
  db = await freshDb();
});

describe('invite and state', () => {
  it('solo, then pending with an STC- code for 48 h', async () => {
    const a = await user();
    expect(await rpc(a, 'couple_state($1)', [today])).toEqual({
      household_id: null,
      status: 'solo',
      invite: null,
      partner: null,
    });
    const inv = (await rpc(a, 'couple_invite()')) as { code: string; expires_at: string };
    expect(inv.code).toMatch(/^STC-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    const hours = (Date.parse(inv.expires_at) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);
    const state = await rpc(a, 'couple_state($1)', [today]);
    expect(state).toMatchObject({ status: 'pending', invite: { code: inv.code }, partner: null });
    expect(state.household_id).toBe(await household(a));
  });

  it('a new invite replaces the previous one; cancel drops the pending household', async () => {
    const a = await user();
    const b = await user();
    const first = (await rpc(a, 'couple_invite()')) as { code: string };
    const second = (await rpc(a, 'couple_invite()')) as { code: string };
    expect(second.code).not.toBe(first.code);
    expect(await rpc(b, 'couple_join($1)', [first.code])).toEqual({ error: 'CODE_INVALID' });
    expect(await rpc(a, 'couple_cancel()')).toEqual({});
    expect(await household(a)).toBeNull();
    expect(await rpc(b, 'couple_join($1)', [second.code])).toEqual({ error: 'CODE_INVALID' });
  });

  it("the household's legacy invite_code can't be redeemed by the legacy join", async () => {
    const a = await user();
    const b = await user();
    await rpc(a, 'couple_invite()');
    const [{ invite_code }] = await asOwner(
      'select h.invite_code from public.households h join public.household_members m on m.household_id = h.id where m.user_id = $1',
      [a],
    );
    expect(await rpc(b, 'join_household($1, $2)', [invite_code, 'B'])).toEqual({ error: 'CODE_INVALID' });
  });

  it('the legacy join keeps its wrong tries: the sixth in a minute is refused', async () => {
    const b = await user();
    for (let i = 0; i < 5; i++)
      expect(await rpc(b, 'join_household($1, $2)', ['ZZZZZZ', 'B'])).toEqual({ error: 'CODE_INVALID' });
    expect(await rpc(b, 'join_household($1, $2)', ['ZZZZZZ', 'B'])).toEqual({ error: 'TOO_MANY_ATTEMPTS' });
  });
});

describe('join', () => {
  it('accepts the code in lower case, with spaces, without STC-; both are on', async () => {
    const a = await user({ first_name: 'Amira' });
    const b = await user({ first_name: 'Sami' });
    const { code } = (await rpc(a, 'couple_invite()')) as { code: string };
    const typed = ` ${code.slice(4, 7).toLowerCase()} ${code.slice(7).toLowerCase()}`;
    expect(await rpc(b, 'couple_join($1)', [typed])).toEqual({});
    const hid = await household(a);
    expect(await household(b)).toBe(hid);
    expect(await rpc(a, 'couple_state($1)', [today])).toMatchObject({
      household_id: hid,
      status: 'on',
      invite: null,
      partner: { user_id: b, first_name: 'Sami', needs_mil: 1_000_000 },
    });
    expect(await rpc(b, 'couple_state($1)', [today])).toMatchObject({
      status: 'on',
      partner: { user_id: a, first_name: 'Amira' },
    });
  });

  it('refuses unknown, own, expired, used and cancelled codes, and a joiner already paired', async () => {
    const [a, b, c, d, e] = [await user(), await user(), await user(), await user(), await user()];
    expect(await rpc(b, 'couple_join($1)', ['STC-ZZZZZZ'])).toEqual({ error: 'CODE_INVALID' });
    const { code } = (await rpc(a, 'couple_invite()')) as { code: string };
    expect(await rpc(a, 'couple_join($1)', [code])).toEqual({ error: 'OWN_CODE' });
    await asOwner(`update public.household_invites set expires_at = now() - interval '1 minute'`);
    expect(await rpc(b, 'couple_join($1)', [code])).toEqual({ error: 'CODE_EXPIRED' });

    await pair(c, d);
    const again = (await rpc(a, 'couple_invite()')) as { code: string };
    expect(await rpc(c, 'couple_join($1)', [again.code])).toEqual({ error: 'ALREADY_PAIRED' });
    expect(await rpc(c, 'couple_invite()')).toEqual({ error: 'ALREADY_PAIRED' });
    expect(await rpc(b, 'couple_join($1)', [again.code])).toEqual({});
    /* used: a third person is refused */
    expect(await rpc(e, 'couple_join($1)', [again.code])).toEqual({ error: 'CODE_EXPIRED' });
  });

  it('never lets a third member in', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const hid = await pair(a, b);
    await asOwner(
      `insert into public.household_invites (code, household_id, created_by, expires_at)
       values ('QQQQQQ', $1, $2, now() + interval '1 hour')`,
      [hid, a],
    );
    expect(await rpc(c, 'couple_join($1)', ['QQQQQQ'])).toEqual({ error: 'HOUSEHOLD_FULL' });
    expect(
      await asOwner('select 1 from public.household_members where household_id = $1', [hid]),
    ).toHaveLength(2);
  });

  it('rate-limits wrong tries, and the tries are kept (not rolled back)', async () => {
    const [a, b] = [await user(), await user()];
    const { code } = (await rpc(a, 'couple_invite()')) as { code: string };
    for (let i = 0; i < 5; i++) {
      expect(await rpc(b, 'couple_join($1)', ['ZZZZZ' + 'ABCDE'[i]])).toEqual({ error: 'CODE_INVALID' });
    }
    expect(
      await asOwner('select 1 from public.household_join_attempts where user_id = $1', [b]),
    ).toHaveLength(5);
    expect(await rpc(b, 'couple_join($1)', [code])).toEqual({ error: 'TOO_MANY_TRIES' });
  });

  it("a joiner's own pending household is dropped", async () => {
    const [a, b] = [await user(), await user()];
    await rpc(b, 'couple_invite()');
    const pending = await household(b);
    const hid = await pair(a, b);
    expect(await household(b)).toBe(hid);
    expect(await asOwner('select 1 from public.households where id = $1', [pending])).toHaveLength(0);
  });

  it("tags this period's Besoins expenses and incomes and active bills, not older ones or Envies", async () => {
    const a = await user({ payday: 25 });
    const b = await user({ payday: 5 });
    const startA = payPeriod(today, 25).start;
    const startB = payPeriod(today, 5).start;
    const now = {
      a: await insert(a, 'expenses', expense({ spent_on: startA })),
      b: await insert(b, 'expenses', expense({ spent_on: startB })),
    };
    const old = await insert(a, 'expenses', expense({ spent_on: addDays(startA, -1) }));
    const wants = await insert(b, 'expenses', expense({ pot: 'wants', category: 'cafe' }));
    const gone = await insert(b, 'expenses', expense());
    await as(b, 'update public.expenses set deleted_at = now() where id = $1', [gone.id]);
    const inc = await insert(a, 'incomes', { amount_mil: 50_000, pot: 'needs', received_on: today });
    const incWants = await insert(a, 'incomes', { amount_mil: 50_000, pot: 'wants', received_on: today });
    const bill = await insert(b, 'bills', { label: 'STEG', amount_mil: 80_000 });
    const off = await insert(b, 'bills', { label: 'Ancien', amount_mil: 1_000, active: false });

    const hid = await pair(a, b);
    const hh = async (table: string, id: unknown) =>
      (await asOwner(`select household_id from public.${table} where id = $1`, [id]))[0].household_id;
    expect(await hh('expenses', now.a.id)).toBe(hid);
    expect(await hh('expenses', now.b.id)).toBe(hid);
    expect(await hh('incomes', inc.id)).toBe(hid);
    expect(await hh('bills', bill.id)).toBe(hid);
    for (const [t, r] of [
      ['expenses', old],
      ['expenses', wants],
      ['expenses', gone],
      ['incomes', incWants],
      ['bills', off],
    ] as const) {
      expect(await hh(t, r.id), `${t} ${String(r.label ?? r.pot)}`).toBeNull();
    }
    /* and the partner now reads them */
    expect(await as(b, 'select id from public.expenses where id = $1', [now.a.id])).toHaveLength(1);
    expect(await as(b, 'select id from public.incomes where id = $1', [inc.id])).toHaveLength(1);
  });

  it("makes the inviter's goal the household's; the joiner's is archived and its moves repointed", async () => {
    const [a, b] = [await user(), await user()];
    const ga = await insert(a, 'goals', { name: 'Voiture', icon: 'car', target_mil: 9_000_000 });
    const gb = await insert(b, 'goals', { name: 'Maison', icon: 'home', target_mil: 5_000_000 });
    const move = (goal: unknown, amount: number) => ({
      goal_id: goal,
      amount_mil: amount,
      kind: 'deposit',
      occurred_on: today,
    });
    await insert(a, 'savings_moves', move(ga.id, 100_000));
    await insert(b, 'savings_moves', move(gb.id, 40_000));
    const hid = await pair(a, b);
    const [shared] = await asOwner('select household_id, archived_at from public.goals where id = $1', [
      ga.id,
    ]);
    expect(shared).toEqual({ household_id: hid, archived_at: null });
    const [old] = await asOwner('select archived_at from public.goals where id = $1', [gb.id]);
    expect(old.archived_at).not.toBeNull();
    for (const who of [a, b]) {
      const [{ total }] = await as(
        who,
        'select sum(amount_mil)::int as total from public.savings_moves where goal_id = $1',
        [ga.id],
      );
      expect(total).toBe(140_000);
    }
    /* the joiner's own goal (archived) stays hidden from the inviter */
    expect(await as(a, 'select 1 from public.goals where id = $1', [gb.id])).toHaveLength(0);
  });

  it("uses the joiner's goal when the inviter has none", async () => {
    const [a, b] = [await user(), await user()];
    const gb = await insert(b, 'goals', { name: 'Maison', icon: 'home', target_mil: 5_000_000 });
    const hid = await pair(a, b);
    expect(
      (await asOwner('select household_id from public.goals where id = $1', [gb.id]))[0].household_id,
    ).toBe(hid);
  });
});

describe('a goal made while paired (review I1)', () => {
  it('is the household’s, whatever the client sends; solo and pending goals stay private', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const hid = await pair(a, b);
    const g = await insert(a, 'goals', { name: 'Voyage', icon: 'plane', target_mil: 3_000_000 });
    expect(g.household_id).toBe(hid);
    expect(await as(b, 'select 1 from public.goals where id = $1', [g.id])).toHaveLength(1);
    await rpc(c, 'couple_invite()');
    const mine = await insert(c, 'goals', { name: 'Perso', icon: 'star', target_mil: 1_000 });
    expect(mine.household_id).toBe(null);
  });

  it('a leave’s copies stay private', async () => {
    const [a, b] = [await user(), await user()];
    await pair(a, b);
    await insert(a, 'goals', { name: 'Voyage', icon: 'plane', target_mil: 3_000_000 });
    await rpc(b, 'couple_leave()');
    const rows = await asOwner('select household_id from public.goals where user_id in ($1, $2)', [a, b]);
    expect(rows.every((r) => r.household_id === null)).toBe(true);
  });
});

describe('shared rows', () => {
  it('a partner can add a move to the shared goal but not update or delete the other’s move', async () => {
    const [a, b] = [await user(), await user()];
    const g = await insert(a, 'goals', { name: 'Voiture', icon: 'car', target_mil: 9_000_000 });
    await pair(a, b);
    const mine = await insert(a, 'savings_moves', {
      goal_id: g.id,
      amount_mil: 10_000,
      kind: 'deposit',
      occurred_on: today,
    });
    const theirs = await insert(b, 'savings_moves', {
      goal_id: g.id,
      amount_mil: 5_000,
      kind: 'deposit',
      occurred_on: today,
    });
    expect(theirs.user_id).toBe(b);
    await expect(
      as(b, 'update public.savings_moves set amount_mil = 1 where id = $1', [mine.id]),
    ).rejects.toMatchObject(RLS);
    await as(b, 'delete from public.savings_moves where id = $1', [mine.id]);
    expect(await asOwner('select 1 from public.savings_moves where id = $1', [mine.id])).toHaveLength(1);
    /* and B can edit the shared goal itself */
    await as(b, `update public.goals set name = 'Auto' where id = $1`, [g.id]);
    expect((await asOwner('select name from public.goals where id = $1', [g.id]))[0].name).toBe('Auto');
  });

  it('refuses clearing or moving household_id directly; sharing an own Besoins row is allowed', async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    const hid = await pair(a, b);
    const other = await pair(c, d);
    const e = await insert(a, 'expenses', expense({ household_id: hid }));
    await expect(
      as(a, 'update public.expenses set household_id = null where id = $1', [e.id]),
    ).rejects.toMatchObject(RLS);
    await expect(
      as(b, 'update public.expenses set household_id = null where id = $1', [e.id]),
    ).rejects.toMatchObject(RLS);
    await expect(
      as(c, 'update public.expenses set household_id = $2 where id = $1', [e.id, other]),
    ).resolves.toHaveLength(0);
    const old = await insert(a, 'expenses', expense({ spent_on: '2020-01-01' }));
    await as(a, 'update public.expenses set household_id = $2 where id = $1', [old.id, hid]);
    expect(
      (await asOwner('select household_id from public.expenses where id = $1', [old.id]))[0].household_id,
    ).toBe(hid);
    const g = await insert(a, 'goals', {
      name: 'Perso',
      icon: 'star',
      target_mil: 1_000,
      archived_at: new Date().toISOString(),
    });
    await expect(
      as(a, 'update public.goals set household_id = $2 where id = $1', [g.id, hid]),
    ).rejects.toMatchObject(RLS);
  });

  it('only Besoins rows can be shared (D1)', async () => {
    const [a, b] = [await user(), await user()];
    const hid = await pair(a, b);
    await expect(insert(a, 'expenses', expense({ pot: 'wants', household_id: hid }))).rejects.toMatchObject(
      CHECK,
    );
    await expect(
      insert(a, 'incomes', { amount_mil: 1_000, pot: 'wants', received_on: today, household_id: hid }),
    ).rejects.toMatchObject(CHECK);
    const e = await insert(a, 'expenses', expense({ household_id: hid }));
    await expect(
      as(b, `update public.expenses set pot = 'wants' where id = $1`, [e.id]),
    ).rejects.toMatchObject(CHECK);
  });

  it('nobody can put a row or a goal into another household', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const hid = await pair(a, b);
    await expect(insert(c, 'expenses', expense({ household_id: hid }))).rejects.toMatchObject(RLS);
    await expect(
      insert(c, 'incomes', { amount_mil: 1_000, pot: 'needs', received_on: today, household_id: hid }),
    ).rejects.toMatchObject(RLS);
    await expect(
      insert(c, 'goals', { name: 'X', icon: 'star', target_mil: 1_000, household_id: hid }),
    ).rejects.toMatchObject(RLS);
  });

  it("the partner's private data never reaches me (Review Focus 3)", async () => {
    const [a, b] = [await user({ salary_mil: 3_333_333 }), await user()];
    const g = await insert(a, 'goals', { name: 'Vieux', icon: 'star', target_mil: 1_000 });
    await asOwner('update public.goals set archived_at = now() where id = $1', [g.id]);
    await pair(a, b);
    const w = await insert(a, 'expenses', expense({ pot: 'wants', category: 'cafe' }));
    const iw = await insert(a, 'incomes', { amount_mil: 1_000, pot: 'wants', received_on: today });
    const priv = await insert(a, 'expenses', expense({ spent_on: '2020-01-01' }));
    await insert(a, 'debts', { direction: 'i_owe', person: 'Ali', amount_mil: 1_000 });
    await insert(a, 'reminders', { text: 'Appeler', remind_at: new Date().toISOString() });
    await asOwner(
      `insert into public.notifications (user_id, trigger, dedupe_key, title, body) values ($1, 'x_y', 'k', 't', 'b')`,
      [a],
    );
    for (const [sql, id] of [
      ['select 1 from public.expenses where id = $1', w.id],
      ['select 1 from public.expenses where id = $1', priv.id],
      ['select 1 from public.incomes where id = $1', iw.id],
      ['select 1 from public.goals where id = $1', g.id],
      ['select 1 from public.debts where user_id = $1', a],
      ['select 1 from public.reminders where user_id = $1', a],
      ['select 1 from public.notifications where user_id = $1', a],
      ['select 1 from public.profiles where user_id = $1', a],
    ] as const) {
      expect(await as(b, sql, [id]), sql).toHaveLength(0);
    }
    const state = await rpc(b, 'couple_state($1)', [today]);
    expect(Object.keys(state.partner as Row).sort()).toEqual(['first_name', 'needs_mil', 'user_id']);
    expect(JSON.stringify(state)).not.toContain('3333333');
  });
});

describe("the partner's Besoins amount (needs_mil)", () => {
  it.each([
    [{ salary_mil: 1_234_567, split_needs: 45, split_wants: 35, split_savings: 20 }, '2026-09-01'],
    [{ salary_mil: 1_000_001, split_needs: 33, split_wants: 33, split_savings: 34 }, '2026-09-01'],
    [
      {
        salary_mil: 2_500_000,
        split_needs: 50,
        split_wants: 30,
        split_savings: 20,
        next_salary_mil: 3_000_007,
        next_split_needs: 61,
        next_split_wants: 19,
        next_split_savings: 20,
        next_from: '2026-10-01',
      },
      '2026-10-01',
    ],
  ])('matches splitSalary(planFor(…)).needs — %o on %s', async (profile, on) => {
    const [a, b] = [await user(profile), await user()];
    await pair(a, b);
    const [row] = await asOwner('select * from public.profiles where user_id = $1', [a]);
    const p = ProfileRow.parse({
      ...row,
      created_at: new Date(row.created_at as string).toISOString(),
      updated_at: new Date(row.updated_at as string).toISOString(),
      onboarded_at: null,
      next_from: row.next_from == null ? null : on,
    });
    const plan = planFor(p, { start: on, end: on, label: on.slice(0, 7) });
    const state = await rpc(b, 'couple_state($1)', [on]);
    expect((state.partner as Row).needs_mil).toBe(splitSalary(plan.salary_mil, plan.split).needs);
    /* before the pending plan's period, the current plan applies */
    if (row.next_from != null) {
      const before = await rpc(b, 'couple_state($1)', ['2026-09-30']);
      expect((before.partner as Row).needs_mil).toBe(1_250_000);
    }
  });
});

describe('leave', () => {
  it('each row goes back to its author, each partner keeps their own savings (Review Focus 5)', async () => {
    const [a, b] = [await user(), await user()];
    const g = await insert(a, 'goals', { name: 'Voiture', icon: 'car', target_mil: 9_000_000 });
    const hid = await pair(a, b);
    const ea = await insert(a, 'expenses', expense({ household_id: hid }));
    const eb = await insert(b, 'expenses', expense({ household_id: hid }));
    const bill = await insert(b, 'bills', { label: 'Loyer', amount_mil: 500_000, household_id: hid });
    const move = (amount: number) => ({
      goal_id: g.id,
      amount_mil: amount,
      kind: 'deposit',
      occurred_on: today,
    });
    await insert(a, 'savings_moves', move(30_000));
    await insert(b, 'savings_moves', move(12_000));

    expect(await rpc(b, 'couple_leave()')).toEqual({});
    for (const who of [a, b]) {
      expect(await rpc(who, 'couple_state($1)', [today])).toMatchObject({
        status: 'solo',
        household_id: null,
      });
    }
    expect(await asOwner('select 1 from public.households where id = $1', [hid])).toHaveLength(0);
    for (const [table, row, owner] of [
      ['expenses', ea, a],
      ['expenses', eb, b],
      ['bills', bill, b],
    ] as const) {
      expect(
        (await asOwner(`select user_id, household_id from public.${table} where id = $1`, [row.id]))[0],
      ).toEqual({ user_id: owner, household_id: null });
    }
    expect(await as(a, 'select 1 from public.expenses where id = $1', [eb.id])).toHaveLength(0);
    const balance = async (who: string) =>
      (
        await as(
          who,
          `select g.name, sum(m.amount_mil)::int as total from public.goals g
             join public.savings_moves m on m.goal_id = g.id
            where g.user_id = $1 and g.archived_at is null group by g.name`,
          [who],
        )
      )[0];
    expect(await balance(a)).toEqual({ name: 'Voiture', total: 30_000 });
    expect(await balance(b)).toEqual({ name: 'Voiture', total: 12_000 });
  });

  it('delete_my_account leaves first: the survivor keeps their goal, moves and bills', async () => {
    const [a, b] = [await user(), await user()];
    const g = await insert(a, 'goals', { name: 'Voiture', icon: 'car', target_mil: 9_000_000 });
    const hid = await pair(a, b);
    await insert(b, 'savings_moves', {
      goal_id: g.id,
      amount_mil: 7_000,
      kind: 'deposit',
      occurred_on: today,
    });
    const bill = await insert(b, 'bills', { label: 'Loyer', amount_mil: 500_000, household_id: hid });
    await as(a, 'select public.delete_my_account()');
    expect(await rpc(b, 'couple_state($1)', [today])).toMatchObject({ status: 'solo' });
    const [{ total }] = await as(
      b,
      `select sum(m.amount_mil)::int as total from public.savings_moves m
         join public.goals g on g.id = m.goal_id where g.user_id = $1`,
      [b],
    );
    expect(total).toBe(7_000);
    expect(await as(b, 'select household_id from public.bills where id = $1', [bill.id])).toEqual([
      { household_id: null },
    ]);
  });
});

describe('partner requests', () => {
  const del = { kind: 'delete' };
  const edit = { kind: 'edit', fields: { amount_mil: 45_000, label: 'Carrefour Market' } };

  it('sends one textless in-app notification to the author, once per expense and kind a day', async () => {
    const [a, b] = [await user(), await user()];
    const hid = await pair(a, b);
    const e = await insert(b, 'expenses', expense({ household_id: hid }));
    expect(await rpc(a, 'couple_request($1, $2)', [e.id, edit])).toEqual({});
    expect(await rpc(a, 'couple_request($1, $2)', [e.id, edit])).toEqual({});
    const rows = await as(b, 'select trigger, title, body, action, dedupe_key from public.notifications');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trigger: 'partner_request',
      title: '',
      body: '',
      action: { kind: 'partner_request', ref: e.id, from: a, change: edit },
      dedupe_key: `partner:${String(e.id)}:edit:${today}`,
    });
  });

  it('refuses Envies or private rows, my own row, a non-member and malformed changes', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const hid = await pair(a, b);
    const shared = await insert(b, 'expenses', expense({ household_id: hid }));
    const envies = await insert(b, 'expenses', expense({ pot: 'wants', category: 'cafe' }));
    const priv = await insert(b, 'expenses', expense({ spent_on: '2020-01-01' }));
    const mine = await insert(a, 'expenses', expense({ household_id: hid }));
    const bad = { error: 'REQUEST_INVALID' };
    expect(await rpc(a, 'couple_request($1, $2)', [envies.id, del])).toEqual(bad);
    expect(await rpc(a, 'couple_request($1, $2)', [priv.id, del])).toEqual(bad);
    expect(await rpc(a, 'couple_request($1, $2)', [mine.id, del])).toEqual(bad);
    expect(await rpc(c, 'couple_request($1, $2)', [shared.id, del])).toEqual(bad);
    for (const change of [
      null,
      [],
      { kind: 'drop' },
      { kind: 'delete', fields: {} },
      { kind: 'edit' },
      { kind: 'edit', fields: {} },
      { kind: 'edit', fields: { user_id: c } },
      { kind: 'edit', fields: { amount_mil: 0 } },
      { kind: 'edit', fields: { amount_mil: 1.5 } },
      { kind: 'edit', fields: { category: 'DROP TABLE' } },
      { kind: 'edit', fields: { pot: 'savings' } },
      { kind: 'edit', fields: { label: 'x'.repeat(61) } },
      { kind: 'edit', fields: { spent_on: '2026-02-30' } },
      { kind: 'edit', fields: { amount_mil: 1_000 }, extra: 1 },
    ]) {
      expect(await rpc(a, 'couple_request($1, $2)', [shared.id, change]), JSON.stringify(change)).toEqual(
        bad,
      );
    }
    expect(await as(b, 'select 1 from public.notifications')).toHaveLength(0);
  });

  it('caps a sender at 10 requests a day', async () => {
    const [a, b] = [await user(), await user()];
    const hid = await pair(a, b);
    for (let i = 0; i < 10; i++) {
      const e = await insert(b, 'expenses', expense({ household_id: hid }));
      expect(await rpc(a, 'couple_request($1, $2)', [e.id, del])).toEqual({});
    }
    const e = await insert(b, 'expenses', expense({ household_id: hid }));
    expect(await rpc(a, 'couple_request($1, $2)', [e.id, del])).toEqual({ error: 'TOO_MANY_REQUESTS' });
  });
});

describe('function privileges', () => {
  const calls = [
    ['couple_state($1)', [today]],
    ['couple_invite()', []],
    ['couple_cancel()', []],
    ['couple_join($1)', ['STC-AAAAAA']],
    ['couple_leave()', []],
    ['couple_request($1, $2)', ['00000000-0000-4000-8000-000000000999', { kind: 'delete' }]],
  ] as const;
  it.each(calls)('anon cannot execute %s', async (call, params) => {
    await expect(as(null, `select public.${call}`, [...params])).rejects.toMatchObject(RLS);
  });
  it.each(calls)('%s refuses a caller with no session', async (call, params) => {
    await expect(asOwner(`select public.${call}`, [...params])).rejects.toThrow(/not signed in/);
  });
  it('the helpers are callable by nobody', async () => {
    const helpers = await asOwner(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('couple_state_for', 'couple_needs_mil', 'couple_period_start', 'couple_tag', 'couple_leave_for',
           'couple_change_ok', 'keep_household_id')`,
    );
    expect(helpers).toHaveLength(7);
    for (const { sig } of helpers) {
      for (const role of ['anon', 'authenticated']) {
        const [{ ok }] = await asOwner(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]);
        expect(ok, `${role} ${String(sig)}`).toBe(false);
      }
    }
  });
  it('household_invites has no table grant for anon or authenticated', async () => {
    await expect(as(null, 'select * from public.household_invites')).rejects.toMatchObject(RLS);
    const u = await user();
    await expect(as(u, 'select * from public.household_invites')).rejects.toMatchObject(RLS);
  });
});
