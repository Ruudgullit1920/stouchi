/* Fil d'activité du foyer.
 *
 * Un petit événement est déposé dans la ligne partagée à chaque dépense
 * commune ou article de liste ajouté, pour que l'autre compte voie ce qui
 * s'est passé sans avoir à comparer les chiffres.
 *
 * Rien à voir avec les dépenses ou les articles côté fusion : un événement est
 * IMMUABLE. Il n'a pas d'updatedAt, on ne le modifie jamais, on ne le supprime
 * pas à la main. D'où trois différences avec les deux autres tableaux :
 *   — dédoublonnage par id, sans arbitrage de date (les deux copies sont
 *     identiques par construction) ;
 *   — pas de pierres tombales : la purge se fait par l'âge et par le nombre ;
 *   — le tableau est tronqué aux 60 derniers, du plus récent au plus ancien,
 *     donc la ligne partagée ne peut pas gonfler indéfiniment.
 *
 * Comme hh_merge_data() reconstruit son résultat clé par clé, une clé 'events'
 * ajoutée seulement côté client serait perdue à chaque écriture — la fonction
 * est donc reprise en entier, comme elle l'a été pour la liste de courses.
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
  /* Le fil est une commodité de lecture, pas un journal : au-delà d'un mois
     personne ne le remonte. */
  ev_cutoff text := to_char((now() at time zone 'utc') - interval '30 days',
                            'YYYY-MM-DD"T"HH24:MI:SS');
  merged_exp jsonb;
  merged_shop jsonb;
  merged_goal jsonb;
  merged_events jsonb;
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
  if jsonb_typeof(patch->'events') = 'array'
     and jsonb_array_length(patch->'events') > 500 then
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

  /* Fil d'activité : union par id, les 60 plus récents, rien de plus vieux
     qu'un mois. Le tri se fait sur ts décroissant — le client reçoit donc la
     liste déjà dans l'ordre d'affichage. */
  select coalesce(jsonb_agg(t.e order by t.e->>'ts' desc), '[]'::jsonb)
    into merged_events
  from (
    select d.e
    from (
      select distinct on (u.e->>'id') u.e
      from (
        select value as e from jsonb_array_elements(
          case when jsonb_typeof(patch->'events') = 'array'
               then patch->'events' else '[]'::jsonb end)
        union all
        select value as e from jsonb_array_elements(
          case when jsonb_typeof(cur->'events') = 'array'
               then cur->'events' else '[]'::jsonb end)
      ) u
      where jsonb_typeof(u.e) = 'object'
        and coalesce(u.e->>'id', '') <> ''
        and coalesce(u.e->>'ts', '') >= ev_cutoff
      order by u.e->>'id'
    ) d
    order by d.e->>'ts' desc
    limit 60
  ) t;

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
    'events', merged_events,
    'goal', merged_goal
  );
end;
$$;

revoke all on function public.hh_merge_data(jsonb, jsonb, boolean) from public, anon, authenticated;
