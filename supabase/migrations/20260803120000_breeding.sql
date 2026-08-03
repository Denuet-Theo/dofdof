-- Élevage : prix des couleurs de monture et réglages par éleveur.
--
-- Les arbres de croisement eux-mêmes ne sont pas en base. Ils vivent dans
-- `src/lib/dofus/breeding/trees.json`, figés par
-- `scripts/extract-breeding-trees.mjs` : 306 couleurs et 382 croisements, soit
-- un jeu de données statique qui ne change qu'à une mise à jour du jeu. Le
-- descendre côté application coûte moins qu'une fonction SQL à maintenir, et le
-- calcul « acheter ou élever » n'agrège rien — contrairement à `farm_targets`,
-- qui brasse 23 000 lignes de drops et doit rester en base.

-- Prix des certificats de monture, partagés par tous les utilisateurs comme
-- `item_prices` : une saisie profite à tout le monde.
--
-- Clé sur (famille, couleur, niveau) et non sur `item_id`, pour deux raisons :
--
--   1. Une couleur se cote à **deux niveaux**. Un bébé naît niveau 1, donc
--      l'élevage produit du niveau 0 ; le prix niveau 200 n'est atteignable
--      qu'en payant la montée. `item_prices` ne porte qu'un prix par item et ne
--      peut pas représenter les deux.
--   2. L'identifiant de couleur est celui de l'arbre (`corail_pourpre`), qui
--      reste stable même si DofusDB change ou perd un certificat. Le lien vers
--      l'item existe bien — les 306 couleurs sont appariées — mais il sert à
--      l'icône et au préremplissage, pas d'identité.
create table if not exists public.breeding_color_prices (
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),
  color_id text not null,
  -- 0 = poulain tel qu'il naît, 200 = monture montée au maximum.
  mount_level integer not null check (mount_level in (0, 200)),
  price bigint not null default 0 check (price >= 0),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  updated_by uuid references auth.users(id),
  primary key (family, color_id, mount_level)
);

-- Le classement lit toujours une famille entière d'un coup.
create index if not exists breeding_color_prices_family_idx
  on public.breeding_color_prices (family);

-- Réglages propres à chaque éleveur, privés comme `user_sales`.
--
-- Ce qui vit ici est ce qui diffère d'un joueur à l'autre et qu'aucune donnée de
-- jeu ne peut fournir : la taille de son élevage, et ce que vaut son temps.
create table if not exists public.user_breeding_settings (
  user_id uuid primary key references auth.users(id) default auth.uid(),

  -- Le niveau d'Éleveur débloque les enclos (1, 40, 80, 120, 160, 200). Il
  -- n'influe **pas** sur la réussite des croisements — celle-ci dépend du niveau
  -- des montures accouplées, pas de celui du joueur.
  breeder_level integer not null default 200 check (breeder_level between 1 and 200),

  -- Un enclos débloqué n'est pas un enclos possédé, d'où un compte distinct du
  -- niveau. 10 places par enclos, 2 jauges actives par enclos.
  enclos_count integer not null default 6 check (enclos_count between 0 and 6),

  -- Ce que vaut une heure de jeu. Sert à trancher les arbitrages temps/kamas :
  -- quel filet de capture utiliser, et quel palier de carburant alimenter. À 0,
  -- le temps est gratuit et les options les moins chères l'emportent toujours.
  kamas_per_hour bigint not null default 0 check (kamas_per_hour >= 0),

  -- Durée d'un combat de capture, trajet et recherche de groupe compris. Un
  -- filet vaut un combat quel que soit son palier, donc ce temps se divise par
  -- le nombre de captures qu'il rend.
  minutes_per_fight integer not null default 12 check (minutes_per_fight > 0),

  -- Part des matériaux récupérée en recraftant un filet après capture.
  net_recovery_rate numeric not null default 0.8
    check (net_recovery_rate >= 0 and net_recovery_rate < 1),

  -- Recycler les parents stériles par clonage : deux stériles de même
  -- génération rendent une monture fertile. Activé par défaut — c'est le conseil
  -- du jeu lui-même, et le gain croît avec la génération visée.
  recycle_steriles boolean not null default true,

  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.breeding_color_prices enable row level security;
alter table public.user_breeding_settings enable row level security;

-- breeding_color_prices : lecture et écriture pour tout utilisateur connecté,
-- comme item_prices. Les prix sont un bien commun de l'équipe.
drop policy if exists "Lecture prix élevage" on public.breeding_color_prices;
create policy "Lecture prix élevage" on public.breeding_color_prices
  for select using (auth.role() = 'authenticated');

drop policy if exists "Ajout prix élevage" on public.breeding_color_prices;
create policy "Ajout prix élevage" on public.breeding_color_prices
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Edition prix élevage" on public.breeding_color_prices;
create policy "Edition prix élevage" on public.breeding_color_prices
  for update using (auth.role() = 'authenticated');

-- user_breeding_settings : chacun ne voit et ne modifie que sa propre ligne.
drop policy if exists "Réglages élevage propres" on public.user_breeding_settings;
create policy "Réglages élevage propres" on public.user_breeding_settings
  for all using (auth.uid() = user_id);
