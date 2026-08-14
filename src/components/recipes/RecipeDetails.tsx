'use client';

import ItemCard from '@/components/ui/ItemCard';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Button from '@/components/ui/Button';
import { toNumber, DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { ShoppingCart, Edit2, Hammer } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';
import { getHdvLabel } from '@/lib/dofus/hdv';
import {
  computeCraftCost,
  computeMargin,
  recipeHasAllPrices,
  unitCostOf,
  type RecipeIndex,
  type UnitCost,
} from '@/lib/utils/recipes';

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
  /**
   * Les recettes des ingrédients. Sans elle, chaque ingrédient est compté à son
   * prix d'achat — le comportement d'avant #123.
   */
  index?: RecipeIndex;
  /**
   * Ouvrir la recette d'un ingrédient, pour y corriger ses composants.
   *
   * Absent sur les surfaces qui n'ont pas où l'ouvrir : la ligne reste alors
   * cliquable pour saisir le prix, comme avant.
   */
  onOpenSubRecipe?: (item: PriceTarget) => void;
}

/**
 * The recipe itself — ingredients, figures, sell button — identical whether it is
 * expanded under a row on /recipes or shown in the popin the narrower surfaces open.
 * Every ingredient reads the same way as the recipe it belongs to: the icon copies the
 * name, the rest of the line edits the price.
 */
/** Ce que la ligne d'un ingrédient annonce, une fois le moins cher choisi. */
const ingredientLabel = (cost: UnitCost) => {
  if (cost.source === 'craft') return 'craft moins cher';
  if (cost.source === 'buy' && cost.craft !== null) return 'achat moins cher';
  return null;
};

const RecipeDetails = ({
  recipe,
  prices,
  resultPrice,
  onEditPrice,
  onSell,
  showSummary = false,
  index,
  onOpenSubRecipe,
}: RecipeDetailsProps) => {
  // Un seul cache pour tout le panneau : un même ingrédient revient dans
  // plusieurs lignes, et l'arbre est le même pour toutes.
  const costs = new Map<number, UnitCost>();
  const craftCost = computeCraftCost(recipe, prices, index, costs);
  const { margin, marginPercent } = computeMargin(resultPrice, craftCost);
  const isProfitable = margin > 0;
  const hasAllPrices = recipeHasAllPrices(recipe, prices, index, costs);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {recipe.ingredients?.map((ingredient, at) => {
          const qty = recipe.quantities[at] || 0;
          const ingPriceObj = prices.get(ingredient.id);
          const unitPrice = ingPriceObj?.price || 0;
          const ingredientName = ingredient.name?.fr || `Item #${ingredient.id}`;

          // Le chiffre qui compte n'est plus le prix d'achat mais le moins cher
          // des deux : c'est lui qui entre dans le coût total, donc c'est lui
          // qu'il faut montrer, sinon la ligne et le total se contredisent.
          const cost = unitCostOf(ingredient.id, prices, index, costs);
          const totalPrice = cost.cost * qty;
          const label = ingredientLabel(cost);
          const target: PriceTarget = {
            id: ingredient.id,
            name: ingredient.name?.fr || '',
            iconUrl: ingredient.img,
            price: toNumber(unitPrice),
            superTypeId: ingredient.superTypeId,
          };
          const craftable = ingredient.hasRecipe && onOpenSubRecipe !== undefined;

          return (
            <ItemCard
              key={ingredient.id}
              layout="row"
              variant="flat"
              onClick={() => onEditPrice(target)}
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

                {/* Les deux chiffres, quand les deux existent. Afficher le seul
                    retenu cacherait l'arbitrage, et c'est précisément ce que
                    l'issue demande de rendre visible. */}
                {label !== null && cost.craft !== null && (
                  // `whitespace-nowrap` sur chaque terme : la popin est étroite et
                  // sans ça « craft moins cher » se coupait en deux lignes. La
                  // ligne peut passer à la suivante, les mots non.
                  <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] flex-wrap">
                    <span
                      className={`whitespace-nowrap ${
                        cost.source === 'buy' ? 'text-gain' : 'text-dark-500'
                      }`}
                    >
                      achat {cost.buy > 0 ? cost.buy.toLocaleString('fr-FR') : '—'}
                    </span>
                    <span
                      className={`whitespace-nowrap ${
                        cost.source === 'craft' ? 'text-gain' : 'text-dark-500'
                      }`}
                    >
                      craft {cost.craft.toLocaleString('fr-FR')}
                    </span>
                    <span className="text-craft whitespace-nowrap">{label}</span>
                  </div>
                )}
              </ItemCard.Body>

              <ItemCard.Actions>
                {cost.source !== 'none' ? (
                  <KamasDisplay amount={totalPrice} size="sm" />
                ) : (
                  <span className="text-[10px] text-loss italic">Pas de prix</span>
                )}
                {/* Ouvrir la recette de l'ingrédient. `stopPropagation` parce que
                    la ligne entière édite le prix : sans ça les deux gestes
                    partiraient ensemble et la modale de prix masquerait l'autre. */}
                {craftable && (
                  <button
                    type="button"
                    title="Ouvrir la recette de cet ingrédient"
                    aria-label={`Ouvrir la recette de ${ingredientName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSubRecipe?.(target);
                    }}
                    className="p-1 rounded-lg text-dark-500 hover:text-craft
                      hover:bg-dark-700/50 transition-colors cursor-pointer"
                  >
                    <Hammer size={12} />
                  </button>
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
