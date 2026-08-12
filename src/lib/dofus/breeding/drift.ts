import { mateGroups, pairOutlook, type Mate } from './pairing';
import { carriedGeneration } from './naming';
import type { BreedingColor } from './costs';
import type { Individual, Stable } from './stable';

/**
 * Ce que l'arbre ne peut pas voir, et qu'il faut donc **signaler**.
 *
 * La route se calcule sur l'arbre : `breedingPlan` parcourt les recettes et rend
 * le chemin le moins cher en régime stationnaire — pour une gen 10 il faut deux
 * gen 9, et ainsi de suite. C'est exact, c'est lisible, et ça n'a aucune
 * heuristique à régler.
 *
 * Sa limite est assumée : l'arbre suppose « parent de génération strictement
 * inférieure à l'enfant », propriété que `extract-breeding-trees.mjs` vérifie et
 * qui rend sa récursion sûre. Or le relevé #59 dit qu'une monture peut porter
 * plus haut que sa propre couleur — une gen 1 née d'un croisement gen 9 manqué
 * traîne un 9 dans son ascendance, et deux telles montures visent la gen 10.
 * **Ce croisement-là n'est dans aucune recette**, donc aucun parcours d'arbre ne
 * le proposera jamais.
 *
 * ## Pourquoi signaler et non planifier
 *
 * Parce que ça ne se prévoit pas. Le raccourci naît d'un raté, à un taux qu'on
 * ne choisit pas, sur une couleur qu'on ne choisit pas non plus. Le faire entrer
 * dans le calcul de route reviendrait à planifier de la chance — et c'est
 * exactement ce que le glouton tentait, en re-dérivant péniblement à chaque coup
 * ce que l'arbre sait déjà.
 *
 * Ici on ne route rien : on **regarde l'écurie** et on dit « tu tiens ça, et ça
 * porte plus haut que ce que le plan compte en faire ». L'éleveur décide. C'est
 * de l'opportunisme, pas du routage, et toute la proposition tient dans cette
 * distinction.
 */

/** Une couleur, sa génération, et rien d'autre : ce qu'il faut pour lire l'écurie. */
export type DriftContext = {
  colors: BreedingColor[];
  generations: Map<string, number>;
};

/**
 * La plus haute génération que l'écurie **porte**, ascendance comprise.
 *
 * Et non la plus haute couleur possédée : une gen 1 dont un parent est gen 9
 * porte un 9. C'est cette valeur-là qui dit où en est réellement la montée, et
 * elle diffère de ce que le plan croit tenir dès qu'un raccourci traîne.
 */
export const stableFrontier = (stable: Stable, generations: Map<string, number>): number => {
  let top = 0;
  const consider = (colorId: string, parents: [string, string] | null) => {
    const own = generations.get(colorId) ?? 0;
    top = Math.max(
      top,
      carriedGeneration(
        own,
        parents ? [generations.get(parents[0]) ?? 0, generations.get(parents[1]) ?? 0] : null
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

/** Une occasion que l'arbre ne sait pas exprimer, et le couple qui la saisirait. */
export type DriftSignal = {
  /** La monture qui porte plus haut que sa couleur. */
  mount: Individual;
  /** La génération que son ascendance traîne, et qui décide de ce qu'elle vise. */
  carried: number;
  /** Le partenaire disponible qui en tire le plus. */
  partner: Mate;
  targetGeneration: number;
  /** Générations gagnées sur ce qu'une recette annoncerait. Toujours ≥ 1 ici. */
  leap: number;
  successRate: number;
};

/**
 * Les croisements hors recette que l'écurie permet **maintenant**.
 *
 * On ne parcourt pas tous les couples : seules les montures dont l'ascendance
 * dépasse la couleur peuvent produire un `leap`, et elles se comptent sur les
 * doigts — ce sont exactement celles que `tracksIndividually` fait suivre une
 * par une. Chacune est confrontée aux ascendances distinctes de l'écurie, pas à
 * ses montures : deux gen 1 achetées visent la même chose.
 *
 * Le second cas de dérive — une fournée malchanceuse qui laisse moins de parents
 * que prévu — n'a rien à faire ici. Il se rattrape tout seul : le plan se reprend
 * sur le stock, donc il redemande simplement l'étape ratée.
 */
export const driftSignals = (
  stable: Stable,
  { colors, generations }: DriftContext,
  limit = 5
): DriftSignal[] => {
  const groups = [...mateGroups(stable).values()];
  const signals: DriftSignal[] = [];

  for (const mount of stable.individuals) {
    if (!mount.fertile) continue;
    const own = generations.get(mount.colorId) ?? 0;
    const carried = carriedGeneration(
      own,
      mount.parents
        ? [generations.get(mount.parents[0]) ?? 0, generations.get(mount.parents[1]) ?? 0]
        : null
    );
    // Sans ascendance plus haute que soi, la monture est déjà ce que l'arbre
    // croit tenir : il n'y a rien à signaler.
    if (carried <= own) continue;

    const self: Mate = {
      id: mount.id,
      colorId: mount.colorId,
      sex: mount.sex,
      level: mount.level,
      parents: mount.parents,
    };

    let best: DriftSignal | null = null;
    for (const { sample } of groups) {
      // Une monture ne s'accouple ni avec elle-même ni avec son sexe.
      if (sample.sex === mount.sex || sample.id === mount.id) continue;

      const male = mount.sex === 'M' ? self : sample;
      const female = mount.sex === 'M' ? sample : self;
      const outlook = pairOutlook(male, female, colors, generations);
      // Sans gain sur la recette, le couple est déjà dans l'arbre : le plan sait
      // le proposer, et le répéter ici ferait deux conseils pour un.
      if (!outlook || outlook.leap <= 0) continue;
      // Et surtout : une cible que **aucune couleur ne nomme** n'est pas un
      // raccourci, c'est une recopie. Le tri de cette fonction se fait par
      // génération visée décroissante, si bien que sans ce test les couples les
      // plus impossibles remontaient en tête — plus l'ascendance pousse la cible
      // haut, plus il devient certain que rien ne la nomme.
      if (outlook.targetColors.length === 0) continue;

      const signal: DriftSignal = {
        mount,
        carried,
        partner: sample,
        targetGeneration: outlook.targetGeneration,
        leap: outlook.leap,
        successRate: outlook.successRate,
      };
      if (
        best === null ||
        signal.targetGeneration > best.targetGeneration ||
        (signal.targetGeneration === best.targetGeneration &&
          signal.successRate > best.successRate)
      ) {
        best = signal;
      }
    }

    if (best) signals.push(best);
  }

  return signals
    .sort(
      (a, b) =>
        b.targetGeneration - a.targetGeneration || b.leap - a.leap || b.successRate - a.successRate
    )
    .slice(0, limit);
};
