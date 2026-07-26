'use client';

import { useState } from 'react';
import { UserSale } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { Check, Trash2, Edit2 } from 'lucide-react';

interface SaleRowProps {
  sale: UserSale;
  onUpdate: () => void;
  onEditPrice?: (sale: UserSale) => void;
}

const SaleRow = ({ sale, onUpdate, onEditPrice }: SaleRowProps) => {
  const [loading, setLoading] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [sellCount, setSellCount] = useState('');
  const [error, setError] = useState('');

  const handleMarkSoldClick = () => {
    if (sale.lot_count > 1) {
      setSellCount(sale.lot_count.toString());
      setIsSellModalOpen(true);
    } else {
      executeSale(1);
    }
  };

  const executeSale = async (countToSell: number) => {
    setLoading(true);
    setError('');
    const supabase = createClient();

    try {
      if (countToSell === sale.lot_count) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase
          .from('user_sales') as any)
          .update({
            status: 'sold',
            sold_at: new Date().toISOString(),
          })
          .eq('id', sale.id);

        if (error) throw error;
      } else {
        const remaining = sale.lot_count - countToSell;
        const total = sale.lot_count;
        
        const remainingCraftCost = Math.floor((sale.craft_cost || 0) * (remaining / total));
        const remainingTaxPaid = Math.floor((sale.tax_paid || 0) * (remaining / total));
        const remainingQuantity = sale.lot_size * remaining;
        
        const soldCraftCost = (sale.craft_cost || 0) - remainingCraftCost;
        const soldTaxPaid = (sale.tax_paid || 0) - remainingTaxPaid;
        const soldQuantity = sale.lot_size * countToSell;

        // 1. Update existing to remaining
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase.from('user_sales') as any).update({
          lot_count: remaining,
          quantity: remainingQuantity,
          craft_cost: remainingCraftCost,
          tax_paid: remainingTaxPaid,
        }).eq('id', sale.id);

        if (updateError) throw updateError;

        // 2. Insert new for sold
        const { error: insertError } = await supabase.from('user_sales').insert({
          user_id: sale.user_id,
          item_id: sale.item_id,
          item_name: sale.item_name,
          icon_url: sale.icon_url,
          quantity: soldQuantity,
          unit_price: sale.unit_price,
          craft_cost: soldCraftCost,
          tax_paid: soldTaxPaid,
          lot_size: sale.lot_size,
          lot_count: countToSell,
          status: 'sold',
          created_at: sale.created_at,
          sold_at: new Date().toISOString(),
        });

        if (insertError) throw insertError;
      }

      setIsSellModalOpen(false);
      onUpdate();
    } catch (err) {
      console.error('Error marking sold:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors de la vente');
    } finally {
      setLoading(false);
    }
  };

  const handlePartialSaleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const count = parseInt(sellCount, 10);
    if (isNaN(count) || count < 1 || count > sale.lot_count) {
      setError(`Quantité invalide (1 à ${sale.lot_count})`);
      return;
    }
    executeSale(count);
  };

  const handleDelete = async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      const { error } = await supabase
        .from('user_sales')
        .delete()
        .eq('id', sale.id);

      if (error) throw error;
      onUpdate();
    } catch (err) {
      console.error('Error deleting sale:', err);
    } finally {
      setLoading(false);
    }
  };

  // La valeur totale mise en vente
  // Un lot_count = 5 de lot_size = 10 avec un unit_price = 100 signifie:
  // lot_size=10, lot_count=5. unit_price=100.
  // Prix d'un lot = unit_price * lot_size (ex: 100 * 10 = 1000)
  // Total vente = prix d'un lot * lot_count (ex: 1000 * 5 = 5000)
  const lotPrice = sale.unit_price * sale.lot_size;
  const totalSaleValue = lotPrice * sale.lot_count;
  
  // Profit = Valeur totale - coût de craft - taxes payées
  const netProfit = totalSaleValue - (sale.craft_cost || 0) - (sale.tax_paid || 0);

  const dateStr = new Date(sale.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });

  const soldDateStr = sale.sold_at
    ? new Date(sale.sold_at).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      })
    : null;

  return (
    <div
      className={`glass rounded-xl p-4 flex items-center gap-4 transition-all duration-300 hover:shadow-md ${
        sale.status === 'sold' ? 'opacity-75' : ''
      }`}
    >
      {/* Item icon */}
      <div className="w-12 h-12 rounded-xl bg-dark-700/50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {sale.icon_url ? (
          <img
            src={sale.icon_url}
            alt={sale.item_name}
            className="w-10 h-10 object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 bg-dark-600 rounded-lg" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-dark-100 truncate">
            {sale.item_name}
          </p>
          {sale.status === 'active' && onEditPrice && (
            <button 
              onClick={() => onEditPrice(sale)}
              className="text-dark-500 hover:text-kamas transition-colors"
              title="Modifier le prix (Taxe 1%)"
            >
              <Edit2 size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge
            variant={sale.status === 'sold' ? 'success' : 'warning'}
          >
            {sale.status === 'sold' ? 'Vendu' : 'En vente'}
          </Badge>
          <span className="text-[10px] font-medium text-kamas">
            {sale.lot_count}x lot de {sale.lot_size}
          </span>
          <span className="text-[10px] text-dark-500">• {dateStr}</span>
          {soldDateStr && (
            <span className="text-[10px] text-gain">
              Vendu le {soldDateStr}
            </span>
          )}
        </div>
      </div>

      {/* Margins */}
      <div className="hidden sm:block text-right flex-shrink-0">
        <KamasDisplay amount={sale.craft_cost || 0} size="sm" className="text-dark-300" />
        <p className="text-[10px] text-dark-500">Coût craft</p>
      </div>
      <div className="hidden sm:block text-right flex-shrink-0">
        <KamasDisplay amount={sale.tax_paid || 0} size="sm" className="text-loss" />
        <p className="text-[10px] text-dark-500">Taxes HDV</p>
      </div>

      {/* Price */}
      <div className="text-right flex-shrink-0">
        <KamasDisplay amount={lotPrice} size="sm" className="text-dark-300" />
        <p className="text-[10px] text-dark-500">prix du lot (x{sale.lot_size})</p>
      </div>

      <div className="text-right flex-shrink-0 min-w-[100px]">
        <KamasDisplay amount={netProfit} size="md" colored className="font-bold text-dark-100" />
        <p className="text-[10px] text-dark-500">bénéfice net</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {sale.status === 'active' && (
          <Button
            size="sm"
            onClick={handleMarkSoldClick}
            loading={loading}
            variant="primary"
            className="px-2"
            title="Marquer vendu"
          >
            <Check size={14} />
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleDelete}
          loading={loading}
          variant="secondary"
          className="px-2 text-loss hover:bg-loss/10 hover:text-loss border-transparent"
          title="Supprimer"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <Modal
        isOpen={isSellModalOpen}
        onClose={() => setIsSellModalOpen(false)}
        title="Lots vendus"
      >
        <form onSubmit={handlePartialSaleSubmit} className="space-y-4">
          <p className="text-sm text-dark-200">
            Combien de lots de {sale.lot_size} avez-vous vendus ? (Max: {sale.lot_count})
          </p>
          <Input
            type="number"
            value={sellCount}
            onChange={(e) => setSellCount(e.target.value)}
            min="1"
            max={sale.lot_count.toString()}
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
              onClick={() => setIsSellModalOpen(false)}
              className="flex-1"
            >
              Annuler
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              Valider
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default SaleRow;
