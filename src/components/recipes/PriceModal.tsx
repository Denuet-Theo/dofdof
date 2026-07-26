'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { createClient } from '@/lib/supabase/client';
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

    const supabase = createClient();

    try {
      const updated_at = new Date().toISOString();
      const { error: upsertError } = await supabase.from('item_prices').upsert(
        {
          item_id: item.id,
          item_name: item.name,
          icon_url: item.iconUrl,
          price: numPrice,
          updated_at,
        },
        { onConflict: 'item_id' }
      );

      if (upsertError) throw upsertError;

      onPriceSaved?.(item.id, numPrice, updated_at);
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
          {/* Item preview */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50">
            <img
              src={item.iconUrl}
              alt={item.name}
              className="w-12 h-12 rounded-lg bg-dark-700/50 object-contain"
            />
            <div>
              <p className="font-semibold text-dark-100">{item.name}</p>
              <p className="text-sm text-dark-500">
                Ajuste le prix moyen en HDV
              </p>
            </div>
          </div>

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
