'use client';

import { useState } from 'react';
import { DofusDBItem, DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import ItemCard from '@/components/ui/ItemCard';
import Badge from '@/components/ui/Badge';
import CopyableIcon from '@/components/ui/CopyableIcon';
import ItemPriceInput from '@/components/items/ItemPriceInput';
import RecipeModal from '@/components/recipes/RecipeModal';
import { Trophy, Hammer, Eye } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';
import { GaugeInfo } from '@/lib/utils/gauges';

interface GaugeItemCardProps {
  item: DofusDBItem;
  gaugeInfo: GaugeInfo;
  currentPrice?: number;
  updatedAt?: string;
  /** The price actually used for the page's ranking — the sell price, or the craft cost when cheaper. */
  effectivePrice: number;
  /** Whether `effectivePrice` came from crafting instead of the sell price. */
  usedCraft: boolean;
  sellRatio: number;
  craftRatio: number;
  recipe?: DofusDBRecipe;
  ingredientPrices: Map<number, ItemPrice>;
  isBest: boolean;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
}

const GaugeItemCard = ({
  item,
  gaugeInfo,
  currentPrice,
  updatedAt,
  effectivePrice,
  usedCraft,
  sellRatio,
  craftRatio,
  recipe,
  ingredientPrices,
  isBest,
  onPriceSaved,
}: GaugeItemCardProps) => {
  const [showRecipe, setShowRecipe] = useState(false);

  const name = item.name?.fr || `Item #${item.id}`;

  return (
    <>
      {/* Nothing is passed as `expanded`, so the card is never clipped and the "Copié !"
          toast can bleed outside the border. */}
      <ItemCard layout="grid" highlight={isBest}>
        <CopyableIcon src={item.img} name={name} size="lg" />

        <ItemCard.Body>
          <div className="flex items-center gap-2">
            <ItemCard.Title>{name}</ItemCard.Title>
            {isBest && (
              <Badge variant="success" className="flex items-center gap-1 flex-shrink-0">
                <Trophy size={10} /> Meilleur rapport
              </Badge>
            )}
          </div>

          <ItemCard.Badges>
            <Badge variant="warning">Niv. {item.level}</Badge>
            <Badge variant="info">
              +{gaugeInfo.rechargeAmount.toLocaleString('fr-FR')}
              {gaugeInfo.gaugeName === 'PV' || gaugeInfo.gaugeName === 'Énergie'
                ? ` ${gaugeInfo.gaugeName}`
                : gaugeInfo.capAmount !== gaugeInfo.rechargeAmount
                  ? ` (max ${gaugeInfo.capAmount.toLocaleString('fr-FR')})`
                  : ''}
            </Badge>
            {updatedAt && (
              <span className="text-[10px] text-dark-500">MAJ : {formatTimeAgo(updatedAt)}</span>
            )}
          </ItemCard.Badges>

          <ItemPriceInput
            className="mt-3"
            itemId={item.id}
            itemName={name}
            iconUrl={item.img}
            currentPrice={currentPrice}
            onPriceSaved={onPriceSaved}
          />

          {/* Rentability: sell price always shown, craft price shown separately when known */}
          {(sellRatio > 0 || craftRatio > 0) && (
            <div className="mt-2 space-y-1 text-xs">
              {sellRatio > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-dark-500">Rentabilité (achat) :</span>
                  <span className={`font-semibold ${usedCraft ? 'text-dark-300' : 'text-kamas'}`}>
                    {sellRatio.toFixed(2)}
                  </span>
                  <span className="text-dark-400">pts/kama</span>
                </div>
              )}
              {craftRatio > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-dark-500">Rentabilité (craft) :</span>
                  <span className={`font-semibold ${usedCraft ? 'text-craft' : 'text-dark-300'}`}>
                    {craftRatio.toFixed(2)}
                  </span>
                  <span className="text-dark-400">pts/kama</span>
                  {usedCraft && (
                    <Badge
                      variant="craft"
                      className="gap-1 px-1.5 py-0.5"
                      title={`Utilisé pour le classement (${effectivePrice.toLocaleString('fr-FR')} kamas, moins cher que l'achat)`}
                    >
                      <Hammer size={10} />
                      Craft
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Too narrow a card to lay the recipe out in place, so it opens in the popin —
              which, unlike the read-only panel this replaces, can edit every ingredient
              price and put the item on sale. */}
          {item.hasRecipe && recipe && (
            <button
              type="button"
              onClick={() => setShowRecipe(true)}
              className="flex items-center gap-1 mt-2 text-xs text-dark-500 hover:text-kamas transition-colors cursor-pointer"
            >
              <Eye size={12} />
              Voir la recette
            </button>
          )}
        </ItemCard.Body>
      </ItemCard>

      <RecipeModal
        isOpen={showRecipe}
        onClose={() => setShowRecipe(false)}
        recipe={recipe}
        prices={ingredientPrices}
        onPriceSaved={onPriceSaved}
      />
    </>
  );
};

export default GaugeItemCard;
