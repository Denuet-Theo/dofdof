import { UserSale } from '@/lib/supabase/types';

export const getSaleValue = (sale: UserSale) =>
  sale.unit_price * sale.lot_size * sale.lot_count;

export const getSaleProfit = (sale: UserSale) =>
  getSaleValue(sale) - (sale.craft_cost || 0) - (sale.tax_paid || 0);
