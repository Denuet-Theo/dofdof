/**
 * Le recensement d'une écurie, et les 74 entrées que le réseau lit.
 *
 * Portage de `rust/breeding-sim/src/encode.rs`. Deuxième pièce du portage, après
 * `network.ts` — et la risquée : une entrée décalée d'un cran, un `log1p` oublié,
 * une normalisation prise sur la mauvaise référence, et le réseau rend un nombre
 * parfaitement plausible qui ne veut rien dire. D'où `check-census.mjs`, qui
 * rejoue des écuries figées par le Rust.
 *
 * ## L'économie est **fournie**, pas devinée
 *
 * Cinq des entrées sont des prix, et c'est délibéré : sans elles la politique ne
 * distingue pas une semaine où l'ambre est à 11 000 d'une où il est à 30 000, et
 * apprendrait un compromis moyen faux aux deux extrêmes.
 *
 * Mais ces prix sont **ceux de l'éleveur**, pas ceux d'`economy.toml`. D'où
 * `EconomyView` : un contrat explicite de ce que l'encodage réclame au marché,
 * que l'app remplit avec ses saisies du jour. C'est ce qui permet au même
 * artefact de servir plusieurs écuries et plusieurs marchés.
 *
 * ## Les comptes passent par `log1p`
 *
 * Une écurie de deux cents montures ne doit pas saturer les entrées d'une écurie
 * de dix, et l'écart qui compte entre 0 et 1 monture est plus grand que celui
 * entre 100 et 101.
 */

import { carriedGeneration } from './naming';
import { matingOutcomes, pairTargetGeneration, type Mate } from './pairing';
import type { BreedingColor } from './costs';
import type { Sex, Stable } from './stable';

/** Générations 1 à 10. L'entrée 0 n'existe pas et reste à zéro. */
export const MAX_GENERATION = 10;

/** La taille du vecteur. Doit valoir `FEATURES` côté Rust, ou rien ne va. */
export const FEATURES = 74;

const FERTILE_MALES = 0;
const FERTILE_FEMALES = 10;
const STERILES = 20;
const CARRIED = 30;
const READY_NEXT = 40;
const READY_AFTER = 43;
const FRONTIER = 46;
const DISTINCT = 47;
const HEADCOUNT = 48;
const KAMAS = 49;
const PRICE_AMBER = 50;
const PRICE_GENETON = 51;
const PRICE_TOP = 52;
const LIQUIDATION = 53;
const CYCLED_MALES = 54;
const CYCLED_FEMALES = 64;

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
 * Génétons rendus par une monture de ce rang. Relevé en jeu. Une gen 10 n'en rend
 * pas : elle ne peut plus s'accoupler.
 */
const GENETONS_BY_GENERATION = [0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0];

/**
 * Les génétons d'un croisement **réussi**.
 *
 * Ils suivent les **parents directs** et non la cible : deux gen 2 visant la gen 4
 * — parce que leur ascendance porte une gen 3 — rendent 4 génétons et non 16.
 *
 * Zéro quand aucune couleur ne nomme la cible : purifier et recopier ne rapportent
 * rien, ce que la fenêtre du jeu affiche noir sur blanc.
 */
export const genetonsForCrossing = (
  maleGeneration: number,
  femaleGeneration: number,
  namesTarget: boolean
): number =>
  namesTarget
    ? GENETONS_BY_GENERATION[Math.min(maleGeneration, 10)] +
      GENETONS_BY_GENERATION[Math.min(femaleGeneration, 10)]
    : 0;

/** Le milieu d'une fourchette, ou la valeur courante si elle est absente. */
const mid = (low: number, high: number, fallback: number) =>
  high > low ? (low + high) / 2 : Math.max(fallback, 1);

export type Census = {
  fertileMales: number[];
  fertileFemales: number[];
  cycledMales: number[];
  cycledFemales: number[];
  steriles: number[];
  /** Histogramme de la génération **portée**, ascendance comprise, sur les fertiles. */
  carried: number[];
  /** Effectif fertile par couleur, pour la complétude des recettes. */
  held: Map<string, number>;
  headcount: number;
  kamas: number;
  liquidation: number;
};

