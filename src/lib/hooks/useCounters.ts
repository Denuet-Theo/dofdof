'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { reportWriteFailure } from '@/lib/errors/write-failures';
import { COUNTER_SLOTS, type CounterTarget } from '@/lib/dofus/counters';
import type { CounterKind } from '@/lib/supabase/types';

/**
 * La grille de compteurs : douze cases, lues au chargement, réécrites à chaque
 * geste.
 *
 * ## Une seule porte de sortie vers la base
 *
 * Poser un compteur, le faire monter, le supprimer : trois gestes, une seule
 * fonction qui écrit (`persist`). Ce n'est pas de l'élégance, c'est la leçon des
 * 22 poulains — une trentaine de points d'écriture terminés par un
 * `console.error` ont suffi à faire disparaître une fournée entière sans que
 * l'écran change d'un pixel. Ici, un appelant ne *peut pas* oublier de signaler
 * un échec : il n'écrit pas lui-même.
 *
 * ## Ce que fait un échec, selon le geste
 *
 * Poser et supprimer sont annulés : la case revient à ce qu'elle était, parce
 * qu'un compteur absent de la base ne doit pas s'afficher, et qu'un compteur
 * qu'on n'a pas réussi à supprimer existe toujours.
 *
 * Un **total**, lui, n'est pas annulé — il est marqué. Rendre les douze clics
 * qu'on vient de faire serait perdre un comptage qui est juste : c'est son
 * enregistrement qui a échoué, pas lui. La case porte alors « non enregistré »
 * jusqu'à ce qu'une écriture aboutisse, ce qui distingue à l'écran un total
 * sauvé d'un total perdu — la seule chose qui manquait le 15 août.
 */

export type CounterCell = {
  kind: CounterKind;
  targetId: number;
  label: string;
  img: string;
  tally: number;
  /** Le total affiché n'est pas celui de la base : la dernière écriture a échoué. */
  unsaved: boolean;
};

type Grid = (CounterCell | null)[];

const EMPTY: Grid = Array.from({ length: COUNTER_SLOTS }, () => null);

/**
 * Délai avant d'écrire un total. Un comptage se fait en rafale — dix carcasses,
 * dix clics en quinze secondes — et une requête par clic écrirait dix fois ce
 * que le dernier clic dit déjà.
 */
const SAVE_DELAY_MS = 500;

const withCell = (grid: Grid, slot: number, cell: CounterCell | null): Grid => {
  const next = [...grid];
  next[slot] = cell;
  return next;
};

const rowOf = (slot: number, cell: CounterCell) => ({
  slot,
  kind: cell.kind,
  target_id: cell.targetId,
  label: cell.label,
  img: cell.img,
  tally: cell.tally,
  updated_at: new Date().toISOString(),
});

/** La seule écriture de compteur. Rend `false` si la base a refusé. */
const persist = async (what: string, write: PromiseLike<{ error: unknown }>): Promise<boolean> => {
  const { error } = await write;
  if (!error) return true;
  reportWriteFailure(what, error);
  return false;
};

const upsertCell = (slot: number, cell: CounterCell) =>
  createClient()
    .from('user_counters')
    // `user_id` vient du défaut SQL `auth.uid()` et n'est donc pas dans le
    // corps : la clé annoncée doit quand même le nommer, c'est elle qui porte
    // l'unicité (user_id, slot).
    .upsert(rowOf(slot, cell), { onConflict: 'user_id,slot' });

