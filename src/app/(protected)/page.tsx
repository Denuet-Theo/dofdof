'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { toNumber, UserSale } from '@/lib/supabase/types';
import { getSaleValue, getSaleProfit } from '@/lib/utils/sales';
import {
  computeCraftCost,
  computeMargin,
  recipeHasAllPrices,
  type UnitCost,
} from '@/lib/utils/recipes';
import { fetchCraftIndex } from '@/lib/dofus/craft-index';
import { fetchRecipesForItems } from '@/lib/dofus/fetch-recipes';
import { useItemPrices } from '@/lib/hooks/useItemPrices';
import KpiCard from '@/components/dashboard/KpiCard';
import SalesChart from '@/components/dashboard/SalesChart';
import TopRecipes, { TopRecipe } from '@/components/dashboard/TopRecipes';
import PriceSuggestions from '@/components/dashboard/PriceSuggestions';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Skeleton from '@/components/ui/Skeleton';
import { Coins, TrendingUp, Package, Sparkles } from 'lucide-react';

interface SalesDataPoint {
  date: string;
  revenue: number;
  profit: number;
}

const DashboardPage = () => {
  // `null` until the first load lands — the transitions below only report time spent
  // inside a running load, not the gap before the effect kicks one off.
  const [sales, setSales] = useState<UserSale[] | null>(null);
  const { prices, applyPriceSaved } = useItemPrices();
  const [loadingSales, startLoadingSales] = useTransition();

  const [jobId, setJobId] = useState<string>('');
  const [topRecipes, setTopRecipes] = useState<TopRecipe[]>([]);
  const [loadingRecipes, startLoadingRecipes] = useTransition();

  const loadData = useCallback(() => {
    startLoadingSales(async () => {
      const supabase = createClient();

      try {
        // Toutes les ventes, pas la première page : les totaux du tableau de
        // bord se somment sur l'historique entier, et une troncature les
        // sous-estimerait sans rien afficher d'anormal.
        const data = await fetchAllRows<UserSale>((from, to) =>
          supabase
            .from('user_sales')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
        );

        setSales(data);
      } catch (err) {
        console.error('Error loading dashboard data:', err);
        setSales([]);
      }
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch actual recipes to compute accurate Top 10
  const fetchTopRecipes = useCallback(() => {
    if (prices.size === 0) return;

    const itemIds = Array.from(prices.values())
      .filter((p) => toNumber(p.price) > 0)
      .map((p) => p.item_id);

    startLoadingRecipes(async () => {
      if (itemIds.length === 0) {
        setTopRecipes([]);
        return;
      }

      try {
        // Tout le vivier tarifé, pas la tranche que la route laisse passer :
        // sans ça le « Top 10 » se classait sur un sous-ensemble arbitraire, ce
        // qui ne se voyait qu'une fois le filtre métier posé.
        const recipesList = await fetchRecipesForItems(itemIds, { jobId });

        // Les recettes des ingrédients : un composant crafté moins cher qu'à
        // l'achat doit compter à son coût de craft (#123), sinon ce Top 10
        // classerait sur d'autres chiffres que la page /recipes.
        const craftIndex = await fetchCraftIndex(recipesList);
        const costs = new Map<number, UnitCost>();

        const computed: TopRecipe[] = recipesList
          .filter((recipe) => recipeHasAllPrices(recipe, prices, craftIndex, costs))
          .map((recipe) => {
            const resultPrice = toNumber(prices.get(recipe.resultId)?.price);
            const craftCost = computeCraftCost(recipe, prices, craftIndex, costs);
            const { margin, marginPercent } = computeMargin(resultPrice, craftCost);

            return {
              id: recipe.resultId,
              name: recipe.resultName?.fr || `Item #${recipe.resultId}`,
              iconUrl: recipe.result?.img || '',
              margin,
              marginPercent,
              sellPrice: resultPrice,
              craftCost,
              // Carried through so a row can open the recipe popin, not just rank it.
              recipe,
            };
          });

        const top = computed
          .filter((r) => r.margin > 0)
          .sort((a, b) => (b.marginPercent || 0) - (a.marginPercent || 0))
          .slice(0, 10);
        setTopRecipes(top);
      } catch (err) {
        console.error('Error fetching top recipes:', err);
      }
    });
  }, [prices, jobId]);

  useEffect(() => {
    fetchTopRecipes();
  }, [fetchTopRecipes]);

  // Compute KPIs
  const soldSales = (sales ?? []).filter((s) => s.status === 'sold');
  const activeSales = (sales ?? []).filter((s) => s.status === 'active');

  const totalRevenue = soldSales.reduce((sum, s) => sum + getSaleValue(s), 0);

  const totalProfit = soldSales.reduce((sum, s) => sum + getSaleProfit(s), 0);

  const totalActiveValue = activeSales.reduce(
    (sum, s) => sum + getSaleValue(s),
    0
  );

  // Build chart data (last 7 days)
  const chartData: SalesDataPoint[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dateStr = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
    });

    const daySales = soldSales.filter((s) => {
      if (!s.sold_at) return false;
      const saleDate = new Date(s.sold_at);
      return saleDate.toDateString() === date.toDateString();
    });

    const revenue = daySales.reduce((sum, s) => sum + getSaleValue(s), 0);

    const profit = daySales.reduce((sum, s) => sum + getSaleProfit(s), 0);

    return {
      date: dateStr,
      revenue,
      profit,
    };
  });

  if (loadingSales || sales === null) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" count={3} />
        </div>
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Sparkles size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Dashboard</h1>
        </div>
        <p className="text-dark-500 text-sm">
          Vue d&apos;ensemble de ton activité HDV
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-children">
        <KpiCard
          title="Revenus Totaux"
          value={<KamasDisplay amount={totalRevenue} size="lg" />}
          icon={Coins}
          accentColor="kamas"
        />
        <KpiCard
          title="Bénéfices Estimés"
          value={
            <KamasDisplay
              amount={totalProfit}
              size="lg"
              colored
            />
          }
          icon={TrendingUp}
          accentColor="gain"
        />
        <KpiCard
          title="Items en Vente"
          value={
            <div className="flex items-baseline gap-2">
              <span>{activeSales.length}</span>
              <span className="text-sm text-dark-500 font-normal">
                (<KamasDisplay amount={totalActiveValue} size="sm" />)
              </span>
            </div>
          }
          icon={Package}
          accentColor="kamas"
        />
      </div>

      {/* Chart + Top Recipes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SalesChart data={chartData} />
        </div>
        <div>
          {loadingRecipes && prices.size > 0 && topRecipes.length === 0 ? (
            <div className="glass rounded-2xl p-6 h-full flex flex-col">
              <Skeleton className="h-6 w-1/3 mb-6" />
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" count={5} />
              </div>
            </div>
          ) : (
            <TopRecipes
              recipes={topRecipes}
              prices={prices}
              jobId={jobId}
              onJobChange={setJobId}
              onPriceSaved={applyPriceSaved}
            />
          )}
        </div>
      </div>

      {/* Le pendant du Top 10 : celui-ci classe ce qui *manque* pour que d'autres
          recettes puissent y entrer. */}
      <PriceSuggestions prices={prices} onPriceSaved={applyPriceSaved} />
    </div>
  );
};

export default DashboardPage;
