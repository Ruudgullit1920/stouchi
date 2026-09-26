/* Cut-over, step 1 (launch day, before the final backfill --apply): the
 * legacy app goes read-only. Its writes are refused with 42501, which the
 * frozen legacy app turns into its "lecture seule" banner, so nothing typed
 * there after the final backfill can vanish silently (plan Review Focus 1).
 *
 * Reads stay: the legacy app still opens and shows everything. The new app is
 * untouched: its tables are not listed here, and the couple_* RPCs are
 * security definer, so the direct-write revokes on households,
 * household_members and household_join_attempts (which RLS already refuses)
 * don't reach them.
 *
 * The grants it removes are recorded first in cutover.legacy_grants, which
 * legacy_read_write.sql replays to restore them exactly. Running this twice is
 * safe: the second run keeps the first run's record.
 *
 * Not a migration: it lives outside supabase/migrations/ on purpose. */
do $$
declare
  legacy_tables text[] := array[
    'budget_data', 'household_shared_data', 'households', 'household_members', 'household_join_attempts'
  ];
  legacy_writers text[] := array[
    'create_household', 'join_household', 'merge_household_data', 'set_household_display_name'
  ];
  t text;
  f regprocedure;
begin
  /* regprocedure prints schema-qualified names */
  perform set_config('search_path', '', true);

  if to_regclass('cutover.legacy_grants') is null then
    create schema if not exists cutover;
    revoke all on schema cutover from public, anon, authenticated;
    create table cutover.legacy_grants (
      kind text not null check (kind in ('table', 'function')),
      obj text not null,
      priv text not null,
      who text not null
    );
    revoke all on cutover.legacy_grants from public, anon, authenticated;
    insert into cutover.legacy_grants (kind, obj, priv, who)
    select 'table', format('public.%I', c.relname), a.privilege_type, coalesce(r.rolname, 'public')
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(c.relacl) a
      left join pg_catalog.pg_roles r on r.oid = a.grantee
     where c.relnamespace = 'public'::regnamespace
       and c.relname = any (legacy_tables)
       and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
       and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    union all
    select 'function', p.oid::regprocedure::text, a.privilege_type, coalesce(r.rolname, 'public')
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid = a.grantee
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (legacy_writers)
       and a.privilege_type = 'EXECUTE'
       and (r.rolname in ('anon', 'authenticated') or a.grantee = 0);
  end if;

  foreach t in array legacy_tables loop
    execute format('revoke insert, update, delete, truncate on public.%I from public, anon, authenticated', t);
  end loop;
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any (legacy_writers)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
