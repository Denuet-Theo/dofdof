'use client';

import { useState } from 'react';
import { DofusDBItem } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Save, Check } from 'lucide-react';

import { formatTimeAgo } from '@/lib/utils/date';

interface ItemCardProps {
  item: DofusDBItem;
  currentPrice?: number;
  updatedAt?: string;
  onPriceSaved?: (itemId: number, price: number, updated_at: string) => void;
}

const ItemCard = ({ item, currentPrice, updatedAt, onPriceSaved }: ItemCardProps) => {
  const [price, setPrice] = useState(currentPrice?.toString() || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSavePrice = async () => {
    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 0) return;

    setSaving(true);
    const supabase = createClient();
    const updated_at = new Date().toISOString();

    try {
      const { error } = await supabase.from('item_prices').upsert(
        {
          item_id: item.id,
          item_name: item.name?.fr || `Item #${item.id}`,
          icon_url: item.img,
          price: numPrice,
          updated_at,
        },
        { onConflict: 'item_id' }
      );

      if (error) throw error;

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onPriceSaved?.(item.id, numPrice, updated_at);
    } catch (err) {
      console.error('Error saving price:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-4 hover:shadow-lg hover:shadow-kamas/5 transition-all duration-300 group">
      <div className="flex items-start gap-4">
        {/* Item image */}
        <div className="w-16 h-16 rounded-xl bg-dark-700/50 flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:scale-105 transition-transform">
          <img
            src={item.img}
            alt={item.name?.fr || ''}
            className="w-12 h-12 object-contain"
            loading="lazy"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-dark-100 truncate">
            {item.name?.fr || `Item #${item.id}`}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="warning">Niv. {item.level}</Badge>
            {item.type?.name?.fr && (
              <Badge>{item.type.name.fr}</Badge>
            )}
            {item.hasRecipe && (
              <a href={`/recipes?search=${encodeURIComponent(item.name?.fr || '')}`} className="inline-flex">
                <Badge variant="info" className="hover:bg-info/20 cursor-pointer transition-colors">
                  Voir la recette →
                </Badge>
              </a>
            )}
            {updatedAt && (
              <span className="text-[10px] text-dark-500 mt-0.5 block">
                MAJ : {formatTimeAgo(updatedAt)}
              </span>
            )}
          </div>

          {/* Price input */}
          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Prix moyen..."
                min="0"
                className="w-full px-3 py-1.5 rounded-lg text-sm
                  bg-dark-800/80 border border-dark-600/50
                  text-dark-100 placeholder:text-dark-500
                  transition-all duration-200
                  hover:border-dark-500
                  focus:border-kamas/50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-kamas">
                ⚜️
              </span>
            </div>
            <Button
              size="sm"
              onClick={handleSavePrice}
              loading={saving}
              variant={saved ? 'secondary' : 'primary'}
              disabled={!price || saving}
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
