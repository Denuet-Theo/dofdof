import type { BreedingPlan } from './costs';
import { pairOutlook, BULK_MATE_LEVEL, type Mate } from './pairing';
import { formCouples, type Individual, type Pairing, type Stable } from './stable';
import type { Move, MoveContext } from './next-move';

/**
 * Suivre une route calculée, au lieu de la deviner coup par coup.
 *
 * `availableMoves` est un **routeur glouton** : il énumère tous les croisements
 * que l'écurie permet, leur donne une note, et prend le meilleur. Il ne voit
 * qu'un coup d'avance, et c'est de là que viennent les cinq défauts trouvés le
 * 6 août — des croisements qui ne pouvaient jamais aboutir (#76), un glouton qui
 * ne montait jamais (#78), le partenaire manquant (#80), une pénalité qui
 * asséchait l'écurie (#83). Chacun a demandé une greffe de plus : une frontière,
 * un besoin transitif, un amortissement par profondeur. À chaque fois, re-dériver
 * péniblement ce que l'arbre des recettes sait déjà.
 *
 * `breedingPlan` le sait, lui, et sans heuristique : il descend l'arbre, compte
 * les multiplicités, chiffre les tentatives par taux de réussite, et rend des
 * étapes **triées parents avant enfants**. Cet ordre est celui du temps — on
 * n'accouple pas une génération avant que la précédente soit née. Suivre le plan
 * revient donc à prendre la première étape que l'écurie permet de lancer.
 *
 * ## Ce qui remplace le rattrapage, et pourquoi il n'y a rien à écrire
 *
 * Le plan se recalcule à **chaque coup**, sur le stock réel. C'est ce que
 * `BreedingPlanOptions.stock` rend possible : les besoins se déduisent du stock
 * avant de remonter aux parents. Une fournée chanceuse allège tout l'amont, une
 * fournée malchanceuse le laisse à refaire — sans qu'aucun code de dérive n'ait
 * à s'en apercevoir. La dérive n'est pas rattrapée, elle est **absorbée**.
 *
 * Reste le cas de #59, qu'un arbre ne peut structurellement pas voir : un raté
 * qui porte une génération haute — une gen 1 dont un parent est gen 9 — n'est
 * dans aucune recette. Ce module ne le traite pas, et c'est délibéré : c'est de
 * l'opportunisme, pas du routage, et ça se signale plutôt que ça ne se planifie.
 *
 * ## Ce que ce module ne décide pas
 *
 * Il ne classe rien et ne compare rien. Le `score` qu'il pose sur ses coups
 * n'ordonne qu'entre eux, par rang d'étape, et n'a aucun sens en face d'un score
 * de `scoreOf`. C'est voulu : tout l'objet de la manœuvre est qu'il n'y ait plus
 * d'arbitrage à faire à ce niveau-là.
 */

/** Ce que l'écurie porte, par couleur — ce que `breedingPlan` appelle son stock. */
export const stableStock = (stable: Stable): Map<string, number> => {
  const stock = new Map<string, number>();
  const add = (colorId: string, count: number) =>
    stock.set(colorId, (stock.get(colorId) ?? 0) + count);

  for (const [colorId, counts] of stable.bulk) add(colorId, counts.males + counts.females);
  for (const mount of stable.individuals) if (mount.fertile) add(mount.colorId, 1);

  return stock;
};

export type PlanContext = MoveContext & {
  /**
   * Le plan à suivre, recalculé sur le stock qu'on lui passe.
   *
   * Injecté plutôt qu'appelé directement : `breedingPlan` demande les estimations
   * de coût de tout l'arbre, que l'appelant a déjà sous la main et que ce module
   * n'a aucune raison de reconstruire. C'est aussi ce qui permet de le mémoïser
   * là où il est calculé.
   */
  planFor: (stock: Map<string, number>) => BreedingPlan;
};

/** Retrouve la monture derrière un côté de couple, ou la traite comme du vrac. */
const mateOf = (side: Pairing, byId: Map<string, Individual>): Mate => {
  const mount = side.mountId ? byId.get(side.mountId) : undefined;
  return mount
    ? {
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        level: mount.level,
        parents: mount.parents,
      }
    : { id: null, colorId: side.colorId, sex: side.sex, level: BULK_MATE_LEVEL, parents: null };
};

/**
 * Le prochain croisement du plan que l'écurie permet de lancer.
 *
 * `null` quand aucune étape n'est réalisable — l'écurie manque de parents, ou le
 * plan est fini. L'appelant en tire ce qu'il en tire : la simulation rachète et
 * recycle, exactement comme lorsque le glouton ne rend rien.
 *
 * On descend les étapes dans l'ordre du plan et on prend la **première**
 * réalisable, sans chercher la meilleure. C'est le point de toute la manœuvre :
 * l'ordre a déjà été décidé par l'arbre, et le redécider ici serait remettre un
 * glouton derrière le plan.
 */
export const plannedMove = (stable: Stable, context: PlanContext): Move | null => {
  const plan = context.planFor(stableStock(stable));
  const byId = new Map(stable.individuals.map((mount) => [mount.id, mount]));

  for (const [rank, step] of plan.steps.entries()) {
    const [couple] = formCouples(stable, step.colorId, step.recipe, 1);
    if (!couple) continue;

    const male = mateOf(couple.male, byId);
    const female = mateOf(couple.female, byId);
    const outlook = pairOutlook(male, female, context.colors, context.generations);
    if (!outlook) continue;

    const held = Math.max(
      context.generations.get(male.colorId) ?? 0,
      context.generations.get(female.colorId) ?? 0
    );

    // Mêmes formules que `availableMoves`, pour que les deux politiques se
    // comparent sur les mêmes coûts : deux parents consommés, à moitié perdus
    // quand on recycle, plus deux cycles de carburant ; et deux des dix places
    // d'une fournée qui dure le même temps qu'elle soit pleine ou non.
    const parents =
      (Math.max(context.costOf(male.colorId), 0) + Math.max(context.costOf(female.colorId), 0)) *
      (context.recycleSteriles ? 0.5 : 1);

    return {
      ...outlook,
      available: 1,
      gained: Math.min(outlook.targetGeneration, context.topGeneration) - held,
      cost: parents + context.fuelCostPerCycle * 2,
      enclosHours:
        context.slots > 0 ? (context.batchHours * 2) / context.slots : context.batchHours,
      expectedValue: 0,
      // Décroissant avec le rang : la première étape réalisable est la bonne, et
      // ce nombre ne sert qu'à ce qu'un appelant qui trie ne les remette pas
      // dans le désordre.
      score: -rank,
    };
  }

  return null;
};
