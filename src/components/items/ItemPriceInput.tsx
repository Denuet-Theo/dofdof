'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Save, Check } from 'lucide-react';
import { priceSaveMessage, saveItemPrice } from '@/lib/hooks/useItemPrices';
import { reportWriteFailure } from '@/lib/errors/write-failures';

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
  const [error, setError] = useState('');

  // The same item can be priced from more than one card on screen — a resource
  // dropped by several monsters on /farm, say — so the field has to follow a
  // price that moved elsewhere. Keyed off a *change* in the prop rather than
  // its current value: re-seating on every render would wipe whatever is being
  // typed the moment the parent re-renders for an unrelated reason.
  const [lastSeen, setLastSeen] = useState(currentPrice);
  if (currentPrice !== lastSeen) {
    setLastSeen(currentPrice);
    setPrice(currentPrice?.toString() || '');
  }

  const handleSave = async () => {
    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 0) return;

    setSaving(true);
    setError('');
    try {
      const updatedAt = await saveItemPrice({ itemId, itemName, iconUrl, price: numPrice });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onPriceSaved?.(itemId, numPrice, updatedAt);
    } catch (err) {
      reportWriteFailure(`le prix de ${itemName}`, err);
      // La saisie reste dans le champ : c'est un échec d'enregistrement, pas une
      // frappe à refaire. L'item est nommé parce que la page en aligne des
      // dizaines, et qu'un message sous une carte perdue au milieu d'une grille
      // ne dit pas de lui-même de quoi il parle.
      setError(`${itemName} non enregistré — ${priceSaveMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              // Repartir de zéro dès la frappe suivante : garder l'échec affiché
              // au-dessus d'une valeur qu'on est en train de changer ferait lire
              // le message comme portant sur la nouvelle saisie.
              if (error) setError('');
            }}
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

      {error && (
        <p role="alert" className="mt-1.5 text-[10px] leading-snug text-loss break-words">
          {error}
        </p>
      )}
    </div>
  );
};

export default ItemPriceInput;
