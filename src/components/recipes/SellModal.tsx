'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ItemPreview from '@/components/items/ItemPreview';
import { createClient } from '@/lib/supabase/client';
import { revertOnFailure } from '@/lib/errors/write-failures';
import { ShoppingCart } from 'lucide-react';
import { HDV_TAX_RATE, computeMargin } from '@/lib/utils/recipes';

interface SellModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id: number;
    name: string;
    iconUrl: string;
    price: number;
    craftCost: number;
    superTypeId?: number;
  } | null;
  onSold?: () => void;
}

/**
 * Split out from the modal so it mounts fresh each time one opens — which is what used
 * to need a "reset everything when closed" effect.
 */
const SellForm = ({
  item,
  onClose,
  onSold,
}: {
  item: NonNullable<SellModalProps['item']>;
  onClose: () => void;
  onSold?: () => void;
}) => {
  const [lotSize, setLotSize] = useState<1 | 10 | 100 | 1000>(1);
  const [lotCount, setLotCount] = useState('1');
  // The suggested lot price follows `lotSize`; this only holds what the user typed over
  // it, tagged with the size it was typed for, so changing the size drops it and the
  // suggestion recomputes — no effect writing the field back after the fact.
  const [typedPrice, setTypedPrice] = useState<{ lotSize: number; value: string } | null>(null);
  const [isResale, setIsResale] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lotPrice =
    typedPrice?.lotSize === lotSize ? typedPrice.value : (item.price * lotSize).toString();
  const setLotPrice = (value: string) => setTypedPrice({ lotSize, value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
      const result = await supabase.from('user_sales').insert({
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

      // La bannière **en plus** du message local : celui-ci dit où, celle-là dit
      // qu'il y a un problème et survit à la fermeture de la fenêtre. Rien n'est
      // posé en avance — la liste est relue par `onSold` — donc rien à défaire.
      if (!revertOnFailure('la mise en vente', result, 'rien-posé-en-avance')) {
        throw result.error;
      }

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
  const totalCraftCost = isResale
    ? parsedPurchasePrice * totalItems
    : item.craftCost * totalItems;
  const totalSaleValue = parsedLotPrice * parsedCount;
  const {
    hdvTax: taxAmount,
    margin: netMargin,
    marginPercent,
  } = computeMargin(totalSaleValue, totalCraftCost);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ItemPreview
        name={item.name}
        iconUrl={item.iconUrl}
        superTypeId={item.superTypeId}
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
          <span className="flex items-center gap-1">
            <KamasDisplay amount={netMargin} colored />
            {totalCraftCost > 0 && (
              <span
                className={`text-[10px] ${netMargin > 0 ? 'text-gain' : netMargin < 0 ? 'text-loss' : 'text-dark-300'}`}
              >
                ({marginPercent > 0 ? '+' : ''}
                {marginPercent}%)
              </span>
            )}
          </span>
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
  );
};

const SellModal = ({ isOpen, onClose, item, onSold }: SellModalProps) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Mettre en vente">
    {/* Keyed so switching item while the modal is up starts the form over. */}
    {item && <SellForm key={item.id} item={item} onClose={onClose} onSold={onSold} />}
  </Modal>
);

export default SellModal;
