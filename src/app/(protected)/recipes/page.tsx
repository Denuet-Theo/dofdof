'use client';

import { useState, useEffect, useCallback, useTransition, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DofusDBRecipe, DofusDBItem, DofusDBResponse } from '@/lib/supabase/types';
import RecipeCard from '@/components/recipes/RecipeCard';
import { PriceTarget, SellTarget } from '@/components/recipes/RecipeDetails';
import SellModal from '@/components/recipes/SellModal';
import PriceModal from '@/components/recipes/PriceModal';
import SearchBar from '@/components/items/SearchBar';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useItemPrices } from '@/lib/hooks/useItemPrices';
import { ChefHat, Filter, ArrowDownAZ, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { JOBS } from '@/lib/constants/jobs';
import { computeCraftCost, computeMargin, recipeHasAllPrices } from '@/lib/utils/recipes';

const RecipesContent = () => {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  
  // `null` until a load has settled. The transition below only covers a load that is
  // actually running, so it can't stand in for "we haven't started yet".
  const [recipes, setRecipes] = useState<DofusDBRecipe[] | null>(null);
  const { prices, applyPriceSaved } = useItemPrices();
  const [loading, startLoading] = useTransition();
  const [jobId, setJobId] = useState<string>('');
  const [minLevel, setMinLevel] = useState('');
  const [maxLevel, setMaxLevel] = useState('');
  const [globalSearch, setGlobalSearch] = useState(initialSearch);
  const [sortBy, setSortBy] = useState<'margin' | 'alpha' | 'level'>('margin');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sellItem, setSellItem] = useState<SellTarget | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);

  const [editPriceItem, setEditPriceItem] = useState<PriceTarget | null>(null);
  const [showPriceModal, setShowPriceModal] = useState(false);

  const loadRecipes = useCallback(() => {
    startLoading(async () => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        const hasLevelOrJobFilter = !!(jobId || minLevel || maxLevel);

        // If global search is active, we must find the item IDs first
        if (globalSearch && globalSearch.length >= 2) {
          const itemsRes = await fetch(`/api/dofusdb/items?q=${encodeURIComponent(globalSearch)}&limit=10`);
          const itemsData: DofusDBResponse<DofusDBItem> = await itemsRes.json();
          const itemIds = (itemsData.data || []).map(i => i.id);

          if (itemIds.length > 0) {
            params.set('resultIds', itemIds.join(','));
          } else {
            // Force no results if item not found
            setRecipes([]);
            return;
          }
        } else if (hasLevelOrJobFilter) {
          // Browsing by job/level: query the full recipe catalog, not just priced items
          params.set('limit', '100');
        } else {
          // No search or filter: fetch recipes for items we have priced
          const pricedIds = Array.from(prices.values()).filter(p => p.price > 0).map(p => p.item_id);
          if (pricedIds.length > 0) {
            // Chunk to avoid URL too long if user has many prices. Let's take the first 100 for now.
            params.set('resultIds', pricedIds.slice(0, 100).join(','));
            params.set('limit', '100');
          } else {
            // User has no prices set and no search, don't fetch random recipes
            setRecipes([]);
            return;
          }
        }

        if (jobId) params.set('jobId', jobId);
        if (minLevel) params.set('minLevel', minLevel);
        if (maxLevel) params.set('maxLevel', maxLevel);

        const res = await fetch(`/api/dofusdb/recipes?${params}`);
        const data: DofusDBResponse<DofusDBRecipe> = await res.json();
        setRecipes(data.data || []);
      } catch (err) {
        console.error('Error loading recipes:', err);
      }
    });
  }, [jobId, minLevel, maxLevel, globalSearch, prices]);

  useEffect(() => {
    // Only load recipes once prices are loaded or if we are searching/filtering
    if (prices.size > 0 || (globalSearch && globalSearch.length >= 2) || jobId || minLevel || maxLevel) {
      loadRecipes();
    }
  }, [loadRecipes, prices.size, globalSearch, jobId, minLevel, maxLevel]);

  function getMargin(recipe: DofusDBRecipe): number {
    const resultPrice = prices.get(recipe.resultId)?.price || 0;
    const craftCost = computeCraftCost(recipe, prices);
    return computeMargin(resultPrice, craftCost).margin;
  }

  function hasAllPrices(recipe: DofusDBRecipe): boolean {
    return recipeHasAllPrices(recipe, prices);
  }

  // Sort recipes by profitability
  const sortedRecipes = [...(recipes ?? [])]
    .filter(recipe => {
      // If there is no active search/filter, only show recipes where we have all prices
      if (!globalSearch && !jobId && !minLevel && !maxLevel) {
        return hasAllPrices(recipe);
      }
      return true;
    })
    .sort((a, b) => {
      let cmp: number;

      if (sortBy === 'alpha') {
        const nameA = a.resultName?.fr || '';
        const nameB = b.resultName?.fr || '';
        cmp = nameA.localeCompare(nameB);
      } else if (sortBy === 'level') {
        cmp = (a.resultLevel || 0) - (b.resultLevel || 0);
      } else {
        const marginA = getMargin(a);
        const marginB = getMargin(b);
        const costA = computeCraftCost(a, prices);
        const costB = computeCraftCost(b, prices);
        const marginPercentA = costA > 0 ? (marginA / costA) * 100 : 0;
        const marginPercentB = costB > 0 ? (marginB / costB) * 100 : 0;
        cmp = marginPercentA - marginPercentB;
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });

  const handleSell = (item: SellTarget) => {
    setSellItem(item);
    setShowSellModal(true);
  };

  const handleIngredientClick = (item: PriceTarget) => {
    setEditPriceItem(item);
    setShowPriceModal(true);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <ChefHat size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">
            Calculateur de Recettes
          </h1>
        </div>
        <p className="text-dark-500 text-sm">
          Calcule automatiquement la rentabilité de chaque craft
        </p>
      </div>

      {/* Global Search */}
      <SearchBar
        onSearch={setGlobalSearch}
        loading={loading && !!globalSearch}
        placeholder="Rechercher une recette par nom (ex: Boudin noir)..."
        defaultValue={initialSearch}
      />

      {/* Filters */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={16} className="text-kamas" />
          <h3 className="text-sm font-semibold text-dark-200">Filtres</h3>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-dark-400 mb-1 block">Métier</label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50
                cursor-pointer"
            >
              <option value="">Tous les métiers</option>
              {JOBS.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-28">
            <label className="text-xs text-dark-400 mb-1 block">
              Niv. min
            </label>
            <input
              type="number"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              placeholder="1"
              min="1"
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
            />
          </div>

          <div className="w-28">
            <label className="text-xs text-dark-400 mb-1 block">
              Niv. max
            </label>
            <input
              type="number"
              value={maxLevel}
              onChange={(e) => setMaxLevel(e.target.value)}
              placeholder="200"
              min="1"
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={loadRecipes}
          >
            <RefreshCw size={14} />
            Actualiser
          </Button>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-xs text-dark-500">
        <ArrowDownAZ size={14} />
        <span>Trier par</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'margin' | 'alpha' | 'level')}
          className="px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-200 text-xs transition-all hover:border-dark-500 focus:border-kamas/50
            cursor-pointer"
        >
          <option value="margin">Rentabilité</option>
          <option value="alpha">Alphabétique</option>
          <option value="level">Niveau</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-200 transition-all hover:border-dark-500 cursor-pointer"
        >
          {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          {sortDir === 'asc' ? 'Croissant' : 'Décroissant'}
        </button>
      </div>

      {/* Recipes list */}
      {loading || recipes === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" count={5} />
        </div>
      ) : sortedRecipes.length > 0 ? (
        <div className="space-y-3 stagger-children">
          {sortedRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              ingredientPrices={prices}
              resultPrice={prices.get(recipe.resultId)?.price || 0}
              onSell={handleSell}
              onIngredientClick={handleIngredientClick}
              expanded={expandedId === recipe.id}
              onToggle={() =>
                setExpandedId(expandedId === recipe.id ? null : recipe.id)
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ChefHat}
          title="Aucune recette trouvée"
          description={'Modifie les filtres pour voir d’autres recettes'}
        />
      )}

      {/* Modals */}
      <SellModal
        isOpen={showSellModal}
        onClose={() => {
          setShowSellModal(false);
          setSellItem(null);
        }}
        item={sellItem}
        onSold={loadRecipes}
      />
      
      <PriceModal
        isOpen={showPriceModal}
        onClose={() => {
          setShowPriceModal(false);
          setEditPriceItem(null);
        }}
        item={editPriceItem}
        onPriceSaved={applyPriceSaved}
      />
    </div>
  );
};

const RecipesPage = () => {
  return (
    <Suspense fallback={<div>Chargement...</div>}>
      <RecipesContent />
    </Suspense>
  );
};

export default RecipesPage;
