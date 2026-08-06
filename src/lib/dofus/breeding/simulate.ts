import { matingOutcomes, type Mate } from './pairing';
import { availableMoves, type MoveContext } from './next-move';
import { cloneOptions, type CloneContext } from './cloning';
import { carriedGeneration } from './naming';
import { tracksIndividually, type Individual, type Sex, type Stable } from './stable';
import type { ObjectiveId } from './objectives';

/**
 * Ce qu'une route coûte **une fois la politique appliquée** — et où elle cale.
 *
 * `breedingPlan` chiffre un arbre figé : il suppose qu'on suivra la recette sans
 * jamais profiter d'un raté chanceux. C'est un majorant honnête, et il le dit.
 * Depuis que le prochain coup se lit sur l'écurie (`next-move.ts`), ce n'est
 * plus ce qu'on fera — donc plus ce que ça coûtera.
 *
 * L'écart n'a pas de forme close : la politique dépend de l'état, l'état dépend
 * des tirages, et les tirages changent qualitativement ce qui est possible
 * ensuite. Trois estimations dérivées à la main pendant ce chantier se sont
 * révélées fausses. On simule.
 *
 * ## Ce module sert à mesurer, pas à conseiller
 *
 * Il n'alimente aucun écran. Il existe parce que **tout ce qu'on a corrigé dans
 * la politique a été trouvé en simulant, jamais en relisant le code** : les
 * croisements qui ne peuvent pas aboutir, le glouton qui ne montait pas, et le
 * blocage que `stallDiagnosis` sert à identifier. Une heuristique qu'on ne
 * mesure pas est une heuristique qu'on invente.
 *
 * ## Pourquoi une distribution
 *
 * Une moyenne mentirait. Quand un seul tirage peut raccourcir la route de
 * plusieurs générations, la dispersion **est** l'information : un coût médian de
 * trois millions avec un neuvième décile à quinze n'est pas « trois millions ».
 *
 * ## Le générateur est injecté
 *
 * Pour que deux exécutions donnent le même chiffre, et qu'un écart mesuré après
 * un changement soit imputable au changement.
 */

/** Un générateur pseudo-aléatoire déterministe, pour que le résultat se relise. */
export const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    // Mulberry32 : court, sans dépendance, de qualité largement suffisante pour
    // tirer des naissances.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type SimulationContext = MoveContext &
  Pick<CloneContext, 'cheapestAt' | 'sacrificeUnitValue'> & {
    /** Coût d'une monture de génération 1, rachetée quand l'écurie se vide. */
    starterCost: number;
    /** Les couleurs de génération 1 qu'on rachète — plusieurs, pour varier les lignées. */
    starterColorIds: string[];
  };

export type SimulationOptions = {
  targetGeneration: number;
  objective: ObjectiveId;
  runs?: number;
  /** Garde-fou : au-delà, la partie est déclarée non aboutie. */
  maxCrossings?: number;
  seed?: number;
};

/**
 * Pourquoi une partie n'est pas allée plus haut.
 *
 * C'est l'information qui manquait pour traiter #79 : on savait que la montée
 * calait vers la génération 4, pas ce qui lui manquait à cet instant. Supposer
 * la cause aurait été une quatrième estimation à la main.
 */
export type StallDiagnosis = {
  /** La plus haute génération portée par une monture de l'écurie, à la fin. */
  frontier: number;
  /** Couleurs qu'il aurait fallu pour franchir la frontière, et qu'on ne tenait pas. */
  missing: string[];
  /** Coups encore possibles à la fin, tous en dessous de la frontière. */
  movesLeft: number;
};

export type RunOutcome = {
  reached: boolean;
  crossings: number;
  cost: number;
  enclosHours: number;
  /** La plus haute génération réellement obtenue. */
  top: number;
  stall: StallDiagnosis | null;
};

export type Distribution = { median: number; p10: number; p90: number; mean: number };

export type SimulationResult = {
  runs: number;
  reachedShare: number;
  /** Sur les parties abouties seulement — mêler les autres fausserait tout. */
  cost: Distribution;
  crossings: Distribution;
  enclosHours: Distribution;
  /** La génération atteinte, sur **toutes** les parties : c'est là qu'on voit caler. */
  top: Distribution;
  /**
   * Les couleurs qui manquaient le plus souvent au moment du blocage, les plus
   * fréquentes devant. C'est la liste qui dit ce que la politique aurait dû
   * fabriquer et n'a pas su vouloir.
   */
  missing: { colorId: string; runs: number }[];
};

