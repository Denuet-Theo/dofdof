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
