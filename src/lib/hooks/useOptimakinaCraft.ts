/**
 * Ce que coûte **fabriquer** chaque Optimakina, sur les prix de l'éleveur.
 *
 * ## Pourquoi un crochet à part
 *
 * La page d'élevage ne chargeait aucune recette : le prix d'une Optimakina y
 * venait de `item_prices`, donc de l'hôtel de vente et de lui seul. Or l'éleveur
 * fabrique — relevé du 27/08, la gen 6 lui coûte 11 000 là où l'hôtel la vend
 * 15 000 — et conseiller un achat quand la fabrication est moins chère fait payer
 * 36 % de trop.
 *
 * Neuf items, une fois : c'est trop peu pour mériter un écran mais assez pour
 * changer la réponse.
 *
 * ## Ce qu'on refuse de chiffrer
 *
 * Un ingrédient sans prix rend la recette **incalculable**, et on rend `null`
 * plutôt qu'un total partiel. Un craft sous-évalué gagnerait la comparaison en
 * paraissant offert, ce qui est exactement l'erreur que `bestFuelFor` documente
 * de son côté : « les items sans prix sont écartés plutôt que comptés gratuits ».
 *
 * On ne demande **pas** que l'Optimakina elle-même ait un prix, contrairement à
 * `recipeHasAllPrices` qui l'exige pour calculer une marge de revente. Ici on ne
 * revend pas : on compare deux façons de se la procurer, et une gen 9 sans offre
 * à l'hôtel se fabrique très bien.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';

import { fetchRecipesForItems } from '@/lib/dofus/fetch-recipes';
import { useCraftIndex } from '@/lib/hooks/useCraftIndex';
import type { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import {
  computeCraftCost,
  unitCostOf,
  type RecipeIndex,
  type UnitCost,
} from '@/lib/utils/recipes';

/**
 * Les coûts de fabrication, **et l'index qui les a calculés**.
 *
 * L'index sort avec eux parce que l'écran ouvre désormais la carte de recette
 * sur une Optimakina, et que `RecipeDetails` sans index chiffre chaque
 * ingrédient à son prix d'achat — le comportement d'avant #123. La carte
 * annoncerait alors un total **plus élevé** que la puce qui l'a ouverte, sur
 * l'écran même qu'on ouvre pour vérifier ce total. Deux chiffres pour une
 * question, c'est pire que pas de carte.
 */
export type OptimakinaCraft = {
  /** Par identifiant d'item : le coût, ou `null` si rien ne le chiffre. */
  costs: Map<number, number | null>;
  /** Les recettes des ingrédients, pour que la carte compte comme la puce. */
  index: RecipeIndex;
};

export const useOptimakinaCraft = (
  itemIds: number[],
  prices: Map<number, ItemPrice>
): OptimakinaCraft => {
  // Les recettes **et la clé qui les a demandées**. Les deux ensemble, parce
  // qu'un lot chargé pour d'autres ids ne doit pas servir : sans la clé, changer
  // d'arbre chiffrerait une fabrication avec la recette de la famille d'avant.
  // C'est aussi ce qui évite de vider l'état dans l'effet, ce qu'`eslint` refuse
  // à raison — un `setState` synchrone y déclenche un rendu en cascade.
  const [loaded, setLoaded] = useState<{ key: string; recipes: DofusDBRecipe[] }>({
    key: '',
    recipes: [],
  });

  // La clé de relance : les ids, pas le tableau. Un nouveau tableau à chaque
  // rendu relancerait la requête sans fin.
  const key = useMemo(() => [...itemIds].sort((a, b) => a - b).join(','), [itemIds]);

  useEffect(() => {
    if (key === '') return;
    let alive = true;
    const ids = key.split(',').map(Number);
    fetchRecipesForItems(ids)
      .then((found) => {
        if (alive) setLoaded({ key, recipes: found });
      })
      // Une recette qu'on n'a pas su charger laisse la fabrication inconnue, ce
      // que `null` dit déjà. Rien à signaler à l'écran : l'achat reste proposé.
      .catch(() => {
        if (alive) setLoaded({ key, recipes: [] });
      });
    return () => {
      alive = false;
    };
  }, [key]);

  // Mémorisé : un tableau neuf à chaque rendu relancerait la descente des
  // recettes d'ingrédients juste en dessous.
  const recipes = useMemo(
    () => (loaded.key === key ? loaded.recipes : []),
    [loaded, key]
  );

  // Les recettes des ingrédients, pour qu'un composant lui-même craftable soit
  // chiffré au moins cher des deux. C'est ce que fait la page des jauges.
  const { index } = useCraftIndex(recipes);

  const costs = useMemo(() => {
    const cache = new Map<number, UnitCost>();
    const byResult = new Map(recipes.map((recipe) => [recipe.resultId, recipe]));
    return new Map(
      itemIds.map((itemId) => {
        const recipe = byResult.get(itemId);
        if (!recipe) return [itemId, null];
        const priced = recipe.ingredientIds.every(
          (ingredient) => unitCostOf(ingredient, prices, index, cache).source !== 'none'
        );
        if (!priced) return [itemId, null];
        const cost = computeCraftCost(recipe, prices, index, cache);
        return [itemId, cost > 0 ? cost : null];
      })
    );
  }, [itemIds, recipes, index, prices]);

  return useMemo(() => ({ costs, index }), [costs, index]);
};
