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
 * Le texte à montrer quand un prix n'est pas passé.
 *
 * Le message de PostgREST **et son code**, pas un « échec » à nous : une session
 * expirée (PGRST301), une policy qui refuse (42501) et une contrainte violée
 * (23xxx) demandent trois gestes différents, et seule la base sait lequel. La
 * console ne suffit pas : personne ne l'ouvre en tarifant cent vingt carburants.
 */
export const priceSaveMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const { message, code } = error as { message?: unknown; code?: unknown };
    if (typeof message === 'string' && message) {
      return typeof code === 'string' && code ? `${message} (${code})` : message;
    }
  }
  return 'La base n’a rien renvoyé.';
};

/**
 * Writes a price to the shared `item_prices` table and returns the timestamp it was
 * stamped with, so callers can merge it into local state. Throws on failure.
 *
 * Le `.select()` n'est pas là pour lire : il est là pour **vérifier**. Une
 * absence d'erreur ne prouve pas qu'une ligne a été écrite — c'est précisément
 * ce qui a laissé six carburants sans prix pendant une semaine, ressaisis trois
 * fois sans que rien ne le dise. On redemande donc la ligne, et son absence
 * devient un échec comme un autre.
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

  const { data, error } = await supabase
    .from('item_prices')
    .upsert(
      {
        item_id: itemId,
        item_name: itemName,
        icon_url: iconUrl ?? null,
        price,
        updated_at,
        updated_by: user?.id,
      },
      { onConflict: 'item_id' }
    )
    .select('updated_at')
    .single();

  if (error) throw error;
  if (!data) throw new Error('La base n’a rien renvoyé.');

  // L'estampille relue, et non celle qu'on vient de fabriquer : c'est celle que
  // porte la ligne, donc celle que « MAJ : il y a 2 min » dira vrai.
  return data.updated_at ?? updated_at;
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
