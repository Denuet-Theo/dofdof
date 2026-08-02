-- Suggestions d'items dont le prix mérite d'être saisi (grille du dashboard).
--
-- Pourquoi en base plutôt que côté client : les deux classements utiles
-- (« dans combien de recettes apparaît cet ingrédient » et « quelle part du coût
-- de craft représente-t-il ») demandent un unnest de `ingredient_ids` sur les
-- ~4 900 recettes joint à `item_prices`. PostgREST ne sait pas l'exprimer, et le
-- client charge déjà `item_prices` en entier sans pagination : y ajouter le
-- catalogue complet n'était pas envisageable.
--
-- Quatre blocs, évalués dans l'ordre, chacun excluant les items déjà retenus par
-- les précédents pour que le tirage aléatoire ne ressorte pas ce qui est affiché
-- juste au-dessus.

create or replace function public.price_suggestions(
  -- Bloc 3 : au-delà de ce délai, un prix existant est considéré comme périmé.
  p_stale_days    integer default 4,
  -- Repli des blocs 1, 2 et 4 : quand il n'y a plus d'item « jamais rempli »,
  -- on complète avec les prix les plus anciens plutôt que de rendre du vide.
  p_fallback_days integer default 8,
  p_per_bucket    integer default 4
)
returns table (
  bucket        text,
  item_id       integer,
  item_name     text,
  img           text,
  has_recipe    boolean,
  -- null quand aucune ligne `item_prices` n'existe : l'app ne distingue nulle
  -- part « pas de ligne » de « prix à 0 » (la colonne a un default 0), les deux
  -- comptent ici comme « jamais rempli ».
  current_price bigint,
  updated_at    timestamptz,
  recipe_count  integer,  -- bloc 1
  craft_cost    bigint,   -- bloc 2
  cost_share    numeric,  -- bloc 3, dans ]0,1]
  context_name  text      -- bloc 3 : la recette qui porte cette part
)
language sql
-- Volatile (défaut) et non `stable` : le bloc 4 appelle random().
security invoker
as $$
with
-- La table de jointure recette↔ingrédient n'existe pas : le miroir stocke deux
-- tableaux alignés par index. On la matérialise ici, tout le reste en dépend.
ri as (
  select
    r.id             as recipe_id,
    r.result_id      as result_id,
    r.result_name_fr as result_name_fr,
    t.ingredient_id  as ingredient_id,
    coalesce(t.qty, 0) as qty
  from public.dofus_recipes r
  cross join lateral unnest(r.ingredient_ids, r.quantities) as t(ingredient_id, qty)
),

-- Le vivier : uniquement les items qui participent à une recette (ingrédient ou
-- résultat). Tirer au hasard dans les 21 738 items du catalogue ferait remonter
-- des objets de quête et du décor sans intérêt marchand.
graph_ids as (
  select ri.ingredient_id as id from ri
  union
  select ri.result_id as id from ri
),

pool as (
  select
    i.id           as id,
    i.name_fr      as name_fr,
    i.img          as img,
    i.has_recipe   as has_recipe,
    pr.price       as price,
    pr.updated_at  as updated_at,
    (pr.item_id is null or pr.price <= 0) as never_filled,
    (pr.price > 0 and pr.updated_at < now() - make_interval(days => p_fallback_days))
      as stale_fallback
  from graph_ids g
  join public.dofus_items i on i.id = g.id
  left join public.item_prices pr on pr.item_id = i.id
),

-- Les candidats des blocs 1, 2 et 4. Le tri `never_filled desc` en tête de chaque
-- bloc suffit à implémenter le repli : tant qu'il reste des items jamais remplis
-- ils passent devant, et les prix de plus de `p_fallback_days` jours ne servent
-- qu'à compléter jusqu'à `p_per_bucket`.
todo as (
  select p.* from pool p where p.never_filled or p.stale_fallback
),

-- Coût de craft par recette, avec le drapeau qui dit s'il est fiable. Un
-- ingrédient sans prix compte pour 0 (comme computeCraftCost côté client), donc
-- le coût est sous-estimé : `all_ingredients_priced` est la condition sans
-- laquelle ni le classement du bloc 2 ni les parts du bloc 3 n'ont de sens.
recipe_cost as (
  select
    ri.recipe_id      as recipe_id,
    min(ri.result_id) as result_id,
    min(ri.result_name_fr) as result_name_fr,
    sum(coalesce(pr.price, 0) * ri.qty)::bigint as craft_cost,
    bool_and(coalesce(pr.price, 0) > 0) as all_ingredients_priced
  from ri
  left join public.item_prices pr on pr.item_id = ri.ingredient_id
  group by ri.recipe_id
),

-- Bloc 1 — les ingrédients présents dans le plus de recettes.
b1 as (
  select s.*, row_number() over () as ord
  from (
    select
      t.id, t.name_fr, t.img, t.has_recipe, t.price, t.updated_at,
      count(distinct ri.recipe_id)::integer as recipe_count
    from todo t
    join ri on ri.ingredient_id = t.id
    group by t.id, t.name_fr, t.img, t.has_recipe, t.price, t.updated_at, t.never_filled
    order by t.never_filled desc, count(distinct ri.recipe_id) desc, t.id
    limit p_per_bucket
  ) s
),