const distribution = (values: number[]): Distribution => {
  if (values.length === 0) return { median: 0, p10: 0, p90: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
};

const copyStable = (stable: Stable): Stable => ({
  bulk: new Map([...stable.bulk].map(([id, counts]) => [id, { ...counts }])),
  individuals: stable.individuals.map((mount) => ({ ...mount })),
});

/** Retire une monture : stérile si suivie, décomptée si elle vient du vrac. */
const consume = (stable: Stable, mate: Mate) => {
  if (mate.id) {
    const mount = stable.individuals.find((candidate) => candidate.id === mate.id);
    if (mount) mount.fertile = false;
    return;
  }
  const bulk = stable.bulk.get(mate.colorId);
  if (!bulk) return;
  if (mate.sex === 'M') bulk.males = Math.max(0, bulk.males - 1);
  else bulk.females = Math.max(0, bulk.females - 1);
};

/** Range un nouveau-né, avec sa généalogie quand il faut la suivre. */
const addBirth = (
  stable: Stable,
  colorId: string,
  parents: [string, string],
  sex: Sex,
  generations: Map<string, number>,
  serial: number
) => {
  const generation = generations.get(colorId) ?? 1;
  const tracked = tracksIndividually(generation, [
    generations.get(parents[0]) ?? 1,
    generations.get(parents[1]) ?? 1,
  ]);

  if (!tracked) {
    const bulk = stable.bulk.get(colorId) ?? { males: 0, females: 0 };
    if (sex === 'M') bulk.males += 1;
    else bulk.females += 1;
    stable.bulk.set(colorId, bulk);
    return;
  }

  stable.individuals.push({
    id: `sim-${serial}`,
    colorId,
    name: null,
    sex,
    level: 1,
    fertile: true,
    parents,
  } satisfies Individual);
};

/** Tire une couleur dans les issues d'un accouplement, à leurs probabilités. */
const drawOutcome = (outcomes: { colorId: string; probability: number }[], roll: number) => {
  let cumulative = 0;
  for (const outcome of outcomes) {
    cumulative += outcome.probability;
    if (roll <= cumulative) return outcome.colorId;
  }
  return outcomes.length > 0 ? outcomes[outcomes.length - 1].colorId : null;
};

/**
 * La plus haute génération que l'écurie **porte**, ascendance comprise.
 *
 * Et non la plus haute couleur possédée : une gen 1 dont un parent est gen 9
 * porte un 9, c'est tout l'objet de #59. C'est cette valeur-là qui dit où en est
 * réellement la montée.
 */
export const stableFrontier = (stable: Stable, generations: Map<string, number>): number => {
  let top = 0;
  const consider = (colorId: string, parents: [string, string] | null) => {
    const own = generations.get(colorId) ?? 0;
    top = Math.max(
      top,
      carriedGeneration(
        own,
        parents
          ? [generations.get(parents[0]) ?? 0, generations.get(parents[1]) ?? 0]
          : null
      )
    );
  };

  for (const [colorId, counts] of stable.bulk) {
    if (counts.males > 0 || counts.females > 0) consider(colorId, null);
  }
  for (const mount of stable.individuals) {
    if (mount.fertile) consider(mount.colorId, mount.parents);
  }
  return top;
};

/**
 * Ce qui manque pour franchir la frontière.
 *
 * Une couleur de génération `frontier + 1` se compose de deux couleurs — sa
 * recette. Si l'écurie porte l'une des deux et pas l'autre, l'autre est ce qu'il
 * faudrait fabriquer. C'est exactement ce qu'un glouton à un coup ne peut pas
 * vouloir : cette monture-là n'avance aucune génération par elle-même.
 */
export const missingForFrontier = (
  stable: Stable,
  frontier: number,
  context: SimulationContext
): string[] => {
  const held = new Set<string>();
  for (const [colorId, counts] of stable.bulk) {
    if (counts.males > 0 || counts.females > 0) held.add(colorId);
  }
  for (const mount of stable.individuals) if (mount.fertile) held.add(mount.colorId);

  const wanted = new Set<string>();
  for (const color of context.colors) {
    if (color.generation !== frontier + 1) continue;
    for (const recipe of color.recipes) {
      const [a, b] = recipe;
      if (held.has(a) && !held.has(b)) wanted.add(b);
      else if (held.has(b) && !held.has(a)) wanted.add(a);
    }
  }
  return [...wanted];
};

/** Recycle les stériles en fertiles, en suivant l'arbitrage de `cloning.ts`. */
const recycle = (stable: Stable, context: SimulationContext, random: () => number) => {
  const options = cloneOptions(
    stable,
    {
      generations: context.generations,
      costOf: context.costOf,
      cheapestAt: context.cheapestAt,
      sacrificeUnitValue: context.sacrificeUnitValue,
    },
    50
  );

  const removed = new Set<string>();
  for (const option of options) {
    const keeps = random() < option.keepChance;
    const survivor = keeps ? option.keep : option.partner;
    const consumed = keeps ? option.partner : option.keep;
    const revived = stable.individuals.find((mount) => mount.id === survivor.id);
    if (revived) {
      revived.fertile = true;
      revived.level = 1;
    }
    removed.add(consumed.id!);
  }
  if (removed.size > 0) {
    stable.individuals = stable.individuals.filter((mount) => !removed.has(mount.id));
  }
};

/**
 * Stériles au-delà desquelles on force un tour de clonage.
 *
 * Sans ce déclencheur, les stériles ne se recyclaient qu'une fois l'écurie
 * bloquée, et la liste des individus enflait — or elle est parcourue à chaque
 * pas. Cloner au fil de l'eau est aussi ce qu'un éleveur fait.
 */
const CLONE_THRESHOLD = 12;

/** Une partie : on joue la politique jusqu'à la génération visée, ou jusqu'au budget. */
const playOnce = (
  start: Stable,
  context: SimulationContext,
  { targetGeneration, objective, maxCrossings = 300 }: SimulationOptions,
  random: () => number
): RunOutcome => {
  const stable = copyStable(start);
  let cost = 0;
  let enclosHours = 0;
  let crossings = 0;
  let serial = 0;
  let top = 0;

  while (crossings < maxCrossings) {
    if (stable.individuals.filter((mount) => !mount.fertile).length >= CLONE_THRESHOLD) {
      recycle(stable, context, random);
    }

    const moves = availableMoves(stable, objective, context, 1);

    if (moves.length === 0) {
      recycle(stable, context, random);
      // Plus rien d'accouplable : on rachète de quoi repartir, ce qu'un éleveur
      // fait. L'ignorer ferait échouer des parties qui n'échouent pas.
      const colorId = context.starterColorIds[serial % context.starterColorIds.length];
      const bulk = stable.bulk.get(colorId) ?? { males: 0, females: 0 };
      bulk.males += 1;
      bulk.females += 1;
      stable.bulk.set(colorId, bulk);
      cost += 2 * context.starterCost;
      crossings += 1;
      serial += 1;
      continue;
    }

    const move = moves[0];
    cost += move.cost;
    enclosHours += move.enclosHours;
    crossings += 1;

    consume(stable, move.male);
    consume(stable, move.female);

    const colorId = drawOutcome(
      matingOutcomes(move.male, move.female, context.colors, context.generations),
      random()
    );
    if (!colorId) continue;

    addBirth(
      stable,
      colorId,
      [move.male.colorId, move.female.colorId],
      random() < 0.5 ? 'M' : 'F',
      context.generations,
      serial++
    );

    const generation = context.generations.get(colorId) ?? 0;
    top = Math.max(top, generation);
    if (generation >= targetGeneration) {
      return { reached: true, crossings, cost, enclosHours, top, stall: null };
    }
  }

  const frontier = stableFrontier(stable, context.generations);
  return {
    reached: false,
    crossings,
    cost,
    enclosHours,
    top,
    stall: {
      frontier,
      missing: missingForFrontier(stable, frontier, context),
      movesLeft: availableMoves(stable, objective, context, 50).length,
    },
  };
};

/**
 * Le coût et la durée d'une route, sous la politique, en distribution — et le
 * diagnostic des parties qui n'aboutissent pas.
 */
export const simulatePolicy = (
  start: Stable,
  context: SimulationContext,
  options: SimulationOptions
): SimulationResult => {
  const runs = options.runs ?? 20;
  const random = seededRandom(options.seed ?? 1);
  const results: RunOutcome[] = [];

  for (let run = 0; run < runs; run += 1) {
    results.push(playOnce(start, context, options, random));
  }

  const reached = results.filter((result) => result.reached);

  const missingCounts = new Map<string, number>();
  for (const result of results) {
    for (const colorId of new Set(result.stall?.missing ?? [])) {
      missingCounts.set(colorId, (missingCounts.get(colorId) ?? 0) + 1);
    }
  }

  return {
    runs,
    reachedShare: reached.length / runs,
    cost: distribution(reached.map((result) => result.cost)),
    crossings: distribution(reached.map((result) => result.crossings)),
    enclosHours: distribution(reached.map((result) => result.enclosHours)),
    top: distribution(results.map((result) => result.top)),
    missing: [...missingCounts]
      .map(([colorId, count]) => ({ colorId, runs: count }))
      .sort((a, b) => b.runs - a.runs),
  };
};
