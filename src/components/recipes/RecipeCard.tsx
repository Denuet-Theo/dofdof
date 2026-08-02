'use client';

import { useState } from 'react';
import ItemCard from '@/components/ui/ItemCard';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import RecipeDetails, { PriceTarget, SellTarget } from '@/components/recipes/RecipeDetails';
import RecipeModal from '@/components/recipes/RecipeModal';
import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { ChevronDown, ChevronUp, Edit2, Eye } from 'lucide-react';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { computeCraftCost, computeMargin, recipeHasAllPrices } from '@/lib/utils/recipes';

interface RecipeCardProps {
  recipe: DofusDBRecipe;
  ingredientPrices: Map<number, ItemPrice>;
  resultPrice: number;
  onSell: (item: SellTarget) => void;
  onIngredientClick?: (item: PriceTarget) => void;
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
  // The ingredient grid needs the full width of the row; under `lg` there is none left
  // once the figures are in, so the recipe moves to the popin the other surfaces use.
  const fitsInline = useMediaQuery('(min-width: 1024px)');
  const [showPopin, setShowPopin] = useState(false);

  const craftCost = computeCraftCost(recipe, ingredientPrices);
  const { margin, marginPercent } = computeMargin(resultPrice, craftCost);
  const isProfitable = margin > 0;
  const hasAllPrices = recipeHasAllPrices(recipe, ingredientPrices);

  const name = recipe.resultName?.fr || `Item #${recipe.resultId}`;
  const iconUrl =
    recipe.result?.img || `https://api.dofusdb.fr/img/items/${recipe.result?.iconId || 0}.png`;

  const editResultPrice = () =>
    onIngredientClick?.({ id: recipe.resultId, name, iconUrl, price: resultPrice });

  const details = (
    <RecipeDetails
      recipe={recipe}
      prices={ingredientPrices}
      resultPrice={resultPrice}
      onEditPrice={(item) => onIngredientClick?.(item)}
      onSell={onSell}
    />
  );

  return (
    <>
      <ItemCard
        layout="row"
        onClick={fitsInline ? onToggle : () => setShowPopin(true)}
        expanded={fitsInline && expanded ? details : undefined}
        className={isProfitable && hasAllPrices ? 'hover:shadow-gain/5 border-gain/10' : ''}
      >
        {/* `toast={false}`: an expanded card clips its content, which would cut the badge. */}
        <CopyableIcon src={iconUrl} name={name} size="md" toast={false} />

        <ItemCard.Body>
          {/* Only the name edits the price — the badges beside it are "the rest of the
              line" and belong to the recipe, like anywhere else on the row. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              editResultPrice();
            }}
            title="Modifier le prix de vente"
            className="group/result flex items-center gap-2 max-w-full cursor-pointer"
          >
            <ItemCard.Title className="group-hover/result:text-kamas transition-colors">
              {name}
            </ItemCard.Title>
            <Edit2
              size={12}
              className="text-dark-500 flex-shrink-0 opacity-0 group-hover/result:opacity-100 transition-opacity"
            />
          </button>
          <ItemCard.Badges>
            <Badge variant="warning">Niv. {recipe.resultLevel}</Badge>
            {recipe.job?.name?.fr && <Badge>{recipe.job.name.fr}</Badge>}
          </ItemCard.Badges>
        </ItemCard.Body>

        <ItemCard.Metrics>
          {/* Dropped on phones so the margin and the recipe button keep their room —
              the popin shows all three figures again. */}
          <ItemCard.Metric label="Coût" hideOnMobile>
            <KamasDisplay amount={craftCost} size="sm" className="text-dark-300" />
          </ItemCard.Metric>
          <ItemCard.Metric label="Vente" hideOnMobile>
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

          {fitsInline ? (
            <div className="text-dark-500">
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              // The label collapses to the icon on phones, so name the button explicitly.
              aria-label="Voir la recette"
              title="Voir la recette"
              onClick={(e) => {
                e.stopPropagation();
                setShowPopin(true);
              }}
            >
              <Eye size={14} />
              <span className="hidden sm:inline">Voir la recette</span>
            </Button>
          )}
        </ItemCard.Metrics>
      </ItemCard>

      {/* The page owns the price and sell modals already, so the popin defers to them. */}
      {!fitsInline && (
        <RecipeModal
          isOpen={showPopin}
          onClose={() => setShowPopin(false)}
          recipe={recipe}
          prices={ingredientPrices}
          onEditPrice={onIngredientClick}
          onSell={onSell}
        />
      )}
    </>
  );
};

export default RecipeCard;
