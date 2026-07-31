'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Save, Check } from 'lucide-react';
import { saveItemPrice } from '@/lib/hooks/useItemPrices';

interface ItemPriceInputProps {
  itemId: number;
  itemName: string;
  iconUrl?: string | null;
  currentPrice?: number;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
  className?: string;
}

/** The inline "average price" field + save button shared by the item and gauge cards. */
const ItemPriceInput = ({
  itemId,
  itemName,
  iconUrl,
  currentPrice,
  onPriceSaved,
  className = '',
}: ItemPriceInputProps) => {
  const [price, setPrice] = useState(currentPrice?.toString() || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 0) return;

    setSaving(true);
    try {
      const updatedAt = await saveItemPrice({ itemId, itemName, iconUrl, price: numPrice });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onPriceSaved?.(itemId, numPrice, updatedAt);
    } catch (err) {
      console.error('Error saving price:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
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
        <img
          src="/kamas.svg"
          alt="Kamas"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
        />
      </div>
      <Button
        size="sm"
        onClick={handleSave}
        loading={saving}
        variant={saved ? 'secondary' : 'primary'}
        disabled={!price || saving}
      >
        {saved ? <Check size={14} /> : <Save size={14} />}
      </Button>
    </div>
  );
};

export default ItemPriceInput;
