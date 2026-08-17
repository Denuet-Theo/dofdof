import type { BreedingColor } from './costs';

/**
 * Le succès de collection : chaque couleur de la famille, née au moins une fois.
 *
 * ## Ce qui compte comme « fait naître »
 *
 * Une naissance **enregistrée**, et rien d'autre. Pas ce que l'écurie porte :
 * l'éleveur achète aussi des montures qui ont une généalogie, si bien que
 * « parents renseignés » ne prouve rien. La collection se remplit donc à la saisie
 * de « Ce qui est né » — voir `recordBirths` — et par aucun autre chemin, ni
 * déduction depuis l'écurie, ni case à cocher.
 *
 * Conséquence assumée : le compteur part de zéro et ignore ce qui a été élevé
 * avant que la table existe. Rien de faux n'y entre, ce qui est le compromis
 * retenu.
 *
 * ## Pourquoi c'est hors plan, et pourquoi la stratégie est bloquée
 *
 * L'échelle ne planifie que ce qui sert la montée, et c'est peu : **30 couleurs
 * sur 120** en muldo, 18 sur 66 en dragodinde, 28 sur 120 en volkorne. Les 90
 * autres ne sont sur aucune route — dont les **50 gen 10**, puisqu'on n'en
 * couronne qu'une. Le succès demande donc, par définition, de produire ce que le
 * plan ne demande pas.
 *
 * Il n'existe aucun chemin gratuit vers lui, et deux mesures du dépôt disent
 * pourquoi :
 *
 * - `loadout.ts` mesure qu'un croisement **n'est jamais gratuit, même sur une
 *   place inoccupée** : il stérilise ses deux parents définitivement, et remplir
 *   les places libres de croisements a coûté quatre fournées et 3,5 % de kamas.
 *   Ce qui est gratuit sur une place libre, c'est la fécondation, et
 *   `fillSparePlaces` y met déjà celle-là.
 * - `check-recipes.mjs` verrouille le jeu de gen 2 retenu comme **union disjointe
 *   de cliques**, parce qu'un raté de `A × B` rend une gen 1 portant `[A, B]` et
 *   que la réemployer hors clique dédouble la cible : **27 % de la masse utile**
 *   s'en va. Détourner un croisement vers une couleur manquante casse donc cette
 *   propriété.
 *
 * Chiffrer ces deux coûts est une branche à part, et le choix de stratégie reste
 * **bloqué** jusque-là. Un réglage sans effet est exactement ce que #181 et #216
 * ont passé deux PR à retirer de cet écran ; `check:settings` l'interdit
 * désormais par construction, puisqu'un champ n'entre dans `BreedingSettings`
 * qu'accompagné du contrôle qui l'écrit.
 *
 * Ce module ne fait donc que tenir la collection à jour.
 */

/** Où en est la collection d'une famille. */
export const collectionProgress = (colors: BreedingColor[], hatched: ReadonlySet<string>) => {
  const done = colors.filter((color) => hatched.has(color.id)).length;
  return { done, total: colors.length, missing: colors.length - done };
};

/**
 * Ce qu'il reste à faire naître, la génération la plus basse d'abord.
 *
 * L'ordre est celui de l'effort : une gen 2 manquante se complète en un croisement
 * de gen 1, une gen 10 demande toute une route. À génération égale, l'ordre
 * alphabétique, stable d'un rendu à l'autre.
 */
export const missingColors = (
  colors: BreedingColor[],
  hatched: ReadonlySet<string>
): BreedingColor[] =>
  colors
    .filter((color) => !hatched.has(color.id))
    .sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'fr'));