const zeroes = () => new Array<number>(MAX_GENERATION + 1).fill(0);

/**
 * Recense une écurie.
 *
 * Le vrac et les individus s'y fondent : côté Rust il n'y a que des montures, et
 * le vrac est une commodité de saisie propre à l'écran. Une monture de vrac est
 * **fertile, non féconde, sans ascendance** — c'est ce que « achetée ou capturée »
 * veut dire, et c'est pour ça que sa génération portée vaut sa couleur.
 */
export const censusOf = (
  stable: Stable,
  colors: BreedingColor[],
  economy: EconomyView,
  kamas: number
): Census => {
  const generationOf = new Map(colors.map((color) => [color.id, color.generation]));
  const generation = (colorId: string) => generationOf.get(colorId) ?? 1;

  const census: Census = {
    fertileMales: zeroes(),
    fertileFemales: zeroes(),
    cycledMales: zeroes(),
    cycledFemales: zeroes(),
    steriles: zeroes(),
    carried: zeroes(),
    held: new Map(),
    headcount: 0,
    kamas,
    liquidation: 0,
  };

  const slot = (value: number) => Math.min(Math.max(value, 0), MAX_GENERATION);
  const hold = (colorId: string, by: number) =>
    census.held.set(colorId, (census.held.get(colorId) ?? 0) + by);

  for (const [colorId, counts] of stable.bulk) {
    const rank = slot(generation(colorId));
    const total = counts.males + counts.females;
    if (total <= 0) continue;
    census.headcount += total;
    census.liquidation += economy.valueOf(colorId) * total;
    census.fertileMales[rank] += counts.males;
    census.fertileFemales[rank] += counts.females;
    census.carried[rank] += total;
    hold(colorId, total);
  }

  for (const mount of stable.individuals) {
    const rank = slot(generation(mount.colorId));
    census.headcount += 1;
    census.liquidation += economy.valueOf(mount.colorId);
    if (!mount.fertile) {
      census.steriles[rank] += 1;
      continue;
    }
    if (mount.sex === 'M') census.fertileMales[rank] += 1;
    else census.fertileFemales[rank] += 1;
    if (mount.cycled) {
      if (mount.sex === 'M') census.cycledMales[rank] += 1;
      else census.cycledFemales[rank] += 1;
    }
    const parents = mount.parents
      ? ([generation(mount.parents[0]), generation(mount.parents[1])] as [number, number])
      : null;
    census.carried[slot(carriedGeneration(generation(mount.colorId), parents))] += 1;
    hold(mount.colorId, 1);
  }

  return census;
};

/** Le plus haut rang **porté** par une monture qui garde sa reproduction. */
export const frontierOf = (census: Census): number => {
  for (let generation = MAX_GENERATION; generation >= 1; generation -= 1) {
    if (census.carried[generation] > 1e-9) return generation;
  }
  return 0;
};

/**
 * Quelle part des recettes de ce rang est complète, à moitié, ou vide.
 *
 * Trois nombres qui somment à 1. Sans eux le réseau ne peut pas distinguer « il
 * me manque un composant » de « il me manque les deux », qui sont pourtant deux
 * situations opposées — la première se débloque en un croisement, la seconde en
 * plusieurs.
 */
const readiness = (census: Census, colors: BreedingColor[], generation: number): number[] => {
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  if (generation === 0 || generation > top) return [0, 0, 0];

  const holds = (colorId: string) => (census.held.get(colorId) ?? 0) > 1e-9;
  const buckets = [0, 0, 0];
  let total = 0;
  for (const color of colors) {
    if (color.generation !== generation) continue;
    for (const [a, b] of color.recipes) {
      buckets[(holds(a) ? 1 : 0) + (holds(b) ? 1 : 0)] += 1;
      total += 1;
    }
  }
  if (total > 0) for (let index = 0; index < 3; index += 1) buckets[index] /= total;
  return buckets;
};

