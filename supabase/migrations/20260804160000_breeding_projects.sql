-- Suivi d'un plan d'élevage en cours.
--
-- Un plan tient sur plusieurs jours et des dizaines de croisements : sans état
-- persistant, la page ne peut que redonner le plan théorique, celui du premier
-- jour. Or l'élevage est aléatoire — 30 à 90 % de réussite selon le niveau des
-- parents — donc l'écart entre le plan et la réalité est la règle, pas
-- l'exception.
--
-- D'où deux tables : le projet, qui dit ce qu'on vise, et le stock, qui dit ce
-- qu'on a obtenu. Le plan restant se **recalcule** de l'un moins l'autre plutôt
-- que de se figer à la création : une couleur obtenue plus tôt que prévu allège
-- toute son ascendance, et une fournée malchanceuse la remet au programme, sans
-- qu'il faille modéliser des « étapes terminées ».

create table if not exists public.breeding_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),
  -- L'identifiant de couleur de l'arbre (`corail_pourpre`), pas un `item_id` :
  -- c'est lui qui sert de clé partout ailleurs dans l'élevage.
  target_color_id text not null,
  -- Viser plusieurs exemplaires change le plan, et pas proportionnellement : les
  -- fournées d'enclos se remplissent mieux et le clonage a de quoi s'appairer.
  target_count integer not null default 1 check (target_count between 1 and 100),
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  -- Un seul projet en cours par couleur : deux plans concurrents sur la même
  -- cible partageraient le même stock réel et se compteraient double.
  unique (user_id, family, target_color_id)
);

create index if not exists breeding_projects_user_idx
  on public.breeding_projects (user_id, family);

-- Ce que l'éleveur possède déjà, par couleur. Ligne absente = zéro.
create table if not exists public.breeding_project_stock (
  project_id uuid not null references public.breeding_projects(id) on delete cascade,
  color_id text not null,
  -- Des montures **fertiles** disponibles pour la suite du plan : une monture
  -- déjà accouplée est stérile et ne compte plus, le recyclage par clonage
  -- étant déjà pris en compte dans le calcul du plan.
  count integer not null default 0 check (count >= 0),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (project_id, color_id)
);

alter table public.breeding_projects enable row level security;
alter table public.breeding_project_stock enable row level security;

-- Un projet est privé : il décrit l'avancement d'un joueur, pas un prix de
-- marché. Contrairement à `breeding_color_prices`, rien à partager ici.
drop policy if exists "Projets d'élevage propres" on public.breeding_projects;
create policy "Projets d'élevage propres" on public.breeding_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Le stock n'a pas de `user_id` à lui : il hérite de celui de son projet, ce
-- qui évite qu'une ligne de stock puisse pointer un projet d'autrui.
drop policy if exists "Stock d'élevage propre" on public.breeding_project_stock;
create policy "Stock d'élevage propre" on public.breeding_project_stock
  for all using (
    exists (
      select 1 from public.breeding_projects project
      where project.id = breeding_project_stock.project_id
        and project.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.breeding_projects project
      where project.id = breeding_project_stock.project_id
        and project.user_id = auth.uid()
    )
  );
