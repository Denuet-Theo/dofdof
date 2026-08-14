import { toNumber, UserSale } from '@/lib/supabase/types';

/**
 * Les trois montants d'une vente sont des `bigint` : ils arrivent en chaînes.
 *
 * Ça marchait par accident — `*` et `-` convertissent tout seuls — mais
 * `craft_cost || 0` rendait la **chaîne** `"0"` plutôt que le nombre, et il
 * suffisait d'une addition quelque part pour concaténer au lieu d'ajouter. Voir
 * `Numeric`.
 */
export const getSaleValue = (sale: UserSale) =>
  toNumber(sale.unit_price) * sale.lot_size * sale.lot_count;

export const getSaleProfit = (sale: UserSale) =>
  getSaleValue(sale) - toNumber(sale.craft_cost) - toNumber(sale.tax_paid);
