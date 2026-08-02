'use client';

import ItemCard from '@/components/ui/ItemCard';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Button from '@/components/ui/Button';
import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { ShoppingCart, Edit2 } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';
import { getHdvLabel } from '@/lib/dofus/hdv';
import { computeCraftCost, computeMargin, recipeHasAllPrices } from '@/lib/utils/recipes';

/** The item whose price is being edited — what every "click the line" handler receives. */
export interface PriceTarget {
  id: number;
  name: string;
  iconUrl: string;
  price?: number;
  /** Optionnel : sert à afficher l'HDV, et tous les appelants ne le connaissent pas. */
  superTypeId?: number;
}

export interface SellTarget {
  id: number;
  name: string;
  iconUrl: string;
  price: number;
  craftCost: number;
  superTypeId?: number;
}

interface RecipeDetailsProps {
  recipe: DofusDBRecipe;
  prices: Map<number, ItemPrice>;
  resultPrice: number;
  onEditPrice: (item: PriceTarget) => void;
  onSell: (item: SellTarget) => void;
  /** Coût / vente / marge. Off where the row around the panel already carries them. */
  showSummary?: boolean;
}

/**
 * The recipe itself — ingredients, figures, sell button — identical whether it is
 * expanded under a row on /recipes or shown in the popin the narrower surfaces open.
 * Every ingredient reads the same way as the recipe it belongs to: the icon copies the
 * name, the rest of the line edits the price.
 */
const RecipeDetails = ({
  recipe,
  prices,
  resultPrice,
  onEditPrice,
  onSell,
  showSummary = false,
}: RecipeDetailsProps) => {
  const craftCost = computeCraftCost(recipe, prices);
  const { margin, marginPercent } = computeMargin(resultPrice, craftCost);
  const isProfitable = margin > 0;
  const hasAllPrices = recipeHasAllPrices(recipe, prices);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {recipe.ingredients?.map((ingredient, index) => {
          const qty = recipe.quantities[index] || 0;
          const ingPriceObj = prices.get(ingredient.id);
          const unitPrice = ingPriceObj?.price || 0;
          const totalPrice = unitPrice * qty;
          const ingredientName = ingredient.name?.fr || `Item #${ingredient.id}`;

          return (
            <ItemCard
              key={ingredient.id}
              layout="row"
              variant="flat"
              onClick={() =>
                onEditPrice({
                  id: ingredient.id,
                  name: ingredient.name?.fr || '',
                  iconUrl: ingredient.img,
                  price: unitPrice,
                  superTypeId: ingredient.superTypeId,
                })
              }
            >
              <CopyableIcon
                src={ingredient.img}
                name={ingredientName}
                size="sm"
                toast={false}
                scaleOnHover={false}
              />

              <ItemCard.Body>
                <ItemCard.Title className="group-hover/row:text-kamas transition-colors">
                  {ingredientName}
                </ItemCard.Title>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px] text-dark-500">× {qty}</p>
                  {/* En texte plutôt qu'en `HdvBadge` : une pastille par ingrédient
                      écraserait une ligne déjà dense, sur huit lignes de recette. */}
                  {getHdvLabel(ingredient.superTypeId) && (
                    <span className="text-[9px] text-craft">
                      {getHdvLabel(ingredient.superTypeId)}
                    </span>
                  )}
                  {ingPriceObj?.updated_at && (
                    <span className="text-[9px] text-dark-600">
                      ({formatTimeAgo(ingPriceObj.updated_at)})
                    </span>
                  )}
                </div>
              </ItemCard.Body>

              <ItemCard.Actions>
                {unitPrice > 0 ? (
                  <KamasDisplay amount={totalPrice} size="sm" />
                ) : (
                  <span className="text-[10px] text-loss italic">Pas de prix</span>
                )}
                <Edit2
                  size={12}
                  className="text-dark-500 opacity-0 group-hover/row:opacity-100 transition-opacity"
                />
              </ItemCard.Actions>
            </ItemCard>
          );
        })}
      </div>

      {showSummary && (
        <div className="grid grid-cols-3 gap-2 mb-4 p-3 rounded-xl bg-dark-800/30 border border-dark-700/30">
          <div>
            <p className="text-[10px] text-dark-500">Coût</p>
            <KamasDisplay amount={craftCost} size="sm" className="text-dark-300" />
          </div>
          <div>
            <p className="text-[10px] text-dark-500">Vente</p>
            <KamasDisplay amount={resultPrice} size="sm" className="text-dark-200" />
          </div>
          <div>
            <p className="text-[10px] text-dark-500">Marge (-2% tax)</p>
            {hasAllPrices ? (
              <div className="flex items-center gap-1 flex-wrap">
                <KamasDisplay amount={margin} size="sm" colored />
                <span className={`text-[10px] ${isProfitable ? 'text-gain' : 'text-loss'}`}>
                  ({marginPercent > 0 ? '+' : ''}
                  {marginPercent}%)
                </span>
              </div>
            ) : (
              <span className="text-xs text-dark-500 italic block">Prix manquants</span>
            )}
          </div>
        </div>
      )}

      <Button
        onClick={() =>
          onSell({
            id: recipe.resultId,
            name: recipe.resultName?.fr || '',
            iconUrl: recipe.result?.img || '',
            price: resultPrice,
            craftCost,
            superTypeId: recipe.result?.superTypeId,
          })
        }
        size="sm"
        className="w-full"
        disabled={!hasAllPrices}
      >
        <ShoppingCart size={14} />
        Mettre en vente
      </Button>
    </>
  );
};

export default RecipeDetails;
