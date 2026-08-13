'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { ItemPrice } from '@/lib/supabase/types';

export interface SaveItemPriceInput {
  itemId: number;
  itemName: string;
  iconUrl?: string | null;
  price: number;
}

/**
 * Writes a price to the shared `item_prices` table and returns the timestamp it was
 * stamped with, so callers can merge it into local state. Throws on failure.
 */
export const saveItemPrice = async ({
  itemId,
  itemName,
  iconUrl,
  price,
}: SaveItemPriceInput): Promise<string> => {
  const supabase = createClient();
  const updated_at = new Date().toISOString();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('item_prices').upsert(
    {
      item_id: itemId,
      item_name: itemName,
      icon_url: iconUrl ?? null,
      price,
      updated_at,
      updated_by: user?.id,
    },
    { onConflict: 'item_id' }
  );

  if (error) throw error;
  return updated_at;
};

/**
 * A copy of `prices` with one price replaced. Kept separate from the hook because a
 * caller sometimes needs the post-save map *before* React has re-rendered with it —
 * comparing a recipe's profitability before and after a save, for instance.
 */
export const mergePrice = (
  prices: Map<number, ItemPrice>,
  itemId: number,
  price: number,
  updatedAt: string
): Map<number, ItemPrice> => {
  const next = new Map(prices);
  const existing = next.get(itemId);

  next.set(itemId, {
    item_id: itemId,
    price,
    updated_at: updatedAt,
    item_name: existing?.item_name || '',
    icon_url: existing?.icon_url || null,
    updated_by: existing?.updated_by || null,
  });

  return next;
};

/**
 * Toute la table, page par page : `item_prices` a dépassé le millier de lignes,
 * et PostgREST tronque en silence au-delà. Voir `fetchAllRows`, qui porte le
 * détail — et que l'élevage lit désormais par le même chemin.
 */
const fetchAllPrices = async (): Promise<ItemPrice[]> => {
  const supabase = createClient();

  return fetchAllRows<ItemPrice>((from, to) =>
    supabase.from('item_prices').select('*').order('item_id', { ascending: true }).range(from, to)
  );
};

/**
 * Loads every known item price once and keeps them keyed by `item_id`.
 * Every page that shows prices reads from the same shape.
 */
export const useItemPrices = () => {
  const [prices, setPrices] = useState<Map<number, ItemPrice>>(new Map());

  useEffect(() => {
    const load = async () => {
      try {
        const rows = await fetchAllPrices();
        setPrices(new Map(rows.map((p) => [p.item_id, p])));
      } catch (err) {
        console.error('Error loading item prices:', err);
      }
    };
    load();
  }, []);

  /** Merge a just-saved price in locally so derived figures recompute without a refetch. */
  const applyPriceSaved = useCallback((itemId: number, price: number, updatedAt: string) => {
    setPrices((prev) => mergePrice(prev, itemId, price, updatedAt));
  }, []);

  return { prices, applyPriceSaved };
};
