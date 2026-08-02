-- Miroir des monstres et de leurs drops (api.dofusdb.fr/monsters).
--
-- Même raisonnement que 20260801090000_dofus_catalog_mirror.sql : le bestiaire
-- ne bouge qu'aux patchs du jeu et tient dans ~10 Mo (5 134 monstres, ~40 000
-- lignes de drop), donc miroir complet plutôt que cache TTL.
--
-- L'intérêt du croisement : `dofus_drops.object_id` pointe sur `dofus_items.id`,
-- déjà miroir, lui-même joignable à `item_prices` — d'où un classement des
-- monstres par kamas espérés, sans un seul appel réseau au chargement de page.
--
-- Alimenté uniquement par `npm run db:sync` (scripts/sync-dofusdb.mjs).

-- ------------------------------------------------------------------ monstres

create table if not exists public.dofus_monsters (
  id                integer primary key,
  name_fr           text    not null,
  -- `slug.fr` arrive déjà sans accents et en minuscules, comme pour les items.
  slug_fr           text    not null default '',
  race              integer not null default 0,
  -- Les cinq drapeaux d'exclusion sont stockés bruts et filtrés au service, pas
  -- à l'ingestion : même convention que super_type_id sur dofus_items. Changer
  -- d'avis sur « faut-il masquer les monstres de quête » ne doit pas imposer une
  -- resynchronisation complète.
  is_boss           boolean not null default false,
  is_mini_boss      boolean not null default false,
  -- Attention à l'usage : 2 839 monstres sur 5 134 portent ce drapeau, il est
  -- beaucoup plus large que « monstre uniquement disponible en quête ».
  is_quest_monster  boolean not null default false,
  is_bounty         boolean not null default false,
  hide_in_bestiary  boolean not null default false,
  -- Bornes dénormalisées depuis grades[].level, pour que le filtre « monstres de
  -- mon niveau » soit un simple between indexable plutôt qu'un parcours du tableau.
  level_min         integer not null default 0,
  level_max         integer not null default 0,
  -- grade_levels[i] = niveau du grade i. Le nombre de grades varie de 3 à 11
  -- selon les monstres (vérifié sur 1 000 monstres), alors que l'API n'expose
  -- que percentDropForGrade1..5 côté drops : au-delà du grade 5, on connaît le
  -- niveau du grade mais pas son taux de drop propre.
  grade_levels      integer[] not null default '{}',
  grade_count       integer not null default 0,
  -- Ids de sous-zones où le monstre apparaît (13 au maximum, 1,3 en moyenne).
  subarea_ids       integer[] not null default '{}',
  -- Résistances élémentaires, en pourcentage, bornes sur l'ensemble des grades.
  --
  -- Deux colonnes par élément et non une seule : les résistances varient d'un
  -- grade à l'autre pour 54,9 % des monstres (mesuré sur 1 500), donc une valeur
  -- unique mentirait une fois sur deux. `_max` est le pire cas pour le joueur et
  -- sert le filtre « je tape en feu, montre-moi ce qui résiste peu » ; `_min`
  -- permet de repérer les grades vulnérables.
  --
  -- Les valeurs vont de -100 à 900 et sont négatives 6 600 fois sur l'échantillon :
  -- une résistance négative est une *vulnérabilité*, d'où le smallint signé et
  -- l'absence de toute contrainte de positivité.
  res_earth_min     smallint not null default 0,
  res_earth_max     smallint not null default 0,
  res_air_min       smallint not null default 0,
  res_air_max       smallint not null default 0,
  res_fire_min      smallint not null default 0,
  res_fire_max      smallint not null default 0,
  res_water_min     smallint not null default 0,
  res_water_max     smallint not null default 0,
  res_neutral_min   smallint not null default 0,
  res_neutral_max   smallint not null default 0,
  img               text    not null default '',
  synced_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------- drops

-- Une ligne par (monstre, objet, critères), avec les taux des cinq grades en
-- colonnes. Le couple (monster_id, object_id) ne suffit *pas* comme clé : 518
-- lignes sur 12 150 le dupliquent, avec des taux différents selon l'état de
-- quête du joueur (ex. monstre 64 / objet 14453 : 5,28 % sous `Qa=846`, 2,64 %
-- sous `Qa!846&Qf!846`). Le triplet, lui, est unique sur 14 238 lignes vérifiées.
create table if not exists public.dofus_drops (
  monster_id       integer not null references public.dofus_monsters(id) on delete cascade,
  object_id        integer not null,
  -- Expression de critères DofusDB, stockée brute et non interprétée. 72,5 % des
  -- lignes en portent une : les exclure viderait la table. Les préfixes dominants
  -- sont `PL` (niveau du joueur), `PO` (exemplaires déjà possédés — un plafond
  -- anti-farm) et `Qo`/`Qa`/`Qf` (états de quête). Fait partie de la clé, d'où
  -- le not null avec chaîne vide plutôt qu'un null non indexable.
  criterions       text    not null default '',
  has_criterions   boolean not null default false,
  percent_grade_1  numeric(6,3) not null default 0,
  percent_grade_2  numeric(6,3) not null default 0,
  percent_grade_3  numeric(6,3) not null default 0,
  percent_grade_4  numeric(6,3) not null default 0,
  percent_grade_5  numeric(6,3) not null default 0,
  -- Le meilleur taux des cinq grades, calculé par Postgres pour que le filtre
  -- « taux >= x » reste une comparaison indexable. Sans lui, la mise en colonnes
  -- des grades obligerait chaque requête de seuil à un greatest() non sargable.
  percent_max      numeric(6,3) not null
    generated always as (
      greatest(percent_grade_1, percent_grade_2, percent_grade_3,
               percent_grade_4, percent_grade_5)
    ) stored,
  -- Champ `count` côté DofusDB : quantité maximale, et non une prospection de
  -- référence. Vaut 63 sur la grande majorité des lignes, 1 sur ~2 %.
  max_count        integer not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (monster_id, object_id, criterions)
);

-- --------------------------------------------------------------------- zones

create table if not exists public.dofus_areas (
  id       integer primary key,
  name_fr  text not null default '',
  synced_at timestamptz not null default now()
);

create table if not exists public.dofus_subareas (
  id        integer primary key,
  area_id   integer not null default 0,
  name_fr   text    not null default '',
  level     integer not null default 0,
  synced_at timestamptz not null default now()
);

-- --------------------------------------------------------------------- index

-- Filtre « monstres de mon niveau » : les deux bornes sont interrogées ensemble.
create index if not exists dofus_monsters_level_idx
  on public.dofus_monsters (level_min, level_max);
-- Filtre par zone : `subarea_ids && '{12,13}'` a besoin d'un GIN.
create index if not exists dofus_monsters_subareas_idx
  on public.dofus_monsters using gin (subarea_ids);
-- Recherche par nom, même convention trigramme que dofus_items.slug_fr.
create index if not exists dofus_monsters_slug_fr_trgm
  on public.dofus_monsters using gin (slug_fr extensions.gin_trgm_ops);
-- Volontairement aucun index sur les dix colonnes de résistance : le filtre
-- porte sur un sous-ensemble d'éléments choisi à l'exécution et se combine en
-- OR, ce qu'un btree par colonne ne sert pas. Sur 5 134 lignes, le parcours
-- séquentiel coûte moins cher que dix index à maintenir à chaque synchro.

-- « Qui droppe cet objet ? », le sens de lecture du planificateur de farm.
-- percent_max en second permet de servir le tri par taux depuis l'index.
create index if not exists dofus_drops_object_idx
  on public.dofus_drops (object_id, percent_max desc);
-- « Que droppe ce monstre ? », sens de lecture de la fiche monstre.
create index if not exists dofus_drops_monster_idx
  on public.dofus_drops (monster_id);
-- Seuil de taux global, pour le classement kamas tous monstres confondus.
create index if not exists dofus_drops_percent_idx
  on public.dofus_drops (percent_max desc);

create index if not exists dofus_subareas_area_idx
  on public.dofus_subareas (area_id);

-- ----------------------------------------------------------------------- RLS

-- Lecture seule pour les utilisateurs connectés, aucune écriture cliente : le
-- script de sync écrit en tant que propriétaire via SUPABASE_DB_URL, et RLS ne
-- s'applique pas au propriétaire (pas de `force row level security`).
alter table public.dofus_monsters enable row level security;
alter table public.dofus_drops    enable row level security;
alter table public.dofus_areas    enable row level security;
alter table public.dofus_subareas enable row level security;

-- Les policies ne supportent pas "if not exists", d'où drop-then-create pour
-- rester idempotent (même convention que les migrations précédentes).
drop policy if exists "Lecture bestiaire" on public.dofus_monsters;
create policy "Lecture bestiaire" on public.dofus_monsters
  for select using (auth.role() = 'authenticated');

drop policy if exists "Lecture drops" on public.dofus_drops;
create policy "Lecture drops" on public.dofus_drops
  for select using (auth.role() = 'authenticated');

drop policy if exists "Lecture zones" on public.dofus_areas;
create policy "Lecture zones" on public.dofus_areas
  for select using (auth.role() = 'authenticated');

drop policy if exists "Lecture sous-zones" on public.dofus_subareas;
create policy "Lecture sous-zones" on public.dofus_subareas
  for select using (auth.role() = 'authenticated');

revoke insert, update, delete on public.dofus_monsters from anon, authenticated;
revoke insert, update, delete on public.dofus_drops    from anon, authenticated;
revoke insert, update, delete on public.dofus_areas    from anon, authenticated;
revoke insert, update, delete on public.dofus_subareas from anon, authenticated;
