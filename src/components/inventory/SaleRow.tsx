'use client';

import { useState } from 'react';
import { UserSale } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Check, Trash2, Edit2 } from 'lucide-react';

interface SaleRowProps {
  sale: UserSale;
  onUpdate: () => void;
  onEditPrice?: (sale: UserSale) => void;
}

const SaleRow = ({ sale, onUpdate, onEditPrice }: SaleRowProps) => {
  const [loading, setLoading] = useState(false);

  const handleMarkSold = async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase
        .from('user_sales') as any)
        .update({
          status: 'sold',
          sold_at: new Date().toISOString(),
        })
        .eq('id', sale.id);

      if (error) throw error;
      onUpdate();
    } catch (err) {
      console.error('Error marking sold:', err);
    } finally {
      setLoading(false);
    }
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
            onClick={handleMarkSold}
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
    </div>
  );
};

export default SaleRow;
