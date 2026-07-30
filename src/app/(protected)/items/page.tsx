'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DofusDBItem, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import SearchBar from '@/components/items/SearchBar';
import ItemCard from '@/components/items/ItemCard';
import Skeleton from '@/components/ui/Skeleton';
import { Search, Database } from 'lucide-react';

type Tab = 'all' | 'resources' | 'craftable';

const ItemsPage = () => {
  const [items, setItems] = useState<DofusDBItem[]>([]);
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');

  // Load existing prices from Supabase
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

  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      setItems([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(
        `/api/dofusdb/items?q=${encodeURIComponent(query)}&limit=20`
      );
      const data: DofusDBResponse<DofusDBItem> = await res.json();
      setItems(data.data || []);
    } catch (err) {
      console.error('Search error:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const filteredItems = items.filter(item => {
    if (activeTab === 'resources') return !item.hasRecipe;
    if (activeTab === 'craftable') return item.hasRecipe;
    return true;
  });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Search size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Items & Prix</h1>
        </div>
        <p className="text-dark-500 text-sm">
          Recherche des items Dofus et configure leurs prix de vente moyens
        </p>
      </div>

      {/* Tabs & Search */}
      <div className="space-y-4">
        <div className="flex gap-1 p-1 glass rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-dark-600 text-white'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            Tous
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'resources'
                ? 'bg-kamas/15 text-kamas'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            Ressources (Base)
          </button>
          <button
            onClick={() => setActiveTab('craftable')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'craftable'
                ? 'bg-info/15 text-info'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            Craftables
          </button>
        </div>

        <SearchBar onSearch={handleSearch} loading={loading} />
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {filteredItems.map((item) => {
            const itemPrice = prices.get(item.id);
            return (
              <ItemCard
                key={item.id}
                item={item}
                currentPrice={itemPrice?.price}
                updatedAt={itemPrice?.updated_at}
                onPriceSaved={handlePriceSaved}
              />
            );
          })}
        </div>
      ) : searched ? (
        <div className="text-center py-16">
          <Database size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">
            Aucun résultat trouvé
          </p>
          <p className="text-dark-500 text-sm mt-1">
            Essaie avec un autre terme de recherche ou change de filtre
          </p>
        </div>
      ) : (
        <div className="text-center py-16">
          <Search size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">
            Recherche un item pour commencer
          </p>
          <p className="text-dark-500 text-sm mt-1">
            Tape le nom d&apos;un item Dofus (ex: &quot;épée&quot;, &quot;bouclier&quot;, &quot;anneau&quot;)
          </p>
        </div>
      )}
    </div>
  );
};

export default ItemsPage;
