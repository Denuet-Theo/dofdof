'use client';

import { useSyncExternalStore } from 'react';

/**
 * L'heure courante, comme source **externe** et non comme état React.
 *
 * Ce n'est pas un détail de style. L'horloge du système est littéralement
 * extérieure à React, et `useSyncExternalStore` est l'API prévue pour ça : elle
 * règle du même coup le rendu serveur. `getServerSnapshot` rend `null`, donc le
 * serveur n'écrit aucun compte à rebours et il n'y a **pas d'écart
 * d'hydratation** à réparer — là où un `Date.now()` pris à l'initialisation d'un
 * `useState`, ou posé dans un effet, en produirait un sur chaque ligne datée.
 *
 * ## Pourquoi c'est partagé
 *
 * Le code vivait dans `useBreedingTimeline`, en privé. Le panneau de politique a
 * eu besoin de la même chose — dater les enclos verrouillés — et l'a d'abord
 * refait avec un `setState` dans un effet, ce que la règle
 * `react-hooks/set-state-in-effect` refuse à juste titre : ça cascade des rendus
 * et ça rate le rendu serveur. Une seule implémentation, atteignable par import,
 * empêche la troisième copie.
 *
 * ## Un intervalle par période, pas par appelant
 *
 * Tous les abonnés d'une même période partagent un seul `setInterval`, qui ne
 * tourne que tant que quelqu'un regarde. Les périodes, elles, se séparent : un
 * ruban qui glisse veut la seconde, un « chargé il y a 3 h » n'a rien à gagner à
 * se réveiller soixante fois par minute pour afficher la même chaîne.
 */

const createWallClock = (period: number) => {
  /**
   * La valeur est mémorisée dans une cellule plutôt que relue à chaque appel :
   * `useSyncExternalStore` exige un instantané **stable** entre deux
   * notifications, et un `Date.now()` direct ferait boucler le rendu.
   */
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

const CLOCKS = new Map<number, ReturnType<typeof createWallClock>>();

const clockFor = (period: number) => {
  const existing = CLOCKS.get(period);
  if (existing) return existing;
  const clock = createWallClock(period);
  CLOCKS.set(period, clock);
  return clock;
};

/** Le serveur ne date rien : il n'a pas d'heure à laquelle l'éleveur regarde. */
const noServerClock = () => null;

/**
 * L'heure courante en millisecondes, `null` tant que le composant n'est pas
 * monté. Le `null` est ce qui rend le rendu serveur silencieux plutôt que faux.
 */
export const useWallClock = (period: number): number | null => {
  const clock = clockFor(period);
  return useSyncExternalStore(clock.subscribe, clock.snapshot, noServerClock);
};

/** Le pas du ruban : le curseur « maintenant » glisse, il lui faut la seconde. */
export const TICK_MS = 1000;

/**
 * Le pas des compteurs datés — « chargé il y a 3 h ».
 *
 * La minute suffit : ces compteurs s'affichent en heures, et les réveiller à la
 * seconde ferait un rendu par seconde d'un panneau qui liste des enclos.
 */
export const MINUTE_MS = 60_000;
