/* Legacy join_household: its rate limit never held. A wrong code recorded an
 * attempt, then raised CODE_INVALID, and the raise rolled the attempt back, so
 * a guesser could try codes without end.
 *
 * Expected refusals now come back as {"error": "<CODE>"} (as the couple_*
 * functions do), so the attempt row commits. app.js turns that answer into the
 * same error it showed before; deploy it with this migration.
 * Only NOT_AUTHENTICATED still raises. Same signature and grants.
 */

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
  if length(code) <> 6 then return jsonb_build_object('error', 'CODE_INVALID'); end if;

  if (select count(*) from public.household_join_attempts a
      where a.user_id = uid and a.attempted_at > now() - interval '1 minute') >= 5 then
    return jsonb_build_object('error', 'TOO_MANY_ATTEMPTS');
  end if;

  select h.id into hid from public.households h where h.invite_code = code;
  if hid is null then
    insert into public.household_join_attempts (user_id) values (uid);
    return jsonb_build_object('error', 'CODE_INVALID');
  end if;

  if exists (select 1 from public.household_members m
             where m.user_id = uid and m.household_id = hid) then
    return public.hh_state_for(uid);       /* already in — nothing to do */
  end if;
  if exists (select 1 from public.household_members m where m.user_id = uid) then
    return jsonb_build_object('error', 'ALREADY_IN_HOUSEHOLD');
  end if;

  /* Lock the shared row first: it serialises two people redeeming the same
     code at once, so the 2-member cap cannot be raced past. */
  select sd.data into cur from public.household_shared_data sd
    where sd.household_id = hid for update;

  select count(*) into n_members from public.household_members m where m.household_id = hid;
  if n_members >= 2 then
    insert into public.household_join_attempts (user_id) values (uid);
    return jsonb_build_object('error', 'HOUSEHOLD_FULL');
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
