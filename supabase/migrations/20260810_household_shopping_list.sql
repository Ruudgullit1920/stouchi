/* Liste de courses partagée ("Quoi acheter").
 *
 * Elle vit dans la même ligne household_shared_data que les besoins et
 * l'objectif, et suit exactement la même règle de fusion : union par id, le
 * updatedAt le plus récent gagne, les suppressions voyagent en pierres
 * tombales balayées après 90 jours.
 *
 * hh_merge_data() reconstruisait son résultat avec jsonb_build_object(...),
 * donc toute clé inconnue était silencieusement perdue — d'où la reprise
 * complète de la fonction plutôt qu'un simple ajout côté client.
 */
create or replace function public.hh_merge_data(cur jsonb, patch jsonb, goal_fill_only boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  cutoff text := to_char((now() at time zone 'utc') - interval '90 days',
                         'YYYY-MM-DD"T"HH24:MI:SS');
  merged_exp jsonb;
  merged_shop jsonb;
  merged_goal jsonb;
begin
  if jsonb_typeof(coalesce(patch, 'null'::jsonb)) <> 'object' then
    patch := '{}'::jsonb;
  end if;
  if jsonb_typeof(coalesce(cur, 'null'::jsonb)) <> 'object' then
    cur := '{}'::jsonb;
  end if;

  if jsonb_typeof(patch->'expenses') = 'array'
     and jsonb_array_length(patch->'expenses') > 5000 then
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;
  if jsonb_typeof(patch->'shopping') = 'array'
     and jsonb_array_length(patch->'shopping') > 500 then
    raise exception 'PAYLOAD_TOO_LARGE';
  end if;

  select coalesce(jsonb_agg(d.e order by d.e->>'id'), '[]'::jsonb)
    into merged_exp
  from (
    select distinct on (u.e->>'id') u.e
    from (
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(patch->'expenses') = 'array'
             then patch->'expenses' else '[]'::jsonb end)
      union all
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(cur->'expenses') = 'array'
             then cur->'expenses' else '[]'::jsonb end)
    ) u
    where jsonb_typeof(u.e) = 'object'
      and coalesce(u.e->>'id', '') <> ''
      /* Perso / épargne ne peuvent pas fuiter dans la ligne partagée. */
      and coalesce(u.e->>'envelope', 'besoins') = 'besoins'
    order by u.e->>'id', coalesce(u.e->>'updatedAt', '') desc
  ) d
  where not (d.e->'deleted' = 'true'::jsonb
             and coalesce(d.e->>'updatedAt', '') < cutoff);

  /* Même fusion, appliquée aux articles de la liste. Un article coché par
     l'un et décoché par l'autre suit la même règle : le plus récent gagne. */
  select coalesce(jsonb_agg(d.e order by d.e->>'id'), '[]'::jsonb)
    into merged_shop
  from (
    select distinct on (u.e->>'id') u.e
    from (
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(patch->'shopping') = 'array'
             then patch->'shopping' else '[]'::jsonb end)
      union all
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(cur->'shopping') = 'array'
             then cur->'shopping' else '[]'::jsonb end)
    ) u
    where jsonb_typeof(u.e) = 'object'
      and coalesce(u.e->>'id', '') <> ''
    order by u.e->>'id', coalesce(u.e->>'updatedAt', '') desc
  ) d
  where not (d.e->'deleted' = 'true'::jsonb
             and coalesce(d.e->>'updatedAt', '') < cutoff);

  select coalesce(jsonb_object_agg(z.k, z.val), '{}'::jsonb)
    into merged_goal
  from (
    select ks.k,
      case
        when goal_fill_only then coalesce(cur->'goal'->ks.k, patch->'goal'->ks.k)
        when cur->'goal'->ks.k is null then patch->'goal'->ks.k
        when patch->'goal'->ks.k is null then cur->'goal'->ks.k
        when coalesce(patch->'goal'->ks.k->>'t', '')
             > coalesce(cur->'goal'->ks.k->>'t', '') then patch->'goal'->ks.k
        else cur->'goal'->ks.k
      end as val
    from unnest(array['goal', 'saved', 'goalType', 'goalNote']) as ks(k)
  ) z
  where z.val is not null;

  return jsonb_build_object(
    'expenses', merged_exp,
    'shopping', merged_shop,
    'goal', merged_goal
  );
end;
$$;

revoke all on function public.hh_merge_data(jsonb, jsonb, boolean) from public, anon, authenticated;
