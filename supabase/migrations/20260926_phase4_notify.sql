/* Stouchi redesign, Phase 4 (notifications) — scheduler extensions, a shape
 * check on notifications.action, and an index for due reminders.
 *
 * ADDITIVE ONLY. Grants and policies from 20260923 are unchanged: users read
 * their own notifications and may only update read_at; rows are written by the
 * notify-run Edge Function (service role), scheduled by pg_cron + pg_net
 * (supabase/sql/notify-schedule.sql, run per project — its URL differs).
 *
 * - pg_cron / pg_net: created only where available, so the PGlite test harness
 *   (which has neither) still runs every migration.
 * - notifications.action: null, or an object whose "kind" is text. The full
 *   list of kinds lives in zod (src/shared/schemas.ts), so a new kind needs no
 *   migration.
 * - reminders_due: the run looks up reminders not done and not deleted. */

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

alter table public.notifications drop constraint if exists notifications_action_shape;
alter table public.notifications add constraint notifications_action_shape check (
  action is null
  or coalesce(jsonb_typeof(action) = 'object' and jsonb_typeof(action -> 'kind') = 'string', false)
);

create index if not exists reminders_due on public.reminders (remind_at)
  where done_at is null and deleted_at is null;
