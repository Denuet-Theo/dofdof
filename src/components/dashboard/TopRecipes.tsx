import ItemCard from '@/components/ui/ItemCard';
import KamasDisplay from '@/components/ui/KamasDisplay';
import { TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { JOBS } from '@/lib/constants/jobs';

interface TopRecipe {
  id: number;
  name: string;
  iconUrl: string;
  margin: number;
  marginPercent?: number;
  sellPrice: number;
  craftCost: number;
}

interface TopRecipesProps {
  recipes: TopRecipe[];
  jobId?: string;
  onJobChange?: (jobId: string) => void;
}

const TopRecipes = ({ recipes, jobId = '', onJobChange }: TopRecipesProps) => {
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
            <ItemCard key={recipe.id} layout="row" variant="flat">
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

              <ItemCard.Icon src={recipe.iconUrl} alt={recipe.name} size="sm" />

              <ItemCard.Body>
                <ItemCard.Title>{recipe.name}</ItemCard.Title>
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
    </div>
  );
};

export default TopRecipes;
