'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BreedingTimeline } from '@/lib/supabase/types';
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
  clear: () => Promise<void>;
};

/** L'horloge telle que la ligne la porte. */
const clockOf = (row: BreedingTimeline): TimelineClock => ({
  startedAt: new Date(row.started_at).getTime(),
  pausedAt: row.paused_at === null ? null : new Date(row.paused_at).getTime(),
  pausedSeconds: row.paused_seconds,
});

/**
 * Le pas de l'horloge.
 *
 * Une seconde : les comptes à rebours s'affichent à la minute, mais le curseur
 * « maintenant » glisse sur douze heures de ruban et un pas plus long le ferait
 * sauter visiblement. Le rendu ne coûte rien — quelques dizaines de barres
 * positionnées en pourcentage.
 */
const TICK_MS = 1000;

/**
 * L'heure courante, partagée par tous les abonnés.
 *
 * Un seul intervalle pour l'application entière, et il ne tourne que tant que
 * quelqu'un regarde. La valeur est mémorisée dans une cellule plutôt que relue à
 * chaque appel : `useSyncExternalStore` exige un instantané **stable** entre deux
 * notifications, et un `Date.now()` direct ferait boucler le rendu.
 *
 * Il bat aussi pendant les pauses, et c'est voulu : « arrêtée depuis 2 j 4 h »
 * est un compteur qui, lui, continue de courir.
 */
const createWallClock = (period: number) => {
  let value = Date.now();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      value = Date.now();

      timer ??= setInterval(() => {
        value = Date.now();
        for (const notify of listeners) notify();
      }, period);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    snapshot: () => value,
  };
};

const WALL_CLOCK = createWallClock(TICK_MS);

/** Le serveur ne date rien : il n'a pas d'heure à laquelle l'éleveur regarde. */
const noServerClock = () => null;

export const useBreedingTimeline = (family: FamilyId): BreedingTimelineState => {
  const [row, setRow] = useState<BreedingTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const now = useSyncExternalStore(WALL_CLOCK.subscribe, WALL_CLOCK.snapshot, noServerClock);

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
        console.error('[breeding] timeline non enregistrée:', failure);
        setError('Timeline non enregistrée.');
        return;
      }
      setError(null);
      setRow(data as BreedingTimeline);
    },
    [family]
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
        updated_at: startedAt,
      }));

      await persist({
        plan: next,
        started_at: startedAt,
        paused_at: null,
        paused_seconds: 0,
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
      paused_seconds: row.paused_seconds,
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

    setRow({ ...row, started_at: startedAt, paused_at: null, paused_seconds: 0 });
    await persist({
      plan: row.plan,
      started_at: startedAt,
      paused_at: null,
      paused_seconds: 0,
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

    if (failure) console.error('[breeding] timeline non effacée:', failure);
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
    clear,
  };
};
