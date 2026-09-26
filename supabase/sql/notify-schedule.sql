/* Schedules notify-run every 15 minutes (Phase 4). NOT a migration: the URL
 * differs per project, so run it by hand on each project, after deploying the
 * function and setting its secrets. Running it again replaces the job.
 *
 * Needs two Vault secrets on the same project, created once. The database
 * makes the cron secret itself, so nobody ever sees or copies it; notify-run
 * reads it back with public.notify_cron_secret() (migration 20260927):
 *
 *   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify-run', 'notify_url');
 *   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notify_secret');
 *
 * To rotate: vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
 * with the id from vault.secrets; the function picks it up within 5 minutes.
 * To stop: select cron.unschedule('notify-run');
 * To check: select * from cron.job_run_details order by start_time desc limit 10;
 *           select * from net._http_response order by created desc limit 10; */

select cron.schedule(
  'notify-run',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
