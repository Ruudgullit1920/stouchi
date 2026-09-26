/* Stouchi redesign — normalised data model (spec §7).
 *
 * ADDITIVE ONLY. The new tables live alongside budget_data and
 * household_shared_data; nothing here reads, changes or drops those, so the
 * current app keeps running untouched until cut-over (spec §9).
 *
 * Conventions
 *   - Money: bigint millimes (1 TND = 1 000); 0 < amount ≤ 1 000 000 TND.
 *   - Dates: `date`, local to Africa/Tunis. Instants: `timestamptz`.
 *   - RLS enabled AND forced on every table, one policy per operation. A
 *     missing policy is a decision; it is stated next to each table.
 *   - user_id defaults to auth.uid() and never changes (keep_user_id).
 *   - updated_at is set by trigger: sync is last-write-wins on it (§8.3).
 *   - Limits match src/shared/schemas.ts; tests/db/rls.test.ts pins expenses'
 *     label length, amount_mil bounds and pot enum against those same limits,
 *     plus every check constraint exercised by name below (§9's fixtures).
 */

/* ── helpers ─────────────────────────────────────────────── */

/* Runs before insert too (not just update, despite the name): created_at is
   pinned on insert so a client-supplied value can't backdate a row, and kept
   unchanged on update so it can't be rewritten later either. */
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

/* `with check` only sees the new row, so without this a household member could
   hand a shared row to someone else by rewriting user_id. */
create or replace function public.keep_user_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot change' using errcode = '42501';
  end if;
  return new;
end $$;

/* The caller's own row, or a row of the caller's household. */
create or replace function public.visible_to_me(row_owner uuid, row_household uuid)
returns boolean language sql stable set search_path = public as $$
  select row_owner = auth.uid()
      or (row_household is not null and public.is_household_member(row_household))
$$;

/* Postgres grants EXECUTE to PUBLIC by default, and the Supabase-mimicking
   test harness additionally grants it straight to anon/authenticated (see
   tests/db/harness.ts) — both must be clawed back explicitly, the same as the
   table grants below. touch_updated_at/keep_user_id only ever run as trigger
   callbacks (no role needs to call them directly); visible_to_me runs inside
   policy expressions as the querying role, so authenticated alone gets it
   back. */
revoke execute on function public.touch_updated_at() from public, anon;
revoke execute on function public.keep_user_id() from public, anon;
revoke execute on function public.visible_to_me(uuid, uuid) from public, anon;
grant execute on function public.visible_to_me(uuid, uuid) to authenticated;

/* ── tables ──────────────────────────────────────────────── */

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 40),
  salary_mil bigint not null default 0 check (salary_mil between 0 and 1000000000),
  payday smallint not null default 1 check (payday between 0 and 28),
  split_needs smallint not null default 50 check (split_needs between 0 and 100),
  split_wants smallint not null default 30 check (split_wants between 0 and 100),
  split_savings smallint not null default 20 check (split_savings between 0 and 100),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_split_is_100 check (split_needs + split_wants + split_savings = 100)
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  label text not null check (char_length(label) between 1 and 60),
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')),
  day smallint not null default 1 check (day between 1 and 31),
  /* first period the bill is due in: anchors bimonthly/quarterly/yearly bills.
     current_date is the session time zone (UTC on Supabase) — pin to Tunis. */
  starts_on date not null default (now() at time zone 'Africa/Tunis')::date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),  -- normally client-generated: idempotent upserts (§8.3)
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  category text not null check (category ~ '^[a-z_]{2,20}$'),
  pot text not null check (pot in ('needs', 'wants')),
  label text not null default '' check (char_length(label) <= 60),
  spent_on date not null,
  source text not null default 'manual' check (source in ('manual', 'chat', 'bill')),
  bill_id uuid references public.bills(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists expenses_user_spent on public.expenses (user_id, spent_on desc) where deleted_at is null;
create index if not exists expenses_household_spent on public.expenses (household_id, spent_on desc)
  where household_id is not null and deleted_at is null;

create table if not exists public.bill_payments (
  bill_id uuid not null references public.bills(id) on delete cascade,
  period_start date not null,
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (bill_id, period_start)
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction text not null check (direction in ('i_owe', 'owed_to_me')),
  person text not null check (char_length(person) between 1 and 40),
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  due_on date,
  note text not null default '' check (char_length(note) <= 120),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists debts_open on public.debts (user_id) where settled_at is null;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  icon text not null check (icon ~ '^[a-z0-9-]{1,30}$'),
  target_mil bigint not null check (target_mil > 0 and target_mil <= 1000000000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.savings_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount_mil bigint not null check (amount_mil <> 0 and abs(amount_mil) <= 1000000000),
  kind text not null check (kind in ('payday', 'deposit', 'withdraw')),
  from_pot text check (from_pot in ('needs', 'wants')),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  constraint savings_moves_sign check ((kind = 'withdraw') = (amount_mil < 0))
);
create index if not exists savings_moves_goal on public.savings_moves (goal_id, occurred_on desc);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120),
  remind_at timestamptz not null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_due on public.reminders (user_id, remind_at) where done_at is null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger text not null check (trigger ~ '^[a-z_]{2,40}$'),
  dedupe_key text not null check (char_length(dedupe_key) <= 120),
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 300),
  action jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_dedupe unique (user_id, dedupe_key)
);
create index if not exists notifications_recent on public.notifications (user_id, created_at desc);

