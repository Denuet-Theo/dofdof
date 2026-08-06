import type { BreedingPlan } from './costs';
import {
  formCouples,
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

/** Une écurie de travail, qu'on peut consommer sans toucher à la vraie. */
const cloneStable = (stable: Stable): Stable => ({
  bulk: new Map([...stable.bulk].map(([id, counts]) => [id, { ...counts }])),
  individuals: stable.individuals.map((mount) => ({ ...mount })),
});

/** Retire de l'écurie de travail les montures que ces couples mobilisent. */
const consume = (stable: Stable, couples: Couple[]) => {
  for (const couple of couples) {
    for (const side of [couple.male, couple.female]) {
      if (side.mountId) {
        const mount = stable.individuals.find((candidate) => candidate.id === side.mountId);
        // Un accouplement rend ses deux parents stériles, définitivement.
        if (mount) mount.fertile = false;
        continue;
      }
      const bulk = stable.bulk.get(side.colorId);
      if (!bulk) continue;
      if (side.sex === 'M') bulk.males = Math.max(0, bulk.males - 1);
      else bulk.females = Math.max(0, bulk.females - 1);
    }
  }
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
      sex: index % 2 === 0 ? 'M' : 'F',
      level: 1,
      fertile: true,
      parents: null,
    };
    stable.individuals.push(projected);
  }
};

export type BatchOptions = {
  /** Places du parc : dix par enclos. */
  capacity: number;
  /** Combien de fournées projeter. Deux en pratique. */
  count?: number;
  recycleSteriles: boolean;
  /** Génération d'une couleur, pour savoir où ranger les bébés attendus. */
  generationOf: (colorId: string) => number;
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
  { capacity, count = 2, recycleSteriles, generationOf }: BatchOptions
): Batch[] => {
  if (capacity < 2) return [];

  const working = cloneStable(stable);
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
    const couples: Couple[] = [];
    let used = 0;

    for (const step of plan.steps) {
      if (used + 2 > capacity) break;
      const left = remaining.get(step.colorId) ?? 0;
      if (left <= 0) continue;

      const room = Math.floor((capacity - used) / 2);
      const formed = formCouples(working, step.colorId, step.recipe, Math.min(left, room));
      if (formed.length === 0) continue;

      consume(working, formed);
      couples.push(...formed);
      used += formed.length * 2;
      remaining.set(step.colorId, left - formed.length);

      for (const parent of step.recipe) {
        sterile.set(parent, (sterile.get(parent) ?? 0) + formed.length);
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
        sterile.set(colorId, idle - clones * 2);
        addExpectedBirths(working, colorId, generationOf(colorId), clones, 1, 100 + index);
        pendingClonings.push({ colorId, count: clones });
      }
    }
  }

  return batches;
};
