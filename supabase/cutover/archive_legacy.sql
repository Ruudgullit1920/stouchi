/* Day +14 (Session D): the legacy app is gone, so its data moves out of
 * reach. budget_data and household_shared_data go to the `archive` schema,
 * with every row and no grants; they are dropped at +90 days, with approval
 * (spec §9.5). The legacy-only functions are dropped. The rollback of the
 * freeze is over, so its record (schema cutover) goes too.
 *
 * households, household_members and household_join_attempts stay in public:
 * couple mode (Phase 6) runs on them. So do is_household_member (RLS) and
 * hh_gen_invite_code (couple_invite).
 *
 * The archived rows keep their cascades, so deleting an account or a household
 * still deletes its archived data. updated_by becomes `on delete set null`, and
 * delete_my_account stops touching household_shared_data, which has left
 * public. */
begin;

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

drop schema if exists cutover cascade;

drop trigger if exists budget_data_touch on public.budget_data;
drop function if exists public.touch_budget_data();

/* the legacy app's realtime channel on the shared row: nobody listens any more */
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'household_shared_data') then
    alter publication supabase_realtime drop table public.household_shared_data;
  end if;
end $$;

alter table public.budget_data set schema archive;
alter table public.household_shared_data set schema archive;
revoke all on archive.budget_data, archive.household_shared_data from public, anon, authenticated;

alter table archive.household_shared_data
  drop constraint household_shared_data_updated_by_fkey,
  add constraint household_shared_data_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null;

/* by name, so an overload made by hand on production goes too */
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array[
         'create_household', 'join_household', 'merge_household_data', 'set_household_display_name',
         'get_household', 'hh_state_for', 'hh_merge_data'
       ])
  loop
    execute format('drop function %s', f);
  end loop;
end $$;

/* 20260929_phase6_couple.sql's version, minus the household_shared_data line */
create or replace function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.couple_leave_for(me);
  delete from public.household_join_attempts where user_id = me;
  delete from auth.users where id = me;
end;
$$;

commit;
