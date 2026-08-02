-- Deux filtres sur `price_suggestions` (20260802140000), pour viser un coin du
-- catalogue plutôt que les 16 items les plus urgents dans l'absolu.
--
--  1. `p_job_id` restreint le graphe des recettes à un métier. Le filtre porte
--     sur `ri`, donc sur *tout* ce qui en découle : le vivier, le comptage de
--     recettes du bloc 1, les coûts de craft du bloc 2 et les parts du bloc 3
--     sont alors comptés dans ce métier seul. C'est le sens utile — un
--     Bijoutier qui filtre veut le classement de la bijouterie, pas le
--     classement global élagué après coup. Une recette entière étant retenue ou
--     rejetée d'un bloc, aucun coût de craft ne devient partiel.
--
--  2. `p_include_quest` (faux par défaut) retire les objets de quête des
--     suggestions. Le filtre porte sur le vivier et pas sur `ri` : les recettes
--     de quête continuent de compter dans les classements, parce que le
--     comptage affiché reste censé dire la vérité sur le jeu. Seul l'objet de
--     quête lui-même, qu'on ne tarifera jamais, cesse d'être proposé.
--
-- Nouvelle migration et non réécriture : les deux précédentes sont mergées,
-- donc enregistrées comme appliquées. Le `drop` est indispensable ici — la
-- fonction gagne deux paramètres, et les nouveaux ayant des valeurs par défaut,
-- laisser l'ancienne en place rendrait tout appel à trois arguments ambigu.
drop function if exists public.price_suggestions(integer, integer, integer);

create or replace function public.price_suggestions(
  -- Bloc 3 : au-delà de ce délai, un prix existant est considéré comme périmé.
  p_stale_days    integer default 4,
  -- Repli des blocs 1, 2 et 4 : quand il n'y a plus d'item « jamais rempli »,
  -- on complète avec les prix les plus anciens plutôt que de rendre du vide.
  p_fallback_days integer default 8,
  p_per_bucket    integer default 4,
  -- Métier de la recette (`dofus_recipes.job_id`, cf. lib/constants/jobs.ts).
  -- null = tous les métiers.
  p_job_id        integer default null,
  p_include_quest boolean default false
)
returns table (
  bucket        text,
  item_id       integer,
  item_name     text,
  img           text,
  -- Détermine l'hôtel de vente côté client (lib/dofus/hdv.ts).
  super_type_id integer,
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
-- tableaux alignés par index. On la matérialise ici, tout le reste en dépend —
-- y compris le filtre métier, posé une fois pour toutes à cet endroit.
ri as (
  select
    r.id             as recipe_id,
    r.result_id      as result_id,
    r.result_name_fr as result_name_fr,
    t.ingredient_id  as ingredient_id,
    coalesce(t.qty, 0) as qty
  from public.dofus_recipes r
  cross join lateral unnest(r.ingredient_ids, r.quantities) as t(ingredient_id, qty)
  where p_job_id is null or r.job_id = p_job_id
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
    i.super_type_id as super_type_id,
    i.has_recipe   as has_recipe,
    pr.price       as price,
    pr.updated_at  as updated_at,
    (pr.item_id is null or pr.price <= 0) as never_filled,
    (pr.price > 0 and pr.updated_at < now() - make_interval(days => p_fallback_days))
      as stale_fallback
  from graph_ids g
  join public.dofus_items i on i.id = g.id
  left join public.item_prices pr on pr.item_id = i.id
  -- Super-type 14 = « Objet de quête » (QUEST_SUPER_TYPE_ID, lib/dofus/hdv.ts).
  where p_include_quest or i.super_type_id <> 14
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
      t.id, t.name_fr, t.img, t.super_type_id, t.has_recipe, t.price, t.updated_at,
      count(distinct ri.recipe_id)::integer as recipe_count
    from todo t
    join ri on ri.ingredient_id = t.id
    group by t.id, t.name_fr, t.img, t.super_type_id, t.has_recipe, t.price,
             t.updated_at, t.never_filled
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
      t.id, t.name_fr, t.img, t.super_type_id, t.has_recipe, t.price, t.updated_at,
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
-- atteinte parmi les recettes *complètes*.
--
-- Complète au sens de `recipeHasAllPrices` côté client : résultat tarifé **et**
-- tous les ingrédients tarifés. Les ingrédients seuls ne suffisent pas — sans
-- prix de vente la recette n'a pas de marge, donc rafraîchir le prix de son
-- ingrédient dominant ne corrige aucun chiffre affiché. Ces recettes-là sont
-- déjà le sujet du bloc 2.
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
  join public.item_prices rp on rp.item_id = rc.result_id and rp.price > 0
  where rc.all_ingredients_priced
    and rc.craft_cost > 0
    and pr.updated_at < now() - make_interval(days => p_stale_days)
),

b3 as (
  select s.*, row_number() over () as ord
  from (
    select
      p.id, p.name_fr, p.img, p.super_type_id, p.has_recipe, p.price, p.updated_at,
      sh.cost_share as cost_share,
      sh.result_name_fr as context_name
    from b3_shares sh
    -- Le vivier plutôt que `dofus_items` : c'est lui qui porte l'exclusion des
    -- objets de quête, et un ingrédient de recette y figure toujours.
    join pool p on p.id = sh.id
    where sh.share_rank = 1
      and not exists (select 1 from b1 where b1.id = sh.id)
      and not exists (select 1 from b2 where b2.id = sh.id)
    order by sh.cost_share desc, p.id
    limit p_per_bucket
  ) s
),

-- Bloc 4 — au hasard, pour sortir des angles morts que les trois classements
-- précédents ne remontent jamais.
b4 as (
  select s.*, row_number() over () as ord
  from (
    select t.id, t.name_fr, t.img, t.super_type_id, t.has_recipe, t.price, t.updated_at
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
    b1.id, b1.name_fr, b1.img, b1.super_type_id, b1.has_recipe, b1.price, b1.updated_at,
    b1.recipe_count, null::bigint as craft_cost, null::numeric as cost_share,
    null::text as context_name
  from b1
  union all
  select
    2, b2.ord, 'ready_recipe'::text,
    b2.id, b2.name_fr, b2.img, b2.super_type_id, b2.has_recipe, b2.price, b2.updated_at,
    null::integer, b2.craft_cost, null::numeric, null::text
  from b2
  union all
  select
    3, b3.ord, 'cost_driver'::text,
    b3.id, b3.name_fr, b3.img, b3.super_type_id, b3.has_recipe, b3.price, b3.updated_at,
    null::integer, null::bigint, b3.cost_share, b3.context_name
  from b3
  union all
  select
    4, b4.ord, 'random'::text,
    b4.id, b4.name_fr, b4.img, b4.super_type_id, b4.has_recipe, b4.price, b4.updated_at,
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
  m.super_type_id,
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
revoke all on function public.price_suggestions(integer, integer, integer, integer, boolean)
  from public;
grant execute on function public.price_suggestions(integer, integer, integer, integer, boolean)
  to authenticated;
-- L'index GIN sur `ingredient_ids` est posé par 20260802120000 et n'est pas
-- affecté par le remplacement de la fonction. `dofus_recipes_job_level_idx`
-- (20260801090000) couvre le nouveau filtre métier.
