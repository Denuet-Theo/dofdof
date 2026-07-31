-- Miroir local du catalogue DofusDB (api.dofusdb.fr).
--
-- Le catalogue ne change qu'aux mises à jour du jeu et tient dans ~30 Mo
-- (21 738 items, 4 858 recettes), donc on synchronise un miroir complet plutôt
-- que de faire un cache TTL en lecture : une requête locale se mesure en
-- millisecondes contre ~200 ms chez DofusDB, et l'app cesse de dépendre d'une
-- API publique non authentifiée à chaque chargement de page.
--
-- Alimenté uniquement par `npm run db:sync` (scripts/sync-dofusdb.mjs), qui se
-- connecte via SUPABASE_DB_URL. Jamais écrit par le client.

-- pg_trgm accélère la recherche multi-mots `slug_fr like '%mot%'`, qui reproduit
-- le regex `(?=.*mot1)(?=.*mot2)` qu'on envoyait à DofusDB.
-- Convention Supabase : les extensions vivent dans `extensions`, pas `public`.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- On ne stocke que le français : le client ne lit jamais les quatre autres
-- locales renvoyées par DofusDB (vérifié sur l'ensemble de src/).
create table if not exists public.dofus_items (
  id              integer primary key,
  type_id         integer not null,
  -- Dénormalisé depuis /item-types (239 types). superTypeId 2 = armes.
  -- Stocké plutôt que déduit d'une liste de typeIds codée en dur : cette liste
  -- est passée de 11 à 13 entrées entre deux lectures de l'API.
  super_type_id   integer not null,
  icon_id         integer not null default 0,
  level           integer not null default 0,
  name_fr         text    not null,
  type_name_fr    text    not null default '',
  -- ~4,6 % des items ont une description vide côté DofusDB, d'où le default.
  description_fr  text    not null default '',
  -- `slug.fr` arrive déjà sans accents et en minuscules : colonne de recherche.
  slug_fr         text    not null default '',
  has_recipe      boolean not null default false,
  effects         jsonb   not null default '[]'::jsonb,
  img             text    not null default '',
  synced_at       timestamptz not null default now()
);

create table if not exists public.dofus_recipes (
  id                    integer primary key,
  result_id             integer not null,
  result_type_id        integer not null,
  result_super_type_id  integer not null,
  result_level          integer not null default 0,
  result_name_fr        text    not null,
  -- Tableaux alignés par index : quantities[i] correspond à ingredient_ids[i].
  -- L'UI (RecipeCard, GaugeItemCard) lit `quantities[index]` en parcourant les
  -- ingrédients, donc un décalage d'un cran fausse silencieusement tous les
  -- coûts de craft suivants. La contrainte rend ce cas impossible à insérer.
  ingredient_ids        integer[] not null default '{}',
  quantities            integer[] not null default '{}',
  job_id                integer not null default 0,
  job_name_fr           text    not null default '',
  job_img               text    not null default '',
  skill_id              integer not null default 0,
  synced_at             timestamptz not null default now(),
  constraint dofus_recipes_ingredients_aligned
    check (array_length(ingredient_ids, 1) is not distinct from array_length(quantities, 1))
);

-- Une ligne par ressource ('items', 'recipes'). Sert au mode --if-stale du
-- script de sync : distinguer un miroir absent (erreur bloquante) d'un miroir
-- simplement périmé (avertissement).
create table if not exists public.dofus_sync_state (
  resource         text primary key,
  last_success_at  timestamptz,
  last_attempt_at  timestamptz,
  row_count        integer not null default 0,
  upstream_total   integer,
  last_error       text
);

-- Recherche multi-mots : `slug_fr like '%a%' and slug_fr like '%b%'`.
-- Sans index trigramme, chaque recherche est un seq scan sur 21 738 lignes.
create index if not exists dofus_items_slug_fr_trgm
  on public.dofus_items using gin (slug_fr extensions.gin_trgm_ops);
-- (type_id, id) couvre le parcours par catégorie de /gauges, qui pagine sur id.
create index if not exists dofus_items_type_id_idx
  on public.dofus_items (type_id, id);
create index if not exists dofus_items_super_type_idx
  on public.dofus_items (super_type_id);

create unique index if not exists dofus_recipes_result_id_key
  on public.dofus_recipes (result_id);
create index if not exists dofus_recipes_job_level_idx
  on public.dofus_recipes (job_id, result_level);
create index if not exists dofus_recipes_level_idx
  on public.dofus_recipes (result_level);

-- RLS : lecture seule pour les utilisateurs connectés, aucune écriture cliente.
-- Le script de sync se connecte via SUPABASE_DB_URL en tant que propriétaire des
-- tables ; RLS ne s'applique pas au propriétaire (pas de `force row level
-- security`), donc il écrit sans policy dédiée et sans nouveau secret.
alter table public.dofus_items      enable row level security;
alter table public.dofus_recipes    enable row level security;
alter table public.dofus_sync_state enable row level security;

-- Les policies ne supportent pas "if not exists", d'où drop-then-create pour
-- rester idempotent (même convention que 20260730080000_initial_schema.sql).
drop policy if exists "Lecture catalogue items" on public.dofus_items;
create policy "Lecture catalogue items" on public.dofus_items
  for select using (auth.role() = 'authenticated');

drop policy if exists "Lecture catalogue recettes" on public.dofus_recipes;
create policy "Lecture catalogue recettes" on public.dofus_recipes
  for select using (auth.role() = 'authenticated');

drop policy if exists "Lecture etat sync" on public.dofus_sync_state;
create policy "Lecture etat sync" on public.dofus_sync_state
  for select using (auth.role() = 'authenticated');

revoke insert, update, delete on public.dofus_items      from anon, authenticated;
revoke insert, update, delete on public.dofus_recipes    from anon, authenticated;
revoke insert, update, delete on public.dofus_sync_state from anon, authenticated;
