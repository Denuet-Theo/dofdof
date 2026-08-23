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

/**
 * Ce qu'il faut **défaire** si la base n'a pas pris l'écriture.
 *
 * Une fonction, ou l'aveu explicite qu'il n'y a rien à défaire. Pas de valeur
 * par défaut, et c'est tout l'objet du type : la question « qu'est-ce que
 * l'écran montre déjà que la base n'a pas confirmé ? » doit être **posée** à
 * chaque écriture. Elle ne l'était nulle part, et la réponse a été « rien » par
 * omission une trentaine de fois.
 *
 * `'rien-posé-en-avance'` est un mot à écrire, pas un oubli à commettre : il se
 * lit dans un diff, il se cherche en `grep`, et il se conteste en relecture.
 */
export type Undo =
  | (() => void)
  /** L'écran n'affiche rien que la base n'ait confirmé : il n'y a rien à défaire. */
  | 'rien-posé-en-avance'
  /**
   * Posé en avance et **gardé volontairement**, la raison écrite juste à côté.
   *
   * Il y en a, et les nier serait pire que le trou d'origine : un panneau de
   * filtres qui se réécrirait sous les doigts pendant qu'on tape est hostile, et
   * la valeur y est de toute façon re-tentée à la frappe suivante. Ce que ce mot
   * garantit, c'est que le cas a été **jugé** — pas qu'il a été oublié.
   */
  | 'gardé-exprès';

/** Défait ce qui avait été posé en avance, s'il y avait quelque chose. */
const revert = (undo: Undo) => {
  if (typeof undo === 'function') undo();
};

/**
 * Une écriture **non filtrée** — `insert`, `upsert`, `rpc` — et son retour arrière.
 *
 * Elle ne peut pas ne rien toucher : un `insert` insère, un `upsert` insère ou
 * met à jour. Il n'y a donc rien à compter, seulement un refus à relayer et un
 * état local à défaire. C'est la clause 2 de la règle d'or, celle qui manquait à
 * `saveBulkStock`, `saveItemStock`, aux filtres de ferme et au projet : les
 * quatre posaient la valeur à l'écran, signalaient le refus, et **gardaient la
 * valeur refusée** jusqu'au rechargement suivant.
 */
export const revertOnFailure = <T>(
  what: string,
  result: { data?: T | null; error: unknown },
  undo: Undo
): boolean => {
  if (!result.error) return true;
  reportWriteFailure(what, result.error);
  revert(undo);
  return false;
};

/**
 * Une écriture filtrée qui **a réellement porté**, ou l'aveu qu'elle n'a rien
 * touché.
 *
 * ## Le silence que ce garde-fou existe pour rompre
 *
 * PostgREST rend un succès quand un `update … in(…)` ou un `delete … eq(…)` ne
 * trouve **aucune ligne**. Ce n'est pas une anomalie de sa part : zéro ligne
 * modifiée n'est pas une erreur SQL. Mais côté app, `{ error: null }` recouvre
 * alors deux états opposés — « les dix lignes sont écrites » et « aucune de ces
 * dix lignes n'existe » — et tout le code lisait le second comme le premier.
 *
 * Le 23/08, une fournée sortie en fécondes a rendu six succès et écrit dix
 * lignes sur soixante. Les cinquante suivies étaient dans l'écurie, fertiles,
 * comptées juste : le `PATCH` est parti, la base a répondu sans erreur, et
 * personne n'a demandé combien de lignes il avait changées. La fenêtre s'est
 * refermée sur un message vert, l'enclos a quitté la fournée, et l'état local
 * affichait les montures fécondes — jusqu'au rechargement suivant, qui les
 * remettait fertiles sans rien dire. Le `reportWriteFailure` d'à côté ne pouvait
 * pas aider : il n'y avait pas d'erreur à signaler.
 *
 * ## Le contrat
 *
 * L'appelant chaîne `.select()` — c'est ce qui fait rendre à PostgREST les
 * lignes qu'il a touchées — et passe ici ce qu'il **attendait**. Un écart se
 * signale comme une écriture perdue, parce que c'en est une : la ligne visée
 * n'est pas dans l'état où l'écran la montre.
 *
 * Rend les lignes réellement touchées, pour que l'appelant ne reflète que
 * celles-là dans son état local — c'est la seule façon de ne pas rejouer le
 * mensonge d'un cran.
 */
export const touchedRows = <T>(
  what: string,
  expected: number,
  result: { data: T[] | null; error: unknown },
  undo: Undo
): { ok: boolean; rows: T[] } => {
  if (result.error) {
    reportWriteFailure(what, result.error);
    revert(undo);
    return { ok: false, rows: [] };
  }

  const rows = result.data ?? [];
  if (rows.length >= expected) return { ok: true, rows };

  reportWriteFailure(
    what,
    `La base a accepté la requête mais n'a changé que ${rows.length} ligne` +
      `${rows.length > 1 ? 's' : ''} sur ${expected}. Les autres n'existent plus, ` +
      'ou ne sont pas à toi — recharge la page pour voir ce qu’elle contient ' +
      'vraiment, le geste est à refaire.'
  );
  // Une écriture partielle défait quand même : l'écran ne doit pas garder ce que
  // la base n'a pas pris. L'appelant qui sait faire mieux — n'annuler que les
  // lignes restées de côté — lit `rows` et passe `'rien-posé-en-avance'`.
  revert(undo);
  return { ok: false, rows };
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
