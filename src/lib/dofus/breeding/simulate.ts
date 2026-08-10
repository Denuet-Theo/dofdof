import { breedingPlan, type BreedingEstimate, type BreedingPlan } from './costs';
import { crossingCost, crossingHours, planCouples, type LoadoutContext } from './loadout';
import { matingOutcomes, BULK_MATE_LEVEL, type Mate } from './pairing';
import { cloneOptions, type CloneContext } from './cloning';
import { driftSignals, stableFrontier } from './drift';
import { seededRandom } from './random';
import {
  breedableStock,
  copyStable,
  splitBySex,
  tracksIndividually,
  type Individual,
  type Pairing,
  type Sex,
  type Stable,
} from './stable';

/**
 * Ce qu'une route coûte **une fois jouée** — et où elle cale.
 *
 * `breedingPlan` chiffre un arbre en régime stationnaire : il suppose que chaque
 * étape rendra ses bébés au taux annoncé. C'est un majorant honnête, et il le
 * dit. Ce qui se passe réellement en diffère de deux façons : les tirages
 * tombent comme ils veulent, et les parents effectivement en main ne sont pas
 * ceux que l'étape supposait.
 *
 * D'où cette simulation, qui joue ce que l'écran conseille : **reprendre le plan
 * sur le stock à chaque fournée, charger les étapes que l'écurie permet,
 * racheter ce que le plan réclame quand plus rien ne se forme**. C'est la
 * politique entière, sans heuristique à régler — ce qui est précisément
 * l'intérêt de router par l'arbre.
 *
 * ## Ce module sert à mesurer, pas à conseiller
 *
 * Il n'alimente aucun écran. Il existe parce que **tout ce qu'on a corrigé dans
 * la politique a été trouvé en simulant, jamais en relisant le code** : les
 * croisements qui ne pouvaient pas aboutir, le glouton qui ne montait pas, la
 * pénalité finie qui asséchait l'écurie. Une politique qu'on ne mesure pas est
 * une politique qu'on invente.
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

/**
 * Un générateur pseudo-aléatoire déterministe, pour que le résultat se relise.
 *
 * Il a déménagé dans `random.ts` le jour où `search.ts` en a eu besoin : la
 * montée de colline portée du Rust n'est reproductible que si les deux côtés
 * tirent la même suite, ce qui fait du générateur un contrat et non un détail de
 * cette simulation-ci. Réexporté ici, où il a toujours été appelé.
 */
export { seededRandom };

export type SimulationContext = LoadoutContext &
  Pick<CloneContext, 'cheapestAt' | 'sacrificeUnitValue'> & {
    /**
     * Les coûts de revient dont le plan se sert pour choisir ses recettes.
     *
     * Ils ne dépendent pas de l'écurie, donc ils se calculent une fois pour
     * toute la simulation — seul le stock change d'une fournée à l'autre.
     */
    estimates: Map<string, BreedingEstimate>;
    genetonValue?: number;
  };

export type SimulationOptions = {
  /** La couleur visée, celle dont on suit le plan. */
  targetColorId: string;
  targetGeneration: number;
  runs?: number;
  /** Garde-fou : au-delà, la partie est déclarée non aboutie. */
  maxCrossings?: number;
  seed?: number;
};

/**
 * Pourquoi une partie n'est pas allée plus haut.
 *
 * Supposer la cause reviendrait à estimer à la main, ce qui s'est révélé faux
 * trois fois pendant ce chantier.
 */