/** Le vecteur que le réseau reçoit. */
export const featuresOf = (
  census: Census,
  colors: BreedingColor[],
  economy: EconomyView
): number[] => {
  const out = new Array<number>(FEATURES).fill(0);
  const log1p = (value: number) => Math.log1p(Math.max(value, 0));

  for (let generation = 1; generation <= MAX_GENERATION; generation += 1) {
    const slot = generation - 1;
    out[FERTILE_MALES + slot] = log1p(census.fertileMales[generation]);
    out[FERTILE_FEMALES + slot] = log1p(census.fertileFemales[generation]);
    out[STERILES + slot] = log1p(census.steriles[generation]);
    out[CARRIED + slot] = log1p(census.carried[generation]);
    out[CYCLED_MALES + slot] = log1p(census.cycledMales[generation]);
    out[CYCLED_FEMALES + slot] = log1p(census.cycledFemales[generation]);
  }

  const frontier = frontierOf(census);
  const next = readiness(census, colors, frontier + 1);
  const after = readiness(census, colors, frontier + 2);
  for (let index = 0; index < 3; index += 1) {
    out[READY_NEXT + index] = next[index];
    out[READY_AFTER + index] = after[index];
  }

  out[FRONTIER] = frontier / MAX_GENERATION;
  out[DISTINCT] =
    [...census.held.values()].filter((count) => count > 1e-9).length / Math.max(colors.length, 1);
  out[HEADCOUNT] = log1p(census.headcount);
  const scale = Math.max(economy.startingKamas, 1);
  out[KAMAS] = census.kamas / scale;

  const amber = mid(economy.amberRange[0], economy.amberRange[1], economy.amberPerGeneration);
  const geneton = mid(economy.genetonRange[0], economy.genetonRange[1], economy.genetonValue);
  const top = mid(economy.topValueRange[0], economy.topValueRange[1], economy.topValue);
  out[PRICE_AMBER] = economy.amberPerGeneration / amber;
  out[PRICE_GENETON] = economy.genetonValue / Math.max(geneton, 1e-9);
  out[PRICE_TOP] = economy.topValue / top;
  out[LIQUIDATION] = census.liquidation / scale;

  return out;
};

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
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  const targetGeneration = pairTargetGeneration(male, female, generations);
  if (targetGeneration === null) return null;

  const withOptimakina = targetGeneration >= optimakinaFrom && targetGeneration <= top;
  const optimakinaCost = withOptimakina
    ? (economy.optimakina[Math.min(targetGeneration, 10)] ?? 0)
    : 0;
  const rate = successRate(level, economy, withOptimakina);

  const outcomes = matingOutcomes(male, female, colors, generations, rate);
  if (outcomes.length === 0) return null;

  // La masse de réussite vaut `rate` quand une couleur nomme la cible, et zéro
  // sinon — c'est exactement la condition des génétons.
  const namesTarget = outcomes.some((outcome) => outcome.kind === 'target');
  const maleGeneration = generations.get(male.colorId) ?? 1;
  const femaleGeneration = generations.get(female.colorId) ?? 1;
  const genetonKamas =
    rate *
    genetonsForCrossing(maleGeneration, femaleGeneration, namesTarget) *
    economy.genetonValue;

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
    optimakinaCost,
    genetonKamas,
  };
};

/* --------------------------------------------------------------- l'algèbre -- */

/**
 * Les mutations du recensement, toutes **réversibles au signe près**.
 *
 * La recherche défait ses coups des milliers de fois par fournée ; un compteur
 * qu'on ne sait pas décrémenter exactement fait dériver le recensement, et on
 * finit par évaluer un état qui n'existe pas. C'est pour ça que chaque opération
 * porte un `sign` plutôt que d'avoir une jumelle écrite à part.
 */
const bump = (census: Census, colorId: string, by: number) =>
  census.held.set(colorId, (census.held.get(colorId) ?? 0) + by);

