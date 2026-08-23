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
  /**
   * Retire d'un enclos **les seules montures qui ont été écrites**.
   *
   * Une sortie partielle laissait le choix entre deux mensonges : retirer
   * l'enclos entier — les montures non écrites devenaient introuvables, ni en
   * fournée ni à l'écurie — ou le garder tel quel, et le reclic réinsérait les
   * comptées déjà entrées, une monture achetée en devenant deux. L'enclos se
   * réduit donc à ce qu'il **doit encore**, et il disparaît quand il ne doit
   * plus rien.
   */
  settle: (index: number, ids: readonly string[]) => Promise<void>;
  /** Abandonne la fournée entière sans rien écrire sur les montures. */
  discard: () => Promise<void>;
  /**
   * Recalcule les enclos **pas encore verrouillés**, en gardant les autres.
   *
   * ## Pourquoi il fallait une porte, et pourquoi elle s'ouvre à la main
   *
   * Le premier verrou fige la fournée entière, enclos à venir compris, et c'est
   * juste : sans ça la liste change sous les doigts pendant qu'on remplit, et on
   * ne sait plus ce qu'on a mis où. Voir `batch.ts`.
   *
   * Mais figée veut dire figée **jusqu'à la fin de la fournée**, et l'écurie,
   * elle, continue de bouger. Une monture corrigée en stérile reste inscrite à
   * un enclos où elle ne peut plus entrer, et l'éleveur va la chercher dans le
   * jeu pour rien. Mesuré : une correction de clonage a laissé
   * `G2 EB M DOEB-DOIN` dans l'enclos 3, et le seul recours était d'abandonner
   * la fournée — donc de perdre aussi le contenu des enclos déjà refermés.
   *
   * D'où un recalcul **explicite**. Ce que le figeage protège est « rien ne
   * change tout seul », pas « rien ne peut changer » : un geste demandé n'est
   * pas une liste qui bouge sous les doigts.
   *
   * Les verrouillés ne sont pas touchés. Ils décrivent des enclos **fermés dans
   * le jeu**, et rien de ce que l'app recalcule ne peut changer ce qu'ils
   * contiennent.
   */
  refresh: (proposed: BatchPen[]) => Promise<void>;
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

  const settle = useCallback(
    async (index: number, ids: readonly string[]) => {
      if (index < 0 || index >= pens.length || ids.length === 0) return;
      const written = new Set(ids);
      const next = pens
        .map((pen, at) =>
          at === index
            ? { ...pen, units: pen.units.filter((unit) => !written.has(unit.id)) }
            : pen
        )
        // Un enclos qui ne doit plus rien n'a plus de geste à offrir : le garder
        // afficherait une carte vide qu'aucun bouton ne referme.
        .filter((pen) => pen.units.length > 0);
      await commit(pens, next);
    },
    [commit, pens]
  );

  const discard = useCallback(async () => {
    if (pens.length === 0) return;
    await commit(pens, []);
  }, [commit, pens]);

  const refresh = useCallback(
    async (proposed: BatchPen[]) => {
      const kept = pens.filter((pen) => pen.lockedAt !== null);
      // Plus rien de verrouillé **et** plus rien à proposer : la fournée n'a
      // plus de raison d'exister, et `commit([])` efface la ligne — l'écran
      // repasse alors sur la proposition vivante, ce qui est exactement l'état
      // « aucune fournée en cours ».
      await commit(pens, [...kept, ...proposed]);
    },
    [commit, pens]
  );

  const nextIndex = useMemo(() => nextPenIndex(pens), [pens]);

  return { pens, loading, nextIndex, lock, unlock, release, settle, discard, refresh };
};
