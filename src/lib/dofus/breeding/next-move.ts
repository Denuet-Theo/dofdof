import { mateGroups, pairOutlook, mateSignature, type Mate, type PairOutlook } from './pairing';
import type { BreedingColor } from './costs';
import type { ObjectiveId } from './objectives';
import type { Stable } from './stable';

/**
 * Le prochain coup — c'est-à-dire un plan qui se relit au lieu de se dérouler.
 *
 * `breedingPlan` répond à « quel arbre de croisements mène à cette couleur ». Il
 * le calcule **avant la première naissance**, et c'est là que le bât blesse :
 * chaque accouplement est un tirage à 30-90 %, et l'écurie qui en sort n'est pas
 * celle que l'arbre supposait. Au troisième croisement, un plan de 762
 * accouplements décrit déjà un parc qui n'existe pas.
 *
 * Le raccourci de #59 rend le décalage qualitatif et non plus quantitatif : un
 * raté peut porter une génération que l'arbre comptait mettre dix croisements à
 * atteindre. Ce n'est pas une erreur d'estimation, c'est une route qui n'était
 * pas dans le graphe.
 *
 * D'où une **politique** plutôt qu'un arbre : « compte tenu de ce que je tiens
 * maintenant, qu'est-ce que je lance ? », recalculée à chaque saisie de fournée.
 *
 * ## Pourquoi un seul coup d'avance n'est pas un renoncement
 *
 * Anticiper à N coups ne vaut que si l'état est prévisible. Ici chaque coup est
 * une pièce qui change l'état **qualitativement** — une naissance hors cible
 * n'est pas « un peu moins bien », c'est une monture d'une autre couleur avec
 * une autre ascendance, donc d'autres croisements possibles. Sur un processus
 * pareil, la politique optimale se réévalue à chaque pas ; dérouler vingt coups
 * revient à parier vingt fois de suite sur le même tirage.
 *
 * ## Ce que ça rend inutile
 *
 * Le crédit des bébés hors cible était un facteur de correction : on chiffrait
 * ce que valait une monture qu'on ne saurait pas replacer. Ici il n'y a rien à
 * créditer — la monture **est** dans l'écurie, et si elle sert, elle apparaît
 * dans la liste. La chance et la malchance ne se modélisent plus, elles se
 * lisent.
 */

/** Un croisement réalisable **maintenant**, et ce qu'il vaut. */
export type Move = PairOutlook & {
  /**
   * Couples formables avec ces deux ascendances, les deux orientations
   * comptées. Voir `stableShortcuts` : les montures interchangeables se
   * replient, on n'affiche pas dix fois la même ligne.
   */
  available: number;
  /**
   * Générations gagnées sur la plus haute des deux montures accouplées.
   *
   * C'est l'avancement réel du coup, et il diffère de `leap` : celui-ci compare
   * à ce qu'une recette annoncerait, celui-là à ce qu'on tient déjà. Un
   * croisement ordinaire gagne 1, un raccourci davantage.
   */
  gained: number;
  /** Kamas à sortir pour cet accouplement, parents consommés compris. */
  cost: number;
  /** Heures d'enclos que les deux parents mobilisent. */
  enclosHours: number;
  /** Ce que la naissance vaut en espérance, cible et hors cible confondus. */
  expectedValue: number;
  /** Le score selon l'objectif courant, déjà orienté « plus grand = mieux ». */
  score: number;
};

export type MoveContext = {
  colors: BreedingColor[];
  generations: Map<string, number>;
  /** Ce qu'une couleur coûterait à se procurer, pour chiffrer ce qu'on consomme. */
  costOf: (colorId: string) => number;
  /** Ce qu'une couleur rapporte à la sortie retenue, pour l'objectif « rentabilité ». */
  valueOf: (colorId: string) => number;
  /** Carburant d'un cycle de fécondité, par monture. Un accouplement en consomme deux. */
  fuelCostPerCycle: number;
  /** Heures d'une fournée d'enclos, et places disponibles. */
  batchHours: number;
  slots: number;
  /**
   * Le clonage rend la moitié de ce qu'on consomme, donc le coût net d'un parent
   * est divisé par deux. Même règle qu'ailleurs.
   */
  recycleSteriles: boolean;
  /** La génération la plus haute de la famille : ce que les objectifs « gen 10 » visent. */
  topGeneration: number;
};

/**
 * Ce que rapporte une naissance, en espérance.
 *
 * La couleur cible arrive avec `successRate`, le reste avec le complément — et
 * `matingOutcomes` sait déjà répartir les deux. On se contente ici de la valeur
 * de la couleur visée et de celle des parents, parce que la valeur d'une couleur
 * hors cible se lit sur sa propre ligne du classement, pas ici.
 */
