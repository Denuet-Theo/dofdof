'use client';

import { useState } from 'react';
import { DofusDBItem, DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Save, Check, Trophy, Copy, Hammer, ChevronDown, ChevronUp } from 'lucide-react';
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
  onPriceSaved?: (itemId: number, price: number, updated_at: string) => void;
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
  const [price, setPrice] = useState(currentPrice?.toString() || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopyName = async () => {
    const name = item.name?.fr || `Item #${item.id}`;
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  const handleSavePrice = async () => {
    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 0) return;

    setSaving(true);
    const supabase = createClient();
    const updated_at = new Date().toISOString();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('item_prices').upsert(
        {
          item_id: item.id,
          item_name: item.name?.fr || `Item #${item.id}`,
          icon_url: item.img,
          price: numPrice,
          updated_at,
          updated_by: user?.id,
        },
        { onConflict: 'item_id' }
      );

      if (error) throw error;

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onPriceSaved?.(item.id, numPrice, updated_at);
    } catch (err) {
      console.error('Error saving price:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`glass rounded-2xl p-4 hover:shadow-lg hover:shadow-kamas/5 transition-all duration-300 group ${
        isBest ? 'ring-1 ring-kamas/40' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={handleCopyName}
            title="Copier le nom dans le presse-papier"
            className="relative w-16 h-16 rounded-xl bg-dark-700/50 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform cursor-pointer"
          >
            <img
              src={item.img}
              alt={item.name?.fr || ''}
              className="w-12 h-12 object-contain"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-dark-950/70 opacity-0 hover:opacity-100 transition-opacity">
              <Copy size={16} className="text-dark-100" />
            </div>
          </button>
          {copied && (
            <span className="absolute -top-2 -right-2 z-10 whitespace-nowrap px-2 py-0.5 rounded-full bg-gain text-dark-950 text-[10px] font-semibold shadow-lg animate-fade-in">
              Copié !
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-dark-100 truncate">
              {item.name?.fr || `Item #${item.id}`}
            </h3>
            {isBest && (
              <Badge variant="success" className="flex items-center gap-1 flex-shrink-0">
                <Trophy size={10} /> Meilleur rapport
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
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
          </div>

          {/* Price input */}
          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Prix moyen..."
                min="0"
                className="w-full px-3 py-1.5 rounded-lg text-sm
                  bg-dark-800/80 border border-dark-600/50
                  text-dark-100 placeholder:text-dark-500
                  transition-all duration-200
                  hover:border-dark-500
                  focus:border-kamas/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-kamas">
                ⚜️
              </span>
            </div>
            <Button
              size="sm"
              onClick={handleSavePrice}
              loading={saving}
              variant={saved ? 'secondary' : 'primary'}
              disabled={!price || saving}
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
            </Button>
          </div>

          {/* Rentability: sell price always shown, craft price shown separately when known */}
          {(sellRatio > 0 || craftRatio > 0) && (
            <div className="mt-2 space-y-1 text-xs">
              {sellRatio > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-dark-500">Rentabilité (achat) :</span>
                  <span
                    className={`font-semibold ${usedCraft ? 'text-dark-300' : 'text-kamas'}`}
                  >
                    {sellRatio.toFixed(2)}
                  </span>
                  <span className="text-dark-400">pts/kama</span>
                </div>
              )}
              {craftRatio > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-dark-500">Rentabilité (craft) :</span>
                  <span
                    className={`font-semibold ${usedCraft ? 'text-purple-400' : 'text-dark-300'}`}
                  >
                    {craftRatio.toFixed(2)}
                  </span>
                  <span className="text-dark-400">pts/kama</span>
                  {usedCraft && (
                    <span
                      title={`Utilisé pour le classement (${effectivePrice.toLocaleString('fr-FR')} kamas, moins cher que l'achat)`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                        bg-purple-400/10 text-purple-400 border border-purple-400/20"
                    >
                      <Hammer size={10} />
                      Craft
                    </span>
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
                    <img
                      src={ingredient.img}
                      alt={ingredient.name?.fr || ''}
                      className="w-6 h-6 rounded-md bg-dark-700/50 object-contain flex-shrink-0"
                      loading="lazy"
                    />
                    <span className="flex-1 min-w-0 truncate text-dark-300">
                      {ingredient.name?.fr || `Item #${ingredient.id}`}{' '}
                      <span className="text-dark-500">× {qty}</span>
                    </span>
                    {unitPrice > 0 ? (
                      <span className="text-dark-400 flex-shrink-0">
                        {totalPrice.toLocaleString('fr-FR')} ⚜️
                      </span>
                    ) : (
                      <span className="text-loss italic flex-shrink-0">Pas de prix</span>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-xs pt-1.5 mt-1.5 border-t border-dark-700/20">
                <span className="text-dark-500">Coût total craft</span>
                <span className="font-semibold text-dark-200">
                  {craftCost > 0 ? `${craftCost.toLocaleString('fr-FR')} ⚜️` : '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GaugeItemCard;
