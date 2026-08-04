-- Mémorise le dernier réglage de la page Farm, joueur par joueur.
--
-- Les filtres de farm décrivent une façon de jouer qui ne change pas d'une
-- session à l'autre : sa fourchette de niveau, sa prospection, sa zone du
-- moment. Les resaisir à chaque visite est le vrai coût de la page.

create table if not exists public.user_farm_filters (
  user_id uuid primary key references auth.users(id) default auth.uid(),

  -- L'état des filtres en jsonb, et non une colonne par réglage.
  --
  -- C'est le seul cas du schéma qui le mérite : contrairement à
  -- `user_breeding_settings`, rien ici n'est lu par du SQL — aucune fonction ne
  -- filtre, n'agrège ni ne contraint ce contenu. C'est un instantané de l'écran,
  -- dont `FarmFilterState` est la seule définition qui compte. En colonnes, la
  -- valeur par défaut de chaque filtre existerait en trois exemplaires (le
  -- client, la signature de `farm_targets`, cette table) et ajouter une case
  -- imposerait une migration.
  --
  -- La contrepartie est que le contenu n'est pas validé ici : c'est le client
  -- qui recolle ce qu'il relit sur `DEFAULT_FILTERS` en ignorant les clés qu'il
  -- ne connaît pas, ce qui absorbe aussi bien un réglage retiré qu'un réglage
  -- ajouté depuis la dernière visite.
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object'),

  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.user_farm_filters enable row level security;

-- Strictement privé, comme `breeding_projects` : ce sont des habitudes de jeu,
-- pas une donnée de marché à partager.
drop policy if exists "Filtres de farm propres" on public.user_farm_filters;
create policy "Filtres de farm propres" on public.user_farm_filters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
