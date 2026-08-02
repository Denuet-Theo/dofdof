'use client';

import { useState } from 'react';
import ItemCard from '@/components/ui/ItemCard';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import RecipeModal from '@/components/recipes/RecipeModal';
import PriceModal from '@/components/recipes/PriceModal';
import { PriceTarget } from '@/components/recipes/RecipeDetails';
import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';
import { TrendingUp, ArrowRight, Edit2 } from 'lucide-react';
import Link from 'next/link';
import { JOBS } from '@/lib/constants/jobs';

export interface TopRecipe {
  id: number;
  name: string;
  iconUrl: string;
  margin: number;
  marginPercent?: number;
  sellPrice: number;
  craftCost: number;
  /** Kept alongside the figures so a row can open the same popin as everywhere else. */
  recipe: DofusDBRecipe;
}

interface TopRecipesProps {
  recipes: TopRecipe[];
  prices: Map<number, ItemPrice>;
  jobId?: string;
  onJobChange?: (jobId: string) => void;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
}

const TopRecipes = ({
  recipes,
  prices,
  jobId = '',
  onJobChange,
  onPriceSaved,
}: TopRecipesProps) => {
  const [openRecipe, setOpenRecipe] = useState<DofusDBRecipe | null>(null);
  const [priceTarget, setPriceTarget] = useState<PriceTarget | null>(null);

  return (
    <div className="glass rounded-2xl p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp size={20} className="text-kamas" />
          <h3 className="text-lg font-bold text-dark-100">Top 10 Recettes</h3>
        </div>

        {onJobChange && (
          <select
            value={jobId}
            onChange={(e) => onJobChange(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-dark-800/80 border border-dark-600/50
              text-dark-100 text-xs transition-all hover:border-dark-500 focus:border-kamas/50
              cursor-pointer"
          >
            <option value="">Tous les métiers</option>
            {JOBS.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {recipes.length === 0 ? (
          <p className="text-dark-500 text-sm text-center py-4">
            Aucune recette rentable trouvée. Configurez des prix dans l&apos;onglet Items ou sélectionnez un autre métier.
          </p>
        ) : (
          recipes.map((recipe, index) => (
            // Nested inside a panel, so the glass shell is swapped for a flat fill —
            // everything else (icon well, title, metric column) comes from the shared card.
            // The panel is far too narrow for the recipe, so the row opens the popin.
            <ItemCard
              key={recipe.id}
              layout="row"
              variant="flat"
              onClick={() => setOpenRecipe(recipe.recipe)}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                  index === 0
                    ? 'bg-kamas/20 text-kamas'
                    : index === 1
                      ? 'bg-dark-400/20 text-dark-300'
                      : index === 2
                        ? 'bg-orange-900/20 text-orange-400'
                        : 'bg-dark-700/50 text-dark-400'
                }`}
              >
                #{index + 1}
              </div>

              <CopyableIcon
                src={recipe.iconUrl}
                name={recipe.name}
                size="sm"
                toast={false}
                scaleOnHover={false}
              />

              <ItemCard.Body>
                {/* The name edits the price; the figures under it are part of the line
                    and open the recipe with the rest of the row. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPriceTarget({
                      id: recipe.id,
                      name: recipe.name,
                      iconUrl: recipe.iconUrl,
                      price: recipe.sellPrice,
                    });
                  }}
                  title="Modifier le prix de vente"
                  className="group/name flex items-center gap-2 max-w-full cursor-pointer"
                >
                  <ItemCard.Title className="group-hover/name:text-kamas transition-colors">
                    {recipe.name}
                  </ItemCard.Title>
                  <Edit2
                    size={10}
                    className="text-dark-500 flex-shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity"
                  />
                </button>
                <div className="flex items-center gap-3 text-[10px] text-dark-500 mt-0.5">
                  <span>
                    Coût: <KamasDisplay amount={recipe.craftCost} size="sm" />
                  </span>
                  <span>
                    Vente: <KamasDisplay amount={recipe.sellPrice} size="sm" />
                  </span>
                </div>
              </ItemCard.Body>

              <ItemCard.Metrics>
                <div className="flex flex-col items-end flex-shrink-0">
                  <KamasDisplay amount={recipe.margin} size="sm" colored className="font-bold" />
                  {recipe.marginPercent !== undefined && (
                    <span
                      className={`text-[10px] ${recipe.margin > 0 ? 'text-gain' : 'text-loss'}`}
                    >
                      {recipe.marginPercent > 0 ? '+' : ''}
                      {recipe.marginPercent}%
                    </span>
                  )}
                </div>
              </ItemCard.Metrics>
            </ItemCard>
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-dark-700/50">
        <Link
          href="/recipes"
          className="flex items-center justify-center gap-2 text-sm text-kamas hover:text-kamas/80 transition-colors py-2 rounded-lg hover:bg-kamas/10"
        >
          <span>Voir toutes les recettes</span>
          <ArrowRight size={16} />
        </Link>
      </div>

      <RecipeModal
        isOpen={openRecipe !== null}
        onClose={() => setOpenRecipe(null)}
        recipe={openRecipe ?? undefined}
        prices={prices}
        onPriceSaved={onPriceSaved}
      />

      {/* Clicking a title edits its price without going through the recipe first. */}
      <PriceModal
        isOpen={priceTarget !== null}
        onClose={() => setPriceTarget(null)}
        item={priceTarget}
        onPriceSaved={onPriceSaved}
      />
    </div>
  );
};

export default TopRecipes;
