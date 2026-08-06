import { availableMoves, frontierNeeds, type Move, type MoveContext } from './next-move';
import { mateGroups, mateSignature, matingOutcomes, type Mate } from './pairing';
import { carriedGeneration, mountName } from './naming';
import { tracksIndividually, type Sex, type Stable } from './stable';
import type { ObjectiveId } from './objectives';

/**
 * La fournée à charger : combien de chaque croisement, et quelles montures
 * sortir de l'écurie.
 *
 * `availableMoves` classe les croisements possibles ; il ne dit pas **combien**
 * en lancer. Or c'est là que tout se joue devant l'enclos : les places sont
 * comptées, les sexes ne s'échangent pas, et un croisement en tête de liste peut
 * n'être réalisable qu'une fois faute de partenaire du bon sexe.
 *
 * Ce module descend du classement à la consigne. Il a été écrit après avoir fait
 * le calcul à la main pour une écurie réelle, et **la main s'était trompée deux
 * fois** : une fournée de 50 places compte 25 croisements et non 50, puisqu'un
 * accouplement consomme deux montures ; et un croisement annoncé sept fois
 * possible ne l'était que quatre, parce que l'une des couleurs était 3♂/0♀.
 * Les deux erreurs disparaissent dès qu'on décrémente un stock au lieu de
 * multiplier des effectifs.
 *
 * ## L'allocation
 *
 * Gloutonne, dans l'ordre du classement, jusqu'à saturer les places. C'est le
 * bon algorithme ici : le classement porte déjà l'arbitrage — la hauteur
 * atteinte, ce qui débloque la frontière, l'efficacité — et une fournée n'est
 * pas un problème d'ordonnancement, c'est un remplissage.
 *
 * Les deux orientations d'un croisement sont essayées, la plus disponible
 * d'abord : le sexe ne change ni la cible, ni le taux, ni la distribution des
 * ratés, il ne décide que de ce qui est faisable.
 */

/** Une ligne de la fournée : un croisement, son sens, et combien de fois. */
export type LoadoutLine = {
  /** La monture mâle à charger, et la femelle. L'ordre est celui du chargement. */
  male: Mate;
  female: Mate;
  count: number;
  /** Le coup dont cette ligne vient, pour la cible, le taux et le reste. */
  move: Move;
  /**
   * Les noms à inscrire en jeu sur les poulains de cette ligne, selon ce qui
   * naît. Vide quand rien n'est à nommer — le cas le plus fréquent, et c'est
   * une bonne nouvelle : seules les montures d'ascendance haute en demandent un.
   */
  names: { name: string; colorId: string; probability: number }[];
};

/** Ce qu'il faut sortir de l'écurie, par couleur et par sexe. */
export type LoadoutPull = {
  colorId: string;
  males: number;
  females: number;
  /** `true` quand la fournée vide cette couleur : c'est ce qu'on veut savoir avant. */
  exhausts: boolean;
};

export type Loadout = {
  lines: LoadoutLine[];
  crossings: number;
  /** Places du parc, et places réellement occupées : deux par croisement. */
  slots: number;
  used: number;
  /** La plus haute génération que l'écurie porte, ascendance comprise. */
  frontier: number;
  /** Les couleurs qui manquent pour franchir la frontière. Voir `frontierNeeds`. */
  missing: string[];
  pull: LoadoutPull[];
  /** Les noms à préparer, regroupés — une ligne par nom et non par monture. */
  names: { name: string; count: number }[];
};

/**
 * Les noms possibles pour les poulains d'un croisement.
 *
 * Un nom ne dépend que des deux couleurs parentes et de la génération de ce qui
 * naît, donc il y en a au plus deux par croisement : celui de la génération
 * visée et celui des issues plus basses. On les rend avec la probabilité
 * cumulée qui leur correspond, pour que l'écran dise combien en préparer.
 */
const namesFor = (
  move: Move,
  context: MoveContext,
  nameOf: (colorId: string) => string
): LoadoutLine['names'] => {
  const parents: [string, string] = [move.male.colorId, move.female.colorId];
  const parentGenerations: [number, number] = [
    context.generations.get(parents[0]) ?? 1,
    context.generations.get(parents[1]) ?? 1,
  ];

  const byName = new Map<string, { name: string; colorId: string; probability: number }>();
  for (const outcome of matingOutcomes(move.male, move.female, context.colors, context.generations)) {
    const generation = context.generations.get(outcome.colorId) ?? 1;
    if (!tracksIndividually(generation, parentGenerations)) continue;

    const name = mountName(carriedGeneration(generation, parentGenerations), [
      nameOf(parents[0]),
      nameOf(parents[1]),
    ]);
    const current = byName.get(name);
    if (current) current.probability += outcome.probability;
    else byName.set(name, { name, colorId: outcome.colorId, probability: outcome.probability });
  }

  return [...byName.values()].sort((a, b) => b.probability - a.probability);
};