create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

/* Assistant telemetry. NO message text, by design (spec §8.5). */
create table if not exists public.ai_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model text not null check (model ~ '^[a-z0-9._:/-]{1,80}$'),
  latency_ms integer not null check (latency_ms >= 0),
  outcome text not null check (outcome in ('ok', 'invalid_json', 'validation_drop', 'fallback', 'error')),
  /* action kinds only — never free text, so message content can't be smuggled in here. */
  action_types text[] not null default '{}' check (
    cardinality(action_types) <= 10
    and array_to_string(action_types, ',') ~ '^([a-z_]{2,30}(,[a-z_]{2,30})*)?$'
  ),
  created_at timestamptz not null default now()
);

/* ── triggers, RLS on ────────────────────────────────────── */

do $$
declare t text;
begin
  foreach t in array array['profiles', 'bills', 'expenses', 'debts', 'goals', 'reminders'] loop
    execute format('create or replace trigger %1$s_touch before insert or update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['profiles', 'bills', 'expenses', 'debts', 'goals', 'savings_moves',
                           'reminders', 'notifications', 'push_subscriptions', 'ai_events'] loop
    execute format('create or replace trigger %1$s_keep_user before update on public.%1$I
                    for each row execute function public.keep_user_id()', t);
  end loop;
  foreach t in array array['profiles', 'bills', 'expenses', 'bill_payments', 'debts', 'goals', 'savings_moves',
                           'reminders', 'notifications', 'push_subscriptions', 'ai_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

/* Don't rely on Supabase's default privileges (the harness's
   `alter default privileges … grant all on tables to anon, authenticated`
   mimics them): revoke everything from both roles first, TRUNCATE/REFERENCES/
   TRIGGER included — those are table-level ACLs, not governed by RLS policies
   at all, so either role could otherwise wipe a table or add a foreign
   key/trigger no policy would ever catch. Then grant `authenticated` only the
   operations its policies actually use, table by table; anon keeps nothing,
   not even a leftover default grant. */
do $$
declare t text;
begin
  foreach t in array array['profiles', 'bills', 'expenses', 'bill_payments', 'debts', 'goals', 'savings_moves',
                           'reminders', 'notifications', 'push_subscriptions', 'ai_events'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

do $$
declare spec record;
begin
  for spec in select * from (values
    ('profiles', 'select, insert, update'),
    ('bills', 'select, insert, update'),
    ('expenses', 'select, insert, update'),
    ('debts', 'select, insert, update'),
    ('goals', 'select, insert, update'),
    ('reminders', 'select, insert, update'),
    ('bill_payments', 'select, insert, delete'),
    ('savings_moves', 'select, insert, delete'),
    ('push_subscriptions', 'select, insert, delete'),
    ('ai_events', 'select, insert'),
    /* notifications: table-level select only — update is column-scoped
       (read_at) further down, next to its policies, and there is no insert
       or delete grant: it's written by the notification cron (service role,
       which bypasses grants) and never deleted by a user. */
    ('notifications', 'select')
  ) as g(table_name, privs) loop
    execute format('grant %s on public.%I to authenticated', spec.privs, spec.table_name);
  end loop;
end $$;

/* households / household_members come from 20260809 with RLS enabled but not
   forced. Their membership test (is_household_member) is security definer and
   reads household_members as the table owner. Forcing RLS on an owner that
   cannot bypass it would send that read through the policy that calls the same
   function — infinite recursion, and couple sharing breaks in production. So
   force only when the owner bypasses RLS anyway (Supabase's postgres does);
   otherwise say so and leave it for Phase 6. */
do $$
declare t text; can_bypass boolean;
begin
  foreach t in array array['households', 'household_members'] loop
    select r.rolsuper or r.rolbypassrls into can_bypass
      from pg_class c join pg_roles r on r.oid = c.relowner
     where c.oid = format('public.%I', t)::regclass;
    if can_bypass then
      execute format('alter table public.%I force row level security', t);
    else
      raise warning '% left unforced: its owner cannot bypass RLS (see comment)', t;
    end if;
  end loop;
end $$;

/* ── policies ────────────────────────────────────────────── */

/* profiles — no delete: account deletion is a server job (Phase 5). */
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "profiles: create own" on public.profiles;
create policy "profiles: create own" on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "profiles: edit own" on public.profiles;
create policy "profiles: edit own" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* expenses — no delete: soft delete (deleted_at); a 90-day purge job removes rows. */
drop policy if exists "expenses: read own or household" on public.expenses;
create policy "expenses: read own or household" on public.expenses for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "expenses: create own" on public.expenses;
create policy "expenses: create own" on public.expenses for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "expenses: edit own or household" on public.expenses;
create policy "expenses: edit own or household" on public.expenses for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* bills — no delete: `active = false` retires a bill and keeps its history. */
drop policy if exists "bills: read own or household" on public.bills;
create policy "bills: read own or household" on public.bills for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "bills: create own" on public.bills;
create policy "bills: create own" on public.bills for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "bills: edit own or household" on public.bills;
create policy "bills: edit own or household" on public.bills for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* bill_payments — visible and writable through the bill (bills' RLS applies inside
   the subquery). Delete = undo "Marquer payée". No update: recorded or undone. */
drop policy if exists "bill_payments: read" on public.bill_payments;
create policy "bill_payments: read" on public.bill_payments for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id));
drop policy if exists "bill_payments: record" on public.bill_payments;
create policy "bill_payments: record" on public.bill_payments for insert to authenticated
  with check (exists (select 1 from public.bills b where b.id = bill_payments.bill_id)
              and (bill_payments.expense_id is null
                   or exists (select 1 from public.expenses e where e.id = bill_payments.expense_id)));
drop policy if exists "bill_payments: undo" on public.bill_payments;
create policy "bill_payments: undo" on public.bill_payments for delete to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id));

