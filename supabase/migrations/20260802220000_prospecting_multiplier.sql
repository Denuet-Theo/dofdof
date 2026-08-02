-- Corrige l'effet de la prospection sur les taux de drop.
--
-- `farm_targets` (20260802210000) supposait un effet proportionnel,
-- `taux = base × PP/100`. C'est faux, et de très loin : à 333 PP la formule
-- annonçait 139,9 % là où le jeu affiche 88,85 %. Erreur quadratique moyenne de
-- 33,9 points de taux sur les relevés ci-dessous, contre 0,11 point pour la
-- formule retenue ici.
--
-- Trois faits ont été établis par la mesure, chacun testé séparément :
--
--  1. L'effet est *multiplicatif* sur le taux de base. Vérifié sur des bases de
--     7,1 % et 42 % (même monstre) : le rapport taux/base coïncide à 2·10⁻⁵.
--     Une seule fonction de la prospection gouverne donc tout le catalogue.
--
--  2. Il ne dépend pas du monstre. Deux monstres de niveau 1 et 200 partageant
--     une base de 10 % affichent tous deux 21,16 % à 333 PP.
--
--  3. Le taux est plafonné à 100 %. Une base de 60 % à 333 PP donnerait 126,9 %
--     sans plafond ; le jeu affiche 100 %.
--
-- Relevés (Muldo doré sauvage, DofusDB 4438) :
--
--     item                     base    140 PP   228 PP   243 PP   333 PP
--     Moustache de muldo doré  42 %     49,29    66,35    69,74    88,85
--     Bave de muldo            7,1 %        —    11,22    11,79    15,02
--
-- Contrôle sur des monstres non utilisés pour l'ajustement : Poils de souris et
-- Corne de Scaratos (base 10 %) donnent 16,57/16,6 à 243 PP et 21,16/21,16 à
-- 333 PP. Les neuf mesures, sur 5 items et 4 monstres, tiennent à ±0,16 point.

/**
 * Multiplicateur appliqué au taux de drop de base pour une prospection donnée.
 *
 *     f(pp) = ((pp + 233) / 333) ^ 1,413
 *
 * Vaut 1 à 100 PP par construction — 233 + 100 = 333 — ce qui est la propriété
 * qu'on veut : le taux stocké dans `dofus_drops` est celui obtenu à 100 PP.
 *
 * Forme empirique, pas une formule officielle. Deux mises en garde :
 *
 *  - Les deux constantes ne sont pas identifiées séparément : un décalage plus
 *    grand se compense par un exposant plus grand. Le minimum reste net (0,111
 *    point contre 0,193 à C=200 et 0,279 à C=300), et surtout toute la vallée de
 *    solutions prédit la même courbe dans la plage mesurée, à 0,5 point près.
 *    C'est la courbe qui est établie, pas le couple de paramètres.
 *
 *  - L'ajustement s'appuie sur quatre valeurs de prospection, de 140 à 333. En
 *    dehors, et surtout en dessous de 140, c'est de l'extrapolation. Le
 *    plafonnement à 100 % est appliqué par l'appelant, pas ici : la fonction
 *    rend le multiplicateur nu, le plafond porte sur le produit base × f.
 *
 * `immutable` : la valeur ne dépend que de l'argument, ce qui autorise Postgres
 * à ne l'évaluer qu'une fois par requête plutôt qu'une fois par ligne de drop.
 */
create or replace function public.prospecting_multiplier(p_prospecting integer)
returns numeric
language sql
immutable
parallel safe
as $$
  -- Une prospection négative n'existe pas ; la borne évite en prime une racine
  -- non entière d'un nombre négatif, qui ferait échouer la requête entière.
  select power((greatest(p_prospecting, 0) + 233)::numeric / 333, 1.413);
$$;

comment on function public.prospecting_multiplier(integer) is
  'Multiplicateur empirique du taux de drop selon la prospection ; vaut 1 à 100 PP.';

