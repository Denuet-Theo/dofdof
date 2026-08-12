import { fetchRecipesForItems } from '@/lib/dofus/fetch-recipes';
import { indexRecipes, type RecipeIndex } from '@/lib/utils/recipes';
import type { DofusDBRecipe } from '@/lib/supabase/types';

/**
 * Descendre l'arbre de craft pour connaître les recettes des ingrédients.
 *
 * ## À quoi ça sert
 *
 * Une page ne charge que les recettes qu'elle affiche. Chiffrer un ingrédient au
 * moins cher de l'achat et de sa fabrication (#123) demande **sa** recette, qui
 * est un cran plus bas et n'est donc jamais dans ce lot.
 *
 * ## Deux tours, et pas trois
 *
 * Les arbres réels font deux niveaux : une rune craftée d'un minerai crafté, et
 * on s'arrête. Chaque tour est un aller-retour réseau ; le troisième ne
 * changerait presque jamais un chiffre pour un coût payé sur toutes les pages.
 * `MAX_CRAFT_DEPTH` borne le calcul, ceci borne le **chargement** — les deux sont
 * distincts, et c'est le plus petit des deux qui décide.
 *
 * `hasRecipe` du miroir filtre avant l'appel : sans lui on demanderait la recette
 * de chaque poussière, pour s'entendre répondre qu'il n'y en a pas.
 *
 * ## Ce qu'un échec vaut
 *
 * Un index incomplet n'est pas une panne : les coûts retombent sur les prix
 * d'achat, c'est-à-dire le comportement d'avant #123. L'appelant décide s'il le
 * signale ; il ne doit pas s'arrêter pour autant.
 */
export const CRAFT_ROUNDS = 2;

/** Les ingrédients d'un lot de recettes qui ont eux-mêmes une recette. */
export const craftableIngredientIds = (recipes: DofusDBRecipe[]): number[] => {
  const ids = new Set<number>();
  for (const recipe of recipes) {
    recipe.ingredients?.forEach((ingredient) => {
      if (ingredient?.hasRecipe) ids.add(ingredient.id);
    });
  }
  return Array.from(ids).sort((a, b) => a - b);
};

/**
 * Les recettes de `rootIds`, puis celles de leurs ingrédients, sur `rounds`
 * niveaux.
 *
 * La primitive prend des **ids** et non des recettes : c'est ce dont dispose un
 * appelant qui a déjà les ingrédients sous la main, et l'envelopper dans de
 * fausses recettes pour respecter une autre signature ne tromperait personne
 * longtemps.
 *
 * `asked` permet de ne pas redemander ce qu'on a déjà — le hook s'en sert entre
 * deux rendus.
 */
export const fetchRecipeTree = async (
  rootIds: number[],
  { rounds = CRAFT_ROUNDS, asked = new Set<number>() } = {}
): Promise<DofusDBRecipe[]> => {
  let frontier = rootIds.filter((id) => !asked.has(id));
  const found: DofusDBRecipe[] = [];

  for (let round = 0; round < rounds && frontier.length > 0; round += 1) {
    frontier.forEach((id) => asked.add(id));

    const page = await fetchRecipesForItems(frontier);
    if (page.length === 0) break;
    found.push(...page);

    frontier = craftableIngredientIds(page).filter((id) => !asked.has(id));
  }

  return found;
};

/** Les recettes des ingrédients de `recipes`, sur `rounds` niveaux. */
export const fetchIngredientRecipes = (
  recipes: DofusDBRecipe[],
  options: { rounds?: number; asked?: Set<number> } = {}
): Promise<DofusDBRecipe[]> =>
  fetchRecipeTree(craftableIngredientIds(recipes), options);

/**
 * L'index de craft pour un lot de recettes, prêt à passer aux fonctions de coût.
 *
 * Rend un index **vide** plutôt que de propager l'erreur : une marge calculée sur
 * les prix d'achat est le comportement d'avant, une page blanche ne l'est pas.
 */
export const fetchCraftIndex = async (
  recipes: DofusDBRecipe[]
): Promise<RecipeIndex> => {
  try {
    return indexRecipes(await fetchIngredientRecipes(recipes));
  } catch (error) {
    console.error('[craft] recettes d’ingrédients non chargées:', error);
    return new Map();
  }
};
