-- Stocks de l'éleveur : montures, carburants et kamas.
--
-- Le stock des montures vivait sur le projet (`breeding_project_stock`). C'était
-- trop étroit : un muldo Roux sert à des dizaines de couleurs, et le posséder
-- allège **tous** les plans, pas seulement celui qu'on suit. Le rattacher à un
-- projet obligeait à le ressaisir à chaque changement d'objectif, et deux
-- projets concurrents auraient compté deux fois les mêmes montures.
--
-- Il devient donc un stock du joueur, comme les carburants et les kamas. Le
-- projet ne garde que ce qui le définit : la couleur visée et la quantité.

-- Ce que l'éleveur possède en écurie, toutes couleurs confondues.
create table if not exists public.user_breeding_mounts (
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),
  color_id text not null,
  -- Des montures **fertiles** : une monture déjà accouplée est stérile et ne
  -- peut plus servir de parent. Le recyclage par clonage est déjà modélisé
  -- ailleurs, dans le calcul du plan.
  count integer not null default 0 check (count >= 0),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, family, color_id)
);

-- Ce que l'éleveur a en réserve d'items, carburants d'enclos en pratique.
--
-- Clé sur `item_id` et non sur une notion de jauge : un carburant est un item
-- comme un autre, et cette table pourra resservir hors élevage sans migration.
create table if not exists public.user_item_stock (
  user_id uuid not null references auth.users(id) default auth.uid(),
  item_id integer not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, item_id)
);

-- Le budget. Distinct de `kamas_per_hour`, qui dit ce que vaut une heure de jeu :
-- celui-ci dit ce qu'on peut engager, et sert de **contrainte** au plan plutôt
-- que d'arbitrage. Un plan rentable mais infinançable n'est pas un plan.
alter table public.user_breeding_settings
  add column if not exists kamas_available bigint not null default 0
    check (kamas_available >= 0);

comment on column public.user_breeding_settings.kamas_available is
  'Kamas engageables. À 0, aucune contrainte de budget n''est appliquée.';

-- Le stock par projet n'a plus lieu d'être : il est remplacé par
-- `user_breeding_mounts`, qui vaut pour tous les projets à la fois.
drop table if exists public.breeding_project_stock;

alter table public.user_breeding_mounts enable row level security;
alter table public.user_item_stock enable row level security;

drop policy if exists "Montures propres" on public.user_breeding_mounts;
create policy "Montures propres" on public.user_breeding_mounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Stock d'items propre" on public.user_item_stock;
create policy "Stock d'items propre" on public.user_item_stock
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
