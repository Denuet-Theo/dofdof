'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ItemPreview from '@/components/items/ItemPreview';
import { createClient } from '@/lib/supabase/client';
import { ShoppingCart } from 'lucide-react';
import { HDV_TAX_RATE } from '@/lib/utils/recipes';

interface SellModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: number;
    name: string;
    iconUrl: string;
    price: number;
    craftCost: number;
  } | null;
  onSold?: () => void;
}

const SellModal = ({ isOpen, onClose, item, onSold }: SellModalProps) => {
  const [lotSize, setLotSize] = useState<1 | 10 | 100 | 1000>(1);
  const [lotCount, setLotCount] = useState('1');
  const [lotPrice, setLotPrice] = useState('');
  const [isResale, setIsResale] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync default lotPrice when modal opens or lotSize changes
  useEffect(() => {
    if (item && isOpen) {
      // We suggest a price based on the current unit price * lotSize
      setLotPrice((item.price * lotSize).toString());
    }
  }, [item, isOpen, lotSize]);

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setLotSize(1);
      setLotCount('1');
      setLotPrice('');
      setIsResale(false);
      setPurchasePrice('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    const count = parseInt(lotCount, 10);
    const price = parseInt(lotPrice, 10);

    if (isNaN(count) || count < 1) {
      setError('Nombre de lots invalide');
      return;
    }
    if (isNaN(price) || price < 0) {
      setError('Prix invalide');
      return;
    }

    setLoading(true);
    setError('');

    // Snapshot variables
    const totalItems = lotSize * count;
    const unitPurchase = parseInt(purchasePrice, 10);
    const totalCraftCost = isResale 
      ? (isNaN(unitPurchase) ? 0 : unitPurchase * totalItems)
      : (item.craftCost * totalItems);

    // La taxe HDV est de 2% du prix de mise en vente (prix du lot * nombre de lots)
    const totalSaleValue = price * count;
    const initialTax = Math.floor(totalSaleValue * HDV_TAX_RATE);
    // Le unit_price enregistré dans Supabase sera le prix de 1 unité pour garder la rétrocompatibilité (bien que lot_size gère l'affichage maintenant)
    const unitPrice = Math.floor(price / lotSize);

    const supabase = createClient();

    try {
      const { error: insertError } = await supabase.from('user_sales').insert({
        item_id: item.id,
        item_name: item.name,
        icon_url: item.iconUrl,
        quantity: totalItems, // Garde le total des items pour la logique globale
        unit_price: unitPrice,
        craft_cost: totalCraftCost,
        tax_paid: initialTax,
        lot_size: lotSize,
        lot_count: count,
        status: 'active' as const,
        is_resale: isResale,
      });

      if (insertError) throw insertError;

      onSold?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erreur lors de la mise en vente'
      );
    } finally {
      setLoading(false);
    }
  };

  const parsedLotPrice = parseInt(lotPrice, 10) || 0;
  const parsedCount = parseInt(lotCount, 10) || 0;
  
  const parsedPurchasePrice = parseInt(purchasePrice, 10) || 0;
  
  const totalItems = lotSize * parsedCount;
  const totalCraftCost = item 
    ? (isResale ? parsedPurchasePrice * totalItems : item.craftCost * totalItems)
    : 0;
  const totalSaleValue = parsedLotPrice * parsedCount;
  const taxAmount = Math.floor(totalSaleValue * HDV_TAX_RATE);
  const netMargin = totalSaleValue - totalCraftCost - taxAmount;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mettre en vente">
      {item && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <ItemPreview
            name={item.name}
            iconUrl={item.iconUrl}
            subtitle={
              <span className="flex gap-1">
                Coût craft unitaire: <KamasDisplay amount={item.craftCost} size="sm" />
              </span>
            }
            action={
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="text-sm text-dark-300 font-medium cursor-pointer">
                  Achat HDV
                </label>
                <button
                  type="button"
                  onClick={() => setIsResale(!isResale)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    isResale ? 'bg-kamas' : 'bg-dark-600'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                      isResale ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            }
          />

          <div className="space-y-3">
            <label className="text-sm font-medium text-dark-200">
              Taille du lot HDV
            </label>
            <div className="flex gap-2">
              {[1, 10, 100, 1000].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setLotSize(size as 1 | 10 | 100 | 1000)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                    lotSize === size
                      ? 'bg-kamas/20 text-kamas border-kamas/50 border'
                      : 'bg-dark-800/50 text-dark-400 border border-transparent hover:bg-dark-700/50'
                  }`}
                >
                  x{size}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nombre de lots"
              type="number"
              value={lotCount}
              onChange={(e) => setLotCount(e.target.value)}
              min="1"
              required
            />
            <Input
              label={`Prix pour x${lotSize}`}
              type="number"
              value={lotPrice}
              onChange={(e) => setLotPrice(e.target.value)}
              min="0"
              required
            />
          </div>

          {isResale && (
            <div className="pt-2">
              <Input
                label="Prix d'achat unitaire (Kamas)"
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                min="0"
                required={isResale}
              />
            </div>
          )}

          {/* Recapitulation */}
          <div className="bg-dark-800/30 p-4 rounded-xl space-y-2 border border-dark-700/30">
            <div className="flex justify-between text-sm">
              <span className="text-dark-400">{isResale ? 'Total acheté' : 'Total à crafter'}</span>
              <span className="font-medium text-dark-100">{totalItems} unités</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-dark-400">{isResale ? "Coût d'achat total" : 'Coût de craft total'}</span>
              <KamasDisplay amount={totalCraftCost} size="sm" />
            </div>
            <div className="flex justify-between text-sm text-loss">
              <span>Taxe de mise en vente (2%)</span>
              <span className="flex items-center gap-1">
                -<KamasDisplay amount={taxAmount} size="sm" className="text-loss" />
              </span>
            </div>
            <div className="h-px w-full bg-dark-700/50 my-2" />
            <div className="flex justify-between font-semibold">
              <span className="text-dark-200">Bénéfice estimé</span>
              <KamasDisplay amount={netMargin} colored />
            </div>
          </div>

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
              <ShoppingCart size={16} />
              Mettre en vente
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default SellModal;
