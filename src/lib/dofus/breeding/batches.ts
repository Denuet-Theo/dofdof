import type { BreedingPlan } from './costs';
import { planCouples } from './loadout';
import {
  copyStable,
  isSterile,
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
  seed: number
) => {
  const born = Math.floor(crossings * successRate);
  if (born <= 0) return;

  // Sans ascendance à projeter, le seuil retombe sur la seule génération — mais
  // il se lit au même endroit que partout ailleurs.
  if (!tracksIndividually(generation)) {
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
      cycled: false,
      parents: null,
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
    if (mount.colorId !== colorId || !isSterile(mount)) continue;
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
  /**
   * Les montures à ne pas charger, comme pour `buildLoadout` : celles que
   * `driftSignals` a repérées comme portant plus haut que leur couleur.
   *
   * La réserve ne valait que pour la fournée à charger, et l'oubli se voyait à
   * l'écran : le prochain coup gardait la monture, les fournées suivantes la
   * dépensaient. Deux panneaux, deux consignes opposées sur la même gen 1 — et
   * c'est celle des fournées qui gagnait, puisqu'elle nommait la monture.
   *
   * `formCouples` sert les individus avant le vrac et les plus bas niveau
   * devant. Pour une couleur de génération basse, un individu n'existe **que**
   * s'il porte un raccourci — voir `tracksIndividually` — donc cette règle ne
   * s'active exactement que là où elle est fausse : sur huit Doré de vrac et
   * deux Doré nés d'un Ambre gen 9 manqué, ce sont les deux porteurs qui partent
   * les premiers, sur l'étape la plus basse du plan. L'accouplement les rend
   * stériles, et le raccourci n'existe plus.
   */
  reserved?: Iterable<string>;
};

/**
 * Les prochaines fournées, montures nommées.
 *
 * Les étapes du plan arrivent triées parents avant enfants, et cet ordre est
 * aussi celui du temps : on ne peut pas accoupler une génération avant que la
 * précédente soit née. Une fournée se remplit donc en descendant les étapes
 * jusqu'à saturer le parc.
 */
export const nextBatches = (
  plan: BreedingPlan,
  stable: Stable,
  { capacity, count = 2, recycleSteriles, generationOf, reserved = [] }: BatchOptions
): Batch[] => {
  if (capacity < 2) return [];

  const working = copyStable(stable);
  // Retirées de l'écurie de travail plutôt que filtrées à l'appariement : une
  // monture réservée ne doit peser sur aucune des fournées projetées, ni sur les
  // clonages qu'elles décident.
  const held = new Set(reserved);
  if (held.size > 0) {
    working.individuals = working.individuals.filter((mount) => !held.has(mount.id));
  }
  const batches: Batch[] = [];
  /**
   * Clonages décidés à la fin d'une fournée, à rattacher à la **suivante** :
   * ce sont eux qui la réarment, et c'est avant elle qu'il faut les faire.
   * Local, et pas au niveau du module — un état partagé entre deux appels
   * fuirait d'un plan à l'autre.
   */
  const pendingClonings: { colorId: string; count: number }[] = [];
  /** Ce qu'il reste à produire par couleur, décrémenté au fil des fournées. */
  const remaining = new Map(plan.steps.map((step) => [step.colorId, step.attempts]));
  /** Stériles en attente d'appairage, par couleur. */
  const sterile = new Map<string, number>();

  for (let index = 0; index < count; index += 1) {
    // Le remplissage est celui de la fournée à charger, et c'est le même code :
    // deux panneaux qui descendraient les étapes chacun à sa façon finiraient
    // par conseiller deux choses différentes sur le même écran.
    const { couples, used } = planCouples(plan, working, capacity, remaining);

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

    for (const step of plan.steps) {
      const done = step.attempts - (remaining.get(step.colorId) ?? 0);
      addExpectedBirths(
        working,
        step.colorId,
        generationOf(step.colorId),
        done,
        step.successRate,
        index
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
