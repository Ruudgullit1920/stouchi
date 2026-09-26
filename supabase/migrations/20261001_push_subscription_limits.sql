/* push_subscriptions — bound what notify-run (service role) will call.
 *
 * notify-run POSTs to every endpoint a user registered, one at a time with a
 * 10 s timeout, and checks its time budget only between users. Before this, a
 * user could register any number of https endpoints on any host: a handful
 * that never answer held the whole run, so everyone after them missed their
 * notifications, and the service role sent blind POSTs wherever it was told.
 *
 * - endpoint: the browsers' push services only (Chrome/Edge-on-Android/Opera/
 *   Samsung → FCM, Firefox → Mozilla, Safari → Apple, Edge → WNS). `not valid`
 *   so an older row doesn't block the migration; every new write is checked.
 * - at most 5 per user: a new device evicts the oldest instead of failing, so
 *   subscribing always works. notify-run also reads at most 5 (load.ts). */

alter table public.push_subscriptions drop constraint if exists push_subscriptions_known_host;
alter table public.push_subscriptions add constraint push_subscriptions_known_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
) not valid;

/* Runs as the caller: RLS limits both the count and the delete to their rows.
   ponytail: two inserts racing can leave 6 rows; load.ts's limit(5) still bounds the run. */
create or replace function public.push_subscriptions_cap()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.push_subscriptions s
              where s.user_id = new.user_id and s.endpoint = new.endpoint) then
    return new;  -- a re-subscribe: the upsert ignores it
  end if;
  delete from public.push_subscriptions s
   where s.user_id = new.user_id
     and s.endpoint in (select o.endpoint from public.push_subscriptions o
                         where o.user_id = new.user_id
                         order by o.created_at desc, o.endpoint offset 4);
  return new;
end $$;

create or replace trigger push_subscriptions_cap before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_cap();

revoke all on function public.push_subscriptions_cap() from public, anon, authenticated;
