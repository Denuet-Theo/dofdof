-- `farm_zones` : le même classement que `farm_targets`, mais par **sous-zone**.
--
-- ## Pourquoi une fonction et non une agrégation côté client
--
-- `farm_targets` rend au plus `p_limit` lignes, cinquante par défaut. Agréger sa
-- sortie dans le navigateur ne moyennerait donc que les cinquante meilleurs
-- monstres du jeu, ce qui n'est pas la moyenne d'une sous-zone : une zone dont
-- aucun monstre n'entre dans ce top n'apparaîtrait pas du tout, et une zone qui
-- y place un seul monstre serait notée sur lui seul. L'agrégation doit voir
-- **tous** les monstres retenus, donc elle appartient au SQL.
--
-- ## La sous-zone et non la région
--
-- C'est la maille où l'on se pose réellement pour enchaîner des combats. La
-- région, servie par `/api/dofusdb/areas`, reste le **filtre** — on resserre à
-- Amakna, puis on lit quelle sous-zone d'Amakna paie.
--
-- Un monstre appartient à plusieurs sous-zones : `subarea_ids` est un tableau.
-- Il compte donc dans chacune, ce qui est fidèle — on le rencontre partout où il
-- apparaît — et implique que la somme des effectifs par zone dépasse le nombre
-- de monstres distincts. Ce n'est pas un double comptage : les moyennes sont
-- indépendantes l'une de l'autre.
--
-- ## La moyenne, et non le meilleur
--
-- `avg_kamas_per_fight` porte sur **tous** les monstres retenus de la zone. Le
-- choix est celui du combat quelconque : on arrive dans une sous-zone et on
-- prend les groupes qui se présentent. Une zone à un excellent monstre et vingt
-- médiocres est donc mal notée, ce qui est voulu — c'est ce qu'on y gagnera en
-- moyenne. `best_kamas_per_fight` et `best_monster_name` sont rendus à côté pour
-- que le cas « une seule bonne proie » reste lisible sans changer le tri.
--
-- ## La signature reproduit celle de `farm_targets`
--
-- Terme pour terme, valeurs par défaut comprises. C'est ce qui permet à la route
-- de passer les mêmes paramètres selon le mode demandé sans traduire quoi que ce
-- soit — et à un filtre ajouté plus tard de n'avoir qu'un endroit à suivre.

create or replace function public.farm_zones(
  p_min_level        integer default null,
  p_max_level        integer default null,
  p_subarea_ids      integer[] default null,
  p_area_id          integer default null,
  p_exclude_boss      boolean default true,
  p_exclude_mini_boss boolean default false,
  p_exclude_quest     boolean default false,
  p_exclude_bounty    boolean default false,
  p_exclude_hidden    boolean default true,
  p_min_percent      numeric default 0,
  p_prospecting      integer default 100,
  p_priced_only      boolean default false,
  p_crafted_only     boolean default false,
  p_exclude_quest_drops boolean default true,
  p_unconditional_only boolean default false,
  p_elements         text[] default null,
  p_max_resistance   integer default null,
  p_limit            integer default 50
)
returns table (
  subarea_id            integer,
  subarea_name          text,
  area_id               integer,
  area_name             text,
  -- Niveau de la sous-zone tel que le jeu l'annonce. Sert à situer la zone sans
  -- avoir à lire les niveaux de chacun de ses monstres.
  subarea_level         integer,
  -- Monstres retenus par les filtres et **porteurs d'au moins un drop retenu**.
  -- C'est le dénominateur de la moyenne, donc il doit être affiché avec elle :
  -- une moyenne sur deux monstres ne se lit pas comme une moyenne sur trente.
  monster_count         integer,
  avg_kamas_per_fight   numeric,
  best_kamas_per_fight  numeric,
  best_monster_name     text,
  -- Fourchette de niveau des monstres retenus, pour dire d'un coup d'œil si la
  -- zone est à portée.
  level_min             integer,
  level_max             integer
)
language sql
stable
security invoker
as $$
with
target_subareas as (
  select array_agg(distinct s.id) as ids
  from public.dofus_subareas s
  where (p_subarea_ids is not null and s.id = any(p_subarea_ids))
     or (p_area_id is not null and s.area_id = p_area_id)
),

-- Identique à `farm_targets` : les filtres qui portent sur le monstre seul,
-- appliqués avant toute jointure sur les drops.
monsters as (
  select m.*
  from public.dofus_monsters m
  where (p_min_level is null or m.level_max >= p_min_level)
    and (p_max_level is null or m.level_min <= p_max_level)
    and (
      (p_subarea_ids is null and p_area_id is null)
      or m.subarea_ids && (select ids from target_subareas)
    )
    and (not p_exclude_boss      or not m.is_boss)
    and (not p_exclude_mini_boss or not m.is_mini_boss)
    and (not p_exclude_quest     or not m.is_quest_monster)
    and (not p_exclude_bounty    or not m.is_bounty)
    and (not p_exclude_hidden    or not m.hide_in_bestiary)
    and (
      p_elements is null or p_max_resistance is null
      or exists (
        select 1
        from unnest(p_elements) as e(name)
        where case e.name
                when 'earth'   then m.res_earth_max
                when 'air'     then m.res_air_max
                when 'fire'    then m.res_fire_max
                when 'water'   then m.res_water_max
                when 'neutral' then m.res_neutral_max
              end <= p_max_resistance
      )
    )
),

