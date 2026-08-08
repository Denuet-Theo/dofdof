import { matingOutcomes, mateSignature, type Mate } from './pairing';
import { availableMoves, type Move, type MoveContext } from './next-move';
import { carriedGeneration, mountName } from './naming';
import { stableFrontier } from './drift';
import {
  availableBySex,
  consumeCouples,
  copyStable,
  formCouples,
  tracksIndividually,
  type Couple,
  type Pairing,
  type Sex,
  type Stable,
} from './stable';
import type { ObjectiveId } from './objectives';
import type { BreedingPlan, BreedingPurchase, BreedingStep } from './costs';

/**
 * La fournée à charger : les **croisements les mieux classés** que l'écurie
 * permet de lancer maintenant, jusqu'à saturer les places.
 *
 * ## Pourquoi le classement et non les étapes du plan
 *
 * #89 avait remplacé le classement par une descente des étapes de
 * `breedingPlan`, au motif que l'arbre calcule la route au lieu de la deviner.
 * L'argument est juste et le résultat était faux : mesuré sur `main`, aux prix
 * réels, écurie et graines identiques, budget non contraignant.
 *
 * | cible | route par l'arbre | classement | fournées |
 * | --- | --- | --- | --- |
 * | gen 3 `roux` | 0,5 M | 0,8 M | 6 → 3 |
 * | gen 5 `ivoire` | 4,6 M | 5,1 M | 13 → 11 |
 * | gen 7 `prune` | 25,4 M | **13,8 M** | 39 → 21 |
 * | gen 9 `ambre` | 44,7 M | **26,3 M** | 58 → 34 |
 * | gen 10 `ambre_doré` | 77,0 M | **29,2 M** | 89 → 36 |
 *
 * 12 graines × 10 parties, 100 % d'aboutissement partout, 12 graines sur 12 dans
 * le même sens à chaque ligne. Au-dessus de la gen 5, le classement ne gagne pas
 * un arbitrage : il **domine**, moins cher *et* moins de fournées.
 *
 * La cause n'est pas le raccourci de #59 — 23 % des croisements des deux côtés,
 * mesuré. C'est que les multiplicités du plan sont comptées en régime
 * stationnaire : dès qu'une étape haute est bloquée, et elle l'est presque
 * toujours, les étapes basses réclament assez d'accouplements pour manger les
 * cinquante places. La route dépense cinq fois plus de croisements pour arriver
 * au même endroit deux fois plus tard.
 *
 * ## Ce que l'arbre garde
 *
 * Tout le chiffrage, et le **diagnostic** : ce que le plan réclame encore, ce qui
 * lui manque, ce qu'il vaut mieux acheter qu'élever. Ce sont deux questions
 * distinctes — « qu'est-ce que je lance » et « où la route s'arrête » — et
 * l'écran les présente séparément. Seule la première repasse au classement.
 *
 * ## Ce qui reste vrai des reproches de #89
 *
 * Les cinq défauts du 6 août étaient bien dans le classement (#76, #78, #80,
 * #83) et ils y sont corrigés. La leçon n'était pas « le classement est
 * indéfendable » mais « un changement de `scoreOf` n'est jamais local » : ils ont
 * tous été trouvés en simulant. D'où l'interrupteur de politique conservé dans
 * `simulate.ts`, qui permet de rejouer les deux à volonté.
 */

/**
 * Ce que la fournée a besoin de savoir du catalogue et des tarifs.
 *
 * C'est exactement ce que `next-move.ts` demande pour classer : le classement et
 * l'allocation lisent le même contexte, faute de quoi l'écran chiffrerait une
 * chose et le classement en ordonnerait une autre.
 */
export type LoadoutContext = MoveContext;

/** Un côté d'une ligne : la couleur à sortir, et les montures suivies s'il y en a. */
export type LoadoutSide = {
  colorId: string;
  /**
   * Les identifiants des montures désignées, dans l'ordre où `formCouples` les
   * prend. Vide du côté du vrac, qui n'a pas d'individu à nommer.
   */
  mountIds: string[];
};

