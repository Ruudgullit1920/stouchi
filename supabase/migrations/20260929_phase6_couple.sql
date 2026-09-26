/* Stouchi redesign, Phase 6 (couple mode) — two accounts share one household.
 *
 * ADDITIVE ONLY. The legacy functions (create_household, join_household,
 * merge_household_data, …), budget_data and household_shared_data are
 * untouched: production's legacy app still uses them.
 *
 * - Shared: Besoins expenses and incomes, fixed bills, and the household goal
 *   with every move into it. Private: everything else (plan D1). The checks
 *   below enforce "Besoins only"; they are `not valid` so legacy backfilled
 *   rows don't block this migration (the backfill fixes them before Phase 7).
 * - household_id changes only through the couple_* functions below, which set
 *   a transaction-local flag (stouchi.couple_rpc). A client can't set it: each
 *   API request is its own transaction, and set_config isn't exposed. One
 *   exception, so a write queued offline before a join still lands: a member
 *   may share their own Besoins row (null → their household; the policies
 *   check membership). Never the other way: a shared row stays shared.
 * - household_invites: one-use codes, 48 h, reached only through the functions.
 * - Expected refusals come back as {"error": "<CODE>"}, not as exceptions: a
 *   raise would roll back the join attempt that rate-limits code guessing.
 */

/* ── columns and checks ──────────────────────────────────── */

alter table public.goals
  add column if not exists household_id uuid references public.households(id) on delete set null;
alter table public.incomes
  add column if not exists household_id uuid references public.households(id) on delete set null;
create index if not exists goals_household on public.goals (household_id) where household_id is not null;
create index if not exists incomes_household on public.incomes (household_id, received_on desc)
  where household_id is not null and deleted_at is null;

alter table public.expenses drop constraint if exists expenses_shared_needs_only;
alter table public.expenses add constraint expenses_shared_needs_only
  check (household_id is null or pot = 'needs') not valid;
alter table public.incomes drop constraint if exists incomes_shared_needs_only;
alter table public.incomes add constraint incomes_shared_needs_only
  check (household_id is null or pot = 'needs') not valid;

/* ── household_id guard ──────────────────────────────────── */

/* security definer: it must see a household the caller can't (to tell a
   deleted household's `on delete set null` from a client clearing the id). */
create or replace function public.keep_household_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.household_id is not distinct from old.household_id
     or current_setting('stouchi.couple_rpc', true) = 'on' then
    return new;
  end if;
  if new.household_id is null
     and not exists (select 1 from public.households h where h.id = old.household_id) then
    return new;  -- the household is gone: its foreign key is clearing the id
  end if;
  if tg_table_name <> 'goals' and old.household_id is null then
    return new;  -- sharing one's own row (see the header)
  end if;
  raise exception 'household_id cannot change' using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['expenses', 'incomes', 'bills', 'goals'] loop
    execute format('create or replace trigger %1$s_keep_household before update on public.%1$I
                    for each row execute function public.keep_household_id()', t);
  end loop;
end $$;

/* A goal made by a member of a couple is the household's (plan D1): the server
   decides, and the client never sends goals.household_id. A leave's copies,
   made while both are still members, stay private. */
create or replace function public.goal_household()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
begin
  if new.archived_at is not null or current_setting('stouchi.couple_rpc', true) = 'on' then
    return new;
  end if;
  select m.household_id into home from public.household_members m where m.user_id = new.user_id;
  if home is not null
     and (select count(*) from public.household_members m where m.household_id = home) = 2 then
    new.household_id := home;
  end if;
  return new;
end $$;
create or replace trigger goals_household before insert on public.goals
  for each row execute function public.goal_household();

/* ── invites ─────────────────────────────────────────────── */

create table if not exists public.household_invites (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists household_invites_household on public.household_invites (household_id);
alter table public.household_invites enable row level security;
alter table public.household_invites force row level security;
revoke all on public.household_invites from anon, authenticated;
/* No policy and no grant: the functions below are the only access. */

/* ── policies: goals, savings moves and incomes follow the household ── */

drop policy if exists "goals: read own" on public.goals;
drop policy if exists "goals: read own or household" on public.goals;
create policy "goals: read own or household" on public.goals for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "goals: create own" on public.goals;
create policy "goals: create own" on public.goals for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "goals: edit own" on public.goals;
drop policy if exists "goals: edit own or household" on public.goals;
create policy "goals: edit own or household" on public.goals for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* moves: visible with their goal (goals' RLS applies inside the subquery);
   a member adds their own moves to a visible goal; undo stays own-only. */
drop policy if exists "savings_moves: read own" on public.savings_moves;
drop policy if exists "savings_moves: read own or goal" on public.savings_moves;
create policy "savings_moves: read own or goal" on public.savings_moves for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.goals g where g.id = savings_moves.goal_id));
drop policy if exists "savings_moves: create own" on public.savings_moves;
create policy "savings_moves: create own" on public.savings_moves for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.goals g where g.id = savings_moves.goal_id));

