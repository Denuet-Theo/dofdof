import { MAX_RESULT_IDS } from './constants';
import type { DofusDBRecipe, DofusDBResponse } from '@/lib/supabase/types';

/**
 * Les recettes dont le résultat fait partie de `itemIds` — typiquement les items
 * tarifés, seuls candidats à un calcul de marge.
 *
 * La route tronque `resultIds` à MAX_RESULT_IDS (limite de taille d'URL côté
 * PostgREST) sans que l'appelant le voie passer : envoyer la liste entière d'un
 * coup revenait à ne travailler que sur une tranche arbitraire du catalogue
 * tarifé. Invisible sur un classement global, où il reste toujours assez de
 * candidats pour remplir les places ; flagrant dès qu'on filtre par métier, où
 * il ne restait que ce qui avait survécu à la coupe.
 *
 * D'où un appel par tranche : le miroir garantissant une recette par item,
 * `limit` = taille de la tranche suffit à rapatrier chacune d'elles en entier.
 */
export const fetchRecipesForItems = async (
  itemIds: number[],
  { jobId }: { jobId?: string } = {}
): Promise<DofusDBRecipe[]> => {
  const batches: number[][] = [];
  for (let i = 0; i < itemIds.length; i += MAX_RESULT_IDS) {
    batches.push(itemIds.slice(i, i + MAX_RESULT_IDS));
  }

  const pages = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({ limit: String(MAX_RESULT_IDS) });
      params.set('resultIds', batch.join(','));
      if (jobId) params.set('jobId', jobId);

      const res = await fetch(`/api/dofusdb/recipes?${params}`);
      if (!res.ok) throw new Error('Failed to fetch recipes');
      const data: DofusDBResponse<DofusDBRecipe> = await res.json();
      return data.data ?? [];
    })
  );

  return pages.flat();
};