/** Une ligne de la fournée : un croisement classé, son sens, et combien de fois. */
export type LoadoutLine = {
  /** Le croisement que cette ligne exécute : ce qu'il vise, son taux, son score. */
  move: Move;
  male: LoadoutSide;
  female: LoadoutSide;
  count: number;
  /** Kamas à sortir pour **un** accouplement de cette ligne, parents compris. */
  cost: number;
  /** Heures d'enclos qu'un accouplement mobilise. */
  enclosHours: number;
  /**
   * Les noms à inscrire en jeu sur les poulains de cette ligne, selon ce qui
   * naît. Vide quand rien n'est à nommer — le cas le plus fréquent, et c'est
   * une bonne nouvelle : seules les montures d'ascendance haute en demandent un.
   */
  names: { name: string; colorId: string; probability: number }[];
};

/** Une étape que le plan réclame et qu'aucune monture ne permet de lancer. */
export type BlockedStep = {
  step: BreedingStep;
  /**
   * Les couleurs de la recette qui manquent. Les deux quand elles sont là toutes
   * les deux mais du même sexe : c'est alors le sexe qui bloque, et ne nommer
   * qu'une couleur ferait chercher au mauvais endroit.
   */
  missing: string[];
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
  /** La couleur que le plan vise. */
  targetColorId: string;
  lines: LoadoutLine[];
  crossings: number;
  /** Places du parc, et places réellement occupées : deux par croisement. */
  slots: number;
  used: number;
  /** Ce que la fournée coûte, et le temps d'enclos qu'elle mobilise. */
  cost: number;
  enclosHours: number;
  /** La plus haute génération que l'écurie porte, ascendance comprise. */
  frontier: number;
  /** Les étapes que le plan réclame et que l'écurie ne permet pas encore. */
  blocked: BlockedStep[];
  /** Ce que le plan demande de se procurer plutôt que d'élever. */
  purchases: BreedingPurchase[];
  pull: LoadoutPull[];
  /** Les noms à préparer, regroupés — une ligne par nom et non par monture. */
  names: { name: string; count: number }[];
};

/**
 * Ce qui manque pour former un couple de cette recette.
 *
 * Trois blocages différents et une seule question à l'écran : « il manque
 * quoi ». Une couleur absente se nomme ; deux couleurs présentes mais du même
 * sexe se nomment toutes les deux, parce que la monture à trouver peut venir de
 * l'un ou l'autre côté.
 */
const missingFor = (stable: Stable, [first, second]: readonly [string, string]): string[] => {
  const left = availableBySex(stable, first);
  if (first === second) {
    return left.males === 0 || left.females === 0 ? [first] : [];
  }

  const right = availableBySex(stable, second);
  const absent: string[] = [];
  if (left.males + left.females === 0) absent.push(first);
  if (right.males + right.females === 0) absent.push(second);

  return absent.length > 0 ? absent : [first, second];
};

/**
 * Les couples que l'écurie permet de former pour ce plan, à concurrence des
 * places.
 *
 * ## L'ordre de remplissage : ce qui monte d'abord
 *
 * Les étapes arrivent triées parents avant enfants, qui est l'ordre du **temps**
 * — on ne peut pas accoupler une génération avant que la précédente soit née.
 * Ce n'est pas l'ordre du **remplissage** : une fournée les prend toutes
 * ensemble, et les places sont comptées.
 *
 * On remplit donc par génération décroissante. Une étape haute dont les parents
 * sont en main se fait maintenant ; ce qui reste de places prépare l'étage du
 * dessous, qui sera refait de toute façon à la fournée suivante. L'inverse
 * asphyxie la montée : les étapes basses réclament des dizaines d'accouplements,
 * elles mangeaient les cinquante places à chaque tour, et la génération 9 en
 * main attendait son tour indéfiniment. Mesuré — c'est 50 % des parties qui
 * atteignaient la génération 10 en remplissant par le bas, 100 % par le haut.
 *
 * Prendre par le haut ne coûte rien quand rien n'est prêt : `formCouples` rend
 * une liste vide et l'étape suivante prend la place.
 *
 * L'écurie passée en argument est **consommée** : c'est ce qui permet
 * d'enchaîner plusieurs fournées sur la même, chacune partant de ce que la
 * précédente a laissé.
 */
