'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UserSale, ItemPrice, DofusDBRecipe, DofusDBResponse } from '@/lib/supabase/types';
import KpiCard from '@/components/dashboard/KpiCard';
import SalesChart from '@/components/dashboard/SalesChart';
import TopRecipes from '@/components/dashboard/TopRecipes';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Skeleton from '@/components/ui/Skeleton';
import { Coins, TrendingUp, Package, Sparkles } from 'lucide-react';

interface SalesDataPoint {
  date: string;
  revenue: number;
  profit: number;
}

interface TopRecipe {
  id: number;
  name: string;
  iconUrl: string;
  margin: number;
  marginPercent?: number;
  sellPrice: number;
  craftCost: number;
}

const DashboardPage = () => {
  const [sales, setSales] = useState<UserSale[]>([]);
  const [prices, setPrices] = useState<ItemPrice[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [jobId, setJobId] = useState<string>('');
  const [topRecipes, setTopRecipes] = useState<TopRecipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);

  const loadData = useCallback(async () => {
    const supabase = createClient();

    try {
      const [salesRes, pricesRes] = await Promise.all([
        supabase
          .from('user_sales')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('item_prices').select('*'),
      ]);

      if (salesRes.data) setSales(salesRes.data);
      if (pricesRes.data) setPrices(pricesRes.data);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch actual recipes to compute accurate Top 10
  const fetchTopRecipes = useCallback(async () => {
    if (prices.length === 0) return;
    setLoadingRecipes(true);
    try {
      const itemIds = prices.filter(p => p.price > 0).map(p => p.item_id);
      if (itemIds.length === 0) {
        setTopRecipes([]);
        setLoadingRecipes(false);
        return;
      }
      
      const params = new URLSearchParams({ limit: '100' });
      params.set('resultIds', itemIds.join(','));
      if (jobId) params.set('jobId', jobId);
      
      const res = await fetch(`/api/dofusdb/recipes?${params}`);
      if (!res.ok) throw new Error('Failed to fetch recipes');
      const data: DofusDBResponse<DofusDBRecipe> = await res.json();
      
      const recipesList = data.data || [];
      const priceMap = new Map<number, ItemPrice>();
      prices.forEach(p => priceMap.set(p.item_id, p));
      
      const computed: TopRecipe[] = recipesList.map(recipe => {
        const resultPrice = priceMap.get(recipe.resultId)?.price || 0;
        const craftCost = recipe.ingredientIds.reduce((sum, ingId, index) => {
          const qty = recipe.quantities[index] || 0;
          return sum + (priceMap.get(ingId)?.price || 0) * qty;
        }, 0);
        
        const hdvTax = Math.floor(resultPrice * 0.02);
        const margin = resultPrice - craftCost - hdvTax;
        const marginPercent = craftCost > 0 ? Math.round((margin / craftCost) * 100) : 0;
        
        return {
          id: recipe.resultId,
          name: recipe.resultName?.fr || `Item #${recipe.resultId}`,
          iconUrl: recipe.result?.img || '',
          margin,
          marginPercent,
          sellPrice: resultPrice,
          craftCost
        };
      });
      
      const top = computed.filter(r => r.margin > 0).sort((a, b) => b.margin - a.margin).slice(0, 10);
      setTopRecipes(top);
    } catch (err) {
      console.error('Error fetching top recipes:', err);
    } finally {
      setLoadingRecipes(false);
    }
  }, [prices, jobId]);

  useEffect(() => {
    fetchTopRecipes();
  }, [fetchTopRecipes]);

  // Compute KPIs
  const soldSales = sales.filter((s) => s.status === 'sold');
  const activeSales = sales.filter((s) => s.status === 'active');

  const totalRevenue = soldSales.reduce(
    (sum, s) => sum + s.unit_price * s.quantity,
    0
  );

  const totalActiveValue = activeSales.reduce(
    (sum, s) => sum + s.unit_price * s.quantity,
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

    const revenue = daySales.reduce(
      (sum, s) => sum + s.unit_price * s.quantity,
      0
    );

    return {
      date: dateStr,
      revenue,
      profit: Math.round(revenue * 0.85), // Approximate: 15% tax estimate
    };
  });

  if (loading) {
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
              amount={Math.round(totalRevenue * 0.85)}
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
          {loadingRecipes && prices.length > 0 && topRecipes.length === 0 ? (
            <div className="glass rounded-2xl p-6 h-full flex flex-col">
              <Skeleton className="h-6 w-1/3 mb-6" />
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" count={5} />
              </div>
            </div>
          ) : (
            <TopRecipes recipes={topRecipes} jobId={jobId} onJobChange={setJobId} />
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
