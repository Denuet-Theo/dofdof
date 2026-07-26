'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DofusDBRecipe, DofusDBItem, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import RecipeCard from '@/components/recipes/RecipeCard';
import SellModal from '@/components/recipes/SellModal';
import PriceModal from '@/components/recipes/PriceModal';
import SearchBar from '@/components/items/SearchBar';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import { ChefHat, Filter, ArrowDownAZ, RefreshCw } from 'lucide-react';

const JOBS = [
  { id: 2, name: 'Bûcheron' },
  { id: 11, name: 'Forgeron' },
  { id: 13, name: 'Sculpteur' },
  { id: 14, name: 'Cordonnier' },
  { id: 15, name: 'Bijoutier' },
  { id: 16, name: 'Tailleur' },
  { id: 17, name: 'Alchimiste' },
  { id: 18, name: 'Boulanger' },
  { id: 24, name: 'Mineur' },
  { id: 25, name: 'Pêcheur' },
  { id: 26, name: 'Chasseur' },
  { id: 27, name: 'Paysan' },
  { id: 36, name: 'Façonneur' },
  { id: 41, name: 'Bricoleur' },
];

const RecipesContent = () => {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  
  const [recipes, setRecipes] = useState<DofusDBRecipe[]>([]);
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<string>('');
  const [minLevel, setMinLevel] = useState('');
  const [maxLevel, setMaxLevel] = useState('');
  const [globalSearch, setGlobalSearch] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sellItem, setSellItem] = useState<{
    id: number;
    name: string;
    iconUrl: string;
    price: number;
    craftCost: number;
  } | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);
  
  const [editPriceItem, setEditPriceItem] = useState<{
    id: number;
    name: string;
    iconUrl: string;
    price?: number;
  } | null>(null);
  const [showPriceModal, setShowPriceModal] = useState(false);

  // Load prices from Supabase
  useEffect(() => {
    const loadPrices = async () => {
      const supabase = createClient();
      const { data } = await supabase.from('item_prices').select('*');
      if (data) {
        const priceMap = new Map<number, ItemPrice>();
        data.forEach((p: ItemPrice) => priceMap.set(p.item_id, p));
        setPrices(priceMap);
      }
    };
    loadPrices();
  }, []);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      
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
          setLoading(false);
          return;
        }
      } else {
        // No search: fetch recipes for items we have priced
        const pricedIds = Array.from(prices.values()).filter(p => p.price > 0).map(p => p.item_id);
        if (pricedIds.length > 0) {
          // Chunk to avoid URL too long if user has many prices. Let's take the first 100 for now.
          params.set('resultIds', pricedIds.slice(0, 100).join(','));
          params.set('limit', '100');
        } else {
          // User has no prices set and no search, don't fetch random recipes
          setRecipes([]);
          setLoading(false);
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
    } finally {
      setLoading(false);
    }
  }, [jobId, minLevel, maxLevel, globalSearch, prices]);

  useEffect(() => {
    // Only load recipes once prices are loaded
    if (prices.size > 0 || (globalSearch && globalSearch.length >= 2)) {
      loadRecipes();
    }
  }, [loadRecipes, prices.size, globalSearch]);

  function getMargin(recipe: DofusDBRecipe): number {
    const resultPrice = prices.get(recipe.resultId)?.price || 0;
    const craftCost = recipe.ingredientIds.reduce((sum, ingId, index) => {
      const qty = recipe.quantities[index] || 0;
      return sum + (prices.get(ingId)?.price || 0) * qty;
    }, 0);
    const hdvTax = Math.floor(resultPrice * 0.02);
    return resultPrice - craftCost - hdvTax;
  }
  
  function hasAllPrices(recipe: DofusDBRecipe): boolean {
    const resultPrice = prices.get(recipe.resultId)?.price || 0;
    if (resultPrice <= 0) return false;
    return recipe.ingredientIds.every(id => (prices.get(id)?.price || 0) > 0);
  }

  // Sort recipes by profitability
  const sortedRecipes = [...recipes]
    .filter(recipe => {
      // If there is no search, only show recipes where we have all prices
      if (!globalSearch) {
        return hasAllPrices(recipe);
      }
      return true;
    })
    .sort((a, b) => {
      const marginA = getMargin(a);
      const marginB = getMargin(b);
      return marginB - marginA;
    });

  const handleSell = (item: {
    id: number;
    name: string;
    iconUrl: string;
    price: number;
    craftCost: number;
  }) => {
    setSellItem(item);
    setShowSellModal(true);
  };
  
  const handleIngredientClick = (item: {
    id: number;
    name: string;
    iconUrl: string;
    price?: number;
  }) => {
    setEditPriceItem(item);
    setShowPriceModal(true);
  };
  
  const handlePriceSaved = (itemId: number, newPrice: number, updated_at: string) => {
    // Update local state instantly so the margin re-calculates without refetching
    setPrices(prev => {
      const next = new Map(prev);
      const existing = next.get(itemId);
      next.set(itemId, {
        item_id: itemId,
        price: newPrice,
        updated_at,
        item_name: existing?.item_name || '',
        icon_url: existing?.icon_url || null,
        updated_by: existing?.updated_by || null,
      });
      return next;
    });
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

      {/* Sort indicator */}
      <div className="flex items-center gap-2 text-xs text-dark-500">
        <ArrowDownAZ size={14} />
        Trié par rentabilité décroissante
      </div>

      {/* Recipes list */}
      {loading ? (
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
        <div className="text-center py-16">
          <ChefHat size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">
            Aucune recette trouvée
          </p>
          <p className="text-dark-500 text-sm mt-1">
            Modifie les filtres pour voir d&apos;autres recettes
          </p>
        </div>
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
        onPriceSaved={handlePriceSaved}
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