export const planCouples = (
  plan: BreedingPlan,
  stable: Stable,
  capacity: number,
  /** Ce qu'il reste à tenter par couleur. Par défaut, tout ce que le plan demande. */
  remaining: Map<string, number> = new Map(
    plan.steps.map((step) => [step.colorId, step.attempts])
  )
): { couples: Couple[]; blocked: BlockedStep[]; used: number } => {
  const couples: Couple[] = [];
  const blocked: BlockedStep[] = [];
  let used = 0;

  const byHeight = [...plan.steps].sort((a, b) => b.generation - a.generation);

  for (const step of byHeight) {
    const todo = remaining.get(step.colorId) ?? 0;
    if (todo <= 0) continue;

    // Plus de place : les étapes suivantes ne sont pas bloquées, elles
    // attendent leur tour. Les confondre ferait signaler un manque là où il n'y
    // a qu'une fournée pleine.
    const room = Math.floor((capacity - used) / 2);
    if (room <= 0) break;

    const formed = formCouples(stable, step.colorId, step.recipe, Math.min(todo, room));
    if (formed.length === 0) {
      blocked.push({ step, missing: missingFor(stable, step.recipe) });
      continue;
    }

    consumeCouples(stable, formed);
    couples.push(...formed);
    used += formed.length * 2;
    remaining.set(step.colorId, todo - formed.length);
  }

  // ## Les places qui restent, et pourquoi on les laisse
  //
  // Une place vide coûte : la fournée dure le même temps qu'elle soit pleine ou
  // non. Deux façons de la combler ont été essayées et mesurées, aucune ne tient.
  //
  // Remplir avec **la couleur dont l'arbre a le plus besoin** est la bonne règle,
  // et c'est justement pourquoi elle ne s'applique pas : après le passage
  // ci-dessus, **toute étape encore réclamée est bloquée** — c'est la définition
  // du goulot. Restreint à ce que le plan demande encore, le remplissage ne se
  // déclenche pas une seule fois de toute une route.
  //
  // Remplir avec ce qui **peut** se former revient à produire ce dont le plan n'a
  // plus besoin. Et un croisement n'est jamais gratuit, même sur une place
  // inoccupée : il rend ses deux parents **stériles définitivement**. On échange
  // donc une place libre contre deux montures que la fournée suivante attendait.
  // Mesuré : deux points d'occupation gagnés, quatre fournées et 3,5 % de kamas
  // perdus — le remplissage retarde la route au lieu de l'avancer.
  //
  // Ce qui se comble utilement, ce sont les **feuilles** — les gen 1 épuisées, qui
  // se capturent — et cela se fait en amont, avant d'appeler cette fonction.
  return { couples, blocked, used };
};

/** Un croisement alloué : le coup classé, et les deux montures qui l'exécutent. */
export type RankedPairing = { move: Move; male: Pairing; female: Pairing };

/**
 * Les croisements les mieux classés que l'écurie permet, à concurrence des
 * places.
 *
 * L'allocation est celle qui a toujours valu — descendre les coups classés, les
 * deux sens comptés, jusqu'à saturer le parc. Ce qui change par rapport à #89
 * est seulement ce qui l'alimente : un classement d'appariements réels plutôt
 * que les étapes d'un arbre.
 *
 * Elle vit ici et non dans `next-move.ts` parce que **la simulation et l'écran
 * doivent en partager une seule copie** : deux allocations divergentes
 * mesureraient autre chose que ce qu'on conseille, et c'est précisément le
 * défaut qui a rendu les chiffres de #88 ininterprétables.
 *
 * L'écurie passée en argument est **consommée**, comme pour `planCouples`.
 */
