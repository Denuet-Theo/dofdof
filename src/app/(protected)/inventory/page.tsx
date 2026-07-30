'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UserSale } from '@/lib/supabase/types';
import SaleRow from '@/components/inventory/SaleRow';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Skeleton from '@/components/ui/Skeleton';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { Package, ShoppingBag, Coins, TrendingUp, Save } from 'lucide-react';

type Tab = 'active' | 'sold';

const InventoryPage = () => {
  const [sales, setSales] = useState<UserSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('active');
  
  const [editingSale, setEditingSale] = useState<UserSale | null>(null);
  const [newLotPrice, setNewLotPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [editError, setEditError] = useState('');

  const loadSales = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      const { data, error } = await supabase
        .from('user_sales')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSales(data || []);
    } catch (err) {
      console.error('Error loading inventory:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const activeSales = sales.filter((s) => s.status === 'active');
  const soldSales = sales.filter((s) => s.status === 'sold');

  const currentSales = activeTab === 'active' ? activeSales : soldSales;

  // Global calculations for active sales
  const totalActiveSalesValue = activeSales.reduce(
    (sum, s) => sum + (s.unit_price * s.lot_size * s.lot_count),
    0
  );
  
  const totalActiveProfit = activeSales.reduce(
    (sum, s) => {
      const val = (s.unit_price * s.lot_size * s.lot_count);
      return sum + (val - (s.craft_cost || 0) - (s.tax_paid || 0));
    },
    0
  );

  const totalSoldProfit = soldSales.reduce(
    (sum, s) => {
      const val = (s.unit_price * s.lot_size * s.lot_count);
      return sum + (val - (s.craft_cost || 0) - (s.tax_paid || 0));
    },
    0
  );

  const handleEditPriceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;
    
    const price = parseInt(newLotPrice, 10);
    if (isNaN(price) || price < 0) {
      setEditError('Prix invalide');
      return;
    }

    setSavingPrice(true);
    setEditError('');

    const supabase = createClient();
    
    // Taxe de modification = 1% de la valeur totale de la vente (nouveau prix * lot_count)
    const newTotalSaleValue = price * editingSale.lot_count;
    const modTax = Math.floor(newTotalSaleValue * 0.01);
    const newTaxPaid = (editingSale.tax_paid || 0) + modTax;
    const newUnitPrice = Math.floor(price / editingSale.lot_size);

    try {
      // 1. Update the sale
      const { error: saleError } = await supabase
        .from('user_sales')
        .update({
          unit_price: newUnitPrice,
          tax_paid: newTaxPaid,
        })
        .eq('id', editingSale.id);

      if (saleError) throw saleError;
      
      // 2. Update the global item_prices to benefit everyone
      const { error: priceError } = await supabase.from('item_prices').upsert(
        {
          item_id: editingSale.item_id,
          item_name: editingSale.item_name,
          icon_url: editingSale.icon_url,
          price: newUnitPrice,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'item_id' }
      );
      
      if (priceError) console.error('Error updating global price:', priceError); // non-blocking

      loadSales();
      setEditingSale(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Erreur lors de la modification'
      );
    } finally {
      setSavingPrice(false);
    }
  };

  const handleOpenEdit = (sale: UserSale) => {
    setEditingSale(sale);
    setNewLotPrice((sale.unit_price * sale.lot_size).toString());
    setEditError('');
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Package size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Inventaire</h1>
        </div>
        <p className="text-dark-500 text-sm">
          Gère tes items en vente et suis tes ventes réalisées
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-kamas/10 flex items-center justify-center">
              <ShoppingBag size={18} className="text-kamas" />
            </div>
            <div>
              <p className="text-xs text-dark-500">En vente</p>
              <p className="text-lg font-bold text-dark-100">
                {activeSales.length}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gain/10 flex items-center justify-center">
              <TrendingUp size={18} className="text-gain" />
            </div>
            <div>
              <p className="text-xs text-dark-500">Vendus</p>
              <p className="text-lg font-bold text-dark-100">
                {soldSales.length}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-kamas/10 flex items-center justify-center">
              <Coins size={18} className="text-kamas" />
            </div>
            <div>
              <p className="text-xs text-dark-500">CA Actif (Estimé)</p>
              <KamasDisplay amount={totalActiveSalesValue} size="md" className="font-bold" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gain/10 flex items-center justify-center">
              <Coins size={18} className="text-gain" />
            </div>
            <div>
              <p className="text-xs text-dark-500">Bénéfice Net Global</p>
              <KamasDisplay amount={totalSoldProfit + totalActiveProfit} size="md" className="font-bold text-gain" colored />
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            activeTab === 'active'
              ? 'bg-kamas/15 text-kamas'
              : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          En vente ({activeSales.length})
        </button>
        <button
          onClick={() => setActiveTab('sold')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
            activeTab === 'sold'
              ? 'bg-gain/15 text-gain'
              : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          Vendus ({soldSales.length})
        </button>
      </div>

      {/* Sales list */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" count={4} />
        </div>
      ) : currentSales.length > 0 ? (
        <div className="space-y-3 stagger-children">
          {currentSales.map((sale) => (
            <SaleRow key={sale.id} sale={sale} onUpdate={loadSales} onEditPrice={handleOpenEdit} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto text-dark-600 mb-4" />
          <p className="text-dark-400 text-lg font-medium">
            {activeTab === 'active'
              ? 'Aucun item en vente'
              : 'Aucune vente réalisée'}
          </p>
          <p className="text-dark-500 text-sm mt-1">
            {activeTab === 'active'
              ? 'Mets des items en vente depuis le Calculateur de Recettes'
              : 'Marque tes items comme vendus pour les voir ici'}
          </p>
        </div>
      )}
      
      {/* Edit Price Modal */}
      <Modal 
        isOpen={!!editingSale} 
        onClose={() => setEditingSale(null)}
        title="Modifier le prix HDV"
      >
        {editingSale && (
          <form onSubmit={handleEditPriceSubmit} className="space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50">
              <img
                src={editingSale.icon_url || ''}
                alt={editingSale.item_name}
                className="w-12 h-12 rounded-lg bg-dark-700/50 object-contain"
              />
              <div>
                <p className="font-semibold text-dark-100">{editingSale.item_name}</p>
                <p className="text-sm text-dark-500">
                  {editingSale.lot_count}x lot de {editingSale.lot_size}
                </p>
              </div>
            </div>

            <Input
              label={`Nouveau prix du lot (x${editingSale.lot_size})`}
              type="number"
              value={newLotPrice}
              onChange={(e) => setNewLotPrice(e.target.value)}
              min="0"
              required
              autoFocus
            />

            {/* Recapitulation Modification */}
            <div className="bg-dark-800/30 p-4 rounded-xl space-y-2 border border-dark-700/30">
              <div className="flex justify-between text-sm text-loss">
                <span>Taxe de modification (1%)</span>
                <span>- {Math.floor((parseInt(newLotPrice, 10) || 0) * editingSale.lot_count * 0.01).toLocaleString('fr-FR')} ⚜️</span>
              </div>
              <p className="text-[10px] text-dark-500 mt-2 leading-tight">
                Cette taxe sera déduite de ton bénéfice net calculé sur cet inventaire. Le nouveau prix sera également mis à jour globalement pour ce serveur.
              </p>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-loss/10 border border-loss/20 text-loss text-sm">
                {editError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingSale(null)}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button type="submit" loading={savingPrice} className="flex-1">
                <Save size={16} />
                Enregistrer
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default InventoryPage;
