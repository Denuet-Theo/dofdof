'use client';

import { useEffect, useState } from 'react';
import { DofusDBRecipe, DofusDBResponse } from '@/lib/supabase/types';
import { MAX_PAGE_SIZE, MAX_RESULT_IDS } from '@/lib/dofus/constants';

/**
 * Résout `item_id` -> `job_id` via le miroir des recettes.
 *
 * `user_sales` ne stocke aucun métier : il n'existe que sur la recette qui
 * produit l'item, d'où ce détour. Un item absent de la map n'est pas une
 * erreur — les items sans recette (ressources achetées pour la revente) n'ont
 * par construction aucun métier, et ne matchent donc aucun filtre métier.
 *
 * Les ids partent par lots de MAX_RESULT_IDS, la borne que la route applique
 * de toute façon en tronquant `resultIds` : au-delà, elle laisserait tomber le
 * surplus en silence côté client.
 */
export const useItemJobs = (itemIds: number[]) => {
  const [jobByItem, setJobByItem] = useState<Map<number, number>>(new Map());

  // Les ids viennent d'un `.map()` recréé à chaque rendu : on dépend de leur
  // contenu, pas de l'identité du tableau, sinon l'effet reboucle sans fin.
  const key = Array.from(new Set(itemIds))
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    const ids = key ? key.split(',').map(Number) : [];
    let cancelled = false;

    // Une liste vide traverse le même chemin qu'un chargement : la boucle ne
    // tourne pas et la map repart vide, sans setState synchrone dans l'effet.
    const load = async () => {
      const next = new Map<number, number>();

      for (let i = 0; i < ids.length; i += MAX_RESULT_IDS) {
        const chunk = ids.slice(i, i + MAX_RESULT_IDS);
        const params = new URLSearchParams({
          // Le miroir tient une recette par item, mais demander la page pleine
          // évite de dépendre de cet invariant pour une simple correspondance.
          limit: String(MAX_PAGE_SIZE),
          resultIds: chunk.join(','),
        });

        const res = await fetch(`/api/dofusdb/recipes?${params}`);
        if (!res.ok) throw new Error(`Recipe lookup failed: ${res.status}`);
        const body: DofusDBResponse<DofusDBRecipe> = await res.json();

        (body.data ?? []).forEach((recipe) => next.set(recipe.resultId, recipe.job.id));
        if (cancelled) return;
      }

      if (!cancelled) setJobByItem(next);
    };

    // Un échec ici ne doit pas casser l'inventaire : la map reste vide et le
    // filtre métier ne renvoie simplement rien, le reste de la page fonctionne.
    load().catch((err) => console.error('[inventory] job lookup failed:', err));

    return () => {
      cancelled = true;
    };
  }, [key]);

  return jobByItem;
};
