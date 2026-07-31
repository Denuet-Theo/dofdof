import ItemCard from '@/components/ui/ItemCard';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { ShoppingCart, ChevronDown, ChevronUp, Edit2 } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';
import { computeCraftCost, computeMargin, recipeHasAllPrices } from '@/lib/utils/recipes';

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
  const craftCost = computeCraftCost(recipe, ingredientPrices);
  const { margin, marginPercent } = computeMargin(resultPrice, craftCost);
  const isProfitable = margin > 0;
  const hasAllPrices = recipeHasAllPrices(recipe, ingredientPrices);

  const name = recipe.resultName?.fr || `Item #${recipe.resultId}`;
  const iconUrl =
    recipe.result?.img || `https://api.dofusdb.fr/img/items/${recipe.result?.iconId || 0}.png`;

  const details = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {recipe.ingredients?.map((ingredient, index) => {
          const qty = recipe.quantities[index] || 0;
          const ingPriceObj = ingredientPrices.get(ingredient.id);
          const unitPrice = ingPriceObj?.price || 0;
          const totalPrice = unitPrice * qty;

          return (
            <div
              key={ingredient.id}
              onClick={() =>
                onIngredientClick?.({
                  id: ingredient.id,
                  name: ingredient.name?.fr || '',
                  iconUrl: ingredient.img,
                  price: unitPrice,
                })
              }
              className="flex items-center gap-3 p-2 rounded-lg bg-dark-800/30 hover:bg-dark-700/40 cursor-pointer transition-colors group/ing"
            >
              <ItemCard.Icon
                src={ingredient.img}
                alt={ingredient.name?.fr || ''}
                size="sm"
                className="group-hover:scale-100"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-dark-200 truncate group-hover/ing:text-kamas transition-colors">
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
                  <span className="text-[10px] text-loss italic">Pas de prix</span>
                )}
                <Edit2
                  size={12}
                  className="text-dark-500 opacity-0 group-hover/ing:opacity-100 transition-opacity"
                />
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
            craftCost,
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

  return (
    <ItemCard
      layout="row"
      onClick={onToggle}
      expanded={expanded ? details : undefined}
      className={isProfitable && hasAllPrices ? 'hover:shadow-gain/5 border-gain/10' : ''}
    >
      <ItemCard.Icon src={iconUrl} alt={name} size="md" />

      <ItemCard.Body
        className="group/result cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onIngredientClick?.({
            id: recipe.resultId,
            name: recipe.resultName?.fr || '',
            iconUrl: recipe.result?.img || '',
            price: resultPrice,
          });
        }}
      >
        <div className="flex items-center gap-2">
          <ItemCard.Title className="group-hover/result:text-kamas transition-colors">
            {name}
          </ItemCard.Title>
          <Edit2
            size={12}
            className="text-dark-500 opacity-0 group-hover/result:opacity-100 transition-opacity"
          />
        </div>
        <ItemCard.Badges>
          <Badge variant="warning">Niv. {recipe.resultLevel}</Badge>
          {recipe.job?.name?.fr && <Badge>{recipe.job.name.fr}</Badge>}
        </ItemCard.Badges>
      </ItemCard.Body>

      <ItemCard.Metrics>
        <ItemCard.Metric label="Coût">
          <KamasDisplay amount={craftCost} size="sm" className="text-dark-300" />
        </ItemCard.Metric>
        <ItemCard.Metric label="Vente">
          <KamasDisplay amount={resultPrice} size="sm" className="text-dark-200" />
        </ItemCard.Metric>
        <ItemCard.Metric label="Marge (-2% tax)" className="min-w-[80px]">
          {hasAllPrices ? (
            <div className="flex items-center gap-1 justify-end">
              <KamasDisplay amount={margin} size="sm" colored />
              <span className={`text-[10px] ${isProfitable ? 'text-gain' : 'text-loss'}`}>
                ({marginPercent > 0 ? '+' : ''}
                {marginPercent}%)
              </span>
            </div>
          ) : (
            <span className="text-xs text-dark-500 italic block">Prix manquants</span>
          )}
        </ItemCard.Metric>

        <div className="text-dark-500">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </ItemCard.Metrics>
    </ItemCard>
  );
};

export default RecipeCard;