create or replace function public.farm_targets(
  -- Fourchette de niveau du joueur. Un monstre est retenu si sa propre plage de
  -- niveaux (level_min..level_max, tous grades confondus) croise celle demandée.
  p_min_level        integer default null,
  p_max_level        integer default null,
  -- Zone de farm. p_subarea_ids vise des sous-zones précises ; p_area_id élargit
  -- à toutes les sous-zones d'une région. Les deux se cumulent en OR.
  p_subarea_ids      integer[] default null,
  p_area_id          integer default null,
  -- Exclusions. Boss et monstres masqués écartés par défaut : on ne les enchaîne
  -- pas en boucle. `p_exclude_quest` reste faux par défaut à dessein — le drapeau
  -- couvre 2 839 monstres sur 5 134, l'activer par défaut viderait le classement.
  p_exclude_boss      boolean default true,
  p_exclude_mini_boss boolean default false,
  p_exclude_quest     boolean default false,
  p_exclude_bounty    boolean default false,
  p_exclude_hidden    boolean default true,
  -- Seuil sur le meilleur taux des cinq grades, avant application de la
  -- prospection. Écarte le bruit à 0,01 % qui n'arrivera jamais en pratique.
  p_min_percent      numeric default 0,
  -- Prospection du joueur. 100 PP reste la référence — le taux stocké est bien
  -- celui obtenu à 100 PP, c'est mesuré — mais la montée n'est pas
  -- proportionnelle : voir public.prospecting_multiplier.
  p_prospecting      integer default 100,
  -- Ne garder que les drops dont le prix HDV est renseigné. Sans ça, un monstre
  -- aux ressources non tarifées apparaît à 0 kama et coule au classement — ce
  -- qui est trompeur : c'est un trou de saisie, pas une absence de valeur.
  p_priced_only      boolean default false,
  -- Ne garder que les drops qui servent réellement d'ingrédient de craft.
  p_crafted_only     boolean default false,
  -- Écarte les drops conditionnés par une quête. **Actif par défaut** : ces
  -- lignes sortent à 100 % et raflent la tête du classement alors qu'elles ne se
  -- farment pas en boucle (ex. Larve Bleue / objet 19756 sous `Qo=14179`). Sur
  -- 14 238 lignes mesurées, 17,6 % portent un tel critère, et elles représentent
  -- 43,2 % de toutes les lignes affichées à 100 %.
  --
  -- C'est la seule interprétation que la fonction fait des `criterions`, et elle
  -- est étroite à dessein : voir QUEST_CRITERION plus bas. Le miroir, lui,
  -- continue de stocker l'expression brute.
  p_exclude_quest_drops boolean default true,
  -- Ne garder que les drops sans *aucune* condition. Instrument brut, sur le
  -- drapeau `has_criterions`, et donc faux par défaut : 72,5 % des lignes portent
  -- une condition, mais 56,7 % en portent une qui n'a rien d'une quête (`PL`
  -- niveau du joueur, `PO` plafond d'exemplaires possédés) et reste parfaitement
  -- farmable. À réserver au cas « je ne veux que du garanti ».
  p_unconditional_only boolean default false,
  -- Filtre de résistance : garde les monstres dont *au moins un* des éléments
  -- listés résiste à p_max_resistance ou moins. Sémantique voulue « je tape feu
  -- ou eau, montre-moi ce qui est tendre dans l'un des deux » — et non
  -- l'intersection, qui ne renverrait presque rien.
  --
  -- Les résistances vont de -100 à 900 : une valeur négative est une
  -- vulnérabilité, donc un seuil négatif est parfaitement légitime.
  p_elements         text[] default null,
  p_max_resistance   integer default null,
  p_limit            integer default 50
)
returns table (
  monster_id      integer,
  monster_name    text,
  img             text,
  level_min       integer,
  level_max       integer,
  grade_count     integer,
  is_boss         boolean,
  is_mini_boss    boolean,
  subarea_names   text[],
  -- Résistances min/max, telles quelles : c'est ce qui permet à l'appelant
  -- d'afficher « faible feu » sans réinterroger la table.
  resistances     jsonb,
  drop_count      integer,
  -- Kamas espérés pour un combat, à la prospection demandée. Somme sur les
  -- drops retenus de (taux effectif × prix). Espérance et non garantie.
  kamas_per_fight numeric,
  -- Les meilleures lignes de drop du monstre, déjà triées, pour éviter un
  -- aller-retour par monstre côté client.
  top_drops       jsonb
)
language sql
stable
security invoker
as $$
with
-- Sous-zones visées, une seule fois : le filtre de zone s'y ramène ensuite à un
-- test d'intersection de tableaux, servi par l'index GIN sur subarea_ids.
target_subareas as (
  select array_agg(distinct s.id) as ids
  from public.dofus_subareas s
  where (p_subarea_ids is not null and s.id = any(p_subarea_ids))
     or (p_area_id is not null and s.area_id = p_area_id)
),

-- Les monstres qui passent tous les filtres portant sur le monstre lui-même.
-- Fait avant toute jointure sur les drops : c'est ce qui garde le coût bas.
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

-- Les drops retenus, valorisés. Le taux effectif plafonne à 100 % : au-delà de
-- ~180 PP certains taux dépasseraient 100, ce qui gonflerait l'espérance sans
-- correspondre à rien en jeu.
valued as (
  select
    d.monster_id,
    d.object_id,
    i.name_fr as object_name,
    i.img     as object_img,
    d.criterions,
    d.has_criterions,
    d.percent_max,
    least(d.percent_max * public.prospecting_multiplier(p_prospecting), 100) as effective_percent,
    coalesce(p.price, 0) as price,
    -- Espérance pour un combat : probabilité × prix unitaire.
    least(d.percent_max * public.prospecting_multiplier(p_prospecting), 100) / 100.0
      * coalesce(p.price, 0) as expected_kamas
  from public.dofus_drops d
  join monsters m on m.id = d.monster_id
  -- Jointure interne : 8 drops du miroir pointent un objet absent du catalogue
  -- d'items, et sans nom ni prix ils n'ont rien à faire dans un classement.
  join public.dofus_items i on i.id = d.object_id
  left join public.item_prices p on p.item_id = d.object_id
  where d.percent_max >= p_min_percent
    and (not p_priced_only or coalesce(p.price, 0) > 0)
    and (not p_unconditional_only or not d.has_criterions)
    -- QUEST_CRITERION. Les critères de quête de DofusDB s'écrivent sur deux
    -- lettres suivies d'un opérateur : Qa (quête active), Qo (objectif), Qs
    -- (étape), Qf (quête terminée), Qc (quête accomplie). Les dix combinaisons
    -- observées sur 14 238 lignes — Qa=, Qa!, Qo=, Qo!, Qo<, Qo>, Qs=, Qf=, Qf!,
    -- Qc= — tiennent toutes dans ce motif.
    --
    -- Volontairement ancré sur le seul préfixe Q : les autres familles (PL, PO,
    -- Ms, Sc…) restent en jeu, sans quoi on retomberait sur le filtre brut et ses
    -- 56,7 % de faux positifs.
    and (not p_exclude_quest_drops or d.criterions !~ 'Q[aofsc][=!<>]')
    and (
      not p_crafted_only
      or exists (
        select 1 from public.dofus_recipes r
        where r.ingredient_ids @> array[d.object_id]
      )
    )
)

select
  m.id,
  m.name_fr,
  m.img,
  m.level_min,
  m.level_max,
  m.grade_count,
  m.is_boss,
  m.is_mini_boss,
  coalesce(
    (select array_agg(s.name_fr order by s.name_fr)
     from public.dofus_subareas s where s.id = any(m.subarea_ids)),
    '{}'
  ),
  jsonb_build_object(
    'earth',   jsonb_build_array(m.res_earth_min,   m.res_earth_max),
    'air',     jsonb_build_array(m.res_air_min,     m.res_air_max),
    'fire',    jsonb_build_array(m.res_fire_min,    m.res_fire_max),
    'water',   jsonb_build_array(m.res_water_min,   m.res_water_max),
    'neutral', jsonb_build_array(m.res_neutral_min, m.res_neutral_max)
  ),
  count(v.object_id)::integer,
  round(coalesce(sum(v.expected_kamas), 0), 2),
  coalesce(
    (
      select jsonb_agg(t)
      from (
        select
          v2.object_id        as "objectId",
          v2.object_name      as "name",
          v2.object_img       as "img",
          round(v2.effective_percent, 3) as "percent",
          v2.price            as "price",
          v2.has_criterions   as "hasCriterions",
          v2.criterions       as "criterions",
          round(v2.expected_kamas, 2)    as "expectedKamas"
        from valued v2
        where v2.monster_id = m.id
        order by v2.expected_kamas desc, v2.percent_max desc
        limit 10
      ) t
    ),
    '[]'::jsonb
  )
from monsters m
join valued v on v.monster_id = m.id
group by m.id, m.name_fr, m.img, m.level_min, m.level_max, m.grade_count,
         m.is_boss, m.is_mini_boss, m.subarea_ids,
         m.res_earth_min, m.res_earth_max, m.res_air_min, m.res_air_max,
         m.res_fire_min, m.res_fire_max, m.res_water_min, m.res_water_max,
         m.res_neutral_min, m.res_neutral_max
-- Le monstre le plus rentable d'abord ; à égalité (typiquement tout à 0 quand
-- aucun prix n'est saisi), le plus accessible, c'est-à-dire le moins haut niveau.
order by round(coalesce(sum(v.expected_kamas), 0), 2) desc, m.level_min asc
limit greatest(p_limit, 1);
$$;
