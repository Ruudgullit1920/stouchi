/* Phase 7, Task 7 — the cut-over SQL in supabase/cutover/ (outside the
 * migrations, run by hand on launch day and at +14 days): the freeze of the
 * legacy app's writes and its exact rollback, the validation of the Phase 6
 * constraints, and the archive of the legacy tables. */
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { todayTunis } from '../../src/shared/dates';
import { convertAll } from '../../scripts/backfill/convert';
import { HOUSEHOLDS, NOW, ROWS } from '../unit/backfill/fixtures';
import { ALICE, BOB, CAROL, HH, asUser, freshDb } from './harness';

type Row = Record<string, unknown>;
const DENIED = { code: '42501' };
const CHECK = { code: '23514' };
const today = todayTunis();

let db: PGlite;
const sqlFile = (dir: string, name: string) =>
  readFileSync(new URL(`../../supabase/${dir}/${name}.sql`, import.meta.url), 'utf8');
const cutover = (name: string) => db.exec(sqlFile('cutover', name));
const asOwner = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
const as = (who: string | null, sql: string, params: unknown[] = []) => asUser<Row>(db, who, sql, params);

async function insertAsOwner(table: string, row: Row): Promise<void> {
  const cols = Object.keys(row);
  await asOwner(
    `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)),
  );
}

/** Every grant anon, authenticated and PUBLIC hold on public's tables and functions. */
const grants = () =>
  asOwner(`
    select c.relname::text as obj, a.privilege_type as priv, coalesce(r.rolname, 'public') as who
      from pg_class c cross join lateral aclexplode(c.relacl) a left join pg_roles r on r.oid = a.grantee
     where c.relnamespace = 'public'::regnamespace and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    union all
    select p.oid::regprocedure::text, a.privilege_type, coalesce(r.rolname, 'public')
      from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
     where p.pronamespace = 'public'::regnamespace and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
     order by 1, 2, 3`);

const upsertBudget = (who: string) =>
  as(
    who,
    `insert into public.budget_data (user_id, data) values ($1, '{"v":2}')
     on conflict (user_id) do update set data = excluded.data`,
    [who],
  );

const validated = async () =>
  Object.fromEntries(
    (
      await asOwner(
        `select conname, convalidated from pg_constraint
          where conname in ('expenses_shared_needs_only', 'incomes_shared_needs_only')`,
      )
    ).map((r) => [String(r.conname), r.convalidated]),
  );

/** A row the Phase 6 check would refuse today, written as if it predated it. */
async function legacySharedWants(table: 'expenses' | 'incomes') {
  const con = `${table}_shared_needs_only`;
  await asOwner(`alter table public.${table} drop constraint ${con}`);
  const row =
    table === 'expenses'
      ? {
          user_id: ALICE,
          household_id: HH,
          amount_mil: 5_000,
          category: 'sorties',
          pot: 'wants',
          label: 'Ciné',
          spent_on: today,
        }
      : {
          user_id: ALICE,
          household_id: HH,
          amount_mil: 5_000,
          pot: 'wants',
          label: 'Prime',
          received_on: today,
        };
  await insertAsOwner(table, row);
  await asOwner(
    `alter table public.${table} add constraint ${con} check (household_id is null or pot = 'needs') not valid`,
  );
}

beforeEach(async () => {
  db = await freshDb();
  /* budget_data is not in the harness: the legacy app's own table */
  await db.exec(sqlFile('migrations', '20260902_budget_data_rls'));
  await asOwner(`insert into public.budget_data (user_id, data) values ($1, '{"v":1}')`, [ALICE]);
  await asOwner(
    `insert into public.household_shared_data (household_id, data, updated_by) values ($1, '{}', $2)`,
    [HH, ALICE],
  );
  await insertAsOwner('profiles', { user_id: ALICE, first_name: 'A', salary_mil: 2_000_000, payday: 1 });
});

describe('legacy_read_only.sql (the freeze)', () => {
  beforeEach(() => cutover('legacy_read_only'));

  it('keeps legacy reads', async () => {
    expect(await as(ALICE, 'select data from public.budget_data')).toEqual([{ data: { v: 1 } }]);
    expect(await as(ALICE, 'select household_id from public.household_shared_data')).toEqual([
      { household_id: HH },
    ]);
    expect((await as(ALICE, 'select public.get_household() as r'))[0].r).toMatchObject({ household_id: HH });
  });

  it('refuses legacy writes with 42501', async () => {
    await expect(upsertBudget(ALICE)).rejects.toMatchObject(DENIED);
    await expect(as(ALICE, `update public.budget_data set data = '{}'`)).rejects.toMatchObject(DENIED);
    /* the legacy app's probe on open: an update that matches no row is refused too */
    await expect(
      as(
        ALICE,
        `update public.budget_data set data = '{}' where id = '00000000-0000-0000-0000-000000000000'`,
      ),
    ).rejects.toMatchObject(DENIED);
    await expect(as(ALICE, `update public.household_shared_data set data = '{}'`)).rejects.toMatchObject(
      DENIED,
    );
    await expect(as(CAROL, `select public.join_household('AAAAAA', 'C')`)).rejects.toMatchObject(DENIED);
    await expect(as(CAROL, `select public.create_household('C')`)).rejects.toMatchObject(DENIED);
    await expect(as(ALICE, `select public.merge_household_data('{}')`)).rejects.toMatchObject(DENIED);
    await expect(as(ALICE, `select public.set_household_display_name('A')`)).rejects.toMatchObject(DENIED);
    expect(await asOwner('select data from public.budget_data')).toEqual([{ data: { v: 1 } }]);
  });

  it('leaves the new tables and the couple RPCs alone', async () => {
    await as(
      ALICE,
      `insert into public.expenses (user_id, amount_mil, category, pot, label, spent_on)
       values ($1, 1000, 'courses', 'needs', 'Pain', $2)`,
      [ALICE, today],
    );
    expect((await as(ALICE, 'select public.couple_state($1) as r', [today]))[0].r).toMatchObject({
      status: 'on',
    });
    expect(((await as(CAROL, 'select public.couple_invite() as r'))[0].r as { code: string }).code).toMatch(
      /^STC-/,
    );
  });
});

describe('legacy_read_only.sql, when a revoke cannot bite', () => {
  it('fails loudly if a write grant survives (made by another grantor)', async () => {
    /* A REVOKE only removes the grants its own grantor made: one made by
       another role (say, supabase_admin) survives it silently. */
    await asOwner(`create role other_admin nologin`);
    await asOwner(`grant insert on public.budget_data to other_admin with grant option`);
    await asOwner(`set role other_admin`);
    await asOwner(`grant insert on public.budget_data to authenticated`);
    await asOwner(`reset role`);
    await expect(cutover('legacy_read_only')).rejects.toThrow(/still writable/);
    expect(await asOwner(`select to_regclass('cutover.legacy_grants') as t`)).toEqual([{ t: null }]);
  });
});

describe('legacy_read_write.sql (the rollback)', () => {
  it('restores the exact grants from before the freeze, even after a double freeze', async () => {
    const before = await grants();
    await cutover('legacy_read_only');
    expect(await grants()).not.toEqual(before);
    await cutover('legacy_read_only');
    await cutover('legacy_read_write');
    expect(await grants()).toEqual(before);
    await upsertBudget(ALICE);
    expect(await as(ALICE, 'select data from public.budget_data')).toEqual([{ data: { v: 2 } }]);
  });
});

describe('validate_constraints.sql', () => {
  it("passes on the backfill fixture's rows", async () => {
    const out = convertAll(ROWS, HOUSEHOLDS, NOW);
    const users = new Set([...out.profiles.map((p) => p.user_id), ...out.expenses.map((e) => e.user_id)]);
    for (const id of users)
      await asOwner('insert into auth.users (id) values ($1) on conflict do nothing', [id]);
    const homes = new Set(out.expenses.map((e) => e.household_id).filter((h): h is string => !!h));
    for (const id of homes)
      await asOwner(
        `insert into public.households (id, invite_code) values ($1, $2) on conflict do nothing`,
        [id, id.slice(-6)],
      );
    expect(out.expenses.some((e) => e.household_id)).toBe(true);
    for (const e of out.expenses) await insertAsOwner('expenses', { ...e, user_id: e.user_id });
    await cutover('validate_constraints');
    expect(await validated()).toEqual({ expenses_shared_needs_only: true, incomes_shared_needs_only: true });
  });

  for (const table of ['expenses', 'incomes'] as const) {
    it(`fails loudly with a shared Envies row in ${table}, and validates neither`, async () => {
      await legacySharedWants(table);
      await expect(cutover('validate_constraints')).rejects.toMatchObject(CHECK);
      expect(await validated()).toEqual({
        expenses_shared_needs_only: false,
        incomes_shared_needs_only: false,
      });
    });
  }
});

describe('archive_legacy.sql (day +14)', () => {
  beforeEach(() => cutover('legacy_read_only'));

  it('keeps every row, out of reach', async () => {
    const count = async (t: string) => (await asOwner(`select count(*)::int as n from ${t}`))[0].n;
    const before = [await count('public.budget_data'), await count('public.household_shared_data')];
    await cutover('archive_legacy');
    expect([await count('archive.budget_data'), await count('archive.household_shared_data')]).toEqual(
      before,
    );
    expect(await asOwner(`select to_regclass('public.budget_data') as t`)).toEqual([{ t: null }]);
    for (const who of [ALICE, null]) {
      await expect(as(who, 'select * from archive.budget_data')).rejects.toMatchObject(DENIED);
      await expect(as(who, 'select * from archive.household_shared_data')).rejects.toMatchObject(DENIED);
    }
  });

  it('drops the legacy functions and keeps what couple mode uses', async () => {
    await cutover('archive_legacy');
    const fns = (
      await asOwner(`select proname from pg_proc where pronamespace = 'public'::regnamespace`)
    ).map((r) => r.proname);
    for (const gone of [
      'create_household',
      'join_household',
      'merge_household_data',
      'get_household',
      'hh_state_for',
    ])
      expect(fns).not.toContain(gone);
    expect(fns).toEqual(expect.arrayContaining(['hh_gen_invite_code', 'is_household_member', 'couple_join']));
    expect(((await as(CAROL, 'select public.couple_invite() as r'))[0].r as { code: string }).code).toMatch(
      /^STC-/,
    );
    expect(await asOwner(`select nspname from pg_namespace where nspname = 'cutover'`)).toEqual([]);
  });

  it('still lets an account holding legacy rows delete itself', async () => {
    await cutover('archive_legacy');
    await as(ALICE, 'select public.delete_my_account()');
    expect(await asOwner('select 1 from auth.users where id = $1', [ALICE])).toEqual([]);
    expect(await asOwner('select 1 from archive.budget_data where user_id = $1', [ALICE])).toEqual([]);
    expect(await asOwner('select 1 from public.household_members where user_id = $1', [BOB])).toEqual([]);
  });
});