const expectedBirthValue = (outlook: PairOutlook, { valueOf }: MoveContext): number => {
  const target = outlook.targetColors[0];
  const onTarget = target ? valueOf(target.colorId) : 0;
  // À défaut de savoir quelle couleur sort d'un raté, on prend la mieux dotée
  // des deux lignées : c'est la borne haute, et elle ne sert qu'à départager.
  const offTarget = Math.max(valueOf(outlook.male.colorId), valueOf(outlook.female.colorId));
  return outlook.successRate * onTarget + (1 - outlook.successRate) * offTarget;
};

/**
 * Le score d'un coup selon l'objectif **que l'éleveur a choisi**.
 *
 * Le même sélecteur que le classement des couleurs, et ce n'est pas une
 * commodité : un panneau qui classerait sur un autre critère que la page où il
 * vit donnerait deux recommandations contradictoires sur le même écran.
 *
 * | Objectif | Ce qu'on maximise |
 * | --- | --- |
 * | `profit` | kamas nets par heure d'enclos |
 * | `gen10_profit` | générations gagnées par kama dépensé |
 * | `gen10_balanced` | générations gagnées par heure d'enclos |
 *
 * Les deux objectifs « gen 10 » ne comptent que ce qui **monte** : un croisement
 * qui ne gagne aucune génération marque zéro, quoi qu'il rapporte. C'est
 * exactement ce qui les sépare de la rentabilité, et c'est déjà ce que
 * `rankFor` fait sur les couleurs.
 */
const scoreOf = (move: Omit<Move, 'score'>, objective: ObjectiveId): number => {
  if (objective === 'profit') {
    return move.enclosHours > 0 ? (move.expectedValue - move.cost) / move.enclosHours : -Infinity;
  }

  // Monter au-dessus du plafond de la famille n'existe pas, et `pairOutlook`
  // l'a déjà écarté. Reste que gagner une génération qu'on tient déjà ne fait
  // pas avancer : c'est le cas d'un croisement qu'on ne monte pas pour monter.
  const progress = move.gained * move.successRate;
  if (progress <= 0) return -Infinity;

  if (objective === 'gen10_profit') {
    // Un coût nul est possible — carburant offert, parents déjà stériles à
    // recycler. Il ne doit pas rendre le score infini et écraser le classement.
    return move.cost > 0 ? progress / move.cost : progress * 1e6;
  }

  return move.enclosHours > 0 ? progress / move.enclosHours : -Infinity;
};

/**
 * Tous les croisements que l'écurie permet de lancer **maintenant**, classés
 * selon l'objectif courant.
 *
 * L'énumération est celle de `stableShortcuts` — les montures fertiles repliées
 * par couleur, ascendance et sexe — mais sans le filtre du raccourci : ici on
 * veut aussi les croisements ordinaires, parce que c'est entre eux tous qu'il
 * faut choisir. Un raccourci qui ne mène nulle part ne vaut pas un croisement
 * ordinaire qui avance.
 */
export const availableMoves = (
  stable: Stable,
  objective: ObjectiveId,
  context: MoveContext,
  limit = 15
): Move[] => {
  const groups = [...mateGroups(stable).values()];
  const males = groups.filter((group) => group.sample.sex === 'M');
  const females = groups.filter((group) => group.sample.sex === 'F');

  const best = new Map<string, Move>();

  const generationOf = (mate: Mate) => context.generations.get(mate.colorId) ?? 0;

  for (const male of males) {
    for (const female of females) {
      const outlook = pairOutlook(male.sample, female.sample, context.colors, context.generations);
      if (!outlook) continue;

      const held = Math.max(generationOf(male.sample), generationOf(female.sample));
      const gained = Math.min(outlook.targetGeneration, context.topGeneration) - held;

      // Deux parents consommés, chacun à moitié perdu quand on recycle par
      // clonage, plus deux cycles de fécondité de carburant.
      const parents =
        (Math.max(context.costOf(male.sample.colorId), 0) +
          Math.max(context.costOf(female.sample.colorId), 0)) *
        (context.recycleSteriles ? 0.5 : 1);
      const cost = parents + context.fuelCostPerCycle * 2;

      // Un accouplement occupe deux des dix places d'une fournée : il en porte
      // donc deux dixièmes des heures, la fournée durant le même temps qu'elle
      // soit pleine ou non.
      const enclosHours =
        context.slots > 0 ? (context.batchHours * 2) / context.slots : context.batchHours;

      const partial = {
        ...outlook,
        available: Math.min(male.count, female.count),
        gained,
        cost,
        enclosHours,
        expectedValue: 0,
      };
      partial.expectedValue = expectedBirthValue(outlook, context);

      const move: Move = { ...partial, score: scoreOf(partial, objective) };
      if (move.score === -Infinity) continue;

      const key = [mateSignature(male.sample), mateSignature(female.sample)].sort().join('//');
      const current = best.get(key);
      if (!current) {
        best.set(key, move);
        continue;
      }
      current.available += move.available;
      if (move.score > current.score) best.set(key, { ...move, available: current.available });
    }
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.targetGeneration - a.targetGeneration ||
        b.successRate - a.successRate
    )
    .slice(0, limit);
};
