-- L'écurie apprend les sexes, et suit les hautes générations une par une.
--
-- Deux manques que le planificateur ne pouvait pas contourner :
--
-- 1. **Un accouplement demande un mâle et une femelle.** L'écurie ne comptait
--    que des montures, et `planWaves` appariait deux exemplaires d'une même
--    couleur avec un `floor(libres / 2)`. Dix mâles Doré et aucune femelle
--    donnaient cinq accouplements annonçables et zéro réalisable.
--
-- 2. **La distribution des couleurs à l'échec dépend de la généalogie de
--    l'individu, pas de sa couleur.** Deux muldos Amande ne se valent pas selon
--    d'où ils viennent. Un compteur par couleur perd exactement ce qui les
--    distingue — et c'est aussi ce qui rend la purification impossible à
--    représenter, puisqu'elle consiste à fabriquer des individus à ascendance
--    homogène.
--
-- D'où deux représentations plutôt qu'une. Les générations 1 et 2 s'achètent et
-- se capturent en volume, sont interchangeables et n'ont pas d'ascendance qui
-- pèse : un couple de compteurs suffit, et évite une saisie à cent lignes. À
-- partir de la génération 3, chaque monture est suivie. Le seuil tombe là parce
-- que c'est la première génération dont les grands-parents peuvent se retrouver
-- du côté de l'échec : une gen 2 n'a que des parents gen 1, qui sont des
-- feuilles.

-- ---------------------------------------------------------------------------
-- Le vrac : générations basses, comptées par sexe.
-- ---------------------------------------------------------------------------

alter table public.user_breeding_mounts
  add column if not exists males integer not null default 0 check (males >= 0),
  add column if not exists females integer not null default 0 check (females >= 0);

-- Le `count` existant ne dit pas la répartition — l'information n'a jamais été
-- saisie. On la partage au plus juste plutôt que de tout mettre d'un côté, et
-- l'éleveur corrigera : un déséquilibre inventé bloquerait des accouplements
-- réellement possibles, ce qui se voit tout de suite dans les fournées.
--
-- Sous garde : la colonne a pu disparaître si cette migration a déjà tourné, et
-- une référence à une colonne absente est une erreur de compilation SQL, pas une
-- ligne sans effet. Guillemets sur `count`, qui est aussi un nom de fonction.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_breeding_mounts'
      and column_name = 'count'
  ) then
    update public.user_breeding_mounts
      set males = "count" / 2,
          females = "count" - "count" / 2
      where "count" > 0 and males = 0 and females = 0;
  end if;
end $$;

alter table public.user_breeding_mounts drop column if exists count;

comment on column public.user_breeding_mounts.males is
  'Mâles fertiles de cette couleur. Réservé aux générations 1 et 2 : au-delà, voir user_breeding_individuals.';

-- ---------------------------------------------------------------------------
-- Les individus : générations 3 et plus, suivis un par un.
-- ---------------------------------------------------------------------------

create table if not exists public.user_breeding_individuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),
  color_id text not null,
  sex text not null check (sex in ('M', 'F')),
  -- Le niveau décide du taux de réussite, qui dépend de la **somme** des
  -- niveaux des deux parents accouplés. Il se suit donc par individu et non par
  -- couleur : dans une même fournée, deux Amande n'ont aucune raison d'être au
  -- même niveau.
  level integer not null default 1 check (level between 1 and 200),
  -- Passe à `false` dès que la monture a servi de parent. Une stérile ne
  -- s'accouple plus ; il lui reste le clonage et l'extraction, tous deux
  -- modélisés ailleurs.
  fertile boolean not null default true,
  -- La généalogie est portée par les **couleurs** des parents et non seulement
  -- par leurs identifiants, parce qu'un parent de génération 1 ou 2 vit dans le
  -- vrac et n'a pas d'identifiant à référencer. Les colonnes `_id` complètent
  -- quand le parent est lui-même suivi, et c'est ce qui permet de remonter aux
  -- grands-parents — le jeu n'expose jamais plus d'un niveau d'ascendance par
  -- monture, donc deux niveaux suffisent à tout ce qu'on calcule.
  parent_a_color text,
  parent_b_color text,
  parent_a_id uuid references public.user_breeding_individuals(id) on delete set null,
  parent_b_id uuid references public.user_breeding_individuals(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

comment on table public.user_breeding_individuals is
  'Montures de génération 3 et plus, suivies une par une : la distribution des couleurs à l''échec dépend de la généalogie de l''individu.';

-- Les deux accès du planificateur : « les fertiles de telle couleur » pour
-- former les couples, et « mes montures de cette famille » pour l'écurie.
create index if not exists user_breeding_individuals_lookup
  on public.user_breeding_individuals (user_id, family, color_id, fertile);

alter table public.user_breeding_individuals enable row level security;

drop policy if exists "Individus propres" on public.user_breeding_individuals;
create policy "Individus propres" on public.user_breeding_individuals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