-- Identique à `farm_targets`, à ceci près qu'on n'a pas besoin des colonnes qui
-- ne servaient qu'à composer `top_drops` : ici on ne rend pas les drops.
valued as (
  select
    d.monster_id,
    least(d.percent_max * greatest(p_prospecting, 0) / 100.0, 100) / 100.0
      * coalesce(p.price, 0) as expected_kamas
  from public.dofus_drops d
  join monsters m on m.id = d.monster_id
  join public.dofus_items i on i.id = d.object_id
  left join public.item_prices p on p.item_id = d.object_id
  where d.percent_max >= p_min_percent
    and (not p_priced_only or coalesce(p.price, 0) > 0)
    and (not p_unconditional_only or not d.has_criterions)
    -- QUEST_CRITERION, même motif que `farm_targets` : voir la migration
    -- 20260802210000 pour le relevé qui le justifie.
    and (not p_exclude_quest_drops or d.criterions !~ 'Q[aofsc][=!<>]')
    and (
      not p_crafted_only
      or exists (
        select 1 from public.dofus_recipes r
        where r.ingredient_ids @> array[d.object_id]
      )
    )
),

-- Un monstre, son espérance par combat. C'est exactement `kamas_per_fight` de
-- `farm_targets`, et la jointure interne reproduit son `join valued` : un
-- monstre sans aucun drop retenu ne compte pas dans la moyenne de sa zone.
-- L'écarter plutôt que le compter à zéro est le même choix que `p_priced_only`
-- fait sur les drops — un trou de saisie n'est pas une absence de valeur, et le
-- faire peser sur la moyenne d'une zone la rendrait illisible.
per_monster as (
  select
    m.id,
    m.name_fr,
    m.level_min,
    m.level_max,
    m.subarea_ids,
    sum(v.expected_kamas) as kamas_per_fight
  from monsters m
  join valued v on v.monster_id = m.id
  group by m.id, m.name_fr, m.level_min, m.level_max, m.subarea_ids
),

-- L'éclatement par sous-zone. Le `where` refait le filtre de zone : sans lui,
-- un monstre retenu parce qu'*une* de ses sous-zones est visée ferait aussi
-- apparaître toutes ses autres sous-zones, hors du périmètre demandé.
per_subarea as (
  select
    s.id      as subarea_id,
    s.name_fr as subarea_name,
    s.area_id,
    s.level   as subarea_level,
    p.id      as monster_id,
    p.name_fr as monster_name,
    p.level_min,
    p.level_max,
    p.kamas_per_fight
  from per_monster p
  cross join unnest(p.subarea_ids) as sub(id)
  join public.dofus_subareas s on s.id = sub.id
  -- Containment plutôt que `= any(...)` : passer une sous-requête à `any` la fait
  -- lire comme un *ensemble de tableaux* et Postgres refuse la comparaison. Le
  -- `@>` est aussi l'idiome de `farm_targets`, qui teste `subarea_ids && ...`.
  where (p_subarea_ids is null and p_area_id is null)
     or (select ids from target_subareas) @> array[s.id]
)

select
  z.subarea_id,
  z.subarea_name,
  z.area_id,
  coalesce(a.name_fr, ''),
  z.subarea_level,
  count(*)::integer,
  round(avg(z.kamas_per_fight), 2),
  round(max(z.kamas_per_fight), 2),
  -- Le nom du meilleur monstre, pris sur la même ligne que le maximum.
  -- `distinct on` serait plus direct mais ne survit pas au `group by` ; ce
  -- `order by` dans l'agrégat est la forme qui reste juste ici.
  (array_agg(z.monster_name order by z.kamas_per_fight desc, z.monster_name))[1],
  min(z.level_min)::integer,
  max(z.level_max)::integer
from per_subarea z
left join public.dofus_areas a on a.id = z.area_id
-- Les sous-zones sans nom ne veulent rien dire dans un classement : DofusDB en
-- laisse quelques-unes sans libellé français, comme pour les régions.
where z.subarea_name <> ''
group by z.subarea_id, z.subarea_name, z.area_id, a.name_fr, z.subarea_level
-- La zone la plus payante d'abord ; à égalité — typiquement tout à zéro quand
-- aucun prix n'est saisi — la plus accessible.
order by round(avg(z.kamas_per_fight), 2) desc, min(z.level_min) asc
limit greatest(p_limit, 1);
$$;

comment on function public.farm_zones is
  'Classe les sous-zones par kamas espérés pour un combat quelconque : moyenne, '
  'sur tous les monstres retenus par les filtres, de leur espérance par combat. '
  'Même signature que farm_targets.';
