'use client';

import { useState, useEffect, useCallback, useMemo, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UserSale } from '@/lib/supabase/types';
import { getSaleValue, getSaleProfit } from '@/lib/utils/sales';
import { PRICE_EDIT_TAX_RATE } from '@/lib/utils/recipes';
import { useItemJobs } from '@/lib/hooks/useItemJobs';
import { JOBS } from '@/lib/constants/jobs';
import SaleRow from '@/components/inventory/SaleRow';
import ItemPreview from '@/components/items/ItemPreview';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { Package, ShoppingBag, Coins, TrendingUp, Save, Filter, X } from 'lucide-react';

type Tab = 'active' | 'sold';

/** `lot_size` est contraint à ces quatre valeurs côté base. */
const LOT_SIZES = [1, 10, 100, 1000] as const;

const InventoryPage = () => {
  // `null` until the first load lands, which is what tells the skeleton apart from a
  // genuinely empty inventory — the transition below is only false-y before it starts.
  const [sales, setSales] = useState<UserSale[] | null>(null);
  // An async transition already tracks "a load is in flight", so there is no loading
  // flag to raise — which is what let the fetch move out of the effect body.
  const [loading, startLoading] = useTransition();
  const [activeTab, setActiveTab] = useState<Tab>('active');

  const [search, setSearch] = useState('');
  const [lotSize, setLotSize] = useState('');
  const [jobId, setJobId] = useState('');

  const [editingSale, setEditingSale] = useState<UserSale | null>(null);
  const [newLotPrice, setNewLotPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [editError, setEditError] = useState('');

  const loadSales = useCallback(() => {
    startLoading(async () => {
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
      }
    });
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  // `user_sales` ne porte pas de métier : il se déduit de la recette qui produit
  // l'item. La liste des ids est mémoïsée pour ne pas relancer la résolution à
  // chaque frappe dans le champ de recherche.
  const saleItemIds = useMemo(() => (sales ?? []).map((s) => s.item_id), [sales]);
  const jobByItem = useItemJobs(saleItemIds);

  const hasFilters = !!(search.trim() || lotSize || jobId);

  const resetFilters = () => {
    setSearch('');
    setLotSize('');
    setJobId('');
  };

  const term = search.trim().toLowerCase();
  const filteredSales = (sales ?? []).filter((sale) => {
    if (term && !sale.item_name.toLowerCase().includes(term)) return false;
    if (lotSize && sale.lot_size !== Number(lotSize)) return false;
    // Un item sans recette n'a aucun métier : il ne matche donc aucune sélection.
    if (jobId && jobByItem.get(sale.item_id) !== Number(jobId)) return false;
    return true;
  });

  const activeSales = filteredSales.filter((s) => s.status === 'active');
  const soldSales = filteredSales.filter((s) => s.status === 'sold');

  const currentSales = activeTab === 'active' ? activeSales : soldSales;

  // Calculs sur la sélection courante : les cartes suivent les filtres.
  const totalActiveSalesValue = activeSales.reduce(
    (sum, s) => sum + getSaleValue(s),
    0
  );

  const totalActiveProfit = activeSales.reduce(
    (sum, s) => sum + getSaleProfit(s),
    0
  );

  const totalSoldProfit = soldSales.reduce(
    (sum, s) => sum + getSaleProfit(s),
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
    const modTax = Math.floor(newTotalSaleValue * PRICE_EDIT_TAX_RATE);
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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: priceError } = await supabase.from('item_prices').upsert(
        {
          item_id: editingSale.item_id,
          item_name: editingSale.item_name,
          icon_url: editingSale.icon_url,
          price: newUnitPrice,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
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

      {/* Filters */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-kamas" />
            <h3 className="text-sm font-semibold text-dark-200">Filtres</h3>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-dark-400 hover:text-kamas transition-colors cursor-pointer"
            >
              <X size={12} />
              Réinitialiser
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-dark-400 mb-1 block">Nom</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un item..."
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm placeholder:text-dark-500 transition-all
                hover:border-dark-500 focus:border-kamas/50"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-dark-400 mb-1 block">Métier</label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50
                cursor-pointer"
            >
              <option value="">Tous les métiers</option>
              {JOBS.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-36">
            <label className="text-xs text-dark-400 mb-1 block">Taille de lot</label>
            <select
              value={lotSize}
              onChange={(e) => setLotSize(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50
                cursor-pointer"
            >
              <option value="">Toutes</option>
              {LOT_SIZES.map((size) => (
                <option key={size} value={size}>
                  x{size}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stats — recalculées sur la sélection courante */}
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
              {/* Plus « Global » : ces totaux suivent désormais les filtres. */}
              <p className="text-xs text-dark-500">Bénéfice Net</p>
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
      {loading || sales === null ? (
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
        <EmptyState
          icon={hasFilters ? Filter : Package}
          title={
            hasFilters
              ? 'Aucun résultat'
              : activeTab === 'active'
                ? 'Aucun item en vente'
                : 'Aucune vente réalisée'
          }
          description={
            hasFilters
              ? 'Aucune ligne ne correspond à ces filtres. Élargis la sélection ou réinitialise-la.'
              : activeTab === 'active'
                ? 'Mets des items en vente depuis le Calculateur de Recettes'
                : 'Marque tes items comme vendus pour les voir ici'
          }
        />
      )}
      
      {/* Edit Price Modal */}
      <Modal 
        isOpen={!!editingSale} 
        onClose={() => setEditingSale(null)}
        title="Modifier le prix HDV"
      >
        {editingSale && (
          <form onSubmit={handleEditPriceSubmit} className="space-y-5">
            <ItemPreview
              name={editingSale.item_name}
              iconUrl={editingSale.icon_url}
              subtitle={`${editingSale.lot_count}x lot de ${editingSale.lot_size}`}
            />

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
                <span className="flex items-center gap-1">
                  -
                  <KamasDisplay
                    amount={Math.floor(
                      (parseInt(newLotPrice, 10) || 0) * editingSale.lot_count * PRICE_EDIT_TAX_RATE
                    )}
                    size="sm"
                    className="text-loss"
                  />
                </span>
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
