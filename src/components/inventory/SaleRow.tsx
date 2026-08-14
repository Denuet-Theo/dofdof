'use client';

import { useState } from 'react';
import { toNumber, UserSale } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';
import { getSaleProfit } from '@/lib/utils/sales';
import ItemCard from '@/components/ui/ItemCard';
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
      setSellCount('1');
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
      const { error } = await supabase.rpc('sell_lots', {
        p_sale_id: sale.id,
        p_count: countToSell,
      });

      if (error) throw error;

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
  const lotPrice = toNumber(sale.unit_price) * sale.lot_size;

  // Profit = Valeur totale - coût de craft - taxes payées
  const netProfit = getSaleProfit(sale);

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
    <ItemCard layout="row" dimmed={sale.status === 'sold'}>
      <ItemCard.Icon src={sale.icon_url} alt={sale.item_name} size="md" />

      <ItemCard.Body>
        <div className="flex items-center gap-2">
          <ItemCard.Title>{sale.item_name}</ItemCard.Title>
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
        <ItemCard.Badges>
          <Badge variant={sale.status === 'sold' ? 'success' : 'warning'}>
            {sale.status === 'sold' ? 'Vendu' : 'En vente'}
          </Badge>
          {sale.is_resale && <Badge variant="craft">Achat HDV</Badge>}
          <span className="text-[10px] font-medium text-kamas">
            {sale.lot_count}x lot de {sale.lot_size}
          </span>
          <span className="text-[10px] text-dark-500">• {dateStr}</span>
          {soldDateStr && (
            <span className="text-[10px] text-gain">Vendu le {soldDateStr}</span>
          )}
        </ItemCard.Badges>
      </ItemCard.Body>

      <ItemCard.Metrics className="gap-4">
        <ItemCard.Metric label={sale.is_resale ? "Coût d'achat" : 'Coût craft'} hideOnMobile>
          <KamasDisplay amount={toNumber(sale.craft_cost)} size="sm" className="text-dark-300" />
        </ItemCard.Metric>
        <ItemCard.Metric label="Taxes HDV" hideOnMobile>
          <KamasDisplay amount={toNumber(sale.tax_paid)} size="sm" className="text-loss" />
        </ItemCard.Metric>
        <ItemCard.Metric label={`prix du lot (x${sale.lot_size})`}>
          <KamasDisplay amount={lotPrice} size="sm" className="text-dark-300" />
        </ItemCard.Metric>
        <ItemCard.Metric label="bénéfice net" className="min-w-[100px]">
          <KamasDisplay amount={netProfit} size="md" colored className="font-bold" />
        </ItemCard.Metric>
      </ItemCard.Metrics>

      <ItemCard.Actions className="ml-2">
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
      </ItemCard.Actions>

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
    </ItemCard>
  );
};

export default SaleRow;
