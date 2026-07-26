import KamasDisplay from '@/components/ui/KamasDisplay';
import { TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';

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

const JOBS = [
  { id: 2, name: 'Bûcheron' },
  { id: 11, name: 'Forgeron' },
  { id: 13, name: 'Sculpteur' },
  { id: 15, name: 'Cordonnier' },
  { id: 16, name: 'Bijoutier' },
  { id: 24, name: 'Mineur' },
  { id: 26, name: 'Alchimiste' },
  { id: 27, name: 'Tailleur' },
  { id: 28, name: 'Paysan' },
  { id: 36, name: 'Pêcheur' },
  { id: 41, name: 'Chasseur' },
  { id: 60, name: 'Façonneur' },
  { id: 65, name: 'Bricoleur' },
];

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
            <div
              key={recipe.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-dark-800/30 hover:bg-dark-800/60 transition-colors"
            >
              {/* Rank */}
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
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

              {/* Icon */}
              <img
                src={recipe.iconUrl}
                alt={recipe.name}
                className="w-8 h-8 rounded-lg bg-dark-700/50 object-contain shrink-0"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-200 truncate">
                  {recipe.name}
                </p>
                <div className="flex items-center gap-3 text-[10px] text-dark-500">
                  <span>
                    Coût: <KamasDisplay amount={recipe.craftCost} size="sm" />
                  </span>
                  <span>
                    Vente: <KamasDisplay amount={recipe.sellPrice} size="sm" />
                  </span>
                </div>
              </div>

              {/* Margin */}
              <div className="shrink-0 flex flex-col items-end">
                <KamasDisplay
                  amount={recipe.margin}
                  size="sm"
                  colored
                  className="font-bold"
                />
                {recipe.marginPercent !== undefined && (
                  <span className={`text-[10px] ${recipe.margin > 0 ? 'text-gain' : 'text-loss'}`}>
                    {recipe.marginPercent > 0 ? '+' : ''}{recipe.marginPercent}%
                  </span>
                )}
              </div>
            </div>
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