drop policy if exists "incomes: read own" on public.incomes;
drop policy if exists "incomes: read own or household" on public.incomes;
create policy "incomes: read own or household" on public.incomes for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "incomes: create own" on public.incomes;
create policy "incomes: create own" on public.incomes for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "incomes: edit own" on public.incomes;
drop policy if exists "incomes: edit own or household" on public.incomes;
create policy "incomes: edit own or household" on public.incomes for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* ── helpers (callable by no client role) ────────────────── */

/* payPeriod(d, payday).start from src/shared/dates.ts; payday 0 = last day. */
create or replace function public.couple_period_start(d date, payday smallint)
returns date language sql immutable set search_path = '' as $$
  with m as (select date_trunc('month', d)::date as this_m, (date_trunc('month', d) - interval '1 month')::date as prev_m)
  select case
    when d >= (case when payday = 0 then (this_m + interval '1 month - 1 day')::date else this_m + (payday - 1) end)
      then (case when payday = 0 then (this_m + interval '1 month - 1 day')::date else this_m + (payday - 1) end)
    else (case when payday = 0 then this_m - 1 else prev_m + (payday - 1) end)
  end
  from m
$$;

/* splitSalary(planFor(profile, period starting p_on)).needs — same integer
   largest-remainder rounding as src/shared/money.ts (ties go to Besoins). */
create or replace function public.couple_needs_mil(who uuid, p_on date)
returns bigint language sql stable set search_path = '' as $$
  with plan as (
    select case when p.next_from is not null and p_on >= p.next_from then p.next_salary_mil else p.salary_mil end as s,
           case when p.next_from is not null and p_on >= p.next_from then p.next_split_needs else p.split_needs end as n,
           case when p.next_from is not null and p_on >= p.next_from then p.next_split_wants else p.split_wants end as w,
           case when p.next_from is not null and p_on >= p.next_from then p.next_split_savings else p.split_savings end as v
      from public.profiles p where p.user_id = who
  ), parts as (
    select s, s * n / 100 as fn, s * w / 100 as fw, s * v / 100 as fv,
           s * n % 100 as rn, s * w % 100 as rw, s * v % 100 as rv
      from plan
  )
  select coalesce((
    select fn + case when s - fn - fw - fv > (rw > rn)::int + (rv > rn)::int then 1 else 0 end from parts
  ), 0)
$$;

