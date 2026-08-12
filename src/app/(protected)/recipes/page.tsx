'use client';

import { useState, useEffect, useCallback, useTransition, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DofusDBRecipe, DofusDBItem, DofusDBResponse } from '@/lib/supabase/types';
import RecipeCard from '@/components/recipes/RecipeCard';
import { PriceTarget, SellTarget } from '@/components/recipes/RecipeDetails';
import SellModal from '@/components/recipes/SellModal';
import PriceModal from '@/components/recipes/PriceModal';
import RecipeModal from '@/components/recipes/RecipeModal';
import SearchBar from '@/components/items/SearchBar';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useItemPrices } from '@/lib/hooks/useItemPrices';
import { fetchRecipesForItems } from '@/lib/dofus/fetch-recipes';
import { ChefHat, Filter, ArrowDownAZ, RefreshCw, ArrowUp, ArrowDown, Hammer } from 'lucide-react';
import { JOBS } from '@/lib/constants/jobs';
import {
  computeCraftCost,
  computeMargin,
  recipeHasAllPrices,
  type UnitCost,
} from '@/lib/utils/recipes';
import { useCraftIndex } from '@/lib/hooks/useCraftIndex';

/** Cartes révélées à chaque « Voir plus ». */
const VISIBLE_STEP = 30;

/**
 * Taille d'une page côté serveur, pour les vues qui parcourent le catalogue au
 * lieu des seuls items tarifés. La branche « métier/niveau » était figée à 100
 * sans `skip` : elle montrait les 100 recettes d'id le plus bas du métier, et
 * rien ne permettait d'aller voir les suivantes.
 */
const CATALOG_PAGE_SIZE = 100;

