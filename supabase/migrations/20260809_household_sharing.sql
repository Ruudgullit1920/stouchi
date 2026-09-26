/* Household sharing — "en couple" links two accounts so that the Besoins
 * envelope (charges & courses) and the shared objectif live in one row both
 * partners can read and write. Perso, épargne, revenus and personal charges
 * never leave public.budget_data, which this migration does not touch.
 *
 * Everything the client does goes through security-definer RPCs:
 *   - joining by code must not require SELECT on households (that would let
 *     anyone enumerate invite codes),
 *   - writes must be a locked read-modify-write, so two partners saving in the
 *     same second merge instead of overwriting each other.
 */

/* ── tables ───────────────────────────────────────────────── */

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  invite_code text not null unique
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  display_name text not null default '',
  primary key (household_id, user_id)
);

/* One account belongs to at most one household — the app has no UI for more,
   and the merge RPC resolves the caller's household without an argument. */
create unique index if not exists household_members_user_uniq
  on public.household_members(user_id);

create table if not exists public.household_shared_data (
  household_id uuid primary key references public.households(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

/* Invite codes are short and therefore guessable by design; this is what keeps
   guessing expensive. Written only by the definer functions below. */
create table if not exists public.household_join_attempts (
  id bigserial primary key,
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create index if not exists household_join_attempts_user_time
  on public.household_join_attempts(user_id, attempted_at desc);

/* ── membership test ──────────────────────────────────────── */

/* security definer: a policy on household_members that reads household_members
   recurses forever. Running as owner sidesteps RLS and terminates. */
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

/* ── RLS ──────────────────────────────────────────────────── */

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_shared_data enable row level security;
alter table public.household_join_attempts enable row level security;
/* household_join_attempts intentionally has no policy: definer functions only. */

drop policy if exists "members read household" on public.households;
create policy "members read household" on public.households
  for select to authenticated
  using (public.is_household_member(id));

drop policy if exists "members read members" on public.household_members;
create policy "members read members" on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "members read shared data" on public.household_shared_data;
create policy "members read shared data" on public.household_shared_data
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "members insert shared data" on public.household_shared_data;
create policy "members insert shared data" on public.household_shared_data
  for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists "members write shared data" on public.household_shared_data;
create policy "members write shared data" on public.household_shared_data
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

/* No delete policy anywhere: the client never removes a household, a member
   row or a shared row. */

/* ── invite codes ─────────────────────────────────────────── */

/* 6 chars from a 31-symbol alphabet with no 0/O/1/I/L, so a code can be read
   out loud without ambiguity. ~8.9e8 combinations. */
create or replace function public.hh_gen_invite_code()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
           (get_byte(b, i) % 31) + 1, 1), '')
  from (select extensions.gen_random_bytes(6) as b) s,
       generate_series(0, 5) as i;
$$;

/* ── merge ────────────────────────────────────────────────── */

/* Item-level last-write-wins.
 *   expenses — union by id, later updatedAt wins, deletes travel as tombstones
 *              ({id, deleted:true, updatedAt}) so a stale client cannot
 *              resurrect a removed row. Tombstones are swept after 90 days.
 *   goal     — per field {v, t}; later t wins. goal_fill_only fills only the
 *              fields the household has never set, which is what a second
 *              account joining with its own history needs: its expenses merge
 *              in, but its objectif does not silently overwrite the couple's.
 * updatedAt is an ISO-8601 UTC string, so text ordering is chronological.
 */
create or replace function public.hh_merge_data(cur jsonb, patch jsonb, goal_fill_only boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  cutoff text := to_char((now() at time zone 'utc') - interval '90 days',
                         'YYYY-MM-DD"T"HH24:MI:SS');
  merged_exp jsonb;
  merged_goal jsonb;
begin
  if jsonb_typeof(coalesce(patch, 'null'::jsonb)) <> 'object' then
    patch := '{}'::jsonb;
  end if;
  if jsonb_typeof(coalesce(cur, 'null'::jsonb)) <> 'object' then
    cur := '{}'::jsonb;
  end if;

  if jsonb_typeof(patch->'expenses') = 'array'
     and jsonb_array_length(patch->'expenses') > 5000 then
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;

  select coalesce(jsonb_agg(d.e order by d.e->>'id'), '[]'::jsonb)
    into merged_exp
  from (
    select distinct on (u.e->>'id') u.e
    from (
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(patch->'expenses') = 'array'
             then patch->'expenses' else '[]'::jsonb end)
      union all
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(cur->'expenses') = 'array'
             then cur->'expenses' else '[]'::jsonb end)
    ) u
    where jsonb_typeof(u.e) = 'object'
      and coalesce(u.e->>'id', '') <> ''
      /* Perso / épargne can never leak into the shared row, whatever a client sends. */
      and coalesce(u.e->>'envelope', 'besoins') = 'besoins'
    order by u.e->>'id', coalesce(u.e->>'updatedAt', '') desc
  ) d
  where not (d.e->'deleted' = 'true'::jsonb
             and coalesce(d.e->>'updatedAt', '') < cutoff);

  select coalesce(jsonb_object_agg(z.k, z.val), '{}'::jsonb)
    into merged_goal
  from (
    select ks.k,
      case
        when goal_fill_only then coalesce(cur->'goal'->ks.k, patch->'goal'->ks.k)
        when cur->'goal'->ks.k is null then patch->'goal'->ks.k
        when patch->'goal'->ks.k is null then cur->'goal'->ks.k
        when coalesce(patch->'goal'->ks.k->>'t', '')
             > coalesce(cur->'goal'->ks.k->>'t', '') then patch->'goal'->ks.k
        else cur->'goal'->ks.k
      end as val
    from unnest(array['goal', 'saved', 'goalType', 'goalNote']) as ks(k)
  ) z
  where z.val is not null;

  return jsonb_build_object('expenses', merged_exp, 'goal', merged_goal);
