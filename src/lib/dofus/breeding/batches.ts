import { rankedCouples, type LoadoutContext } from './loadout';
import type { Move } from './next-move';
import type { ObjectiveId } from './objectives';
import {
  copyStable,
  splitBySex,
  tracksIndividually,
  type Couple,
  type Individual,
  type Stable,
} from './stable';

/**
 * Le plan traduit en **montures à charger dans l'enclos, nommément**.
 *
 * `planWaves` répond à « combien d'accouplements, en combien de tours ». C'est
 * ce qu'il faut pour chiffrer un délai, et ce n'est pas ce qu'il faut pour aller
 * jouer : devant l'enclos, la question est « je mets lesquelles ». Entre les
 * deux il y a tout le travail d'appariement — quel mâle avec quelle femelle,
 * lesquels sont encore fertiles, lesquels sont assez montés.
 *
 * Deux fournées et pas une seule, parce que c'est ce qui permet de **relancer
 * sans avoir fait les accouplements**. Un cycle de fécondité dure des heures ;
 * si la liste suivante n'existe qu'une fois les naissances saisies, l'enclos
 * reste vide le temps qu'on revienne. En connaissant la fournée d'après, on
 * recharge dans la foulée.
 *
 * La seconde est **provisoire**, et l'écran doit le dire : elle suppose les
 * naissances de la première, qui n'ont pas encore eu lieu. On la construit sur
 * l'espérance — le taux de réussite pour la couleur, moitié-moitié pour le sexe
 * — ce qui est la seule chose qu'on sache avant le tirage. La saisie des
 * naissances la remplace par la vraie.
 */

export type Batch = {
  /** Rang de la fournée, à partir de 1. */
  index: number;
  couples: Couple[];
  /** Places du parc : dix par enclos. */
  capacity: number;
  /** Places occupées — deux par accouplement. */
  used: number;
  /**
   * `true` dès la deuxième : elle repose sur des naissances qui n'ont pas eu
   * lieu. Dire qu'on suppose vaut mieux que de laisser croire qu'on sait.
   */
  provisional: boolean;
  /**
   * Clonages à faire avant celle-ci, pour réarmer des parents qui manquent.
   * Gratuits, mais sans eux la fournée n'a pas ses montures.
   */
  clonings: { colorId: string; count: number }[];
};

/**
 * Ajoute à l'écurie de travail les bébés **attendus** d'une série
 * d'accouplements.
 *
 * En espérance, et assumé comme tel : `successRate × accouplements` bébés de la
 * couleur visée, moitié mâles moitié femelles. Les ratés ne sont pas comptés —
 * ils naissent bel et bien, mais d'une couleur qui dépend de la généalogie, et
 * en attribuer une au hasard remplirait la fournée suivante de montures qui
 * n'existeront pas.
 */
const addExpectedBirths = (
  stable: Stable,
  colorId: string,
  generation: number,
  crossings: number,
  successRate: number,
  seed: number,
  /**
   * Les deux couleurs parentes, quand on les connaît.
   *
   * Elles ne sont pas décoratives : c'est l'ascendance qui décide de ce que les
   * accouplements de la monture viseront, et le classement la lit. Une naissance
   * projetée sans parents se retrouve rangée en vrac et proposée comme une gen 1
   * quelconque — ce qui rendait la seconde fournée systématiquement fausse.
   */
  parents: [string, string] | null = null,
  parentGenerations: [number, number] | null = null
) => {
  const born = Math.floor(crossings * successRate);
  if (born <= 0) return;

  if (!tracksIndividually(generation, parentGenerations)) {
    const bulk = stable.bulk.get(colorId) ?? { males: 0, females: 0 };
    const { males, females } = splitBySex(born);
    stable.bulk.set(colorId, { males: bulk.males + males, females: bulk.females + females });
    return;
  }

  for (let index = 0; index < born; index += 1) {
    const projected: Individual = {
      // Préfixe explicite : ces montures n'existent pas encore, et rien ne doit
      // pouvoir les enregistrer par mégarde.
      id: `projete-${seed}-${colorId}-${index}`,
      colorId,
      // Une monture qui n'est pas née n'a évidemment pas de nom en jeu. Le
      // laisser vide vaut « Anonyme » à l'affichage, ce qui est exact : c'est
      // bien ce qu'elle portera tant qu'on ne l'aura pas renommée.
      name: null,
      sex: index % 2 === 0 ? 'M' : 'F',
      level: 1,
      fertile: true,
      parents,
    };
    stable.individuals.push(projected);
  }
};

