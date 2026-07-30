'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DofusDBItem, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import SearchBar from '@/components/items/SearchBar';
import GaugeItemCard from '@/components/gauges/GaugeItemCard';
import Skeleton from '@/components/ui/Skeleton';
import { Gauge as GaugeIcon } from 'lucide-react';
import { parseGaugeInfo, computeValuePerKama, GaugeInfo } from '@/lib/utils/gauges';

// The 6 gauges fed by "Carburant d'enclos" items in the élevage profession
const ELEVAGE_GAUGES = ['Baffeur', 'Caresseur', 'Dragofesse', 'Foudroyeur', 'Abreuvoir', 'Mangeoire'];
// typeId 33 = "Pain": restores PV (e.g. Briochette) or Énergie (e.g. Borodinski) depending on the item
const PV_TYPE_ID = '33';

const GaugesPage = () => {
  const [items, setItems] = useState<DofusDBItem[]>([]);
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

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

  const runFetch = useCallback(async (params: URLSearchParams) => {
    setLoading(true);
    setSearched(true);
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
    (query: string) => runFetch(new URLSearchParams({ q: query, limit: '50' })),
    [runFetch]
  );

  const handleBrowseTypeId = useCallback(
    (typeId: string) => runFetch(new URLSearchParams({ typeId, limit: '50' })),
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

  const rows = items
    .map((item) => ({ item, gaugeInfo: parseGaugeInfo(item) }))
    .filter((row): row is { item: DofusDBItem; gaugeInfo: GaugeInfo } => row.gaugeInfo !== null)
    .map((row) => {
      const price = prices.get(row.item.id)?.price || 0;
      return { ...row, price, ratio: computeValuePerKama(row.gaugeInfo.rechargeAmount, price) };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const bestId = rows.find((r) => r.ratio > 0)?.item.id;

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
            onClick={() => handleSearch(gauge)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-800/80 border border-dark-600/50
              text-dark-300 transition-all hover:border-kamas/40 hover:text-kamas cursor-pointer"
          >
            {gauge}
          </button>
        ))}
        <span className="text-xs text-dark-500 ml-2">PV / Énergie :</span>
        <button
          type="button"
          onClick={() => handleBrowseTypeId(PV_TYPE_ID)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-800/80 border border-dark-600/50
            text-dark-300 transition-all hover:border-kamas/40 hover:text-kamas cursor-pointer"
        >
          Pains (Briochette, Borodinski...)
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {rows.map(({ item, gaugeInfo, ratio }) => (
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
            Essaie avec un autre nom (ex: Baffeur, Caresseur, Briochette...)
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