end;
$$;

/* ── state read ───────────────────────────────────────────── */

/* One round trip on boot: household, both members and the shared payload.
   Returns null when the caller is not in a household. */
create or replace function public.hh_state_for(uid uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'household_id', h.id,
    'invite_code', h.invite_code,
    'created_at', h.created_at,
    'data', coalesce(sd.data, '{}'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m2.user_id,
        'display_name', m2.display_name,
        'joined_at', m2.joined_at,
        'is_me', m2.user_id = uid
      ) order by m2.joined_at)
      from public.household_members m2
      where m2.household_id = h.id
    ), '[]'::jsonb)
  )
  from public.household_members m
  join public.households h on h.id = m.household_id
  left join public.household_shared_data sd on sd.household_id = h.id
  where m.user_id = uid;
$$;

create or replace function public.get_household()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.hh_state_for(auth.uid());
$$;

/* ── create ───────────────────────────────────────────────── */

create or replace function public.create_household(p_display_name text, p_seed jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing jsonb;
  hid uuid;
  code text;
  tries int := 0;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  /* Idempotent: a double tap on "créer le lien" must not orphan a household. */
  existing := public.hh_state_for(uid);
  if existing is not null then return existing; end if;

  loop
    tries := tries + 1;
    code := public.hh_gen_invite_code();
    exit when not exists (select 1 from public.households h where h.invite_code = code);
    if tries > 10 then raise exception 'CODE_GENERATION_FAILED'; end if;
  end loop;

  insert into public.households (invite_code) values (code) returning id into hid;
  insert into public.household_members (household_id, user_id, display_name)
    values (hid, uid, coalesce(nullif(btrim(p_display_name), ''), ''));
  insert into public.household_shared_data (household_id, data, updated_by)
    values (hid, public.hh_merge_data('{}'::jsonb, p_seed, false), uid);

  return public.hh_state_for(uid);
end;
$$;

/* ── join ─────────────────────────────────────────────────── */

create or replace function public.join_household(p_code text, p_display_name text, p_seed jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  code text;
  hid uuid;
  n_members int;
  cur jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  /* Accept the code however it was typed or pasted. */
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(code) <> 6 then raise exception 'CODE_INVALID'; end if;

  if (select count(*) from public.household_join_attempts a
      where a.user_id = uid and a.attempted_at > now() - interval '1 minute') >= 5 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  select h.id into hid from public.households h where h.invite_code = code;
  if hid is null then
    insert into public.household_join_attempts (user_id) values (uid);
    raise exception 'CODE_INVALID';
  end if;

  if exists (select 1 from public.household_members m
             where m.user_id = uid and m.household_id = hid) then
    return public.hh_state_for(uid);       /* already in — nothing to do */
  end if;
  if exists (select 1 from public.household_members m where m.user_id = uid) then
    raise exception 'ALREADY_IN_HOUSEHOLD';
  end if;

  /* Lock the shared row first: it serialises two people redeeming the same
     code at once, so the 2-member cap cannot be raced past. */
  select sd.data into cur from public.household_shared_data sd
    where sd.household_id = hid for update;

  select count(*) into n_members from public.household_members m where m.household_id = hid;
  if n_members >= 2 then
    insert into public.household_join_attempts (user_id) values (uid);
    raise exception 'HOUSEHOLD_FULL';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
    values (hid, uid, coalesce(nullif(btrim(p_display_name), ''), ''));

  /* goal_fill_only: the joiner's besoins history merges in, their objectif
     only fills fields the household never set. */
  update public.household_shared_data sd
     set data = public.hh_merge_data(coalesce(cur, '{}'::jsonb), p_seed, true),
         updated_at = now(),
         updated_by = uid
   where sd.household_id = hid;

  return public.hh_state_for(uid);
end;
$$;

/* ── write ────────────────────────────────────────────────── */

create or replace function public.merge_household_data(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  cur jsonb;
  merged jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select m.household_id into hid from public.household_members m where m.user_id = uid;
  if hid is null then raise exception 'NOT_IN_HOUSEHOLD'; end if;

  select sd.data into cur from public.household_shared_data sd
    where sd.household_id = hid for update;

  merged := public.hh_merge_data(coalesce(cur, '{}'::jsonb), p_patch, false);

  update public.household_shared_data sd
     set data = merged, updated_at = now(), updated_by = uid
   where sd.household_id = hid;

  return merged;
end;
$$;

create or replace function public.set_household_display_name(p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.household_members m
     set display_name = coalesce(nullif(btrim(p_name), ''), '')
   where m.user_id = auth.uid();
$$;

/* ── grants ───────────────────────────────────────────────── */

/* Supabase grants EXECUTE on new public functions to anon/authenticated by
 * default, so each internal helper must be revoked from `authenticated` too —
 * hh_state_for() takes a caller-supplied uid, and left exposed it would hand
 * any signed-in account another household's data and invite code. */
revoke all on function public.hh_merge_data(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.hh_state_for(uuid) from public, anon, authenticated;
revoke all on function public.hh_gen_invite_code() from public, anon, authenticated;
revoke all on function public.get_household() from public, anon;
revoke all on function public.create_household(text, jsonb) from public, anon;
revoke all on function public.join_household(text, text, jsonb) from public, anon;
revoke all on function public.merge_household_data(jsonb) from public, anon;
revoke all on function public.set_household_display_name(text) from public, anon;
revoke all on function public.is_household_member(uuid) from public, anon;

grant execute on function public.get_household() to authenticated;
grant execute on function public.create_household(text, jsonb) to authenticated;
grant execute on function public.join_household(text, text, jsonb) to authenticated;
grant execute on function public.merge_household_data(jsonb) to authenticated;
grant execute on function public.set_household_display_name(text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;

/* ── realtime ─────────────────────────────────────────────── */

/* Lets the partner's screen update within a second instead of on next reload.
   Realtime re-checks RLS per subscriber, so only members receive the payload. */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'household_shared_data'
  ) then
    alter publication supabase_realtime add table public.household_shared_data;
  end if;
end;
$$;
