'use client';

import { useState } from 'react';
import ItemCard from '@/components/ui/ItemCard';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import RecipeModal from '@/components/recipes/RecipeModal';
import { ItemPrice, DofusDBRecipe } from '@/lib/supabase/types';
import { ProfitableRecipe } from '@/lib/utils/recipes';
import { Sparkles } from 'lucide-react';

interface UnlockedRecipesProps {
  recipes: ProfitableRecipe[];
  prices: Map<number, ItemPrice>;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
}

/**
 * Le retour immédiat d'une saisie de prix : les recettes qu'elle vient de rendre
 * rentables. Sans ça, remplir un prix n'a qu'un effet différé et invisible —
 * c'est précisément ce qui faisait qu'on ne les remplissait pas.
 */
const UnlockedRecipes = ({ recipes, prices, onPriceSaved }: UnlockedRecipesProps) => {
  const [openRecipe, setOpenRecipe] = useState<DofusDBRecipe | null>(null);

  if (recipes.length === 0) return null;

  return (
    <div className="mt-6 pt-6 border-t border-dark-700/50 animate-slide-up">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} className="text-gain" />
        <h4 className="text-sm font-bold text-gain">Débloqué par tes saisies</h4>
        <span className="text-xs text-dark-500">
          {recipes.length} recette{recipes.length > 1 ? 's' : ''} rentable
          {recipes.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recipes.map(({ recipe, margin, marginPercent, craftCost, sellPrice }) => {
          const name = recipe.resultName?.fr || `Item #${recipe.resultId}`;

          return (
            <ItemCard
              key={recipe.resultId}
              layout="row"
              variant="flat"
              className="border border-gain/20 bg-gain/5"
              onClick={() => setOpenRecipe(recipe)}
            >
              <CopyableIcon
                src={recipe.result?.img || ''}
                name={name}
                size="sm"
                toast={false}
                scaleOnHover={false}
              />

              <ItemCard.Body>
                <ItemCard.Title>{name}</ItemCard.Title>
                <div className="flex items-center gap-3 text-[10px] text-dark-500 mt-0.5">
                  <span>
                    Coût: <KamasDisplay amount={craftCost} size="sm" />
                  </span>
                  <span>
                    Vente: <KamasDisplay amount={sellPrice} size="sm" />
                  </span>
                </div>
              </ItemCard.Body>

              <ItemCard.Metrics>
                <div className="flex flex-col items-end flex-shrink-0">
                  <KamasDisplay amount={margin} size="sm" colored className="font-bold" />
                  <span className="text-[10px] text-gain">+{marginPercent}%</span>
                </div>
              </ItemCard.Metrics>
            </ItemCard>
          );
        })}
      </div>

      <RecipeModal
        isOpen={openRecipe !== null}
        onClose={() => setOpenRecipe(null)}
        recipe={openRecipe ?? undefined}
        prices={prices}
        onPriceSaved={onPriceSaved}
      />
    </div>
  );
};

export default UnlockedRecipes;
