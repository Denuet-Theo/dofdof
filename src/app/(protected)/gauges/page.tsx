'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DofusDBItem, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import SearchBar from '@/components/items/SearchBar';
import GaugeItemCard from '@/components/gauges/GaugeItemCard';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import { Gauge as GaugeIcon, Filter, ArrowDownAZ, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { parseGaugeInfo, computeValuePerKama, GaugeInfo } from '@/lib/utils/gauges';

// The 6 gauges fed by "Carburant d'enclos" items in the élevage profession
const ELEVAGE_GAUGES = ['Baffeur', 'Caresseur', 'Dragofesse', 'Foudroyeur', 'Abreuvoir', 'Mangeoire'];
// typeId 33 = "Pain": restores PV (e.g. Briochette) or Énergie (e.g. Borodinski) depending on the item
const PV_TYPE_ID = '33';

type SortBy = 'ratio' | 'alpha' | 'level';

const GaugesPage = () => {
  const [items, setItems] = useState<DofusDBItem[]>([]);
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Restricts results to one gauge name (e.g. only 'PV', not 'Énergie') when browsing a
  // category that mixes several gauges — free-text search leaves this unset.
  const [activeGaugeFilter, setActiveGaugeFilter] = useState<string | null>(null);
  const [minLevel, setMinLevel] = useState('');
  const [maxLevel, setMaxLevel] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('ratio');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  const runFetch = useCallback(async (params: URLSearchParams, gaugeFilter: string | null) => {
    setLoading(true);
    setSearched(true);
    setActiveGaugeFilter(gaugeFilter);
    try {
      const res = await fetch(`/api/dofusdb/items?${params}`);
      const data: DofusDBResponse<DofusDBItem> = await res.json();
      setItems(data.data || []);
    } catch (err) {
      console.error('Search error:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(
    (query: string, gaugeFilter: string | null = null) =>
      runFetch(new URLSearchParams({ q: query, limit: '50' }), gaugeFilter),
    [runFetch]
  );

  const handleBrowseTypeId = useCallback(
    (typeId: string, gaugeFilter: string | null) =>
      runFetch(new URLSearchParams({ typeId, limit: '50' }), gaugeFilter),
    [runFetch]
  );

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
    .filter((row) => !activeGaugeFilter || row.gaugeInfo.gaugeName === activeGaugeFilter)
    .filter((row) => !minLevel || row.item.level >= Number(minLevel))
    .filter((row) => !maxLevel || row.item.level <= Number(maxLevel))
    .map((row) => {
      const price = prices.get(row.item.id)?.price || 0;
      return { ...row, price, ratio: computeValuePerKama(row.gaugeInfo.rechargeAmount, price) };
    });

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
        onSearch={handleSearch}
        loading={loading}
        placeholder="Rechercher un carburant ou un aliment (ex: Baffeur, Briochette...)"
      />

      {/* Quick presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-dark-500">Jauges d&apos;enclos :</span>
        {ELEVAGE_GAUGES.map((gauge) => (
          <button
            key={gauge}
            type="button"
            onClick={() => handleSearch(gauge, gauge)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-800/80 border border-dark-600/50
              text-dark-300 transition-all hover:border-kamas/40 hover:text-kamas cursor-pointer"
          >
            {gauge}
          </button>
        ))}
        <span className="text-xs text-dark-500 ml-2">Aliments :</span>
        <button
          type="button"
          onClick={() => handleBrowseTypeId(PV_TYPE_ID, 'PV')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-800/80 border border-dark-600/50
            text-dark-300 transition-all hover:border-kamas/40 hover:text-kamas cursor-pointer"
        >
          PV (Briochette...)
        </button>
        <button
          type="button"
          onClick={() => handleBrowseTypeId(PV_TYPE_ID, 'Énergie')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-800/80 border border-dark-600/50
            text-dark-300 transition-all hover:border-kamas/40 hover:text-kamas cursor-pointer"
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
          {sortedRows.map(({ item, gaugeInfo, ratio }) => (
            <GaugeItemCard
              key={item.id}
              item={item}
              gaugeInfo={gaugeInfo}
              currentPrice={prices.get(item.id)?.price}
              updatedAt={prices.get(item.id)?.updated_at}
              ratio={ratio}
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
