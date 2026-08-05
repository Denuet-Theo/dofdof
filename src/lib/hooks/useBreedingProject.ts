'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BreedingProject } from '@/lib/supabase/types';
import type { FamilyId } from '@/lib/hooks/useBreeding';
import type { ObjectiveId } from '@/lib/dofus/breeding/objectives';

/**
 * Le plan que l'éleveur suit en ce moment : une couleur et une quantité.
 *
 * Rien de plus. Ni les étapes, ni leur avancement, ni ce qu'il possède — les
 * montures en écurie vivent dans `user_breeding_mounts`, parce qu'un muldo Roux
 * allège **tous** les plans qui en demandent et pas seulement celui qu'on suit.
 * Le reste à faire se recalcule de la cible moins l'écurie.
 *
 * C'est la seule forme qui tienne face à l'aléa : un croisement rate deux fois
 * sur trois en début de partie, donc une liste d'étapes cochées une à une serait
 * fausse dès le premier échec.
 */

export type BreedingProjectState = {
  /** Le plan en cours, ou `null` si aucun n'est sélectionné. */
  current: BreedingProject | null;
  loading: boolean;
  select: (colorId: string, targetCount: number, objective?: ObjectiveId) => Promise<void>;
  setTargetCount: (count: number) => Promise<void>;
  /**
   * Change ce que le plan cherche, sans le rouvrir.
   *
   * L'objectif ne se déduit d'aucun prix : deux éleveurs devant le même arbre
   * n'ont pas la même bonne réponse, et c'est justement pourquoi il se choisit.
   */
  setObjective: (objective: ObjectiveId) => Promise<void>;
  abandon: () => Promise<void>;
};

export const useBreedingProject = (family: FamilyId): BreedingProjectState => {
  const [current, setCurrent] = useState<BreedingProject | null>(null);
  const [loading, startLoading] = useTransition();

  const load = useCallback(() => {
    const supabase = createClient();

    startLoading(async () => {
      const { data, error } = await supabase
        .from('breeding_projects')
        .select('*')
        .eq('family', family)
        // Le plus récemment touché fait foi : c'est celui qu'on suit.
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('[breeding] projet illisible:', error);
        return;
      }
      setCurrent((data?.[0] as BreedingProject | undefined) ?? null);
    });
  }, [family]);

  useEffect(() => {
    load();
  }, [load]);

  const select = useCallback(
    async (colorId: string, targetCount: number, objective: ObjectiveId = 'profit') => {
      const supabase = createClient();
      // `upsert` plutôt qu'`insert` : reprendre une couleur déjà visée puis
      // abandonnée doit rouvrir la même ligne, pas buter sur la contrainte
      // d'unicité.
      const { data, error } = await supabase
        .from('breeding_projects')
        .upsert(
          {
            family,
            target_color_id: colorId,
            target_count: targetCount,
            objective,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,family,target_color_id' }
        )
        .select()
        .single();

      if (error) {
        console.error('[breeding] plan non sélectionné:', error);
        return;
      }
      setCurrent(data as BreedingProject);
    },
    [family]
  );

  const setTargetCount = useCallback(
    async (count: number) => {
      if (!current) return;
      setCurrent({ ...current, target_count: count });

      const supabase = createClient();
      const { error } = await supabase
        .from('breeding_projects')
        .update({ target_count: count, updated_at: new Date().toISOString() })
        .eq('id', current.id);

      if (error) console.error('[breeding] objectif non enregistré:', error);
    },
    [current]
  );

  const setObjective = useCallback(
    async (objective: ObjectiveId) => {
      if (!current) return;
      setCurrent({ ...current, objective });

      const supabase = createClient();
      const { error } = await supabase
        .from('breeding_projects')
        .update({ objective, updated_at: new Date().toISOString() })
        .eq('id', current.id);

      if (error) console.error('[breeding] objectif non enregistré:', error);
    },
    [current]
  );

  const abandon = useCallback(async () => {
    if (!current) return;
    const supabase = createClient();
    const { error } = await supabase.from('breeding_projects').delete().eq('id', current.id);

    if (error) {
      console.error('[breeding] plan non abandonné:', error);
      return;
    }
    setCurrent(null);
  }, [current]);

  return { current, loading, select, setTargetCount, setObjective, abandon };
};
