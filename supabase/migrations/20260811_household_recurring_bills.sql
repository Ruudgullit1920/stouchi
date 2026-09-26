/* Factures récurrentes partagées.
 *
 * Cinquième clé de la ligne partagée, après expenses / shopping / events /
 * goal. Une facture de portée « foyer » y vit ; une facture « moi » reste
 * dans budget_data et n'atteint jamais l'autre compte — même routage que les
 * dépenses, où « perso » ne franchit pas la frontière.
 *
 * Fusion identique aux articles de la liste : union par id, le updatedAt le
 * plus récent gagne, suppressions en pierres tombales balayées après 90 jours.
 * Une facture se modifie (le montant change, le jour change), donc contrairement
 * aux événements du fil elle a bien besoin d'un arbitrage par date.
 *
 * Le filtre sur scope = 'foyer' est la contrepartie serveur de celui du
 * client : ni l'un ni l'autre ne doit être seul à tenir cette frontière.
 *
 * hh_merge_data() reconstruit son résultat clé par clé — une clé 'bills'
 * ajoutée seulement côté client serait perdue à chaque écriture. D'où, encore
 * une fois, la reprise complète de la fonction.
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
  ev_cutoff text := to_char((now() at time zone 'utc') - interval '30 days',
                            'YYYY-MM-DD"T"HH24:MI:SS');
  merged_exp jsonb;
  merged_shop jsonb;
  merged_bills jsonb;
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
  if jsonb_typeof(patch->'bills') = 'array'
     and jsonb_array_length(patch->'bills') > 200 then
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

  /* Factures : seules celles marquées « foyer » sont admises. Une pierre
     tombale n'a pas de portée, elle doit passer quand même. */
  select coalesce(jsonb_agg(d.e order by d.e->>'id'), '[]'::jsonb)
    into merged_bills
  from (
    select distinct on (u.e->>'id') u.e
    from (
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(patch->'bills') = 'array'
             then patch->'bills' else '[]'::jsonb end)
      union all
      select value as e from jsonb_array_elements(
        case when jsonb_typeof(cur->'bills') = 'array'
             then cur->'bills' else '[]'::jsonb end)
    ) u
    where jsonb_typeof(u.e) = 'object'
      and coalesce(u.e->>'id', '') <> ''
      and (u.e->'deleted' = 'true'::jsonb or coalesce(u.e->>'scope', '') = 'foyer')
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
    'bills', merged_bills,
    'events', merged_events,
    'goal', merged_goal
  );
end;
$$;

revoke all on function public.hh_merge_data(jsonb, jsonb, boolean) from public, anon, authenticated;
