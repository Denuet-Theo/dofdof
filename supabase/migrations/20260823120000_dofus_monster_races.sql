-- Miroir des familles de monstres (api.dofusdb.fr/monster-races).
--
-- `dofus_monsters.race` ne porte qu'un entier. Le miroir sait donc qu'un Bouftou
-- appartient à la famille 12, et rien nulle part ne sait dire « 12, ce sont les
-- Bouftous ». Tant qu'on ne filtrait le bestiaire que par niveau, zone ou
-- résistance, ça n'avait aucune importance : un compteur, lui, se choisit par nom.
--
-- 264 lignes pour tout le référentiel : le miroir complet coûte moins qu'un
-- appel à DofusDB par recherche, et suit le même chemin que le reste du
-- catalogue (`npm run db:sync`).
create table if not exists public.dofus_monster_races (
  id             integer primary key,
  name_fr        text    not null default '',
  -- DofusDB ne fournit pas de slug pour les familles, contrairement aux items et
  -- aux monstres : celui-ci est calculé à l'ingestion, avec exactement la même
  -- normalisation que `normalizeSearchTerms` applique aux termes tapés — accents
  -- retirés, minuscules. Les deux bouts doivent rester d'accord, sinon
  -- « Bouftou » ne retrouverait pas « bouftou ».
  slug_fr        text    not null default '',
  super_race_id  integer not null default 0,
  -- Nombre de monstres de la famille présents dans le miroir, pour que l'écran
  -- puisse annoncer « 12 ennemis » sans compter lui-même.
  monster_count  integer not null default 0,
  -- Une famille n'a pas d'image chez DofusDB. Celle-ci est empruntée à l'un de
  -- ses monstres — le moins élevé en niveau, qui est l'archétype de la famille —
  -- et dénormalisée ici pour que l'icône s'affiche sans jointure.
  img            text    not null default '',
  synced_at      timestamptz not null default now()
);

-- Pas d'index trigramme, contrairement à `dofus_items` et `dofus_monsters` : la
-- table fait 264 lignes, un parcours séquentiel y est plus rapide que la lecture
-- de l'index, et Postgres l'ignorerait de toute façon.

alter table public.dofus_monster_races enable row level security;

-- Les policies ne supportent pas "if not exists", d'où drop-then-create pour
-- rester idempotent (même convention que le reste du catalogue).
drop policy if exists "Lecture familles" on public.dofus_monster_races;
create policy "Lecture familles" on public.dofus_monster_races
  for select using (auth.role() = 'authenticated');
