/* Stouchi redesign, Phase 4 — the notify-run cron secret lives only in Vault.
 *
 * The database makes the secret itself (see supabase/sql/notify-schedule.sql:
 * vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), …)), so
 * no person or tool ever copies it. pg_cron sends it from Vault, and the Edge
 * Function reads it back through this function with the service key, which
 * the function already holds. anon and authenticated cannot execute it.
 *
 * plpgsql, not sql: the body is checked when it runs, so the PGlite test
 * harness (which has no vault schema) can still apply every migration. */

create or replace function public.notify_cron_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret' limit 1);
end;
$$;

revoke all on function public.notify_cron_secret() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notify_cron_secret() to service_role;
  end if;
end $$;