export const rankedCouples = (
  stable: Stable,
  objective: ObjectiveId,
  context: LoadoutContext,
  capacity: number
): { pairings: RankedPairing[]; used: number } => {
  if (capacity < 2) return { pairings: [], used: 0 };

  /**
   * Les montures libres, par ascendance et par sexe, chacune nommée.
   *
   * Le vrac n'a pas d'individu à désigner : il entre comme des jetons sans
   * identifiant, que `consumeCouples` décomptera du compteur de couleur.
   */
  const pool = new Map<string, (string | null)[]>();
  const push = (mate: Mate, id: string | null) => {
    const key = `${mateSignature(mate)}|${mate.sex}`;
    const slot = pool.get(key) ?? [];
    slot.push(id);
    pool.set(key, slot);
  };

  for (const mount of stable.individuals) {
    if (!mount.fertile) continue;
    push(
      {
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        level: mount.level,
        parents: mount.parents,
      },
      mount.id
    );
  }
  for (const [colorId, counts] of stable.bulk) {
    for (const [sex, howMany] of [
      ['M', counts.males],
      ['F', counts.females],
    ] as [Sex, number][]) {
      for (let index = 0; index < howMany; index += 1) {
        push({ id: null, colorId, sex, level: 1, parents: null }, null);
      }
    }
  }

  /**
   * Assez de coups pour remplir n'importe quel parc.
   *
   * Le plafond n'est pas cosmétique, il **est** la politique : à 5 coups la
   * montée vers la gen 10 revient à 15,5 M en 235 fournées, à 40 coups 18,3 M en
   * 101 fournées, à 400 coups 29,2 M en 36 fournées. Écrémer est moins cher en
   * kamas et six fois plus long en calendrier. On remplit l'enclos — une fournée
   * dure le même temps qu'elle soit pleine ou non, et c'est la règle de la
   * maison.
   */
  const ranked = availableMoves(stable, objective, context, 400);

  const take = (mate: Mate, sex: Sex) => pool.get(`${mateSignature(mate)}|${sex}`)?.pop();
  const give = (mate: Mate, sex: Sex, id: string | null) => {
    pool.get(`${mateSignature(mate)}|${sex}`)?.push(id);
  };

  const pairings: RankedPairing[] = [];
  let used = 0;

  for (const move of ranked) {
    // Les deux sens du même croisement sont deux couples distincts : ce sont des
    // montures différentes à sortir, même si le résultat est identique.
    const orientations: [Mate, Mate][] = [
      [move.male, move.female],
      [move.female, move.male],
    ];

    for (const [first, second] of orientations) {
      while (used + 2 <= capacity) {
        const maleId = take(first, 'M');
        if (maleId === undefined) break;
        const femaleId = take(second, 'F');
        if (femaleId === undefined) {
          // Sans partenaire, la première reste disponible pour l'autre sens.
          give(first, 'M', maleId);
          break;
        }

        pairings.push({
          move,
          male: { colorId: first.colorId, sex: 'M', mountId: maleId },
          female: { colorId: second.colorId, sex: 'F', mountId: femaleId },
        });
        used += 2;
      }
    }

    if (used + 2 > capacity) break;
  }

  consumeCouples(
    stable,
    pairings.map(({ male, female }) => ({ targetColorId: male.colorId, male, female }))
  );

  return { pairings, used };
};

/**
 * Les noms possibles pour les poulains d'une étape.
 *
 * Un nom ne dépend que des deux couleurs de la recette et de la génération de ce
 * qui naît, donc il y en a au plus deux par étape : celui de la génération visée
 * et celui des issues plus basses. On les rend avec la probabilité cumulée qui
 * leur correspond, pour que l'écran dise combien en préparer.
 */
