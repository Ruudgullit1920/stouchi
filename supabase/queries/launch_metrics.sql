-- The launch's success criteria, 30 days after launch (spec §2): paste into
-- Supabase's SQL editor. Read-only. What the tables can't tell is listed with
-- where to look instead, so no metric is silently missing.
with onboarding as (
  select count(*) filter (where onboarded_at is not null)::float8 / nullif(count(*), 0) as v
  from public.profiles
),
weekly as (
  select count(*) filter (where n >= 3)::float8 / nullif(count(*), 0) as v
  from (
    select p.user_id, count(e.id) as n
    from public.profiles p
    left join public.expenses e
      on e.user_id = p.user_id and e.deleted_at is null and e.created_at > now() - interval '7 days'
    where p.onboarded_at is not null
    group by p.user_id
  ) per_user
),
chat as (
  select percentile_cont(0.95) within group (order by latency_ms) as v
  from public.ai_events
  where created_at > now() - interval '30 days'
)
select 1 as n, 'onboarding_completion' as metric, (select v from onboarding)::text as value, '>= 0.80' as target,
       'profiles onboarded / profiles created' as note
union all
select 2, 'weekly_active_loggers', (select v from weekly)::text, '>= 0.60',
       'onboarded users with 3+ expenses in the last 7 days'
union all
select 3, 'chat_p95_latency_ms', (select v from chat)::text, '<= 4000', 'ai_events, last 30 days'
union all
select 4, 'median_time_to_log', null, '<= 5 s', 'not measured: no timing event is recorded'
union all
select 5, 'crash_free_sessions', null, '>= 99.5 %', 'in Sentry (Releases > crash-free sessions)'
union all
select 6, 'expenses_lost', null, '0', 'not measurable here: check Sentry sync_failed and user reports'
order by n;
