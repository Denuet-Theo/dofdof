'use client';

import { useState } from 'react';
import { DofusDBItem } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Save, Check, Trophy } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';
import { GaugeInfo } from '@/lib/utils/gauges';

interface GaugeItemCardProps {
  item: DofusDBItem;
  gaugeInfo: GaugeInfo;
  currentPrice?: number;
  updatedAt?: string;
  ratio: number;
  isBest: boolean;
  onPriceSaved?: (itemId: number, price: number, updated_at: string) => void;
}

const GaugeItemCard = ({
  item,
  gaugeInfo,
  currentPrice,
  updatedAt,
  ratio,
  isBest,
  onPriceSaved,
}: GaugeItemCardProps) => {
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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('item_prices').upsert(
        {
          item_id: item.id,
          item_name: item.name?.fr || `Item #${item.id}`,
          icon_url: item.img,
          price: numPrice,
          updated_at,
          updated_by: user?.id,
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
    <div
      className={`glass rounded-2xl p-4 hover:shadow-lg hover:shadow-kamas/5 transition-all duration-300 group ${
        isBest ? 'ring-1 ring-kamas/40' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-dark-700/50 flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:scale-105 transition-transform">
          <img
            src={item.img}
            alt={item.name?.fr || ''}
            className="w-12 h-12 object-contain"
            loading="lazy"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-dark-100 truncate">
              {item.name?.fr || `Item #${item.id}`}
            </h3>
            {isBest && (
              <Badge variant="success" className="flex items-center gap-1 flex-shrink-0">
                <Trophy size={10} /> Meilleur rapport
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="warning">Niv. {item.level}</Badge>
            <Badge variant="info">
              +{gaugeInfo.rechargeAmount.toLocaleString('fr-FR')}
              {gaugeInfo.gaugeName === 'PV' || gaugeInfo.gaugeName === 'Énergie'
                ? ` ${gaugeInfo.gaugeName}`
                : gaugeInfo.capAmount !== gaugeInfo.rechargeAmount
                  ? ` (max ${gaugeInfo.capAmount.toLocaleString('fr-FR')})`
                  : ''}
            </Badge>
            {updatedAt && (
              <span className="text-[10px] text-dark-500">MAJ : {formatTimeAgo(updatedAt)}</span>
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

          {ratio > 0 && (
            <p className="text-xs text-dark-400 mt-2">
              <span className="text-kamas font-semibold">{ratio.toFixed(2)}</span> points de
              jauge par kama
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GaugeItemCard;