/* debts, goals, reminders — own rows only; no delete (settled_at closes a debt,
   archived_at closes a goal, done_at closes a reminder). */
drop policy if exists "debts: read own" on public.debts;
create policy "debts: read own" on public.debts for select to authenticated using (user_id = auth.uid());
drop policy if exists "debts: create own" on public.debts;
create policy "debts: create own" on public.debts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "debts: edit own" on public.debts;
create policy "debts: edit own" on public.debts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "goals: read own" on public.goals;
create policy "goals: read own" on public.goals for select to authenticated using (user_id = auth.uid());
drop policy if exists "goals: create own" on public.goals;
create policy "goals: create own" on public.goals for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "goals: edit own" on public.goals;
create policy "goals: edit own" on public.goals for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reminders: read own" on public.reminders;
create policy "reminders: read own" on public.reminders for select to authenticated using (user_id = auth.uid());
drop policy if exists "reminders: create own" on public.reminders;
create policy "reminders: create own" on public.reminders for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reminders: edit own" on public.reminders;
create policy "reminders: edit own" on public.reminders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* savings_moves — into your own goals only; delete = undo; no update. */
drop policy if exists "savings_moves: read own" on public.savings_moves;
create policy "savings_moves: read own" on public.savings_moves for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "savings_moves: create own" on public.savings_moves;
create policy "savings_moves: create own" on public.savings_moves for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.goals g where g.id = savings_moves.goal_id and g.user_id = auth.uid()));
drop policy if exists "savings_moves: undo own" on public.savings_moves;
create policy "savings_moves: undo own" on public.savings_moves for delete to authenticated
  using (user_id = auth.uid());

/* notifications — written by the notification cron (service role) only. Users
   read theirs and set read_at; the column grant below stops them editing text. */
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications: mark read" on public.notifications;
create policy "notifications: mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

/* push_subscriptions — subscribe / unsubscribe; no update. */
drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push: subscribe" on public.push_subscriptions;
create policy "push: subscribe" on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "push: unsubscribe" on public.push_subscriptions;
create policy "push: unsubscribe" on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

/* ai_events — written by /api/chat with the caller's JWT; append-only. */
drop policy if exists "ai_events: read own" on public.ai_events;
create policy "ai_events: read own" on public.ai_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "ai_events: log own" on public.ai_events;
create policy "ai_events: log own" on public.ai_events for insert to authenticated with check (user_id = auth.uid());

/* ── ship check ──────────────────────────────────────────── */

/* Lets scripts/check-supabase.ts confirm RLS is on and forced, signed in as a
   normal user. Exposes table names and two flags, nothing else. */
create or replace function public.rls_report()
returns table (table_name text, rls_enabled boolean, rls_forced boolean)
language sql stable set search_path = public as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1
$$;
revoke all on function public.rls_report() from public, anon;
grant execute on function public.rls_report() to authenticated;
