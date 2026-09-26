/* budget_data — la table qui porte réellement les comptes de chacun, déclarée
 * ici pour la première fois.
 *
 * Les quatre migrations précédentes couvrent le foyer partagé (households,
 * household_members, household_shared_data, household_join_attempts), chacune
 * avec son `enable row level security` et ses politiques nommées. budget_data,
 * elle, n'apparaissait que dans des commentaires : sa politique vivait dans le
 * tableau de bord Supabase, donc hors de toute relecture, de tout diff, et
 * impossible à reproduire dans un projet neuf.
 *
 * Cette migration est RÉTROACTIVE et volontairement idempotente : elle décrit
 * ce que la table est déjà censée être. Sur la base existante elle ne devrait
 * rien changer — si elle change quelque chose, c'est qu'il y avait un écart,
 * et c'est précisément la raison de l'écrire.
 *
 * Le modèle est simple et c'est ce qui le rend sûr : une ligne par compte, et
 * la seule ligne qu'un compte peut voir ou écrire est la sienne. Le proxy de
 * chat (lib/chat-context.js) s'appuie dessus comme deuxième barrière,
 * indépendante de son propre filtre user_id.
 */

create table if not exists public.budget_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* hydrate() fait un select ... maybeSingle() sur user_id, et flush() un update
   filtré sur user_id : les deux supposent qu'il n'existe jamais deux lignes
   pour un même compte. Rien ne le garantissait. */
create unique index if not exists budget_data_user_uniq
  on public.budget_data(user_id);

alter table public.budget_data enable row level security;
/* Le propriétaire de la table contourne RLS par défaut ; ici, personne ne doit
   y échapper — pas même lui. */
alter table public.budget_data force row level security;

/* Quatre politiques distinctes plutôt qu'un `for all` : chacune dit exactement
   ce qu'elle autorise, et l'absence de politique de DELETE est alors une
   décision lisible, pas un oubli. L'application ne supprime jamais de ligne —
   « Tout effacer et recommencer » réécrit `data`, il ne retire pas le compte. */

drop policy if exists "owner reads own budget" on public.budget_data;
create policy "owner reads own budget" on public.budget_data
  for select using (auth.uid() = user_id);

drop policy if exists "owner creates own budget" on public.budget_data;
create policy "owner creates own budget" on public.budget_data
  for insert with check (auth.uid() = user_id);

/* using() filtre les lignes visées, with check() interdit de faire glisser
   user_id vers quelqu'un d'autre au passage. Il faut les deux. */
drop policy if exists "owner writes own budget" on public.budget_data;
create policy "owner writes own budget" on public.budget_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.budget_data to authenticated;
revoke all on public.budget_data from anon;

/* updated_at n'était mis à jour par personne : toutes les lignes portaient leur
   date de création, ce qui rend l'inspection en base trompeuse quand on cherche
   à savoir si une sauvegarde est bien passée. */
create or replace function public.touch_budget_data()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists budget_data_touch on public.budget_data;
create trigger budget_data_touch
  before update on public.budget_data
  for each row execute function public.touch_budget_data();
