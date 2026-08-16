'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { reportWriteFailure } from '@/lib/errors/write-failures';
import { nextPenIndex, parsePens, type BatchPen } from '@/lib/dofus/breeding/batch';
import type { FamilyId } from '@/lib/hooks/useBreeding';
import type { BreedingBatch } from '@/lib/supabase/types';

/**
 * La fournée en cours, telle qu'elle est **dans les enclos**.
 *
 * Voir `batch.ts` pour le pourquoi. Ce hook ne fait que la lire, l'écrire, et
 * garantir qu'un échec d'écriture ne laisse pas l'écran affirmer un verrou qui
 * n'a pas pris.
 *
 * ## L'écriture est optimiste, mais elle se défait
 *
 * Le reste de l'app pose l'état local avant l'aller-retour et le laisse tel quel
 * si la base refuse — la bannière de `write-failures` dit alors qu'il y a un
 * problème, mais l'écran continue d'afficher ce que l'éleveur croyait avoir
 * enregistré. C'est tolérable sur un prix ; ça ne l'est pas ici. Un enclos
 * affiché « verrouillé » alors que rien n'est en base est exactement le mensonge
 * que cette fournée persistante est venue supprimer : au rechargement suivant,
 * l'enclos redevient « à charger » et son contenu se recalcule — le bug d'origine,
 * en pire, puisque l'éleveur l'aura vu confirmé.
 *
 * Chaque écriture repart donc de l'état d'avant en cas de refus. C'est la classe
 * « écriture optimiste sans retour arrière » de `AGENTS.md`, traitée à la source
 * plutôt qu'au point d'appel.
 */

export type BreedingBatchState = {
  /** Les enclos de la fournée. Vide = aucune fournée en cours. */
  pens: BatchPen[];
  loading: boolean;
  /** L'index du prochain enclos à charger, `null` si tout est verrouillé. */
  nextIndex: number | null;
  /**
   * Referme le prochain enclos.
   *
   * `proposed` est la fournée que la politique propose : elle ne sert qu'au
   * **premier** verrou, qui fige la liste entière. Ensuite, les enclos à venir
   * sont lus dans l'instantané et `proposed` est ignoré — sans quoi ils
   * changeraient sous les doigts entre deux chargements.
   */
  lock: (proposed: BatchPen[]) => Promise<void>;
  /** Rouvre le dernier enclos verrouillé — un clic de trop, rien de plus. */
  unlock: () => Promise<void>;
  /** Retire un enclos de la fournée : il vient d'être vidé, dans un sens ou l'autre. */
  release: (index: number) => Promise<void>;
  /** Abandonne la fournée entière sans rien écrire sur les montures. */
  discard: () => Promise<void>;
};

export const useBreedingBatch = (family: FamilyId): BreedingBatchState => {
  const [pens, setPens] = useState<BatchPen[]>([]);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    const supabase = createClient();

    startLoading(async () => {
      const { data, error } = await supabase
        .from('breeding_batch')
        .select('*')
        .eq('family', family)
        .maybeSingle();

      if (error) {
        console.error('[breeding] fournée illisible:', error);
        setPens([]);
        return;
      }
      setPens(parsePens((data as BreedingBatch | null)?.pens));
    });
  }, [family]);

  /**
   * Écrit la liste d'enclos, et rend `false` si la base a refusé.
   *
   * Une fournée vide **efface** la ligne plutôt que d'écrire un tableau vide :
   * « aucune fournée en cours » et « une fournée sans enclos » se liraient
   * pareil, et la seconde ferait un état de plus à distinguer pour rien.
   */
  const persist = useCallback(
    async (next: BatchPen[]): Promise<boolean> => {
      const supabase = createClient();
      const stamp = new Date().toISOString();

      if (next.length === 0) {
        const { error } = await supabase.from('breeding_batch').delete().eq('family', family);
        if (error) {
          reportWriteFailure('la fin de la fournée', error);
          return false;
        }
        return true;
      }

      const { error } = await supabase
        .from('breeding_batch')
        .upsert({ family, pens: next, updated_at: stamp }, { onConflict: 'user_id,family' });

      if (error) {
        reportWriteFailure('la fournée en cours', error);
        return false;
      }
      return true;
    },
    [family]
  );

  /** Pose l'état, écrit, et le remet comme il était si la base refuse. */
  const commit = useCallback(
    async (from: BatchPen[], next: BatchPen[]) => {
      setPens(next);
      const ok = await persist(next);
      if (!ok) setPens(from);
    },
    [persist]
  );

  const lock = useCallback(
    async (proposed: BatchPen[]) => {
      // Le premier verrou fige la fournée entière : voir `batch.ts`. Les suivants
      // ignorent `proposed`, qui décrit une écurie déjà entamée par le premier.
      const base = pens.length > 0 ? pens : proposed.map((pen) => ({ ...pen, lockedAt: null }));
      const at = nextPenIndex(base);
      if (at === null) return;

      const stamp = new Date().toISOString();
      await commit(
        pens,
        base.map((pen, index) => (index === at ? { ...pen, lockedAt: stamp } : pen))
      );
    },
    [commit, pens]
  );

  const unlock = useCallback(async () => {
    // Le dernier verrouillé, et non le dernier de la liste : les enclos à venir
    // sont à sa suite.
    const at = pens.reduce((last, pen, index) => (pen.lockedAt !== null ? index : last), -1);
    if (at === -1) return;

    const next = pens.map((pen, index) => (index === at ? { ...pen, lockedAt: null } : pen));
    // Rouvrir le seul enclos verrouillé d'une fournée qui n'a rien d'autre à
    // charger annule la fournée : il n'y a plus rien à figer.
    await commit(pens, next.some((pen) => pen.lockedAt !== null) ? next : []);
  }, [commit, pens]);

  const release = useCallback(
    async (index: number) => {
      if (index < 0 || index >= pens.length) return;
      await commit(pens, pens.filter((_, at) => at !== index));
    },
    [commit, pens]
  );

  const discard = useCallback(async () => {
    if (pens.length === 0) return;
    await commit(pens, []);
  }, [commit, pens]);

  const nextIndex = useMemo(() => nextPenIndex(pens), [pens]);

  return { pens, loading, nextIndex, lock, unlock, release, discard };
};
