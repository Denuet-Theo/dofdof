'use client';

import { useState } from 'react';
import { DofusDBItem, DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import ItemCard from '@/components/ui/ItemCard';
import Badge from '@/components/ui/Badge';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ItemPriceInput from '@/components/items/ItemPriceInput';
import { Trophy, Copy, Hammer, ChevronDown, ChevronUp } from 'lucide-react';
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
  craftCost: number;
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
  craftCost,
  recipe,
  ingredientPrices,
  isBest,
  onPriceSaved,
}: GaugeItemCardProps) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const name = item.name?.fr || `Item #${item.id}`;

  const handleCopyName = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  return (
    // The recipe panel is nested in the body rather than passed as `expanded`, so the card
    // is not clipped and the "Copié !" toast can bleed outside the border.
    <ItemCard layout="grid" highlight={isBest}>
      <div className="relative flex-shrink-0">
        <ItemCard.Icon
          src={item.img}
          alt={name}
          size="lg"
          onClick={handleCopyName}
          title="Copier le nom dans le presse-papier"
          overlay={<Copy size={16} className="text-dark-100" />}
        />
        {copied && (
          <span className="absolute -top-2 -right-2 z-10 whitespace-nowrap px-2 py-0.5 rounded-full bg-gain text-dark-950 text-[10px] font-semibold shadow-lg animate-fade-in">
            Copié !
          </span>
        )}
      </div>

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

        {/* Recipe */}
        {item.hasRecipe && recipe && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 mt-2 text-xs text-dark-500 hover:text-kamas transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Masquer la recette' : 'Voir la recette'}
          </button>
        )}

        {expanded && recipe && (
          <div className="mt-2 pt-2 border-t border-dark-700/30 space-y-1.5 animate-fade-in">
            {recipe.ingredients?.map((ingredient, index) => {
              const qty = recipe.quantities[index] || 0;
              const unitPrice = ingredientPrices.get(ingredient.id)?.price || 0;
              const totalPrice = unitPrice * qty;

              return (
                <div key={ingredient.id} className="flex items-center gap-2 text-xs">
                  <ItemCard.Icon
                    src={ingredient.img}
                    alt={ingredient.name?.fr || ''}
                    size="sm"
                    className="group-hover/item:scale-100"
                  />
                  <span className="flex-1 min-w-0 truncate text-dark-300">
                    {ingredient.name?.fr || `Item #${ingredient.id}`}{' '}
                    <span className="text-dark-500">× {qty}</span>
                  </span>
                  {unitPrice > 0 ? (
                    <KamasDisplay amount={totalPrice} size="sm" className="text-dark-400 flex-shrink-0" />
                  ) : (
                    <span className="text-loss italic flex-shrink-0">Pas de prix</span>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between text-xs pt-1.5 mt-1.5 border-t border-dark-700/20">
              <span className="text-dark-500">Coût total craft</span>
              {craftCost > 0 ? (
                <KamasDisplay amount={craftCost} size="sm" className="font-semibold text-dark-200" />
              ) : (
                <span className="font-semibold text-dark-200">—</span>
              )}
            </div>
          </div>
        )}
      </ItemCard.Body>
    </ItemCard>
  );
};

export default GaugeItemCard;