-- Bloc 2 — recettes dont tous les ingrédients sont tarifés : il ne manque que le
-- prix de vente pour obtenir une marge exploitable. `dofus_recipes_result_id_key`
-- garantit une recette par résultat, donc pas de doublon possible ici.
b2 as (
  select s.*, row_number() over () as ord
  from (
    select
      t.id, t.name_fr, t.img, t.has_recipe, t.price, t.updated_at,
      rc.craft_cost as craft_cost
    from recipe_cost rc
    join todo t on t.id = rc.result_id
    where rc.all_ingredients_priced
      and not exists (select 1 from b1 where b1.id = t.id)
    order by t.never_filled desc, rc.craft_cost desc, t.id
    limit p_per_bucket
  ) s
),

-- Bloc 3 — un prix périmé sur un ingrédient qui pèse 80 % d'un craft fausse la
-- marge bien plus qu'ailleurs. On garde, par ingrédient, la part maximale
-- atteinte parmi les recettes entièrement tarifées.
b3_shares as (
  select
    ri.ingredient_id as id,
    rc.result_name_fr as result_name_fr,
    (pr.price * ri.qty)::numeric / rc.craft_cost as cost_share,
    row_number() over (
      partition by ri.ingredient_id
      order by (pr.price * ri.qty)::numeric / rc.craft_cost desc, rc.recipe_id
    ) as share_rank
  from ri
  join recipe_cost rc on rc.recipe_id = ri.recipe_id
  join public.item_prices pr on pr.item_id = ri.ingredient_id
  where rc.all_ingredients_priced
    and rc.craft_cost > 0
    and pr.updated_at < now() - make_interval(days => p_stale_days)
),

b3 as (
  select s.*, row_number() over () as ord
  from (
    select
      i.id, i.name_fr, i.img, i.has_recipe, pr.price, pr.updated_at,
      sh.cost_share as cost_share,
      sh.result_name_fr as context_name
    from b3_shares sh
    join public.dofus_items i on i.id = sh.id
    join public.item_prices pr on pr.item_id = sh.id
    where sh.share_rank = 1
      and not exists (select 1 from b1 where b1.id = sh.id)
      and not exists (select 1 from b2 where b2.id = sh.id)
    order by sh.cost_share desc, i.id
    limit p_per_bucket
  ) s
),

-- Bloc 4 — au hasard, pour sortir des angles morts que les trois classements
-- précédents ne remontent jamais.
b4 as (
  select s.*, row_number() over () as ord
  from (
    select t.id, t.name_fr, t.img, t.has_recipe, t.price, t.updated_at
    from todo t
    where not exists (select 1 from b1 where b1.id = t.id)
      and not exists (select 1 from b2 where b2.id = t.id)
      and not exists (select 1 from b3 where b3.id = t.id)
    order by t.never_filled desc, random()
    limit p_per_bucket
  ) s
),

merged as (
  select
    1 as bucket_ord, b1.ord as ord, 'most_used'::text as bucket,
    b1.id, b1.name_fr, b1.img, b1.has_recipe, b1.price, b1.updated_at,
    b1.recipe_count, null::bigint as craft_cost, null::numeric as cost_share,
    null::text as context_name
  from b1
  union all
  select
    2, b2.ord, 'ready_recipe'::text,
    b2.id, b2.name_fr, b2.img, b2.has_recipe, b2.price, b2.updated_at,
    null::integer, b2.craft_cost, null::numeric, null::text
  from b2
  union all
  select
    3, b3.ord, 'cost_driver'::text,
    b3.id, b3.name_fr, b3.img, b3.has_recipe, b3.price, b3.updated_at,
    null::integer, null::bigint, b3.cost_share, b3.context_name
  from b3
  union all
  select
    4, b4.ord, 'random'::text,
    b4.id, b4.name_fr, b4.img, b4.has_recipe, b4.price, b4.updated_at,
    null::integer, null::bigint, null::numeric, null::text
  from b4
)
-- Toutes les références sont qualifiées : dans une fonction `language sql`, une
-- colonne portant le nom d'un paramètre de sortie (item_id, img, updated_at…)
-- déclenche « column reference is ambiguous » si elle est laissée nue.
select
  m.bucket,
  m.id,
  m.name_fr,
  m.img,
  m.has_recipe,
  m.price,
  m.updated_at,
  m.recipe_count,
  m.craft_cost,
  m.cost_share,
  m.context_name
from merged m
order by m.bucket_ord, m.ord;
$$;

-- `public` et pas seulement `anon` : Postgres accorde EXECUTE à PUBLIC sur toute
-- nouvelle fonction, et anon en hérite. Révoquer anon seul ne retirerait rien.
revoke all on function public.price_suggestions(integer, integer, integer) from public;
grant execute on function public.price_suggestions(integer, integer, integer) to authenticated;

-- Sert le filtre `ingredient_ids && {id}` de /api/dofusdb/recipes?involvesId=,
-- qui cherche les recettes impactées par le prix qu'on vient de saisir.
create index if not exists dofus_recipes_ingredient_ids_gin
  on public.dofus_recipes using gin (ingredient_ids);
