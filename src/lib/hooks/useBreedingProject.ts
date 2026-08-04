'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BreedingProject, BreedingProjectStock } from '@/lib/supabase/types';
import type { FamilyId } from '@/lib/hooks/useBreeding';

/**
 * Le suivi d'un plan d'élevage : ce qu'on vise, et ce qu'on a déjà.
 *
 * Rien du plan lui-même n'est stocké — ni les étapes, ni leur avancement. Il se
 * recalcule de la cible moins le stock, ce qui est la seule façon de rattraper
 * l'aléa : un croisement rate deux fois sur trois en début de partie, et une
 * liste d'étapes figée serait fausse dès le premier échec. Le stock, lui, dit
 * toujours la vérité.
 *
 * Chargé à la demande, quand une couleur s'ouvre : ramener les projets de 306
 * couleurs à l'affichage du classement coûterait une requête pour rien.
 */

export type BreedingProjectState = {
  project: BreedingProject | null;
  /** Montures fertiles possédées, par couleur. Absent = zéro. */
  stock: Map<string, number>;
  loading: boolean;
  start: (targetCount: number) => Promise<void>;
  setTargetCount: (count: number) => Promise<void>;
  setStock: (colorId: string, count: number) => Promise<void>;
  abandon: () => Promise<void>;
};

export const useBreedingProject = (
  family: FamilyId,
  targetColorId: string,
  /** Ne rien charger tant que le panneau est replié. */
  enabled: boolean
): BreedingProjectState => {
  const [project, setProject] = useState<BreedingProject | null>(null);
  const [stock, setStockMap] = useState<Map<string, number>>(new Map());
  const [loading, startLoading] = useTransition();

  const load = useCallback(() => {
    if (!enabled) return;
    const supabase = createClient();

    startLoading(async () => {
      try {
        const { data: projects, error } = await supabase
          .from('breeding_projects')
          .select('*')
          .eq('family', family)
          .eq('target_color_id', targetColorId)
          .limit(1);

        if (error) throw error;

        const found = (projects?.[0] as BreedingProject | undefined) ?? null;
        setProject(found);

        if (!found) {
          setStockMap(new Map());
          return;
        }

        const { data: rows } = await supabase
          .from('breeding_project_stock')
          .select('*')
          .eq('project_id', found.id);

        setStockMap(
          new Map(
            ((rows ?? []) as BreedingProjectStock[])
              .filter((row) => row.count > 0)
              .map((row) => [row.color_id, row.count])
          )
        );
      } catch (err) {
        console.error('[breeding] projet illisible:', err);
      }
    });
  }, [enabled, family, targetColorId]);

  useEffect(() => {
    load();
  }, [load]);

  const start = useCallback(
    async (targetCount: number) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('breeding_projects')
        .insert({ family, target_color_id: targetColorId, target_count: targetCount })
        .select()
        .single();

      if (error) {
        console.error('[breeding] création du projet impossible:', error);
        return;
      }
      setProject(data as BreedingProject);
      setStockMap(new Map());
    },
    [family, targetColorId]
  );

  const setTargetCount = useCallback(
    async (count: number) => {
      if (!project) return;
      // L'état local part devant : la saisie doit rester fluide, et un échec
      // d'écriture se voit au rechargement.
      setProject({ ...project, target_count: count });

      const supabase = createClient();
      const { error } = await supabase
        .from('breeding_projects')
        .update({ target_count: count, updated_at: new Date().toISOString() })
        .eq('id', project.id);

      if (error) console.error('[breeding] cible non enregistrée:', error);
    },
    [project]
  );

  const setStock = useCallback(
    async (colorId: string, count: number) => {
      if (!project) return;

      setStockMap((current) => {
        const next = new Map(current);
        if (count > 0) next.set(colorId, count);
        else next.delete(colorId);
        return next;
      });

      const supabase = createClient();
      const { error } = await supabase.from('breeding_project_stock').upsert(
        {
          project_id: project.id,
          color_id: colorId,
          count,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,color_id' }
      );

      if (error) console.error('[breeding] stock non enregistré:', error);
    },
    [project]
  );

  const abandon = useCallback(async () => {
    if (!project) return;
    const supabase = createClient();
    // Le stock part avec, par la cascade de la clé étrangère.
    const { error } = await supabase.from('breeding_projects').delete().eq('id', project.id);

    if (error) {
      console.error('[breeding] projet non supprimé:', error);
      return;
    }
    setProject(null);
    setStockMap(new Map());
  }, [project]);

  return { project, stock, loading, start, setTargetCount, setStock, abandon };
};
