'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import ItemPreview from '@/components/items/ItemPreview';
import { saveItemPrice } from '@/lib/hooks/useItemPrices';
import { Save } from 'lucide-react';

interface PriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: number;
    name: string;
    iconUrl: string;
    price?: number;
  } | null;
  onPriceSaved?: (itemId: number, price: number, updated_at: string) => void;
}

const PriceModal = ({ isOpen, onClose, item, onPriceSaved }: PriceModalProps) => {
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync price when item changes
  useEffect(() => {
    if (item && isOpen) {
      setPrice(item.price !== undefined && item.price !== 0 ? item.price.toString() : '');
      setError('');
    }
  }, [item, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

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
      setError(
        err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du prix'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ajuster le prix">
      {item && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <ItemPreview
            name={item.name}
            iconUrl={item.iconUrl}
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
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
            >
              Annuler
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              <Save size={16} />
              Enregistrer
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default PriceModal;
