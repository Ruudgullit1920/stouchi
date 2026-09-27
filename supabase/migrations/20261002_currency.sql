/* Currency choice (docs/superpowers/specs/2026-09-27-currency-design.md §4).
 *
 * ADDITIVE ONLY. A display currency per profile, one per household: amounts are
 * never converted and stay integer thousandths of the unit.
 *
 * - profiles.currency: the nine codes of src/shared/currencies.ts, TND by
 *   default, so existing users and the backfill need nothing. This check is the
 *   only SQL list of codes: set_currency relies on it.
 * - set_currency(code): mine, and my partner's when I'm in a household.
 * - couple_join: unchanged but for one statement — the joiner takes the host's
 *   currency — and it answers {"currency": <code>} when that changed it.
 */

alter table public.profiles add column if not exists currency text not null default 'TND';
alter table public.profiles drop constraint if exists profiles_currency_known;
alter table public.profiles add constraint profiles_currency_known check (
  currency in ('TND', 'EUR', 'USD', 'GBP', 'CAD', 'CHF', 'MAD', 'DZD', 'LYD')
);

create or replace function public.set_currency(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  home uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_code is null then
    return jsonb_build_object('error', 'CURRENCY_INVALID');
  end if;
  select m.household_id into home from public.household_members m where m.user_id = me;
  begin
    update public.profiles p set currency = p_code
     where p.user_id = me
        or (home is not null
            and p.user_id in (select m.user_id from public.household_members m where m.household_id = home));
  exception when check_violation then
    return jsonb_build_object('error', 'CURRENCY_INVALID');
  end;
  return '{}'::jsonb;
end $$;

/* Copied from 20260929_phase6_couple.sql; only the host-currency statement is new. */
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
  host_currency text;
  changed int;
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
  /* One currency per household: the joiner takes the host's. */
  select p.currency into host_currency from public.profiles p where p.user_id = host;
  update public.profiles p set currency = host_currency
   where p.user_id = me and host_currency is not null and p.currency <> host_currency;
  get diagnostics changed = row_count;
  if changed > 0 then
    return jsonb_build_object('currency', host_currency);
  end if;
  return '{}'::jsonb;
end $$;

do $$
declare f text;
begin
  foreach f in array array['set_currency(text)', 'couple_join(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
