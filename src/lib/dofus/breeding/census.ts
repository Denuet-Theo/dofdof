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
import type { BreedingColor } from './costs';
import type { Stable } from './stable';

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
};

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
