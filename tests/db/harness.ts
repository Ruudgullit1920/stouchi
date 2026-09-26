/* Postgres in-process (PGlite) with just enough of Supabase to run our
 * migrations and exercise RLS as real roles: the auth schema and auth.uid(),
 * the anon / authenticated roles with Supabase's default grants, the
 * extensions.gen_random_bytes the invite codes use, and the realtime
 * publication. Tables are owned by the superuser, which (like Supabase's
 * postgres) bypasses RLS — so setup runs as owner and every test query runs
 * as `authenticated` or `anon`. */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const CAROL = '00000000-0000-4000-8000-000000000003';
/** Alice + Bob */
export const HH = '00000000-0000-4000-8000-0000000000a1';
/** Carol alone */
export const HH2 = '00000000-0000-4000-8000-0000000000a2';

const SUPABASE_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema if not exists extensions;
  create or replace function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$
    select substring(decode(md5(random()::text) || md5(random()::text), 'hex') from 1 for n)
  $$;
  create publication supabase_realtime;
`;

const MIGRATIONS = [
  '20260809_household_sharing.sql',
  '20260923_redesign_schema.sql',
  '20260924_server_stamped_created_at.sql',
  '20260925_phase3_incomes_soft_delete.sql',
  '20260926_phase4_notify.sql',
  '20260927_notify_cron_secret.sql',
  '20260928_phase5_plan_and_delete.sql',
  '20260929_phase6_couple.sql',
  '20260930_legacy_join_limit.sql',
];

export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${CAROL}');
    insert into public.households (id, invite_code) values ('${HH}', 'AAAAAA'), ('${HH2}', 'BBBBBB');
    insert into public.household_members (household_id, user_id)
      values ('${HH}', '${ALICE}'), ('${HH}', '${BOB}'), ('${HH2}', '${CAROL}');
  `);
  return db;
}

/** Run one statement as a signed-in user (or as anon when `user` is null). */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  user: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