/**
 * Applique `count` clonages sur les stériles d'une couleur.
 *
 * Un clonage n'est **pas une naissance**, et les confondre coûtait cher. L'écran
 * du jeu est explicite : « la monture obtenue sera fertile et conservera la
 * couleur, le genre, le nom et la généalogie de l'original ». Deux montures de
 * même génération entrent, elles sont détruites, l'une des deux ressort — avec
 * tout ce qui la distingue. Seules les jauges repartent à zéro, d'où le niveau 1.
 *
 * Le clone était traité comme un poulain sans ascendance et de sexe tiré à pile
 * ou face. Deux erreurs, et la première est la plus grave depuis #59 : **un
 * clone de porteur de raccourci porte encore le raccourci**. Le jeter revenait à
 * perdre en projection la monture la plus utile de l'écurie.
 *
 * ## Pourquoi on n'appaire que des identiques
 *
 * C'est **l'une des deux au hasard** qui est clonée. Appairer deux montures de
 * même couleur mais d'ascendances différentes rend donc une généalogie tirée à
 * pile ou face, et une projection ne doit pas promettre le bon côté d'une pièce.
 * On n'apparie donc que des stériles de même couleur, **même ascendance et même
 * sexe** : le résultat est alors certain sur les quatre attributs que le jeu
 * conserve. Les stériles qui ne trouvent pas leur pareil attendent.
 *
 * Ce n'est pas une restriction du jeu — il accepte n'importe quelles deux
 * montures de même génération — c'est une restriction de ce qu'on ose annoncer.
 */
const applyClonings = (stable: Stable, colorId: string, count: number): number => {
  if (count <= 0) return 0;

  /** Les stériles de cette couleur, groupés par ce que le clone conserverait. */
  const groups = new Map<string, Individual[]>();
  for (const mount of stable.individuals) {
    if (mount.colorId !== colorId || mount.fertile) continue;
    const key = `${(mount.parents ?? []).join('+')}|${mount.sex}`;
    const group = groups.get(key) ?? [];
    group.push(mount);
    groups.set(key, group);
  }

  let made = 0;
  for (const group of groups.values()) {
    while (made < count && group.length >= 2) {
      // Deux entrent, une ressort. Celle qui ressort reprend sa fécondité et
      // repart les jauges vides ; l'autre a été détruite.
      const survivor = group.shift()!;
      const consumed = group.shift()!;
      survivor.fertile = true;
      survivor.level = 1;
      stable.individuals = stable.individuals.filter((mount) => mount !== consumed);
      made += 1;
    }
  }

  return made;
};

export type BatchOptions = {
  /** Places du parc : dix par enclos. */
  capacity: number;
  /** Combien de fournées projeter. Deux en pratique. */
  count?: number;
  recycleSteriles: boolean;
  /** Génération d'une couleur, pour savoir où ranger les bébés attendus. */
  generationOf: (colorId: string) => number;
  /** L'objectif sur lequel classer, et de quoi chiffrer. Voir `loadout.ts`. */
  objective: ObjectiveId;
  context: LoadoutContext;
};

/**
 * Les prochaines fournées, montures nommées.
 *
 * Le remplissage est celui de la fournée à charger, et c'est **le même appel** :
 * deux panneaux qui rempliraient chacun à sa façon finiraient par conseiller
 * deux choses différentes sur le même écran, ce qui est arrivé.
 */