const RecipesContent = () => {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  
  // `null` until a load has settled. The transition below only covers a load that is
  // actually running, so it can't stand in for "we haven't started yet".
  const [recipes, setRecipes] = useState<DofusDBRecipe[] | null>(null);
  // Ce que le serveur dit avoir en tout pour la requête courante, pour savoir
  // s'il reste une page à demander une fois les cartes chargées épuisées.
  const [total, setTotal] = useState(0);
  const [visible, setVisible] = useState(VISIBLE_STEP);
  const { prices, applyPriceSaved } = useItemPrices();
  // Les recettes des ingrédients : c'est ce qui permet de compter un composant
  // au moins cher de l'achat et de sa fabrication (#123).
  const { index: craftIndex, indexing } = useCraftIndex(recipes);
  const [loading, startLoading] = useTransition();
  const [loadingMore, startLoadingMore] = useTransition();
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

  /**
   * L'ingrédient dont on regarde la recette (#123).
   *
   * Une seule popin, repointée à chaque descente : ouvrir la recette d'un
   * composant d'un composant remplace la vue au lieu d'empiler des modales, ce
   * qui donne une profondeur libre sans jamais laisser deux fenêtres l'une sur
   * l'autre.
   */
  const [subRecipeItem, setSubRecipeItem] = useState<PriceTarget | null>(null);

  /**
   * Une page de résultats pour les filtres courants.
   *
   * `total` est ce que le serveur compte pour la requête, indépendamment de la
   * fenêtre renvoyée — sauf sur la branche des items tarifés, qui rapatrie tout
   * d'un coup et n'a donc jamais de page suivante à demander.
   */
  const fetchPage = useCallback(
    async (skip: number): Promise<{ data: DofusDBRecipe[]; total: number }> => {
      const params = new URLSearchParams({
        limit: String(CATALOG_PAGE_SIZE),
        skip: String(skip),
      });
      const hasLevelOrJobFilter = !!(jobId || minLevel || maxLevel);

      // If global search is active, we must find the item IDs first
      if (globalSearch && globalSearch.length >= 2) {
        const itemsRes = await fetch(`/api/dofusdb/items?q=${encodeURIComponent(globalSearch)}&limit=10`);
        const itemsData: DofusDBResponse<DofusDBItem> = await itemsRes.json();
        const itemIds = (itemsData.data || []).map(i => i.id);

        // Force no results if item not found
        if (itemIds.length === 0) return { data: [], total: 0 };
        params.set('resultIds', itemIds.join(','));
      } else if (!hasLevelOrJobFilter) {
        // No search or filter: fetch recipes for items we have priced
        const pricedIds = Array.from(prices.values()).filter(p => p.price > 0).map(p => p.item_id);
        // User has no prices set and no search, don't fetch random recipes
        if (pricedIds.length === 0) return { data: [], total: 0 };

        // Le vivier entier, découpé en tranches par le helper. Il était coupé
        // aux 100 premiers ids, donc au-delà de 100 prix la page ne montrait
        // qu'une part arbitraire des recettes réellement calculables — et le
        // tri par rentabilité juste en dessous classait sur cette part-là.
        const data = await fetchRecipesForItems(pricedIds);
        return { data, total: data.length };
      }
      // Browsing by job/level: query the full recipe catalog, not just priced items

      if (jobId) params.set('jobId', jobId);
      if (minLevel) params.set('minLevel', minLevel);
      if (maxLevel) params.set('maxLevel', maxLevel);

      const res = await fetch(`/api/dofusdb/recipes?${params}`);
      const body: DofusDBResponse<DofusDBRecipe> = await res.json();
      return { data: body.data || [], total: body.total || 0 };
    },
    [jobId, minLevel, maxLevel, globalSearch, prices]
  );

  const loadRecipes = useCallback(() => {
    startLoading(async () => {
      try {
        const page = await fetchPage(0);
        setRecipes(page.data);
        setTotal(page.total);
      } catch (err) {
        console.error('Error loading recipes:', err);
      }
    });
  }, [fetchPage]);

  useEffect(() => {
    // Only load recipes once prices are loaded or if we are searching/filtering
    if (prices.size > 0 || (globalSearch && globalSearch.length >= 2) || jobId || minLevel || maxLevel) {
      loadRecipes();
    }
  }, [loadRecipes, prices.size, globalSearch, jobId, minLevel, maxLevel]);

  // Changer de filtre repart du haut de la liste ; un simple rechargement (prix
  // modifié, bouton Actualiser) garde la profondeur déjà atteinte. D'où la remise
  // à zéro dans les gestionnaires plutôt que dans un effet sur les filtres.
  //
  // Stables par ailleurs : `SearchBar` garde `onSearch` en dépendance d'effet, et
  // un callback recréé à chaque rendu y relancerait la recherche en boucle.
  const changeSearch = useCallback((value: string) => {
    setGlobalSearch(value);
    setVisible(VISIBLE_STEP);
  }, []);

  const changeJob = useCallback((value: string) => {
    setJobId(value);
    setVisible(VISIBLE_STEP);
  }, []);

  const changeMinLevel = useCallback((value: string) => {
    setMinLevel(value);
    setVisible(VISIBLE_STEP);
  }, []);

  const changeMaxLevel = useCallback((value: string) => {
    setMaxLevel(value);
    setVisible(VISIBLE_STEP);
  }, []);

  // Un cache pour toute la passe de tri : les mêmes ingrédients reviennent dans
  // des dizaines de recettes, et l'arbre est identique pour toutes. Recréé à
  // chaque rendu, donc jamais périmé quand un prix change.
  const costs = new Map<number, UnitCost>();

  function craftCostOf(recipe: DofusDBRecipe): number {
    return computeCraftCost(recipe, prices, craftIndex, costs);
  }

  function getMargin(recipe: DofusDBRecipe): number {
    const resultPrice = prices.get(recipe.resultId)?.price || 0;
    return computeMargin(resultPrice, craftCostOf(recipe)).margin;
  }

  function hasAllPrices(recipe: DofusDBRecipe): boolean {
    return recipeHasAllPrices(recipe, prices, craftIndex, costs);
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
        const costA = craftCostOf(a);
        const costB = craftCostOf(b);
        const marginPercentA = costA > 0 ? (marginA / costA) * 100 : 0;
        const marginPercentB = costB > 0 ? (marginB / costB) * 100 : 0;
        cmp = marginPercentA - marginPercentB;
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });

  const loaded = recipes?.length ?? 0;
  // Deux réserves distinctes : ce qui est déjà chargé mais pas encore affiché,
  // et ce que le serveur garde en attente. La seconde est toujours nulle sur la
  // vue des items tarifés, qui a tout rapatrié d'un coup.
  const hidden = Math.max(0, sortedRecipes.length - visible);
  const unfetched = Math.max(0, total - loaded);
  const remaining = hidden + unfetched;

  const loadMore = () => {
    // Rien à demander tant qu'il reste des cartes chargées à révéler.
    if (hidden > 0) {
      setVisible(v => v + VISIBLE_STEP);
      return;
    }

    startLoadingMore(async () => {
      try {
        const page = await fetchPage(loaded);
        setRecipes(prev => [...(prev ?? []), ...page.data]);
        setTotal(page.total);
        setVisible(v => v + VISIBLE_STEP);
      } catch (err) {
        console.error('Error loading more recipes:', err);
      }
    });
  };

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
        onSearch={changeSearch}
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
              onChange={(e) => changeJob(e.target.value)}
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
              onChange={(e) => changeMinLevel(e.target.value)}
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
              onChange={(e) => changeMaxLevel(e.target.value)}
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
        <div className="space-y-3">
          {/* Tant que les recettes des ingrédients ne sont pas là, les coûts
              affichés sont ceux de l'achat seul et le classement va bouger sous
              les yeux. Le dire vaut mieux qu'un glissement silencieux. */}
          {indexing ? (
            <p className="text-[11px] text-dark-500 flex items-center gap-1.5">
              <Hammer size={11} className="text-craft" />
              Chargement des recettes de composants — les coûts affichés ne comptent
              encore que les prix d&apos;achat.
            </p>
          ) : null}

          <div className="space-y-3 stagger-children">
            {sortedRecipes.slice(0, visible).map((recipe) => (
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
                index={craftIndex}
                onOpenSubRecipe={setSubRecipeItem}
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <p className="text-xs text-dark-500">
              {Math.min(visible, sortedRecipes.length)} recette
              {Math.min(visible, sortedRecipes.length) > 1 ? 's' : ''} affichée
              {Math.min(visible, sortedRecipes.length) > 1 ? 's' : ''}
              {remaining > 0 && ` sur ${sortedRecipes.length + unfetched}`}
            </p>
            {remaining > 0 && (
              <Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore}>
                Voir plus ({remaining})
              </Button>
            )}
          </div>
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
      
      {/* La recette d'un ingrédient. `RecipeModal` la charge depuis l'id, donc
          rien à précharger : on ne descend que là où on clique. */}
      <RecipeModal
        isOpen={subRecipeItem !== null}
        onClose={() => setSubRecipeItem(null)}
        prices={prices}
        itemId={subRecipeItem?.id}
        onPriceSaved={applyPriceSaved}
        index={craftIndex}
        onOpenSubRecipe={setSubRecipeItem}
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
