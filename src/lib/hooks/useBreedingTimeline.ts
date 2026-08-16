'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TICK_MS, useWallClock } from '@/lib/hooks/useWallClock';
import { reportWriteFailure } from '@/lib/errors/write-failures';
import { toNumber, type BreedingTimeline } from '@/lib/supabase/types';
import type { FamilyId } from '@/lib/hooks/useBreeding';
import {
  parsePlan,
  resumed,
  type TimelineClock,
  type TimelinePlan,
} from '@/lib/dofus/breeding/timeline';

/**
 * Le plan du modèle et l'horloge qui le parcourt.
 *
 * ## Pourquoi en base et pas en local
 *
 * Une pause de week-end dure plus longtemps qu'un onglet. Le `localStorage`
 * suffirait pour un compte à rebours de cinq minutes ; ici, se rouvrir lundi sur
 * une timeline repartie à zéro ferait rater la reprise, et changer de machine la
 * perdrait. L'horloge est donc une donnée du joueur, comme son écurie.
 *
 * ## L'écriture est rare, la lecture est continue
 *
 * On n'écrit qu'aux quatre gestes qui changent l'état — charger, mettre en
 * pause, reprendre, relancer. Le temps qui passe, lui, ne s'écrit jamais : il se
 * **déduit** de `started_at` et du cumul de pauses. C'est toute la raison de
 * garder trois colonnes plutôt qu'un compteur qu'il faudrait sauvegarder à
 * chaque seconde.
 *
 * ## L'heure courante est une source externe, pas un état
 *
 * `now` passe par `useSyncExternalStore` et non par un `setState` dans un effet.
 * Ce n'est pas un détail de style : l'horloge du système est littéralement une
 * source extérieure à React, et l'API prévue pour ça règle du même coup le
 * rendu serveur. `getServerSnapshot` rend `null`, donc le serveur n'écrit aucun
 * compte à rebours et il n'y a pas d'écart d'hydratation à réparer — là où un
 * `Date.now()` pris à l'initialisation du state en produirait un sur chaque
 * ligne de l'agenda.
 */

export type BreedingTimelineState = {
  plan: TimelinePlan | null;
  clock: TimelineClock | null;
  /** Millisecondes epoch, `null` tant que le composant n'est pas monté. */
  now: number | null;
  loading: boolean;
  /** Ce qui a empêché de lire le plan : version inconnue, JSON malformé. */
  error: string | null;
  /** Charge un plan et démarre son horloge à maintenant. */
  load: (plan: TimelinePlan) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Repart du début du même plan, pauses remises à zéro. */
  restart: () => Promise<void>;
  /**
   * Lance le compteur d'une piste — un enclos qu'on vient de finir de charger.
   *
   * Le parc ne se charge pas d'un bloc : le temps de nommer les poulains et de
   * chercher les montures dans le coffre, le premier enclos a une heure d'avance
   * sur le dernier. Une horloge unique obligeait à les faire partir ensemble, ce
   * qui n'arrive jamais.
   */
  startTrack: (trackId: string) => Promise<void>;
  /**
   * Arrête ou relance **une seule piste**.
   *
   * Un enclos bloqué sur la sérénité ou la Mangeoire ne progresse plus sans
   * l'éleveur : à l'heure du coucher on le coupe, et on laisse finir celui qui
   * n'attend qu'une stat. Voir `BLOCKING_GAUGES`.
   */
  toggleTrack: (trackId: string) => Promise<void>;
  clear: () => Promise<void>;
};

/** L'horloge telle que la ligne la porte. */
const clockOf = (row: BreedingTimeline): TimelineClock => ({
  startedAt: new Date(row.started_at).getTime(),
  tracks: Object.fromEntries(
    Object.entries(row.track_clocks ?? {}).map(([id, own]) => [
      id,
      {
        startedAt: new Date(own.started_at).getTime(),
        pausedAt: own.paused_at === null ? null : new Date(own.paused_at).getTime(),
        pausedSeconds: own.paused_seconds,
      },
    ])
  ),
  pausedAt: row.paused_at === null ? null : new Date(row.paused_at).getTime(),
  pausedSeconds: toNumber(row.paused_seconds),
});