export const nextBatches = (
  stable: Stable,
  { capacity, count = 2, recycleSteriles, generationOf, objective, context }: BatchOptions
): Batch[] => {
  if (capacity < 2) return [];

  const working = copyStable(stable);
  const batches: Batch[] = [];
  /**
   * Clonages décidés à la fin d'une fournée, à rattacher à la **suivante** :
   * ce sont eux qui la réarment, et c'est avant elle qu'il faut les faire.
   * Local, et pas au niveau du module — un état partagé entre deux appels
   * fuirait d'un plan à l'autre.
   */
  const pendingClonings: { colorId: string; count: number }[] = [];
  /** Stériles en attente d'appairage, par couleur. */
  const sterile = new Map<string, number>();

  for (let index = 0; index < count; index += 1) {
    const { pairings, used } = rankedCouples(working, objective, context, capacity);
    const couples: Couple[] = pairings.map(({ move, male, female }) => ({
      targetColorId: move.targetColors[0]?.colorId ?? male.colorId,
      male,
      female,
    }));

    for (const couple of couples) {
      for (const side of [couple.male, couple.female]) {
        sterile.set(side.colorId, (sterile.get(side.colorId) ?? 0) + 1);
      }
    }

    // Une fournée vide n'est pas une fournée : ou bien le plan est fini, ou bien
    // les parents manquent. Dans les deux cas, mieux vaut une liste courte qu'un
    // programme que rien ne permet de lancer.
    if (couples.length === 0) break;

    batches.push({
      index: index + 1,
      couples,
      capacity,
      used,
      provisional: index > 0,
      // Ceux décidés au tour précédent : ils réarment celle-ci.
      clonings: pendingClonings.splice(0),
    });

    // Préparer la fournée suivante : les bébés attendus rejoignent le vivier, et
    // les stériles s'appairent pour réarmer les parents qui manqueraient.
    const isLast = index === count - 1;
    if (isLast) break;

    /**
     * Les naissances attendues, une entrée par croisement lancé.
     *
     * On projette la couleur cible la plus probable du coup, avec **ses deux
     * parents** : c'est l'ascendance qui décide de ce que la monture visera à son
     * tour, et la fournée suivante se classe dessus.
     */
    const launched = new Map<Move, number>();
    for (const { move } of pairings) launched.set(move, (launched.get(move) ?? 0) + 1);

    for (const [move, crossings] of launched) {
      const target = move.targetColors[0];
      if (!target) continue;
      addExpectedBirths(
        working,
        target.colorId,
        generationOf(target.colorId),
        crossings,
        move.successRate,
        index,
        [move.male.colorId, move.female.colorId],
        [generationOf(move.male.colorId), generationOf(move.female.colorId)]
      );
    }

    // Les clonages se font **entre** deux fournées : ils appartiennent à celle
    // qu'ils réarment, pas à celle qui a produit les stériles. D'où la mise de
    // côté, reprise à la construction de la fournée suivante.
    if (recycleSteriles) {
      for (const [colorId, idle] of sterile) {
        const clones = Math.floor(idle / 2);
        if (clones <= 0) continue;

        // Les stériles suivis individuellement se clonent en gardant tout ce
        // que le jeu conserve — ascendance comprise. Ceux qui n'ont pas trouvé
        // leur pareil, et le vrac qui n'a pas d'individu à ressusciter,
        // retombent sur un simple effectif.
        const revived = applyClonings(working, colorId, clones);
        const remainder = clones - revived;
        if (remainder > 0) {
          addExpectedBirths(working, colorId, generationOf(colorId), remainder, 1, 100 + index);
        }

        sterile.set(colorId, idle - clones * 2);
        pendingClonings.push({ colorId, count: clones });
      }
    }
  }

  return batches;
};
