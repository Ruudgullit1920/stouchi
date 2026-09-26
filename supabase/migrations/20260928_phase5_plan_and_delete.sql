/* Stouchi redesign, Phase 5 (Objectif and Moi) — a pending plan change on
 * profiles, and account deletion.
 *
 * ADDITIVE ONLY.
 *
 * - profiles.next_*: a salary / split change that waits for the next payday
 *   (spec §4.6). All null, or all set with a split adding up to 100.
 *   `next_from` is the start of the pay period it applies from; the app
 *   resolves it with planFor (src/shared/plan.ts), so no job applies it.
 *   The table-level grants on profiles already cover the new columns.
 * - delete_my_account(): deletes the caller's auth.users row; every table
 *   cascades from it (spec §8.5). It first clears the one reference that does
 *   not cascade (household_shared_data.updated_by), drops the caller's join
 *   attempts, and afterwards deletes a household left with no member. */

alter table public.profiles
  add column if not exists next_salary_mil bigint check (next_salary_mil between 0 and 1000000000),
  add column if not exists next_split_needs smallint check (next_split_needs between 0 and 100),
  add column if not exists next_split_wants smallint check (next_split_wants between 0 and 100),
  add column if not exists next_split_savings smallint check (next_split_savings between 0 and 100),
  add column if not exists next_from date;

alter table public.profiles drop constraint if exists profiles_next_all_or_none;
alter table public.profiles add constraint profiles_next_all_or_none check (
  num_nulls(next_salary_mil, next_split_needs, next_split_wants, next_split_savings, next_from) in (0, 5)
);
alter table public.profiles drop constraint if exists profiles_next_split_is_100;
alter table public.profiles add constraint profiles_next_split_is_100 check (
  next_from is null or next_split_needs + next_split_wants + next_split_savings = 100
);

create or replace function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  home uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select household_id into home from public.household_members where user_id = me;
  update public.household_shared_data set updated_by = null where updated_by = me;
  delete from public.household_join_attempts where user_id = me;
  delete from auth.users where id = me;
  if home is not null and not exists (select 1 from public.household_members where household_id = home) then
    delete from public.households where id = home;
  end if;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