export const useBreedingTimeline = (family: FamilyId): BreedingTimelineState => {
  const [row, setRow] = useState<BreedingTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  /**
   * Le pas est la seconde : les comptes à rebours s'affichent à la minute, mais
   * le curseur « maintenant » glisse sur douze heures de ruban et un pas plus
   * long le ferait sauter visiblement.
   *
   * Il bat aussi pendant les pauses, et c'est voulu : « arrêtée depuis 2 j 4 h »
   * est un compteur qui, lui, continue de courir.
   */
  const now = useWallClock(TICK_MS);

  useEffect(() => {
    const supabase = createClient();

    startLoading(async () => {
      const { data, error: failure } = await supabase
        .from('breeding_timeline')
        .select('*')
        .eq('family', family)
        .maybeSingle();

      if (failure) {
        console.error('[breeding] timeline illisible:', failure);
        setError('Timeline illisible.');
        return;
      }
      setError(null);
      setRow((data as BreedingTimeline | null) ?? null);
    });
  }, [family]);

  /**
   * Le plan, relu et validé.
   *
   * Validé même en venant de notre propre base : la colonne est du `jsonb` libre,
   * et une ligne écrite par une version antérieure de l'écran doit donner un
   * message plutôt qu'un ruban vide.
   */
  const parsed = useMemo(() => (row ? parsePlan(row.plan) : null), [row]);
  const plan = parsed?.ok ? parsed.plan : null;
  const clock = useMemo(() => (row ? clockOf(row) : null), [row]);

  /** Écrit la ligne entière et la reprend telle que la base l'a acceptée. */
  const persist = useCallback(
    async (next: {
      plan: unknown;
      started_at: string;
      paused_at: string | null;
      paused_seconds: number;
      /** L'horloge propre de chaque piste. Voir `startTrack` et `toggleTrack`. */
      track_clocks?: Record<
        string,
        { started_at: string; paused_at: string | null; paused_seconds: number }
      >;
    }) => {
      const supabase = createClient();
      const { data, error: failure } = await supabase
        .from('breeding_timeline')
        .upsert(
          { family, ...next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,family' }
        )
        .select()
        .single();

      if (failure) {
        reportWriteFailure('le planning de la fournée', failure);
        setError('Timeline non enregistrée.');
        return;
      }
      setError(null);
      setRow(data as BreedingTimeline);
    },
    [family]
  );

  /** La ligne complète, plus une horloge de piste réécrite. */
  const withTrack = useCallback(
    async (
      trackId: string,
      next: { started_at: string; paused_at: string | null; paused_seconds: number }
    ) => {
      if (!row) return;
      const clocks = { ...row.track_clocks, [trackId]: next };
      setRow({ ...row, track_clocks: clocks });
      // La ligne entière repart : un `upsert` ne met à jour que les colonnes
      // fournies, mais il **insère** avec les autres à vide si la ligne n'existe
      // pas. Renvoyer le plan et l'horloge coûte un JSON et ferme le cas.
      await persist({
        plan: row.plan,
        started_at: row.started_at,
        paused_at: row.paused_at,
        paused_seconds: toNumber(row.paused_seconds),
        track_clocks: clocks,
      });
    },
    [persist, row]
  );

  const startTrack = useCallback(
    async (trackId: string) =>
      withTrack(trackId, {
        started_at: new Date().toISOString(),
        paused_at: null,
        paused_seconds: 0,
      }),
    [withTrack]
  );

  const toggleTrack = useCallback(
    async (trackId: string) => {
      const own = row?.track_clocks?.[trackId];
      // Une piste sans horloge propre n'a jamais été lancée : la mettre en pause
      // n'aurait pas de sens, on la démarre plutôt.
      if (!own) return startTrack(trackId);
      const now = new Date();
      if (own.paused_at === null) {
        return withTrack(trackId, { ...own, paused_at: now.toISOString() });
      }
      const held = (now.getTime() - new Date(own.paused_at).getTime()) / 1000;
      return withTrack(trackId, {
        ...own,
        paused_at: null,
        paused_seconds: own.paused_seconds + Math.max(0, Math.round(held)),
      });
    },
    [row, startTrack, withTrack]
  );

  const load = useCallback(
    async (next: TimelinePlan) => {
      const startedAt = new Date().toISOString();
      // Optimiste : le ruban doit apparaître au clic, pas après l'aller-retour.
      setRow((current) => ({
        user_id: current?.user_id ?? '',
        family,
        plan: next,
        started_at: startedAt,
        paused_at: null,
        paused_seconds: 0,
        // Un plan neuf part sans départ propre : chaque enclos suivra celui du
        // plan tant qu'on ne l'aura pas lancé pour lui-même.
        track_clocks: {},
        updated_at: startedAt,
      }));

      await persist({
        plan: next,
        started_at: startedAt,
        paused_at: null,
        paused_seconds: 0,
        track_clocks: {},
      });
    },
    [family, persist]
  );

  const pause = useCallback(async () => {
    if (!row || row.paused_at !== null) return;
    const pausedAt = new Date().toISOString();

    setRow({ ...row, paused_at: pausedAt });
    await persist({
      plan: row.plan,
      started_at: row.started_at,
      paused_at: pausedAt,
      paused_seconds: toNumber(row.paused_seconds),
    });
  }, [row, persist]);

  const resume = useCallback(async () => {
    if (!row || row.paused_at === null) return;

    // Le calcul de reprise vit dans `timeline.ts`, pas ici : c'est la même règle
    // que celle dont dépend tout l'affichage, et la dupliquer ferait dériver
    // l'écran de ce qu'on enregistre.
    const next = resumed(clockOf(row), Date.now());

    setRow({ ...row, paused_at: null, paused_seconds: next.pausedSeconds });
    await persist({
      plan: row.plan,
      started_at: row.started_at,
      paused_at: null,
      paused_seconds: next.pausedSeconds,
    });
  }, [row, persist]);

  const restart = useCallback(async () => {
    if (!row) return;
    const startedAt = new Date().toISOString();

    // Les horloges d'enclos repartent avec le plan, exactement comme dans `load`.
    // Les laisser était le défaut de #167 : chaque enclos gardait son ancien
    // `started_at`, donc `elapsedFor` continuait de rendre le temps écoulé de la
    // fournée précédente, la piste restait « lancée » — et une piste lancée
    // n'offre que pause et reprise, jamais un départ. Le bandeau « Le plan ne
    // porte plus au-delà d'ici — relance-le » survivait donc à sa propre relance,
    // et rien ne permettait de repartir sans recharger un plan entier.
    setRow({ ...row, started_at: startedAt, paused_at: null, paused_seconds: 0, track_clocks: {} });
    await persist({
      plan: row.plan,
      started_at: startedAt,
      paused_at: null,
      paused_seconds: 0,
      track_clocks: {},
    });
  }, [row, persist]);

  const clear = useCallback(async () => {
    const supabase = createClient();
    setRow(null);
    setError(null);

    const { error: failure } = await supabase
      .from('breeding_timeline')
      .delete()
      .eq('family', family);

    if (failure) reportWriteFailure('l’effacement du planning', failure);
  }, [family]);

  return {
    plan,
    clock,
    now,
    loading,
    // L'erreur de lecture du plan prime sur celle du réseau : elle est plus
    // précise, et c'est celle sur laquelle on peut agir.
    error: parsed && !parsed.ok ? parsed.error : error,
    load,
    pause,
    resume,
    restart,
    startTrack,
    toggleTrack,
    clear,
  };
};
