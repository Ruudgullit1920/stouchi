/* Stouchi redesign — the insert-only tables get a server-set created_at.
 *
 * ADDITIVE ONLY: one function and two triggers; no table, row or policy changes.
 *
 * savings_moves and bill_payments have no updated_at, so the app's pull
 * cursor for them is created_at. Until now a client could send its own
 * created_at: a row written offline at 09:00 and pushed at 18:00 kept 09:00,
 * so another device whose cursor was already past 09:00 never pulled it.
 * The server now stamps created_at on insert, as touch_updated_at already
 * does for the other tables. */

create or replace function public.stamp_created_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end $$;
revoke execute on function public.stamp_created_at() from public, anon;

create or replace trigger savings_moves_stamp before insert on public.savings_moves
  for each row execute function public.stamp_created_at();
create or replace trigger bill_payments_stamp before insert on public.bill_payments
  for each row execute function public.stamp_created_at();
