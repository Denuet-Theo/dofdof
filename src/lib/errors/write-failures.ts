'use client';

import { useSyncExternalStore } from 'react';

/**
 * Le registre des écritures qui ont échoué, et l'écran qui les montre.
 *
 * ## Pourquoi ce module existe
 *
 * Le 15 août 2026, une fournée de 22 accouplements a été enregistrée : les 44
 * parents sont passés stériles, les 22 poulains n'ont jamais été écrits.
 * L'insertion avait échoué, `recordBirths` l'avait consignée dans un
 * `console.error`, et la fenêtre de saisie s'était refermée en annonçant que
 * c'était fait. L'éleveur l'a découvert le lendemain, en comparant son écurie du
 * jeu à celle de l'outil : 203 contre 225. Le message d'erreur, lui, était dans
 * une console fermée depuis.
 *
 * Ce n'était pas un cas particulier. Une trentaine de points d'écriture de l'app
 * — prix de couleurs, compteurs de vrac, réserve de carburant, réglages, ventes,
 * filtres de ferme, timeline — se terminaient tous par la même ligne :
 *
 *     if (error) console.error('[…] machin non enregistré:', error);
 *
 * C'est-à-dire : on continue comme si de rien n'était. L'état local, lui, est
 * déjà parti devant — c'est le parti pris de l'app, et il est bon pour la
 * fluidité — si bien que l'écran affiche **exactement** ce que l'éleveur croyait
 * avoir enregistré. Rien ne distingue une écriture réussie d'une écriture
 * perdue avant le rechargement suivant, qui peut venir des jours plus tard.
 *
 * ## Le parti pris
 *
 * Une erreur d'écriture ne se résume pas, ne s'abrège pas et ne disparaît pas
 * toute seule. Elle reste à l'écran jusqu'à ce qu'on la ferme, avec le message
 * de la base tel quel — une session expirée, une contrainte violée et une
 * colonne absente demandent trois gestes différents, et seul PostgREST sait
 * lequel. C'est aussi pour ça qu'il n'y a pas de minuterie : une alerte qui
 * s'efface au bout de cinq secondes est une alerte qu'on rate en regardant le
 * jeu à côté, ce qui est exactement la posture de travail de cet écran.
 *
 * ## Pourquoi un store hors React
 *
 * Les écritures partent de hooks (`useBreeding`, `useFarmFilters`…) et de
 * composants qui n'ont pas d'ancêtre commun autre que la mise en page protégée.
 * Passer un `onError` de proche en proche jusqu'à chacun aurait touché toute la
 * hiérarchie et se serait oublié au premier ajout. Un store atteignable par
 * import se câble en une ligne partout où l'on écrit, et `useSyncExternalStore`
 * le rend lisible depuis React sans provider.
 */

/** Une écriture qui a échoué, telle qu'elle s'affiche. */
export type WriteFailure = {
  id: number;
  /** Ce qu'on tentait d'écrire, en français et du point de vue de l'éleveur. */
  what: string;
  /** Le message de la base, non résumé. */
  message: string;
  at: number;
};

let failures: WriteFailure[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => failures;

/**
 * Le serveur ne rend jamais d'échec : ils naissent tous d'un geste du client.
 *
 * La constante est partagée, et ce n'est pas une micro-optimisation :
 * `useSyncExternalStore` compare les instantanés par identité, si bien qu'un
 * `[]` neuf à chaque appel rend un état « toujours différent » et boucle. React
 * le dit à la console — « The result of getServerSnapshot should be cached to
 * avoid an infinite loop » — et c'est exactement ce qu'il a dit à la première
 * ouverture de la page.
 */
const NO_FAILURES: WriteFailure[] = [];
const serverSnapshot = (): WriteFailure[] => NO_FAILURES;

/**
 * Le message d'une erreur, quelle que soit sa forme.
 *
 * PostgREST rend un objet à quatre champs dont trois portent l'essentiel du
 * diagnostic — `details` dit quelle contrainte, `hint` dit souvent quoi faire.
 * Les jeter pour ne garder que `message` laissait « new row violates row-level
 * security policy », qui ne dit pas laquelle.
 */
export const failureMessage = (error: unknown): string => {
  if (error === null || error === undefined) return 'Échec sans message.';
  if (typeof error === 'string') return error;

  if (typeof error === 'object') {
    const shape = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [shape.message, shape.details, shape.hint]
      .filter((part): part is string => typeof part === 'string' && part.length > 0);
    const code = typeof shape.code === 'string' && shape.code.length > 0 ? ` [${shape.code}]` : '';
    if (parts.length > 0) return `${parts.join(' — ')}${code}`;
  }

  if (error instanceof Error) return error.message;
  return String(error);
};

/**
 * Signale une écriture perdue : à l'écran, et dans la console pour le débogage.
 *
 * Rend le message, parce que la plupart des appelants ont aussi un endroit à
 * eux où le dire — le champ qu'on vient de quitter, la ligne qu'on vient de
 * cliquer — et que le double affichage est voulu : la bannière dit *qu'il y a*
 * un problème, l'affichage local dit *où*.
 */
export const reportWriteFailure = (what: string, error: unknown): string => {
  const message = failureMessage(error);
  console.error(`[écriture perdue] ${what}:`, error);
  failures = [...failures, { id: nextId++, what, message, at: Date.now() }];
  emit();
  return message;
};

export const dismissWriteFailure = (id: number) => {
  failures = failures.filter((failure) => failure.id !== id);
  emit();
};

export const clearWriteFailures = () => {
  failures = [];
  emit();
};

/** Les échecs en cours, pour l'écran qui les affiche. */
export const useWriteFailures = (): WriteFailure[] =>
  useSyncExternalStore(subscribe, snapshot, serverSnapshot);