create or replace function public.couple_state_for(me uuid, p_on date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  home uuid;
  mate uuid;
  inv_code text;
  inv_expires timestamptz;
begin
  select m.household_id into home from public.household_members m where m.user_id = me;
  if home is null then
    return jsonb_build_object('household_id', null, 'status', 'solo', 'invite', null, 'partner', null);
  end if;
  select m.user_id into mate from public.household_members m
   where m.household_id = home and m.user_id <> me limit 1;
  if mate is null then
    select i.code, i.expires_at into inv_code, inv_expires from public.household_invites i
     where i.household_id = home and i.used_at is null and i.expires_at > now()
     order by i.expires_at desc limit 1;
    return jsonb_build_object('household_id', home, 'status', 'pending', 'partner', null,
      'invite', case when inv_code is null then null
                     else jsonb_build_object('code', 'STC-' || inv_code, 'expires_at', inv_expires) end);
  end if;
  return jsonb_build_object('household_id', home, 'status', 'on', 'invite', null,
    'partner', jsonb_build_object(
      'user_id', mate,
      'first_name', coalesce((select p.first_name from public.profiles p where p.user_id = mate), ''),
      'needs_mil', public.couple_needs_mil(mate, coalesce(p_on, (now() at time zone 'Africa/Tunis')::date))));
end $$;

/* Join: share both members' active bills and this pay period's Besoins rows
   (each member's own period), and merge the goals (plan D5). */
create or replace function public.couple_tag(home uuid, host uuid, joiner uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  member record;
  since date;
  goal uuid;
  other uuid;
begin
  for member in
    select m.user_id, coalesce(p.payday, 1::smallint) as payday
      from public.household_members m left join public.profiles p on p.user_id = m.user_id
     where m.household_id = home
  loop
    since := public.couple_period_start((now() at time zone 'Africa/Tunis')::date, member.payday);
    update public.expenses set household_id = home
     where user_id = member.user_id and household_id is null and pot = 'needs'
       and deleted_at is null and spent_on >= since;
    update public.incomes set household_id = home
     where user_id = member.user_id and household_id is null and pot = 'needs'
       and deleted_at is null and received_on >= since;
    update public.bills set household_id = home
     where user_id = member.user_id and household_id is null and active;
  end loop;

  select g.id into goal from public.goals g
   where g.user_id in (host, joiner) and g.archived_at is null
   order by g.user_id = host desc, g.created_at desc limit 1;
  if goal is null then
    return;
  end if;
  update public.goals set household_id = home where id = goal;
  for other in
    select g.id from public.goals g
     where g.user_id in (host, joiner) and g.archived_at is null and g.id <> goal
  loop
    update public.savings_moves set goal_id = goal where goal_id = other;
    update public.goals set archived_at = now() where id = other;
  end loop;
end $$;

/* Leave: every row goes back to its author; the goal stays with its owner and
   each other member gets a copy holding their own moves; the household goes
   (plan D6). Also run by delete_my_account. */
create or replace function public.couple_leave_for(me uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  home uuid;
  goal record;
  mate uuid;
  copy uuid;
begin
  select m.household_id into home from public.household_members m where m.user_id = me;
  if home is null then
    return;
  end if;
  perform 1 from public.households h where h.id = home for update;
  perform set_config('stouchi.couple_rpc', 'on', true);
  update public.expenses set household_id = null where household_id = home;
  update public.incomes set household_id = null where household_id = home;
  update public.bills set household_id = null where household_id = home;
  for goal in
    select g.id, g.user_id, g.name, g.icon, g.target_mil, g.archived_at
      from public.goals g where g.household_id = home
  loop
    for mate in
      select m.user_id from public.household_members m
       where m.household_id = home and m.user_id <> goal.user_id
    loop
      insert into public.goals (user_id, name, icon, target_mil, archived_at)
        values (mate, goal.name, goal.icon, goal.target_mil, goal.archived_at)
        returning id into copy;
      update public.savings_moves set goal_id = copy where goal_id = goal.id and user_id = mate;
    end loop;
    update public.goals set household_id = null where id = goal.id;
  end loop;
  delete from public.households where id = home;
  perform set_config('stouchi.couple_rpc', 'off', true);
end $$;

/* A partner request's change: {"kind": "delete"} or
   {"kind": "edit", "fields": {…}} with only the fields Aam Salah may change. */
create or replace function public.couple_change_ok(c jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c -> 'kind') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(c) x where x not in ('kind', 'fields')) then
    return false;
  end if;
  if c ->> 'kind' = 'delete' then
    return not c ? 'fields';
  end if;
  if c ->> 'kind' <> 'edit' or jsonb_typeof(c -> 'fields') is distinct from 'object'
     or c -> 'fields' = '{}'::jsonb then
    return false;
  end if;
  for k, v in select * from jsonb_each(c -> 'fields') loop
    if k = 'amount_mil' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric not between 1 and 1000000000 then
        return false;
      end if;
    elsif k in ('category', 'pot', 'label', 'spent_on') then
      if jsonb_typeof(v) <> 'string' then
        return false;
      end if;
      if (k = 'category' and v #>> '{}' !~ '^[a-z_]{2,20}$')
         or (k = 'pot' and v #>> '{}' not in ('needs', 'wants'))
         or (k = 'label' and char_length(v #>> '{}') > 60)
         or (k = 'spent_on' and (v #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$'
                                 or to_char((v #>> '{}')::date, 'YYYY-MM-DD') <> v #>> '{}')) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;  -- e.g. a date that doesn't exist
end $$;

/* ── the client's functions ──────────────────────────────── */

create or replace function public.couple_state(p_on date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return public.couple_state_for(auth.uid(), p_on);
end $$;

create or replace function public.couple_invite()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  home uuid;
  c text;
  tries int := 0;
  expires timestamptz := now() + interval '48 hours';
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select m.household_id into home from public.household_members m where m.user_id = me;
  if home is not null then
    if (select count(*) from public.household_members m where m.household_id = home) >= 2 then
      return jsonb_build_object('error', 'ALREADY_PAIRED');
    end if;
  else
    /* households.invite_code is the legacy app's code: give it a value its
       join_household (6 letters or digits) can never match. */
    insert into public.households (invite_code) values (gen_random_uuid()::text) returning id into home;
    insert into public.household_members (household_id, user_id) values (home, me);
  end if;
  delete from public.household_invites i where i.household_id = home;
  loop
    tries := tries + 1;
    c := public.hh_gen_invite_code();
    exit when not exists (select 1 from public.household_invites i where i.code = c);
    if tries > 10 then
      raise exception 'CODE_GENERATION_FAILED';
    end if;
  end loop;
  insert into public.household_invites (code, household_id, created_by, expires_at)
    values (c, home, me, expires);
  return jsonb_build_object('code', 'STC-' || c, 'expires_at', expires);
end $$;

create or replace function public.couple_cancel()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  home uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select m.household_id into home from public.household_members m where m.user_id = me;
  if home is not null
     and (select count(*) from public.household_members m where m.household_id = home) = 1 then
    perform public.couple_leave_for(me);
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.couple_join(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  mine uuid;
  home uuid;
  host uuid;
  expires timestamptz;
  used timestamptz;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if length(c) = 9 and left(c, 3) = 'STC' then
    c := substr(c, 4);
  end if;
  if (select count(*) from public.household_join_attempts a
       where a.user_id = me and a.attempted_at > now() - interval '1 minute') >= 5 then
    return jsonb_build_object('error', 'TOO_MANY_TRIES');
  end if;
  select m.household_id into mine from public.household_members m where m.user_id = me;
  if mine is not null
     and (select count(*) from public.household_members m where m.household_id = mine) >= 2 then
    return jsonb_build_object('error', 'ALREADY_PAIRED');
  end if;
  if length(c) <> 6 then
    return jsonb_build_object('error', 'CODE_INVALID');
  end if;
  /* Locking the invite serialises two people redeeming it at once. */
  select i.household_id, i.created_by, i.expires_at, i.used_at into home, host, expires, used
    from public.household_invites i where i.code = c for update;
  if home is null then
    insert into public.household_join_attempts (user_id) values (me);
    return jsonb_build_object('error', 'CODE_INVALID');
  end if;
  if home = mine or host = me then
    return jsonb_build_object('error', 'OWN_CODE');
  end if;
  if used is not null or expires <= now() then
    insert into public.household_join_attempts (user_id) values (me);
    return jsonb_build_object('error', 'CODE_EXPIRED');
  end if;
  perform 1 from public.households h where h.id = home for update;
  if (select count(*) from public.household_members m where m.household_id = home) >= 2 then
    insert into public.household_join_attempts (user_id) values (me);
    return jsonb_build_object('error', 'HOUSEHOLD_FULL');
  end if;
  if mine is not null then
    perform public.couple_leave_for(me);  -- my own pending household
  end if;
  perform set_config('stouchi.couple_rpc', 'on', true);
  insert into public.household_members (household_id, user_id) values (home, me);
  update public.household_invites set used_at = now() where code = c;
  perform public.couple_tag(home, host, me);
  perform set_config('stouchi.couple_rpc', 'off', true);
  return '{}'::jsonb;
end $$;

create or replace function public.couple_leave()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.couple_leave_for(auth.uid());
  return '{}'::jsonb;
end $$;

/* Aam Salah's proposal on a partner's shared expense (plan D7): an in-app
   notification for its author, with no text (the app renders it). */
create or replace function public.couple_request(p_expense uuid, p_change jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  home uuid;
  author uuid;
  day date := (now() at time zone 'Africa/Tunis')::date;
  key text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select m.household_id into home from public.household_members m where m.user_id = me;
  select e.user_id into author from public.expenses e
   where e.id = p_expense and e.household_id = home and e.deleted_at is null and e.user_id <> me
     and exists (select 1 from public.household_members m where m.household_id = home and m.user_id = e.user_id);
  if home is null or author is null or not public.couple_change_ok(p_change) then
    return jsonb_build_object('error', 'REQUEST_INVALID');
  end if;
  key := 'partner:' || p_expense || ':' || (p_change ->> 'kind') || ':' || day;
  if exists (select 1 from public.notifications n where n.user_id = author and n.dedupe_key = key) then
    return '{}'::jsonb;
  end if;
  if (select count(*) from public.notifications n
       where n.trigger = 'partner_request' and n.action ->> 'from' = me::text
         and n.created_at >= (day::timestamp at time zone 'Africa/Tunis')) >= 10 then
    return jsonb_build_object('error', 'TOO_MANY_REQUESTS');
  end if;
  insert into public.notifications (user_id, trigger, dedupe_key, title, body, action)
    values (author, 'partner_request', key, '', '',
            jsonb_build_object('kind', 'partner_request', 'ref', p_expense, 'from', me, 'change', p_change));
  return '{}'::jsonb;
end $$;

/* Account deletion leaves the household first, so a deleted partner never
   takes the survivor's goal, moves or bills with them (plan D6). */
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
  update public.household_shared_data set updated_by = null where updated_by = me;
  delete from public.household_join_attempts where user_id = me;
  delete from auth.users where id = me;
end;
$$;

/* ── grants ──────────────────────────────────────────────── */

revoke all on function public.keep_household_id() from public, anon, authenticated;
revoke all on function public.goal_household() from public, anon, authenticated;
revoke all on function public.couple_period_start(date, smallint) from public, anon, authenticated;
revoke all on function public.couple_needs_mil(uuid, date) from public, anon, authenticated;
revoke all on function public.couple_state_for(uuid, date) from public, anon, authenticated;
revoke all on function public.couple_tag(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.couple_leave_for(uuid) from public, anon, authenticated;
revoke all on function public.couple_change_ok(jsonb) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['couple_state(date)', 'couple_invite()', 'couple_cancel()', 'couple_join(text)',
                           'couple_leave()', 'couple_request(uuid, jsonb)', 'delete_my_account()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
