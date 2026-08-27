/**
 * Le contrat économique de la politique, et l'effet attendu d'un croisement.
 *
 * Portage de `rust/breeding-sim/src/encode.rs`, dont il ne reste que la moitié qui
 * sert. L'autre était le **recensement** et son vecteur de 75 entrées : ce que le
 * réseau du champion lisait. Le champion a quitté le TypeScript — l'échelle joue,
 * et la recherche reste côté Rust comme étalon — donc `censusOf`, `featuresOf`,
 * `frontierOf` et l'algèbre réversible des annulations sont partis avec lui, ainsi
 * que `check-census.mjs` et `check-delta.mjs` qui les figeaient.
 *
 * Le nom du fichier survit à son recensement, et c'est délibéré : ce qui reste est
 * exactement ce que la parité `encode.rs` couvre encore, et le renommer casserait
 * la correspondance un-pour-un que les deux portages tiennent par leurs noms.
 *
 * ## L'économie est **fournie**, pas devinée
 *
 * Sans elle la politique ne distingue pas une semaine où l'ambre est à 11 000
 * d'une où il est à 30 000, et jouerait un compromis moyen faux aux deux extrêmes.
 *
 * Mais ces prix sont **ceux de l'éleveur**, pas ceux d'`economy.toml`. D'où
 * `EconomyView` : un contrat explicite de ce que le calcul réclame au marché, que
 * l'app remplit avec ses saisies du jour. C'est ce qui permet à la même politique
 * de servir plusieurs écuries et plusieurs marchés.
 *
 * Les trois fourchettes ne normalisent plus rien — elles servaient à ramener chaque
 * prix autour de 1 pour le réseau. Elles restent parce que le Rust les porte et que
 * la parité les compare.
 */

import {
  matingOutcomes,
  pairAncestryGeneration,
  pairTargetGeneration,
  type Mate,
} from './pairing';
import type { BreedingColor } from './costs';

/**
 * Ce que l'encodage réclame au marché.
 *
 * Les trois fourchettes servent à **normaliser** : chaque prix est divisé par le
 * milieu de sa fourchette, donc il vaut environ 1 en marché ordinaire et s'écarte
 * quand le cours s'écarte. Sans ça les trois entrées auraient des échelles sans
 * rapport et le réseau devrait les réapprendre à chaque économie.
 */
export type EconomyView = {
  /**
   * L'échelle des kamas. `KAMAS` et `LIQUIDATION` s'y rapportent, donc une écurie
   * qui vaut trois fois la mise se lit « 3 ».
   */
  startingKamas: number;
  amberPerGeneration: number;
  amberRange: [number, number];
  genetonValue: number;
  genetonRange: [number, number];
  topValue: number;
  topValueRange: [number, number];
  /** Ce qu'une monture de cette couleur vaut à la liquidation, couleur par couleur. */
  valueOf: (colorId: string) => number;
  /** Prix d'une Optimakina par génération visée, index 0 à 10. */
  optimakina: number[];
  /** Ce que l'Optimakina ajoute au taux de réussite. */
  optimakinaBonus: number;
  /** Prix d'une gen 1 anonyme à l'hôtel de vente. */
  starterPrice: number;
};

/**
 * Le taux de réussite d'un croisement.
 *
 * `0,3 + 0,0015 × 2 × niveau`, plafonné à 1 — relevé en jeu, et le niveau est
 * celui de la **fournée** : la Mangeoire monte le lot d'un bloc, donc les deux
 * parents partagent le même.
 */
export const successRate = (level: number, economy: EconomyView, optimakina: boolean): number =>
  Math.min(1, 0.3 + 0.0015 * (2 * level) + (optimakina ? economy.optimakinaBonus : 0));

/**
 * Génétons rendus par une monture de ce rang. Relevé en jeu.
 *
 * L'entrée 10 vaut zéro, et la raison a changé : on la croyait inaccessible
 * — « une gen 10 ne peut plus s'accoupler » — alors qu'elle s'accouple très
 * bien, voir `pairTargetGeneration`. Elle reste hors de portée pour une autre
 * raison, plus solide : un parent gen 10 porte l'ascendance au plafond, donc la
 * cible n'y dépasse plus rien et le croisement ne paie pas. Sa valeur propre
 * n'est simplement jamais lue.
 */
const GENETONS_BY_GENERATION = [0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0];

/**
 * Ce qu'une monture de ce rang pèse en génétons, seule.
 *
 * `genetonsForCrossing` en somme deux ; la moisson, elle, compare des montures
 * une par une — « de laquelle se prive-t-on le moins » — donc elle a besoin du
 * barème à l'unité. Voir `ladder-policy.ts`.
 */
export const genetonWeight = (generation: number): number =>
  GENETONS_BY_GENERATION[Math.max(0, Math.min(generation, 10))];

/**
 * Les génétons d'un croisement **réussi**.
 *
 * Ils suivent les **parents directs** et non la cible : deux gen 2 visant la gen 4
 * — parce que leur ascendance porte une gen 3 — rendent 4 génétons et non 16.
 *
 * `paying` est faux dans deux cas, qui n'en font qu'un : l'enfant ne **dépasse**
 * pas l'ascendance. Soit aucune couleur ne nomme la cible — purifier et recopier
 * ne rapportent rien —, soit la cible est plafonnée et vaut ce que l'ascendance
 * porte déjà. Les trois fenêtres du 14/08 montrent le second : une ligne
 * « Génération cible » pleine, et zéro géneton.
 */
const genetonsForCrossing = (
  maleGeneration: number,
  femaleGeneration: number,
  paying: boolean
): number =>
  paying
    ? GENETONS_BY_GENERATION[Math.min(maleGeneration, 10)] +
      GENETONS_BY_GENERATION[Math.min(femaleGeneration, 10)]
    : 0;


