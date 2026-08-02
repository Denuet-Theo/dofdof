'use client';

import { useState, useCallback } from 'react';
import { DofusDBItem, DofusDBResponse } from '@/lib/supabase/types';
import SearchBar from '@/components/items/SearchBar';
import ItemPriceCard from '@/components/items/ItemPriceCard';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useItemPrices } from '@/lib/hooks/useItemPrices';
import { Search, Database } from 'lucide-react';

type Tab = 'all' | 'resources' | 'craftable';

const ItemsPage = () => {
  const [items, setItems] = useState<DofusDBItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const { prices, applyPriceSaved } = useItemPrices();

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
              <ItemPriceCard
                key={item.id}
                item={item}
                prices={prices}
                currentPrice={itemPrice?.price}
                updatedAt={itemPrice?.updated_at}
                onPriceSaved={applyPriceSaved}
              />
            );
          })}
        </div>
      ) : searched ? (
        <EmptyState
          icon={Database}
          title="Aucun résultat trouvé"
          description="Essaie avec un autre terme de recherche ou change de filtre"
        />
      ) : (
        <EmptyState
          icon={Search}
          title="Recherche un item pour commencer"
          description={'Tape le nom d’un item Dofus (ex: « épée », « bouclier », « anneau »)'}
        />
      )}
    </div>
  );
};

export default ItemsPage;
