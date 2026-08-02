'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PriceSuggestion } from '@/lib/supabase/types';

/** Au-delà, un prix existant est considéré comme périmé (bloc « poids du craft »). */
export const STALE_PRICE_DAYS = 4;

/**
 * Quand plus aucun item n'est « jamais rempli », les blocs se rabattent sur les
 * prix plus vieux que ça — sinon la grille se viderait dès que le catalogue est
 * tarifé, c'est-à-dire exactement quand elle redevient utile pour la fraîcheur.
 */
export const NEVER_FILLED_FALLBACK_DAYS = 8;

export const SUGGESTIONS_PER_BUCKET = 4;

/**
 * Les 16 items à remplir (4 par bloc), classés côté base : les comptages sur
 * `ingredient_ids` et les parts de coût de craft ne sont pas exprimables en
 * PostgREST. Voir 20260802120000_price_suggestions.sql.
 */
export const usePriceSuggestions = () => {
  // `null` tant que le premier chargement n'a pas atterri, pour distinguer
  // « pas encore chargé » de « rien à proposer » (même convention que le dashboard).
  const [suggestions, setSuggestions] = useState<PriceSuggestion[] | null>(null);
  const [loading, startLoading] = useTransition();

  const reload = useCallback(() => {
    startLoading(async () => {
      const supabase = createClient();

      const { data, error } = await supabase.rpc('price_suggestions', {
        p_stale_days: STALE_PRICE_DAYS,
        p_fallback_days: NEVER_FILLED_FALLBACK_DAYS,
        p_per_bucket: SUGGESTIONS_PER_BUCKET,
      });

      if (error) {
        console.error('Error loading price suggestions:', error);
        setSuggestions([]);
        return;
      }

      setSuggestions(data ?? []);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { suggestions, loading, reload };
};