/**
 * La fournée complète, à partir de l'écurie et des places disponibles.
 *
 * `nameOf` est injecté plutôt que déduit du catalogue : les noms affichés vivent
 * dans les lignes de l'écran, et les recopier ici ferait diverger les deux.
 */
export const buildLoadout = (
  stable: Stable,
  objective: ObjectiveId,
  context: MoveContext,
  slots: number,
  nameOf: (colorId: string) => string
): Loadout => {
  const needs = frontierNeeds(stable, context);
  // Assez de coups pour remplir n'importe quel parc : le classement décide de
  // l'ordre, l'allocation décide du nombre.
  const ranked = availableMoves(stable, objective, context, 40, true);

  /** Les montures encore libres, par ascendance et par sexe. */
  const pool = new Map<string, { mate: Mate; count: number }>();
  for (const [key, group] of mateGroups(stable)) {
    pool.set(key, { mate: group.sample, count: group.count });
  }

  const keyOf = (mate: Mate, sex: Sex) => `${mateSignature(mate)}|${sex}`;
  /** Prend une monture de cette ascendance et de ce sexe, si elle existe. */
  const take = (mate: Mate, sex: Sex): Mate | null => {
    const slot = pool.get(keyOf(mate, sex));
    if (!slot || slot.count <= 0) return null;
    slot.count -= 1;
    return slot.mate;
  };
  const give = (mate: Mate, sex: Sex) => {
    const slot = pool.get(keyOf(mate, sex));
    if (slot) slot.count += 1;
  };

  const lines: LoadoutLine[] = [];
  let used = 0;

  for (const move of ranked) {
    // Les deux sens du même croisement forment deux lignes distinctes : ce sont
    // des montures différentes à sortir, même si le résultat est identique.
    const orientations: [Mate, Mate][] = [
      [move.male, move.female],
      [move.female, move.male],
    ];

    for (const [first, second] of orientations) {
      let count = 0;
      while (used + 2 <= slots) {
        const male = take(first, 'M');
        if (!male) break;
        const female = take(second, 'F');
        if (!female) {
          // Sans partenaire, la première reste disponible pour l'autre sens.
          give(first, 'M');
          break;
        }
        count += 1;
        used += 2;
      }

      if (count > 0) {
        lines.push({
          male: { ...first, sex: 'M' },
          female: { ...second, sex: 'F' },
          count,
          move,
          names: namesFor(move, context, nameOf),
        });
      }
    }

    if (used + 2 > slots) break;
  }

  /** Ce qu'il faut sortir, agrégé par couleur et par sexe. */
  const pulled = new Map<string, { males: number; females: number }>();
  for (const line of lines) {
    for (const [mate, sex] of [
      [line.male, 'M'],
      [line.female, 'F'],
    ] as [Mate, Sex][]) {
      const current = pulled.get(mate.colorId) ?? { males: 0, females: 0 };
      if (sex === 'M') current.males += line.count;
      else current.females += line.count;
      pulled.set(mate.colorId, current);
    }
  }

  /** Ce qui reste après la fournée, pour signaler les couleurs vidées. */
  const left = new Map<string, number>();
  for (const [key, slot] of pool) {
    const colorId = key.slice(0, key.indexOf('|'));
    left.set(colorId, (left.get(colorId) ?? 0) + slot.count);
  }

  const names = new Map<string, number>();
  for (const line of lines) {
    for (const entry of line.names) {
      // Espérance arrondie au supérieur : mieux vaut préparer un nom de trop
      // qu'en manquer un devant l'enclos.
      const expected = Math.ceil(line.count * entry.probability);
      if (expected > 0) names.set(entry.name, (names.get(entry.name) ?? 0) + expected);
    }
  }

  return {
    lines,
    crossings: lines.reduce((total, line) => total + line.count, 0),
    slots,
    used,
    frontier: needs.reach - 1,
    missing: [...needs.depths.keys()],
    pull: [...pulled]
      .map(([colorId, counts]) => ({
        colorId,
        ...counts,
        exhausts: (left.get(colorId) ?? 0) === 0,
      }))
      .sort((a, b) => b.males + b.females - (a.males + a.females)),
    names: [...names]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
};
