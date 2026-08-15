import { cloneOptions, sterileMounts, type CloneContext, type SterileMount } from './cloning';
import type { Stable } from './stable';

/**
 * Quelles stériles transformer en ambre, et dans quel ordre les regarder.
 *
 * ## Ce que l'extraction n'est pas
 *
 * Ce n'est pas le pendant du clonage : `cloneOptions` répond à « avec qui
 * apparier », donc il ne parle que des stériles qu'il a réussi à apparier.
 * Restent hors de son champ celles qu'il a **écartées** — l'effectif impair d'une
 * génération, les rangs où l'on n'a qu'une seule stérile — et elles ne sont dans
 * aucune liste de l'écran. Or ce sont exactement celles qu'il faut extraire :
 * une stérile dépareillée ne vaut plus que son ambre, et elle occupe une ligne
 * d'écurie tant qu'on ne la vide pas.
 *
 * D'où une liste qui part de **toutes** les stériles et n'en apparie aucune.
 *
 * ## L'ordre : de la moins intéressante à reproduire vers la plus
 *
 * Ce qu'on cherche en ouvrant cet onglet, c'est par où commencer à vider — donc
 * ce qu'on veut en tête est ce qu'on perd le moins à détruire. Le classement se
 * lit sur `value`, qui est déjà la bonne mesure et qui vient de `cloning.ts` :
 * le prix de la couleur la moins chère de la génération que l'**ascendance**
 * porte, c'est-à-dire ce qu'il faudrait payer pour remplacer la monture dans son
 * rôle. Pas sa propre couleur, qui ne dit rien de ce qu'elle permet — depuis #59
 * une gen 1 à parent gen 9 vise la gen 10.
 *
 * Le tri est donc **croissant**, et c'est l'inverse de celui de `cloneOptions` —
 * qui, lui, range par gain décroissant parce qu'il conseille de faire, pas de
 * détruire.
 *
 * À valeur égale, celle qui rend le plus d'ambre passe devant : entre deux
 * montures aussi inutiles à la reproduction, celle qui rapporte le plus se
 * sacrifie d'abord.
 *
 * ## Ce qu'une gen 1 rend : rien
 *
 * `units` vaut la génération **affichée**, et zéro en génération 1 — elles ne
 * s'extraient pas du tout, c'est la règle du jeu que `costs.ts` applique déjà.
 * Elles restent listées quand même, en tête puisqu'elles sont les moins
 * précieuses, avec `units` à zéro : les taire les laisserait indéfiniment en
 * écurie sans que rien ne dise pourquoi elles n'apparaissent nulle part.
 */

/** Une stérile, ce qu'elle vaut encore, et ce que son extraction rendrait. */
export type ExtractionCandidate = SterileMount & {
  /** Unités de ressource rendues : sa génération affichée, et zéro en gen 1. */
  units: number;
  /** Ce que l'extraction rapporte, en kamas. Zéro tant que la ressource n'est pas tarifée. */
  amber: number;
  /**
   * Un clonage peut encore la ramener dans l'écurie : une autre stérile de
   * **même génération affichée** lui reste disponible. Voir `pairable` ci-dessous.
   */
  pairable: boolean;
  /**
   * `true` quand mieux vaut la garder pour un clonage que l'extraire.
   *
   * Les deux conditions comptent, et la première est celle qu'une version
   * précédente oubliait : il faut qu'un clonage soit **possible**. Comparer la
   * valeur de reproduction à l'ambre sans ça marquait toute l'écurie « plutôt
   * cloner » — le prix de remplacement dépasse presque toujours quelques milliers
   * de kamas d'ambre — y compris les stériles que rien ne peut apparier, qui sont
   * précisément celles que cet onglet existe pour montrer.
   *
   * Une stérile dépareillée ne retourne jamais à la reproduction, quelle que soit
   * sa valeur : il ne lui reste que l'ambre.
   */
  keepForBreeding: boolean;
};

/**
 * Les stériles qu'un clonage peut encore ramener dans l'écurie : celles que
 * `cloneOptions` apparie.
 *
 * **On le lui demande** plutôt que de refaire le calcul, et c'est le résultat
 * d'une mesure. Le jeu n'appariant qu'à génération affichée égale, un effectif
 * impair laisse forcément une monture dehors, et `cloneOptions` documente
 * laquelle : la moins précieuse du rang. Rejouer cette règle ici paraissait sûr —
 * elle tient en trois lignes — et elle est fausse : les deux passes de
 * **jumelles** consomment d'abord les montures à ascendance identique, si bien
 * que la dépareillée est la moins précieuse de ce qui **reste**, pas du rang. Sur
 * 200 écuries tirées au hasard, 94 désaccords, dans les deux sens.
 *
 * Or les deux écrans parlent du même geste, et il est irréversible : « dépareillée,
 * il ne lui reste que l'ambre » sur une monture que l'onglet Clonage propose
 * d'apparier est exactement l'erreur qu'on ne peut pas rattraper.
 *
 * `limit` est levé : son plafond de 10 sert à ne pas noyer un écran de conseils,
 * alors qu'ici la question est « existe-t-il un clonage pour elle », posée sur
 * toute l'écurie.
 */
const pairedIds = (stable: Stable, context: CloneContext): Set<string> => {
  const ids = new Set<string>();
  for (const option of cloneOptions(stable, context, Number.POSITIVE_INFINITY)) {
    if (option.keep.id) ids.add(option.keep.id);
    if (option.partner.id) ids.add(option.partner.id);
  }
  return ids;
};

/**
 * Toutes les stériles de l'écurie, de la moins intéressante à reproduire à la
 * plus intéressante — donc dans l'ordre où les extraire.
 */
export const extractionOrder = (
  stable: Stable,
  context: CloneContext
): ExtractionCandidate[] => {
  const paired = pairedIds(stable, context);

  return sterileMounts(stable, context)
    .map((mount) => {
      const units = mount.generation > 1 ? mount.generation : 0;
      const amber = units * context.sacrificeUnitValue;
      const pairable = mount.id !== null && paired.has(mount.id);
      return { ...mount, units, amber, pairable, keepForBreeding: pairable && mount.value > amber };
    })
    .sort(
      (a, b) =>
        a.value - b.value ||
        a.carried - b.carried ||
        // À valeur de reproduction égale, celle qui rend le plus part d'abord.
        b.amber - a.amber ||
        (a.id ?? '').localeCompare(b.id ?? '')
    );
};
