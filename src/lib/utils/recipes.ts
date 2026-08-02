import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';

export const HDV_TAX_RATE = 0.02;
export const PRICE_EDIT_TAX_RATE = 0.01;

export const computeCraftCost = (
  recipe: Pick<DofusDBRecipe, 'ingredientIds' | 'quantities'>,
  prices: Map<number, ItemPrice>
) =>
  recipe.ingredientIds.reduce((sum, ingId, index) => {
    const qty = recipe.quantities[index] || 0;
    return sum + (prices.get(ingId)?.price || 0) * qty;
  }, 0);

export const computeMargin = (resultPrice: number, craftCost: number) => {
  const hdvTax = Math.floor(resultPrice * HDV_TAX_RATE);
  const margin = resultPrice - craftCost - hdvTax;
  const marginPercent =
    craftCost > 0 ? Math.round((margin / craftCost) * 100) : 0;
  return { hdvTax, margin, marginPercent };
};

export const recipeHasAllPrices = (
  recipe: Pick<DofusDBRecipe, 'resultId' | 'ingredientIds'>,
  prices: Map<number, ItemPrice>
) => {
  const resultPrice = prices.get(recipe.resultId)?.price || 0;
  if (resultPrice <= 0) return false;
  return recipe.ingredientIds.every((id) => (prices.get(id)?.price || 0) > 0);
};

export type ProfitableRecipe = {
  recipe: DofusDBRecipe;
  craftCost: number;
  sellPrice: number;
  margin: number;
  marginPercent: number;
};

/** Les chiffres d'une recette, ou `null` si elle n'est pas (encore) exploitable. */
const profitabilityOf = (
  recipe: DofusDBRecipe,
  prices: Map<number, ItemPrice>
): ProfitableRecipe | null => {
  if (!recipeHasAllPrices(recipe, prices)) return null;

  const sellPrice = prices.get(recipe.resultId)?.price || 0;
  const craftCost = computeCraftCost(recipe, prices);
  const { margin, marginPercent } = computeMargin(sellPrice, craftCost);

  return margin > 0 ? { recipe, craftCost, sellPrice, margin, marginPercent } : null;
};

/**
 * Les recettes qu'une saisie de prix vient de rendre rentables : celles qui ne
 * l'étaient pas avec `before` et le sont avec `after`. Couvre les deux cas
 * utiles — la recette débloquée parce qu'il lui manquait ce prix, et celle qui
 * repasse en marge positive parce que le prix a bougé.
 */
export const findNewlyProfitable = (
  recipes: DofusDBRecipe[],
  before: Map<number, ItemPrice>,
  after: Map<number, ItemPrice>
): ProfitableRecipe[] =>
  recipes.reduce<ProfitableRecipe[]>((unlocked, recipe) => {
    if (profitabilityOf(recipe, before)) return unlocked;

    const now = profitabilityOf(recipe, after);
    if (now) unlocked.push(now);
    return unlocked;
  }, []);
