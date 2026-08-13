'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import ItemPreview from '@/components/items/ItemPreview';
import { priceSaveMessage, saveItemPrice } from '@/lib/hooks/useItemPrices';
import { Save } from 'lucide-react';

interface PriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: number;
    name: string;
    iconUrl: string;
    price?: number;
    superTypeId?: number;
  } | null;
  onPriceSaved?: (itemId: number, price: number, updated_at: string) => void;
}

/**
 * Split out from the modal so it mounts fresh per item: the field seeds itself from the
 * item's current price at mount instead of an effect syncing it after the fact.
 */
const PriceForm = ({
  item,
  onClose,
  onPriceSaved,
}: {
  item: NonNullable<PriceModalProps['item']>;
  onClose: () => void;
  onPriceSaved?: PriceModalProps['onPriceSaved'];
}) => {
  const [price, setPrice] = useState(
    item.price !== undefined && item.price !== 0 ? item.price.toString() : ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const numPrice = parseInt(price, 10);

    if (isNaN(numPrice) || numPrice < 0) {
      setError('Prix invalide');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updatedAt = await saveItemPrice({
        itemId: item.id,
        itemName: item.name,
        iconUrl: item.iconUrl,
        price: numPrice,
      });

      onPriceSaved?.(item.id, numPrice, updatedAt);
      onClose();
    } catch (err) {
      console.error('Error saving price:', err);
      // `priceSaveMessage` et non `err.message` : PostgREST renvoie un objet nu,
      // qui n'est pas une `Error` — la modale retombait donc sur son texte
      // générique là où la base disait précisément ce qui n'allait pas.
      setError(priceSaveMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ItemPreview
        name={item.name}
        iconUrl={item.iconUrl}
        superTypeId={item.superTypeId}
        subtitle="Ajuste le prix moyen en HDV"
      />

      <Input
        label="Prix (kamas)"
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        min="0"
        required
        autoFocus
      />

      {error && (
        <div className="p-3 rounded-xl bg-loss/10 border border-loss/20 text-loss text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
          Annuler
        </Button>
        <Button type="submit" loading={loading} className="flex-1">
          <Save size={16} />
          Enregistrer
        </Button>
      </div>
    </form>
  );
};

const PriceModal = ({ isOpen, onClose, item, onPriceSaved }: PriceModalProps) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Ajuster le prix">
    {/* Keyed so switching item while the modal is up reseeds the field. */}
    {item && (
      <PriceForm key={item.id} item={item} onClose={onClose} onPriceSaved={onPriceSaved} />
    )}
  </Modal>
);

export default PriceModal;
