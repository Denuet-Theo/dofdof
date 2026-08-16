import {
  pairedSterileIds,
  sterileMounts,
  type CloneContext,
  type SterileMount,
} from './cloning';
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
 * ## Les gen 1 n'y sont pas
 *
 * Le jeu ne les extrait pas. C'est la règle que `costs.ts` applique déjà, et
 * `sacrificeValue` avec lui : `units` valait zéro pour elles. Elles étaient
 * pourtant listées, « ne s'extrait pas » en bout de ligne, au motif que les
 * taire les laisserait en écurie sans que rien ne dise pourquoi.
 *
 * Le motif ne tenait pas, et il coûtait cher. Elles ne sont invisibles nulle
 * part : une gen 1 stérile s'apparie comme les autres, et l'onglet Clonage la
 * propose — c'est même le rang le plus fourni en clonages à ascendance
 * certaine. Surtout, le tri étant **croissant** sur la valeur de reproduction,
 * elles se rangeaient toutes **en tête** : sur une écurie réelle, des dizaines
 * de lignes qui ne rendent rien poussaient hors de l'écran les quelques-unes qui
 * rapportent. Un écran d'extraction dont le haut de liste est inextractible ne
 * répond plus à la seule question qu'on lui pose — par où commencer à vider.
 *
 * `units` est donc toujours strictement positif ici, et l'écran n'a plus de cas
 * « rend zéro » à afficher.
 *
 * ## Ni les « plutôt cloner », ni ce que le projet protège
 *
 * Le même raisonnement est allé deux crans plus loin, et pour la même raison : une
 * ligne qu'on n'extraira pas n'a rien à faire sur la liste de ce qu'on extrait.
 *
 * Sur l'écurie du 16/08, la liste portait **42 lignes pour 4 extractions**. Les 38
 * autres disaient « plutôt cloner » — leur valeur de reproduction dépasse leur
 * ambre — et l'en-tête annonçait « 4 à extraire · 408 000 kamas » devant une liste
 * dont la somme visible faisait **1 700 000**. Deux populations sur le même écran,
 * un total qui n'en couvre qu'une, et rien pour dire laquelle.
 *
 * Elles sortent donc, et `keepForBreeding` avec : le drapeau n'existe plus, donc
 * aucun écran ne peut plus afficher une ligne « à ne pas extraire » dans la liste
 * d'extraction, et le total ne peut plus qu'être la somme de ce qui est affiché.
 *
 * Sortent aussi celles que le **projet** protège. Une Azur-Turquoise gen 10
 * croisée avec un Doré à mille kamas nomme Azur-Doré — la couleur visée — à
 * 13,95 %, et l'écran proposait de la détruire pour 170 000 kamas d'ambre parce
 * que son prix de rang, net des génétons, tombait sous cette somme. Voir
 * `cloning.ts`, § « le projet ».
 *
 * **Rien de ce qui sort d'ici ne disparaît de l'app**, et c'est la condition qui
 * rend ces retraits acceptables : les appariables sont dans l'onglet Clonage, qui
 * les liste toutes, et les protégées que rien n'apparie sont dans
 * `unpairedObjectiveSteriles`, qui existe pour elles.
 */

/** Une stérile, ce qu'elle vaut encore, et ce que son extraction rendrait. */
export type ExtractionCandidate = SterileMount & {
  /**
   * Unités de ressource rendues : sa génération affichée, toujours ≥ 2.
   *
   * Les gen 1 ne sont pas dans cette liste — le jeu ne les extrait pas. Voir
   * l'en-tête du module.
   */
  units: number;
  /** Ce que l'extraction rapporte, en kamas. Zéro tant que la ressource n'est pas tarifée. */
  amber: number;
  /**
   * Un clonage peut encore la ramener dans l'écurie : une autre stérile de
   * **même génération affichée** lui reste disponible.
   *
   * Toujours `false` en pratique sur une liste où l'appariable ne rentre que si
   * son ambre bat sa valeur de reproduction — mais c'est ce qui distingue les deux
   * motifs de rester ici, et ils ne se corrigent pas pareil.
   */
  pairable: boolean;
};

/**
 * Les stériles **à extraire**, de la moins intéressante à reproduire à la plus —
 * donc dans l'ordre où les extraire.
 *
 * Trois populations n'y sont pas, et l'en-tête du module dit pourquoi : les gen 1,
 * que le jeu n'extrait pas ; celles qu'un clonage vaut mieux que leur ambre ; et
 * celles que le projet protège. Toutes se retrouvent à l'onglet Clonage.
 */
export const extractionOrder = (
  stable: Stable,
  context: CloneContext
): ExtractionCandidate[] => {
  const paired = pairedSterileIds(stable, context);

  return sterileMounts(stable, context)
    .filter((mount) => mount.generation > 1 && !mount.servesObjective)
    .map((mount) => {
      const units = mount.generation;
      const amber = units * context.sacrificeUnitValue;
      const pairable = mount.id !== null && paired.has(mount.id);
      return { ...mount, units, amber, pairable };
    })
    // Ce qu'un clonage rattrape sort de la liste. Les deux conditions comptent :
    // comparer la valeur de reproduction à l'ambre sans exiger qu'un clonage soit
    // **possible** viderait l'écran de son objet même — le prix de remplacement
    // dépasse presque toujours quelques milliers de kamas d'ambre, y compris pour
    // les dépareillées, qui sont précisément celles qu'on vient chercher ici.
    .filter((candidate) => !(candidate.pairable && candidate.value > candidate.amber))
    .sort(
      (a, b) =>
        a.value - b.value ||
        a.carried - b.carried ||
        // À valeur de reproduction égale, celle qui rend le plus part d'abord.
        b.amber - a.amber ||
        (a.id ?? '').localeCompare(b.id ?? '')
    );
};