/* ------------------------------------------------------------------ delta -- */

/**
 * L'effet attendu d'un croisement sur le recensement.
 *
 * Précalculé une fois par paire de signatures : deux montures de même couleur et
 * même ascendance produisent exactement la même distribution, et la recherche
 * réemploie la paire des dizaines de fois.
 *
 * Tout y est en **espérance**, pas en tirage — chaque issue entre au prorata de
 * sa probabilité. C'est ce qui rend deux évaluations d'un même candidat
 * identiques, donc la recherche compare des compositions au lieu de comparer des
 * coups de dés.
 */
export type PairDelta = {
  maleGeneration: number;
  femaleGeneration: number;
  maleCarried: number;
  femaleCarried: number;
  maleColor: string;
  femaleColor: string;
  /** `(couleur, probabilité, génération portée par le bébé)`. */
  births: [string, number, number][];
  /** Ce que la naissance vaut en espérance, à la liquidation. */
  expectedValue: number;
  targetGeneration: number;
  /**
   * Une couleur **nomme** ce rang.
   *
   * Faux pour deux Ébène : la paire vise la génération 2, mais aucune recette ne
   * s'écrit `[ebene, ebene]`, et toute la masse retombe sur la recopie. Le calcul
   * le savait déjà — c'est la condition des génétons — mais il jetait
   * l'information, si bien qu'un affichage lisant `targetGeneration` seul
   * annonçait « gen 2 » là où il ne sortira qu'un Ébène de plus.
   */
  namesTarget: boolean;
  /**
   * Le croisement gagne-t-il une génération ?
   *
   * Ce champ disait « donc le croisement peut y monter » à la suite du
   * précédent, et cette inférence-là est tombée : au **plafond**, une paire
   * nomme des couleurs de la génération visée sans que celle-ci dépasse ce que
   * le couple porte déjà. Les deux se confondaient tant que ces couples étaient
   * refusés ; ils se séparent depuis, et c'est celui-ci que les génétons et
   * l'admissibilité veulent. Voir `climbs` dans `pairing.ts`.
   */
  climbs: boolean;
  optimakinaCost: number;
  genetonKamas: number;
};

/** La génération qu'une monture **porte**, ascendance comprise. */
const ancestryGeneration = (mate: Mate, generations: Map<string, number>): number => {
  const own = generations.get(mate.colorId) ?? 1;
  if (!mate.parents) return own;
  return Math.max(
    own,
    generations.get(mate.parents[0]) ?? 1,
    generations.get(mate.parents[1]) ?? 1
  );
};

/**
 * L'effet d'un croisement, ou `null` quand le jeu ne propose pas l'accouplement.
 *
 * `level` est celui de la **fournée** et non des montures : la Mangeoire monte le
 * lot d'un bloc. C'est pour ça que le taux est imposé à `matingOutcomes` au lieu
 * d'être déduit des niveaux — voir la surcharge, côté Rust comme ici.
 */
export const pairDelta = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>,
  economy: EconomyView,
  level: number,
  optimakinaFrom: number
): PairDelta | null => {
  // La cible est ce qu'une recombinaison sait nommer, et non le maximum de
  // l'ascendance plus un : voir `crossingShares`. `null` veut dire « aucune ne
  // nomme rien », donc le poulain reprend une couleur de la généalogie — il n'y a
  // pas de delta d'accouplement à encoder.
  const targetGeneration = pairTargetGeneration(male, female, colors, generations);
  if (targetGeneration === null) return null;

  const withOptimakina = targetGeneration >= optimakinaFrom;
  const optimakinaCost = withOptimakina
    ? (economy.optimakina[Math.min(targetGeneration, 10)] ?? 0)
    : 0;
  const rate = successRate(level, economy, withOptimakina);

  const outcomes = matingOutcomes(male, female, colors, generations, rate);
  if (outcomes.length === 0) return null;

  // Le croisement paie quand une couleur nomme la cible **et** que la cible
  // dépasse ce que l'ascendance porte déjà. La seconde moitié ne se voyait pas
  // tant que le plafond refusait le couple : sous le plafond la cible vaut
  // toujours l'ascendance plus un, donc elle la dépasse toujours.
  const namesTarget = outcomes.some((outcome) => outcome.kind === 'target');
  const carriedByPair = pairAncestryGeneration(male, female, generations);
  const climbs = namesTarget && carriedByPair !== null && targetGeneration > carriedByPair;
  const maleGeneration = generations.get(male.colorId) ?? 1;
  const femaleGeneration = generations.get(female.colorId) ?? 1;
  const genetonKamas =
    rate * genetonsForCrossing(maleGeneration, femaleGeneration, climbs) * economy.genetonValue;

  const births: [string, number, number][] = [];
  let expectedValue = 0;
  for (const outcome of outcomes) {
    // La génération que le bébé **porte** : sa couleur, et celles de ses deux
    // parents — c'est exactement l'ascendance que le jeu retient, et c'est elle
    // qui décide de ce qu'il pourra viser.
    const carried = Math.max(
      generations.get(outcome.colorId) ?? 1,
      maleGeneration,
      femaleGeneration
    );
    births.push([outcome.colorId, outcome.probability, carried]);
    expectedValue += outcome.probability * economy.valueOf(outcome.colorId);
  }

  return {
    maleGeneration,
    femaleGeneration,
    maleCarried: ancestryGeneration(male, generations),
    femaleCarried: ancestryGeneration(female, generations),
    maleColor: male.colorId,
    femaleColor: female.colorId,
    births,
    expectedValue,
    targetGeneration,
    namesTarget,
    climbs,
    optimakinaCost,
    genetonKamas,
  };
};