export const useCounters = () => {
  const [cells, setCells] = useState<Grid>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * L'état courant, lisible sans attendre un rendu.
   *
   * Les gestes s'enchaînent plus vite que React ne recommit, et un
   * `setCells(current => …)` qui programmerait au passage une écriture serait un
   * effet de bord dans une fonction que React se réserve le droit de rejouer.
   * La référence tient l'état, le state ne sert qu'à afficher.
   */
  const grid = useRef<Grid>(EMPTY);
  const commit = useCallback((next: Grid) => {
    grid.current = next;
    setCells(next);
  }, []);

  /** Ce qui attend d'être écrit, case par case, et la minuterie qui l'écrira. */
  const pending = useRef(new Map<number, CounterCell>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const cancel = useCallback((slot: number) => {
    const timer = timers.current.get(slot);
    if (timer) clearTimeout(timer);
    timers.current.delete(slot);
    pending.current.delete(slot);
  }, []);

  const mark = useCallback(
    (slot: number, saved: boolean) => {
      const cell = grid.current[slot];
      // Supprimée entre-temps : il n'y a plus de case à marquer.
      if (!cell || cell.unsaved === !saved) return;
      commit(withCell(grid.current, slot, { ...cell, unsaved: !saved }));
    },
    [commit]
  );

  const flush = useCallback(
    (slot: number) => {
      const cell = pending.current.get(slot);
      if (!cell) return;
      cancel(slot);
      void persist(`le total du compteur « ${cell.label} »`, upsertCell(slot, cell)).then((ok) =>
        mark(slot, ok)
      );
    },
    [cancel, mark]
  );

  const schedule = useCallback(
    (slot: number, cell: CounterCell) => {
      const timer = timers.current.get(slot);
      if (timer) clearTimeout(timer);
      pending.current.set(slot, cell);
      timers.current.set(slot, setTimeout(() => flush(slot), SAVE_DELAY_MS));
    },
    [flush]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await createClient()
        .from('user_counters')
        .select('*')
        .order('slot', { ascending: true });

      if (cancelled) return;

      if (error) {
        // Une grille vide affichée sur une lecture ratée serait le pire écran
        // possible : douze cases libres où poser un compteur, dont chacune
        // écraserait celui que la base porte encore. L'écran refuse donc de
        // montrer la grille plutôt que de mentir sur son contenu.
        console.error('[compteur] cases non relues:', error);
        setLoadError(error.message);
      } else {
        const next = [...EMPTY];
        for (const row of data ?? []) {
          // Une case hors grille n'a nulle part où s'afficher. Le cas n'existe
          // qu'après un rétrécissement de la grille, et la contrainte SQL le
          // refuse déjà : ignorée plutôt que rendue invisible.
          if (row.slot < 0 || row.slot >= COUNTER_SLOTS) continue;
          next[row.slot] = {
            kind: row.kind,
            targetId: row.target_id,
            label: row.label,
            img: row.img,
            tally: row.tally,
            unsaved: false,
          };
        }
        commit(next);
      }

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [commit]);

  /**
   * Écrit ce que le délai n'a pas eu le temps d'écrire.
   *
   * Quitter l'écran deux dixièmes de seconde après le dernier clic est le geste
   * le plus naturel du monde — on compte, on s'en va — et c'est exactement la
   * fenêtre pendant laquelle le total ne serait allé nulle part.
   */
  useEffect(
    () => () => {
      for (const [slot, cell] of pending.current) {
        const timer = timers.current.get(slot);
        if (timer) clearTimeout(timer);
        void persist(
          `le total du compteur « ${cell.label} », en quittant l'écran`,
          upsertCell(slot, cell)
        );
      }
      pending.current.clear();
      timers.current.clear();
    },
    []
  );

  /** Pose une cible sur une case. Écrit tout de suite : c'est un geste isolé. */
  const place = useCallback(
    (slot: number, target: CounterTarget) => {
      const previous = grid.current[slot];
      const cell: CounterCell = {
        kind: target.kind,
        targetId: target.id,
        label: target.name,
        img: target.img,
        tally: 0,
        unsaved: false,
      };

      cancel(slot);
      commit(withCell(grid.current, slot, cell));

      void persist(`le compteur « ${cell.label} »`, upsertCell(slot, cell)).then((ok) => {
        if (ok) return;
        // La case n'existe pas en base : elle ne doit pas rester à l'écran, où
        // l'on compterait dans le vide jusqu'au prochain rechargement.
        cancel(slot);
        commit(withCell(grid.current, slot, previous));
      });
    },
    [cancel, commit]
  );

  /** +1 sur l'icône, -1 sur 🔙. Le plancher est à zéro, comme la contrainte SQL. */
  const bump = useCallback(
    (slot: number, delta: number) => {
      const cell = grid.current[slot];
      if (!cell) return;

      const tally = Math.max(0, cell.tally + delta);
      if (tally === cell.tally) return;

      const next = { ...cell, tally };
      commit(withCell(grid.current, slot, next));
      schedule(slot, next);
    },
    [commit, schedule]
  );

  const remove = useCallback(
    (slot: number) => {
      const previous = grid.current[slot];
      if (!previous) return;

      // Le total en attente n'a plus de case où atterrir : l'écrire ferait
      // réapparaître en base le compteur qu'on vient de supprimer.
      cancel(slot);
      commit(withCell(grid.current, slot, null));

      void persist(
        `la suppression du compteur « ${previous.label} »`,
        createClient().from('user_counters').delete().eq('slot', slot)
      ).then((ok) => {
        if (!ok) commit(withCell(grid.current, slot, previous));
      });
    },
    [cancel, commit]
  );

  return { cells, loading, loadError, place, bump, remove };
};