const namesFor = (
  move: Move,
  context: LoadoutContext,
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

/** Ce qu'un accouplement de cette recette coûte, parents consommés compris. */
export const crossingCost = (
  [first, second]: readonly [string, string],
  context: LoadoutContext
): number => {
  const parents =
    (Math.max(context.costOf(first), 0) + Math.max(context.costOf(second), 0)) *
    (context.recycleSteriles ? 0.5 : 1);
  return parents + context.fuelCostPerCycle * 2;
};

/**
 * Un accouplement occupe deux des dix places d'une fournée : il en porte donc
 * deux dixièmes des heures, la fournée durant le même temps qu'elle soit pleine
 * ou non.
 */
export const crossingHours = (context: LoadoutContext): number =>
  context.slots > 0 ? (context.batchHours * 2) / context.slots : context.batchHours;

/**
 * La fournée complète, à partir du plan, de l'écurie et des places disponibles.
 *
 * `nameOf` est injecté plutôt que déduit du catalogue : les noms affichés vivent
 * dans les lignes de l'écran, et les recopier ici ferait diverger les deux.
 */
export const buildLoadout = (
  plan: BreedingPlan,
  targetColorId: string,
  stable: Stable,
  objective: ObjectiveId,
  context: LoadoutContext,
  capacity: number,
  nameOf: (colorId: string) => string
): Loadout => {
  const working = copyStable(stable);
  const { pairings, used } = rankedCouples(working, objective, context, capacity);

  /**
   * Où la route s'arrête, lu sur l'arbre — et sur une écurie **intacte**.
   *
   * C'est une question différente de « qu'est-ce que je lance » : elle demande
   * ce que le plan réclame encore et ce qui lui manque pour l'obtenir. La poser
   * sur l'écurie déjà vidée par la fournée ferait passer pour un manque ce qui
   * n'est qu'une place prise.
   */
  const { blocked } = planCouples(plan, copyStable(stable), capacity);

  /**
   * Les couples repliés en lignes. Deux au plus par coup classé : les deux
   * ascendances sont fixées, et seul le sens varie.
   */
  const byLine = new Map<string, LoadoutLine>();
  for (const { move, male, female } of pairings) {
    const key = `${mateSignature(move.male)}|${mateSignature(move.female)}|${male.colorId}`;
    const line =
      byLine.get(key) ??
      ({
        move,
        male: { colorId: male.colorId, mountIds: [] },
        female: { colorId: female.colorId, mountIds: [] },
        count: 0,
        cost: crossingCost([male.colorId, female.colorId], context),
        enclosHours: crossingHours(context),
        names: namesFor(move, context, nameOf),
      } satisfies LoadoutLine);

    line.count += 1;
    if (male.mountId) line.male.mountIds.push(male.mountId);
    if (female.mountId) line.female.mountIds.push(female.mountId);
    byLine.set(key, line);
  }

  // Ce qui monte en tête, comme à l'allocation : les accouplements d'une fournée
  // partent ensemble, donc l'ordre n'est pas celui de l'exécution — c'est celui
  // de la lecture, et ce qu'on vient lire est jusqu'où la fournée porte.
  const lines = [...byLine.values()].sort(
    (a, b) => b.move.targetGeneration - a.move.targetGeneration || b.count - a.count
  );

  /** Ce qu'il faut sortir, agrégé par couleur et par sexe. */
  const pulled = new Map<string, { males: number; females: number }>();
  for (const { male, female } of pairings) {
    for (const [side, sex] of [
      [male, 'M'],
      [female, 'F'],
    ] as [Pairing, Sex][]) {
      const current = pulled.get(side.colorId) ?? { males: 0, females: 0 };
      if (sex === 'M') current.males += 1;
      else current.females += 1;
      pulled.set(side.colorId, current);
    }
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

  const crossings = lines.reduce((total, line) => total + line.count, 0);

  return {
    targetColorId,
    lines,
    crossings,
    slots: capacity,
    used,
    cost: lines.reduce((total, line) => total + line.count * line.cost, 0),
    enclosHours: lines.reduce((total, line) => total + line.count * line.enclosHours, 0),
    frontier: stableFrontier(stable, context.generations),
    blocked,
    purchases: plan.purchases.filter((purchase) => purchase.count > 0),
    pull: [...pulled]
      .map(([colorId, counts]) => ({
        colorId,
        ...counts,
        // Ce qui reste **après** la fournée : l'écurie de travail a déjà été
        // consommée, il suffit donc de la relire.
        exhausts: (() => {
          const left = availableBySex(working, colorId);
          return left.males + left.females === 0;
        })(),
      }))
      .sort((a, b) => b.males + b.females - (a.males + a.females)),
    names: [...names]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
};