/** Un croisement. Les deux parents deviennent stériles, le bébé arrive en espérance. */
export const applyCrossing = (
  census: Census,
  delta: PairDelta,
  generations: Map<string, number>,
  sign = 1
): void => {
  const rank = (colorId: string) => Math.min(generations.get(colorId) ?? 1, MAX_GENERATION);
  census.fertileMales[delta.maleGeneration] -= sign;
  census.fertileFemales[delta.femaleGeneration] -= sign;
  census.steriles[delta.maleGeneration] += sign;
  census.steriles[delta.femaleGeneration] += sign;
  census.carried[delta.maleCarried] -= sign;
  census.carried[delta.femaleCarried] -= sign;
  bump(census, delta.maleColor, -sign);
  bump(census, delta.femaleColor, -sign);

  for (const [colorId, probability, carried] of delta.births) {
    // Le sexe tombe à pile ou face, donc la naissance attendue est une
    // demi-monture de chaque côté. C'est ce qui permet à la recherche de voir
    // qu'un croisement de plus rééquilibre le parc.
    census.fertileMales[rank(colorId)] += sign * probability * 0.5;
    census.fertileFemales[rank(colorId)] += sign * probability * 0.5;
    census.carried[carried] += sign * probability;
    bump(census, colorId, sign * probability);
  }
  census.headcount += sign;
  census.kamas += sign * delta.genetonKamas;
  census.liquidation += sign * delta.expectedValue;
};

/** Un gen 1 anonyme entre au parc. */
export const purchase = (
  census: Census,
  colorId: string,
  sex: Sex,
  price: number,
  sign = 1
): void => {
  if (sex === 'M') census.fertileMales[1] += sign;
  else census.fertileFemales[1] += sign;
  census.carried[1] += sign;
  bump(census, colorId, sign);
  census.headcount += sign;
  census.kamas -= sign * price;
};

/** Une monture part en ambre. */
export const sacrifice = (
  census: Census,
  generation: number,
  carried: number,
  colorId: string,
  sex: Sex | null,
  value: number,
  sign = 1
): void => {
  if (sex === null) {
    census.steriles[generation] -= sign;
  } else {
    if (sex === 'M') census.fertileMales[generation] -= sign;
    else census.fertileFemales[generation] -= sign;
    census.carried[carried] -= sign;
    bump(census, colorId, -sign);
  }
  census.headcount -= sign;
  census.kamas += sign * value;
  census.liquidation -= sign * value;
};

/** Un clonage : deux stériles entrent, une fertile ressort. */
export const cloning = (
  census: Census,
  generation: number,
  carried: number,
  colorId: string,
  value: number,
  sign = 1
): void => {
  census.steriles[generation] -= 2 * sign;
  // Le sexe du survivant n'est pas choisi par la recherche : à ce niveau de
  // résumé on répartit une demi-monture de chaque côté.
  census.fertileMales[generation] += 0.5 * sign;
  census.fertileFemales[generation] += 0.5 * sign;
  census.carried[carried] += sign;
  bump(census, colorId, sign);
  census.headcount -= sign;
  // Le clonage consomme deux stériles et en rend une : une monture part.
  census.liquidation -= sign * value;
};

/** Une fertile passe féconde, ou l'inverse quand on défait. */
export const cycle = (census: Census, generation: number, sex: Sex, by: number): void => {
  const slot = Math.min(generation, MAX_GENERATION);
  if (sex === 'M') census.cycledMales[slot] += by;
  else census.cycledFemales[slot] += by;
};

/**
 * Ce que l'écurie rendrait si on la liquidait maintenant, solde compris.
 *
 * C'est **exactement la fonction de score** de la partie, évaluée sur l'état
 * attendu — la valeur myope, celle qui ne voit que ce que la fournée rapporte
 * tout de suite. Le point de comparaison honnête pour la valeur apprise.
 */
export const expectedScore = (census: Census): number => census.kamas + census.liquidation;
