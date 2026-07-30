'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DofusDBItem, DofusDBRecipe, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import SearchBar from '@/components/items/SearchBar';
import GaugeItemCard from '@/components/gauges/GaugeItemCard';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import { Gauge as GaugeIcon, Filter, ArrowDownAZ, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { parseGaugeInfo, computeValuePerKama, GaugeInfo } from '@/lib/utils/gauges';
import { computeCraftCost } from '@/lib/utils/recipes';

// The 6 gauges fed by "Carburant d'enclos" items in the élevage profession
const ELEVAGE_GAUGES = ['Baffeur', 'Caresseur', 'Dragofesse', 'Foudroyeur', 'Abreuvoir', 'Mangeoire'];
// Every item type across all jobs whose consumables restore PV or Énergie: Pain, Friandise,
// Poisson comestible, Viande comestible, Boisson, Viande primitive — not just bread/Paysan.
const FOOD_TYPE_IDS = '33,42,49,69,79,187';
const FOOD_CHIPS = ['PV', 'Énergie'];
const PAGE_SIZE = 50;
// Headroom above the ~600 items currently spread across the food types above.
const MAX_FOOD_ITEMS = 700;

type SortBy = 'ratio' | 'alpha' | 'level';

const GaugesPage = () => {
  const [items, setItems] = useState<DofusDBItem[]>([]);
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Free-text term from the search box and the quick-select chip combine into one query,
  // instead of the chip overriding whatever the user already typed.
  const [textQuery, setTextQuery] = useState('');
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [minLevel, setMinLevel] = useState('');
  const [maxLevel, setMaxLevel] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('ratio');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Off by default: rentability uses the sell price only. When on, craftable items use
  // whichever is cheaper between buying at the sell price and crafting from ingredients.
  const [includeCraft, setIncludeCraft] = useState(false);
  const [recipesByResultId, setRecipesByResultId] = useState<Map<number, DofusDBRecipe>>(new Map());

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

  const runFetch = useCallback(async (params: URLSearchParams | null, paginate: boolean) => {
    if (!params) {
      setItems([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      params.set('limit', String(PAGE_SIZE));
      const firstRes = await fetch(`/api/dofusdb/items?${params}`);
      const firstData: DofusDBResponse<DofusDBItem> = await firstRes.json();
      let allItems = firstData.data || [];

      // The PV/Énergie browse spans ~600 items across 6 item types — one page of 50 would
      // silently drop most of them, so fetch the rest in parallel up to a safety cap.
      if (paginate) {
        const total = Math.min(firstData.total ?? allItems.length, MAX_FOOD_ITEMS);
        const skips: number[] = [];
        for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE) skips.push(skip);

        if (skips.length > 0) {
          const pages = await Promise.all(
            skips.map(async (skip) => {
              const pageParams = new URLSearchParams(params);
              pageParams.set('skip', String(skip));
              const res = await fetch(`/api/dofusdb/items?${pageParams}`);
              const data: DofusDBResponse<DofusDBItem> = await res.json();
              return data.data || [];
            })
          );
          allItems = allItems.concat(...pages);
        }
      }

      setItems(allItems);
    } catch (err) {
      console.error('Search error:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const hasText = textQuery.length >= 2;
    if (!hasText && !selectedChip) {
      runFetch(null, false);
      return;
    }

    const isFoodChip = FOOD_CHIPS.includes(selectedChip || '');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (isFoodChip) {
      params.set('typeId', FOOD_TYPE_IDS);
      if (hasText) params.set('q', textQuery);
    } else {
      const words = [textQuery, selectedChip].filter((w): w is string => !!w).join(' ');
      params.set('q', words);
    }
    runFetch(params, isFoodChip && !hasText);
  }, [textQuery, selectedChip, runFetch]);

  useEffect(() => {
    const craftableIds = items.filter((i) => i.hasRecipe).map((i) => i.id);

    const fetchRecipes = async () => {
      if (craftableIds.length === 0) {
        setRecipesByResultId(new Map());
        return;
      }
      try {
        const params = new URLSearchParams({
          resultIds: craftableIds.join(','),
          limit: String(craftableIds.length),
        });
        const res = await fetch(`/api/dofusdb/recipes?${params}`);
        const data: DofusDBResponse<DofusDBRecipe> = await res.json();
        const map = new Map<number, DofusDBRecipe>();
        (data.data || []).forEach((recipe) => map.set(recipe.resultId, recipe));
        setRecipesByResultId(map);
      } catch (err) {
        console.error('Recipe fetch error:', err);
        setRecipesByResultId(new Map());
      }
    };
    fetchRecipes();
  }, [items]);

  const handleChipClick = (chip: string) => {
    setSelectedChip((current) => (current === chip ? null : chip));
  };

  // Sell rentability and craft rentability are always both computed (when known) so the card
  // can show both; `includeCraft` only decides which one feeds the page's sort/best-value pick.
  const computePricing = (item: DofusDBItem, gaugeInfo: GaugeInfo) => {
    const sellPrice = prices.get(item.id)?.price || 0;
    const sellRatio = computeValuePerKama(gaugeInfo.rechargeAmount, sellPrice);

    const recipe = recipesByResultId.get(item.id);
    const allIngredientsPriced =
      !!recipe && recipe.ingredientIds.every((id) => (prices.get(id)?.price || 0) > 0);
    const craftCost = recipe && allIngredientsPriced ? computeCraftCost(recipe, prices) : 0;
    const craftRatio = craftCost > 0 ? computeValuePerKama(gaugeInfo.rechargeAmount, craftCost) : 0;

    const usedCraft = includeCraft && craftCost > 0 && (sellPrice <= 0 || craftCost < sellPrice);
    const price = usedCraft ? craftCost : sellPrice;
    const ratio = usedCraft ? craftRatio : sellRatio;

    return { sellPrice, sellRatio, recipe, craftCost, craftRatio, price, usedCraft, ratio };
  };

  const handlePriceSaved = (itemId: number, price: number, updated_at: string) => {
    setPrices((prev) => {
      const next = new Map(prev);
      const existing = next.get(itemId);
      next.set(itemId, {
        item_id: itemId,
        price,
        updated_at,
        item_name: existing?.item_name || '',
        icon_url: existing?.icon_url || null,
        updated_by: existing?.updated_by || null,
      });
      return next;
    });
  };

  const filteredRows = items
    .map((item) => ({ item, gaugeInfo: parseGaugeInfo(item) }))
    .filter((row): row is { item: DofusDBItem; gaugeInfo: GaugeInfo } => row.gaugeInfo !== null)
    .filter((row) => !selectedChip || row.gaugeInfo.gaugeName === selectedChip)
    .filter((row) => !minLevel || row.item.level >= Number(minLevel))
    .filter((row) => !maxLevel || row.item.level <= Number(maxLevel))
    .map((row) => ({ ...row, ...computePricing(row.item, row.gaugeInfo) }));

  const bestId = filteredRows.reduce<number | undefined>((bestItemId, row) => {
    if (row.ratio <= 0) return bestItemId;
    const bestRow = filteredRows.find((r) => r.item.id === bestItemId);
    return !bestRow || row.ratio > bestRow.ratio ? row.item.id : bestItemId;
  }, undefined);

  const sortedRows = [...filteredRows].sort((a, b) => {
    let cmp: number;
    if (sortBy === 'alpha') {
      cmp = (a.item.name?.fr || '').localeCompare(b.item.name?.fr || '');
    } else if (sortBy === 'level') {
      cmp = (a.item.level || 0) - (b.item.level || 0);
    } else {
      cmp = a.ratio - b.ratio;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
      active
        ? 'bg-kamas/15 text-kamas border-kamas/40'
        : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40 hover:text-kamas'
    }`;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <GaugeIcon size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Jauges & PV d&apos;élevage</h1>
        </div>
        <p className="text-dark-500 text-sm">
          Compare les carburants d&apos;enclos (Baffeur, Caresseur...) et les aliments qui
          restaurent des PV ou de l&apos;Énergie (Briochette, Borodinski...) pour trouver le
          meilleur rapport par kama
        </p>
      </div>

      <SearchBar
        onSearch={setTextQuery}
        loading={loading}
        placeholder="Rechercher un carburant ou un aliment (ex: Baffeur, Briochette...)"
      />

      {/* Quick presets — combine with the search box above instead of replacing it */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-dark-500">Jauges d&apos;enclos :</span>
        {ELEVAGE_GAUGES.map((gauge) => (
          <button
            key={gauge}
            type="button"
            onClick={() => handleChipClick(gauge)}
            className={chipClass(selectedChip === gauge)}
          >
            {gauge}
          </button>
        ))}
        <span className="text-xs text-dark-500 ml-2">Aliments :</span>
        <button
          type="button"
          onClick={() => handleChipClick('PV')}
          className={chipClass(selectedChip === 'PV')}
        >
          PV (Briochette...)
        </button>
        <button
          type="button"
          onClick={() => handleChipClick('Énergie')}
          className={chipClass(selectedChip === 'Énergie')}
        >
          Énergie (Borodinski...)
        </button>
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={16} className="text-kamas" />
          <h3 className="text-sm font-semibold text-dark-200">Filtres</h3>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-28">
            <label className="text-xs text-dark-400 mb-1 block">Niv. min</label>
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
            <label className="text-xs text-dark-400 mb-1 block">Niv. max</label>
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
            onClick={() => {
              setMinLevel('');
              setMaxLevel('');
            }}
          >
            <RefreshCw size={14} />
            Réinitialiser
          </Button>
        </div>

        <label className="flex items-center gap-2 mt-4 text-xs text-dark-400 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={includeCraft}
            onChange={(e) => setIncludeCraft(e.target.checked)}
            className="accent-kamas cursor-pointer"
          />
          Utiliser le prix de craft pour le classement quand il est moins cher que l&apos;achat
        </label>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-xs text-dark-500">
        <ArrowDownAZ size={14} />
        <span>Trier par</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-200 text-xs transition-all hover:border-dark-500 focus:border-kamas/50
            cursor-pointer"
        >
          <option value="ratio">Rentabilité</option>
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

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : sortedRows.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {sortedRows.map(({ item, gaugeInfo, price, usedCraft, sellRatio, craftRatio, craftCost, recipe }) => (
            <GaugeItemCard
              key={item.id}
              item={item}
              gaugeInfo={gaugeInfo}
              currentPrice={prices.get(item.id)?.price}
              updatedAt={prices.get(item.id)?.updated_at}
              effectivePrice={price}
              usedCraft={usedCraft}
              sellRatio={sellRatio}
              craftRatio={craftRatio}
              craftCost={craftCost}
              recipe={recipe}
              ingredientPrices={prices}
              isBest={item.id === bestId}
              onPriceSaved={handlePriceSaved}
            />
          ))}
        </div>
      ) : searched ? (
        <div className="text-center py-16">
          <GaugeIcon size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">Aucun résultat trouvé</p>
          <p className="text-dark-500 text-sm mt-1">
            Essaie avec un autre nom, ou élargis les filtres de niveau
          </p>
        </div>
      ) : (
        <div className="text-center py-16">
          <GaugeIcon size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">
            Recherche une jauge ou un aliment pour commencer
          </p>
          <p className="text-dark-500 text-sm mt-1">
            Renseigne les prix pour faire apparaître le meilleur rapport par kama
          </p>
        </div>
      )}
    </div>
  );
};

export default GaugesPage;