export type StallDiagnosis = {
  /** La plus haute génération portée par une monture de l'écurie, à la fin. */
  frontier: number;
  /** Couleurs que les étapes bloquées réclamaient et que l'écurie ne fournissait pas. */
  missing: string[];
  /** Étapes du plan encore à faire à la fin. */
  stepsLeft: number;
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
   * fréquentes devant. C'est la liste qui dit ce que le plan réclamait et que
   * l'écurie n'a jamais su fournir.
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

/**
 * Sort une monture de l'écurie pour l'accoupler. `false` si elle n'y est plus.
 *
 * Les signalements de dérive se lisent sur l'écurie d'avant la fournée ; deux
 * d'entre eux peuvent vouloir le même partenaire. On revérifie donc à la prise
 * plutôt que de faire confiance à la liste.
 */
const takeMate = (stable: Stable, mate: Mate): boolean => {
  if (mate.id) {
    const mount = stable.individuals.find((candidate) => candidate.id === mate.id);
    if (!mount?.fertile) return false;
    mount.fertile = false;
    return true;
  }

  const bulk = stable.bulk.get(mate.colorId);
  const key = mate.sex === 'M' ? 'males' : 'females';
  if (!bulk || bulk[key] <= 0) return false;
  bulk[key] -= 1;
  return true;
};

/** Retrouve la monture derrière un côté de couple, telle que l'appariement la voit. */
const mateOf = (stable: Stable, side: Pairing): Mate => {
  const mount = side.mountId
    ? stable.individuals.find((candidate) => candidate.id === side.mountId)
    : undefined;
  return {
    id: side.mountId,
    colorId: side.colorId,
    sex: side.sex,
    level: mount?.level ?? BULK_MATE_LEVEL,
    parents: mount?.parents ?? null,
  };
};

/** Range une monture entrante — vrac ou individu, selon ce que son ascendance vaut. */
const store = (
  stable: Stable,
  colorId: string,
  parents: [string, string] | null,
  sex: Sex,
  generations: Map<string, number>,
  serial: number
) => {
  const generation = generations.get(colorId) ?? 1;
  const tracked = tracksIndividually(
    generation,
    parents ? [generations.get(parents[0]) ?? 1, generations.get(parents[1]) ?? 1] : null
  );

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
    // La simulation facture un cycle de fécondité à chaque accouplement, donc
    // aucune monture simulée n'arrive avec le sien déjà payé.
    cycled: false,
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
 * Achète ce qui bloque, et à défaut ce que le plan réclame.
 *
 * Le plan dit déjà quoi se procurer plutôt qu'élever — ce sont les feuilles de
 * son parcours. Inutile de deviner une couleur de départ : il suffit de le lire.
 *
 * Mais le lire ne suffit pas, et c'est la simulation qui l'a montré : le plan
 * déduit le stock **en effectif**, sans égard au sexe. Trois mâles et zéro
 * femelle se lisent « trois exemplaires en main », donc le plan ne redemande
 * rien — et aucun couple ne se forme. La partie calait alors en génération 6
 * sans jamais racheter, dans vingt parties sur vingt. On part donc de ce qui a
 * réellement bloqué la fournée, et on rachète parmi ces couleurs-là celles qui
 * s'achètent.
 *
 * On achète **par paire au moins**, un mâle et une femelle : un exemplaire seul
 * n'ouvre aucun couple, et la fournée suivante rebloquerait au même endroit.
 */
const buyWhatIsMissing = (
  stable: Stable,
  plan: BreedingPlan,
  blocking: Set<string>,
  context: SimulationContext,
  serial: number
): { spent: number; bought: number } => {
  /** Une couleur ne se rachète que si quelqu'un la vend — ou si on la capture. */
  const purchasable = (colorId: string) => {
    const estimate = context.estimates.get(colorId);
    if (!estimate || estimate.cost === null) return null;
    return estimate.strategy === 'buy' || estimate.strategy === 'capture' ? estimate.cost : null;
  };

  const stuck = [...blocking]
    .flatMap((colorId) => {
      const unitCost = purchasable(colorId);
      return unitCost === null
        ? []
        : [{ colorId, unitCost, generation: context.generations.get(colorId) ?? 1 }];
    })
    .sort((a, b) => a.generation - b.generation || a.unitCost - b.unitCost);

  const list =
    stuck.length > 0
      ? stuck
      : plan.purchases
          .map((purchase) => ({
            colorId: purchase.colorId,
            unitCost: purchase.unitCost,
            generation: purchase.generation,
          }))
          .sort((a, b) => a.generation - b.generation || a.unitCost - b.unitCost);

  /** Ce que le plan veut de chaque couleur achetée, pour toute la route. */
  const wanted = new Map(plan.purchases.map((purchase) => [purchase.colorId, purchase.count]));

  let spent = 0;
  let bought = 0;

  for (const { colorId, unitCost } of list) {
    // La quantité vient du plan, qui l'a comptée sur toute la route. En acheter
    // deux à la fois « pour voir » revient à s'arrêter au premier obstacle : la
    // partie repassait alors son budget à racheter une paire, la brûler, et
    // racheter — génération 4 atteinte, jamais dépassée.
    const count = Math.max(2, wanted.get(colorId) ?? 0);
    const { males, females } = splitBySex(count);

    for (const [sex, howMany] of [
      ['M', males],
      ['F', females],
    ] as [Sex, number][]) {
      for (let index = 0; index < howMany; index += 1) {
        store(stable, colorId, null, sex, context.generations, serial + bought + index);
      }
    }

    bought += males + females;
    spent += (males + females) * unitCost;
  }

  return { spent, bought };
};

/**
 * Stériles au-delà desquelles on force un tour de clonage.
 *
 * Sans ce déclencheur, les stériles ne se recyclaient qu'une fois l'écurie
 * bloquée, et la liste des individus enflait — or elle est parcourue à chaque
 * pas. Cloner au fil de l'eau est aussi ce qu'un éleveur fait.
 */
const CLONE_THRESHOLD = 12;

/** Une partie : on suit le plan jusqu'à la génération visée, ou jusqu'au budget. */
const playOnce = (
  start: Stable,
  context: SimulationContext,
  { targetColorId, targetGeneration, maxCrossings = 300 }: SimulationOptions,
  random: () => number
): RunOutcome => {
  const stable = copyStable(start);
  const capacity = Math.max(context.slots, 2);
  let cost = 0;
  let enclosHours = 0;
  let crossings = 0;
  let serial = 0;
  let top = 0;

  /** Le dernier diagnostic, gardé pour dire où la partie a calé. */
  let blocked: string[] = [];
  let stepsLeft = 0;

  /**
   * Accouple deux montures déjà sorties de l'écurie et range ce qui naît.
   * Rend la génération obtenue, ou `null` si l'appariement ne donne rien.
   */
  const breed = (male: Mate, female: Mate): number | null => {
    cost += crossingCost([male.colorId, female.colorId], context);
    enclosHours += crossingHours(context);
    crossings += 1;

    const colorId = drawOutcome(
      matingOutcomes(male, female, context.colors, context.generations),
      random()
    );
    if (!colorId) return null;

    store(
      stable,
      colorId,
      [male.colorId, female.colorId],
      random() < 0.5 ? 'M' : 'F',
      context.generations,
      serial++
    );
    return context.generations.get(colorId) ?? 0;
  };

  while (crossings < maxCrossings) {
    if (stable.individuals.filter((mount) => !mount.fertile).length >= CLONE_THRESHOLD) {
      recycle(stable, context, random);
    }

    let used = 0;

    /**
     * Le rattrapage, et c'est le seul morceau que l'arbre ne porte pas.
     *
     * Une monture dont l'ascendance dépasse sa couleur n'est dans aucune
     * recette : le plan ne la proposera jamais. L'écran la signale, l'éleveur la
     * saisit — et une simulation qui suivrait le plan sans le faire mesurerait
     * autre chose que ce qu'on conseille. Elle passe **avant** la fournée : ces
     * montures-là sont exactement celles qu'une étape ordinaire consommerait
     * sans profit.
     */
    for (const signal of driftSignals(stable, context, Math.floor(capacity / 2))) {
      if (used + 2 > capacity) break;
      const self: Mate = {
        id: signal.mount.id,
        colorId: signal.mount.colorId,
        sex: signal.mount.sex,
        level: signal.mount.level,
        parents: signal.mount.parents,
      };
      if (!takeMate(stable, self)) continue;
      if (!takeMate(stable, signal.partner)) {
        // Sans partenaire, la porteuse reste fertile : elle vaut trop cher pour
        // qu'on la brûle sur un couple qui ne se forme pas.
        const mount = stable.individuals.find((candidate) => candidate.id === self.id);
        if (mount) mount.fertile = true;
        continue;
      }

      used += 2;
      const male = self.sex === 'M' ? self : signal.partner;
      const female = self.sex === 'M' ? signal.partner : self;
      const generation = breed(male, female);
      if (generation === null) continue;
      top = Math.max(top, generation);
      if (generation >= targetGeneration) {
        return { reached: true, crossings, cost, enclosHours, top, stall: null };
      }
    }

    // Le plan se reprend sur le stock à chaque fournée : c'est tout le mécanisme
    // de rattrapage de la dérive ordinaire. Une fournée chanceuse allège l'amont,
    // une fournée malchanceuse laisse l'étape à refaire.
    const plan = breedingPlan(targetColorId, context.colors, context.estimates, {
      targetCount: 1,
      recycleSteriles: context.recycleSteriles,
      genetonValue: context.genetonValue ?? 0,
      stock: breedableStock(stable, targetColorId),
      slots: capacity,
    });
    stepsLeft = plan.steps.length;

    const batch = planCouples(plan, stable, capacity - used);
    blocked = [...new Set(batch.blocked.flatMap((entry) => entry.missing))];

    /**
     * Les places qui restent, comblées en capturant les feuilles qui bloquent.
     *
     * Le diagnostic, relevé sur une route complète : les fournées incomplètes ne
     * le sont ni parce que le plan est vide ni parce qu'il demande trop peu — il
     * réclamait dix-neuf étapes — mais parce que **les gen 1 sont épuisées**.
     * `ebene_orchidee <- orchidee`, `dore_orchidee <- orchidee`, sur une écurie
     * qui ne portait plus que quatre Doré. Le plan bloque en cascade jusqu'en
     * haut, et les trois quarts du parc restent vides.
     *
     * Le rachat général ne s'en occupait pas : il ne se déclenche que sur une
     * fournée *entièrement* vide, or il en restait deux couples. Et l'élargir a
     * été essayé — il rachète alors toute la liste du plan, hautes générations
     * comprises, ce qui revenait 22 % plus cher.
     *
     * On ne capture donc que ce qui bloque **et** se capture : les feuilles de
     * génération 1, par paires, ce qui est toujours possible et bon marché. Une
     * capture n'est pas un accouplement : elle ne compte pas au budget de
     * croisements, seulement en kamas.
     */
    for (let appoint = 0; appoint < 4; appoint += 1) {
      if (used + batch.used + 2 > capacity) break;

      const feuilles = [...new Set(batch.blocked.flatMap((entry) => entry.missing))].filter(
        (colorId) => (context.generations.get(colorId) ?? 9) === 1
      );
      if (feuilles.length === 0) break;

      for (const colorId of feuilles) {
        const unite = Math.max(context.costOf(colorId), 0);
        for (const sex of ['M', 'F'] as Sex[]) {
          store(stable, colorId, null, sex, context.generations, serial++);
          cost += unite;
        }
      }

      const appointBatch = planCouples(plan, stable, capacity - used - batch.used);
      if (appointBatch.couples.length === 0) break;
      batch.couples.push(...appointBatch.couples);
      batch.used += appointBatch.used;
      batch.blocked = appointBatch.blocked;
      blocked = [...new Set(appointBatch.blocked.flatMap((entry) => entry.missing))];
    }

    // Le rachat ne se déclenche que sur une fournée **entièrement** vide, si bien
    // qu'un seul couple formé suffit à le bloquer : l'enclos peut tourner à deux
    // accouplements sur vingt-cinq places sans que rien ne le signale.
    //
    // Racheter dès qu'il reste de la place a été essayé et mesuré : la gen 10
    // revenait **22 % plus cher**, parce qu'on capture alors des gen 1 en
    // permanence là où l'ancien seuil n'achetait qu'au blocage. Le comportement
    // reste donc celui-ci, faute d'une règle qui remplisse l'enclos sans acheter
    // à tout va.
    if (batch.couples.length === 0 && used === 0) {
      // Rien à charger : on réarme les stériles, puis on rachète ce que le plan
      // demande. Un éleveur fait exactement cela, et l'ignorer ferait échouer des
      // parties qui n'échouent pas.
      recycle(stable, context, random);
      const bought = buyWhatIsMissing(stable, plan, new Set(blocked), context, serial);
      serial += bought.bought;
      cost += bought.spent;
      // Une tournée d'achat compte au budget : sans quoi une route qui ne peut
      // rien produire tournerait sans fin.
      crossings += 1;
      if (bought.bought === 0) break;
      continue;
    }

    for (const couple of batch.couples) {
      const generation = breed(mateOf(stable, couple.male), mateOf(stable, couple.female));
      if (generation === null) continue;
      top = Math.max(top, generation);
      if (generation >= targetGeneration) {
        return { reached: true, crossings, cost, enclosHours, top, stall: null };
      }
    }
  }

  return {
    reached: false,
    crossings,
    cost,
    enclosHours,
    top,
    stall: { frontier: stableFrontier(stable, context.generations), missing: blocked, stepsLeft },
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
