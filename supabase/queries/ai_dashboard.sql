-- Aam Salah over the last 7 days (spec §8.7): paste into Supabase's SQL editor.
-- Read-only. ai_events holds no message text, only the model, latency and outcome.
-- Alert thresholds live in Sentry (error rate > 5 % over 15 minutes).
select
  count(*)::int as turns,
  round(avg(latency_ms))::int as avg_latency_ms,
  percentile_cont(0.5) within group (order by latency_ms) as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms,
  (count(*) filter (where outcome = 'fallback'))::float8 / nullif(count(*), 0) as fallback_rate,
  (count(*) filter (where outcome = 'validation_drop'))::float8 / nullif(count(*), 0) as validation_drop_rate,
  (count(*) filter (where outcome = 'invalid_json'))::float8 / nullif(count(*), 0) as invalid_json_rate,
  (count(*) filter (where outcome = 'error'))::float8 / nullif(count(*), 0) as error_rate
from public.ai_events
where created_at > now() - interval '7 days';
