import KamasDisplay from '@/components/ui/KamasDisplay';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { ShoppingCart, ChevronDown, ChevronUp, Edit2 } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';

interface RecipeCardProps {
  recipe: DofusDBRecipe;
  ingredientPrices: Map<number, ItemPrice>;
  resultPrice: number;
  onSell: (item: {
    id: number;
    name: string;
    iconUrl: string;
    price: number;
    craftCost: number;
  }) => void;
  onIngredientClick?: (item: {
    id: number;
    name: string;
    iconUrl: string;
    price?: number;
  }) => void;
  expanded?: boolean;
  onToggle?: () => void;
}

const RecipeCard = ({
  recipe,
  ingredientPrices,
  resultPrice,
  onSell,
  onIngredientClick,
  expanded = false,
  onToggle,
}: RecipeCardProps) => {
  // Calculate craft cost
  const craftCost = recipe.ingredientIds.reduce((sum, ingId, index) => {
    const qty = recipe.quantities[index] || 0;
    const unitPrice = ingredientPrices.get(ingId)?.price || 0;
    return sum + unitPrice * qty;
  }, 0);

  const hdvTax = Math.floor(resultPrice * 0.02);
  const margin = resultPrice - craftCost - hdvTax;
  const marginPercent =
    craftCost > 0 ? Math.round((margin / craftCost) * 100) : 0;
  const isProfitable = margin > 0;
  const hasAllPrices =
    resultPrice > 0 &&
    recipe.ingredientIds.every((id) => ingredientPrices.has(id));

  return (
    <div
      className={`glass rounded-2xl overflow-hidden transition-all duration-300 ${
        isProfitable && hasAllPrices
          ? 'hover:shadow-lg hover:shadow-gain/5 border-gain/10'
          : ''
      }`}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-dark-800/30 transition-colors"
        onClick={onToggle}
      >
        {/* Result icon */}
        <img
          src={recipe.result?.img || `https://api.dofusdb.fr/img/items/${recipe.result?.iconId || 0}.png`}
          alt={recipe.resultName?.fr || ''}
          className="w-14 h-14 rounded-xl bg-dark-700/50 object-contain flex-shrink-0"
          loading="lazy"
        />

        {/* Info */}
        <div 
          className="flex-1 min-w-0 group/result cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onIngredientClick?.({
              id: recipe.resultId,
              name: recipe.resultName?.fr || '',
              iconUrl: recipe.result?.img || '',
              price: resultPrice
            });
          }}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-dark-100 truncate group-hover/result:text-kamas transition-colors">
              {recipe.resultName?.fr || `Item #${recipe.resultId}`}
            </h3>
            <Edit2 size={12} className="text-dark-500 opacity-0 group-hover/result:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="warning">Niv. {recipe.resultLevel}</Badge>
            {recipe.job?.name?.fr && <Badge>{recipe.job.name.fr}</Badge>}
          </div>
        </div>

        {/* Prices */}
        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs text-dark-500">Coût</p>
            <KamasDisplay
              amount={craftCost}
              size="sm"
              className="text-dark-300"
            />
          </div>
          <div className="text-right">
            <p className="text-xs text-dark-500">Vente</p>
            <KamasDisplay
              amount={resultPrice}
              size="sm"
              className="text-dark-200"
            />
          </div>
          <div className="text-right min-w-[80px]">
            <p className="text-xs text-dark-500">Marge (-2% tax)</p>
            {hasAllPrices ? (
              <div className="flex items-center gap-1 justify-end">
                <KamasDisplay amount={margin} size="sm" colored />
                <span
                  className={`text-[10px] ${
                    isProfitable ? 'text-gain' : 'text-loss'
                  }`}
                >
                  ({marginPercent > 0 ? '+' : ''}
                  {marginPercent}%)
                </span>
              </div>
            ) : (
              <span className="text-xs text-dark-500 italic block">Prix manquants</span>
            )}
          </div>

          {/* Expand toggle */}
          <div className="text-dark-500">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {/* Expanded: Ingredients + Sell button */}
      {expanded && (
        <div className="border-t border-dark-700/30 p-4 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {recipe.ingredients?.map((ingredient, index) => {
              const qty = recipe.quantities[index] || 0;
              const ingPriceObj = ingredientPrices.get(ingredient.id);
              const unitPrice = ingPriceObj?.price || 0;
              const totalPrice = unitPrice * qty;

              return (
                <div
                  key={ingredient.id}
                  onClick={() => onIngredientClick?.({
                    id: ingredient.id,
                    name: ingredient.name?.fr || '',
                    iconUrl: ingredient.img,
                    price: unitPrice
                  })}
                  className="flex items-center gap-3 p-2 rounded-lg bg-dark-800/30 hover:bg-dark-700/40 cursor-pointer transition-colors group"
                >
                  <img
                    src={ingredient.img}
                    alt={ingredient.name?.fr || ''}
                    className="w-8 h-8 rounded-lg bg-dark-700/50 object-contain"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-dark-200 truncate group-hover:text-kamas transition-colors">
                      {ingredient.name?.fr || `Item #${ingredient.id}`}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-dark-500">× {qty}</p>
                      {ingPriceObj?.updated_at && (
                        <span className="text-[9px] text-dark-600">
                          ({formatTimeAgo(ingPriceObj.updated_at)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    {unitPrice > 0 ? (
                      <KamasDisplay amount={totalPrice} size="sm" />
                    ) : (
                      <span className="text-[10px] text-loss italic">
                        Pas de prix
                      </span>
                    )}
                    <Edit2 size={12} className="text-dark-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            onClick={() =>
              onSell({
                id: recipe.resultId,
                name: recipe.resultName?.fr || '',
                iconUrl: recipe.result?.img || '',
                price: resultPrice,
                craftCost: craftCost,
              })
            }
            size="sm"
            className="w-full"
            disabled={!hasAllPrices}
          >
            <ShoppingCart size={14} />
            Mettre en vente
          </Button>
        </div>
      )}
    </div>
  );
};

export default RecipeCard;
