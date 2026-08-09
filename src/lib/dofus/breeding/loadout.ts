import { BULK_MATE_LEVEL, matingOutcomes, type Mate } from './pairing';
import { carriedGeneration, colorCoder, mountName } from './naming';
import { stableFrontier } from './drift';
import {
  availableBySex,
  consumeCouples,
  copyStable,
  formCouples,
  tracksIndividually,
  type Couple,
  type Sex,
  type Stable,
} from './stable';
import type { BreedingColor, BreedingPlan, BreedingPurchase, BreedingStep } from './costs';

/**
 * La fournée à charger : les **étapes du plan** que l'écurie permet de lancer
 * maintenant.
 *
 * La route ne se devine pas coup par coup, elle se calcule. `breedingPlan`
 * parcourt l'arbre des recettes et rend le chemin le moins cher en régime
 * stationnaire — multiplicités comprises, tentatives par taux de réussite,
 * recyclage par clonage, étapes triées parents avant enfants. C'est exact, c'est
 * sans heuristique, et c'est écrit depuis longtemps.
 *
 * Ce module ne fait donc qu'une chose : **descendre les étapes du plan et
 * former les couples que l'écurie permet**, jusqu'à saturer les places. Ce qui
 * ne peut pas se former se signale au lieu de se contourner.
 *
 * ## Ce qui a été retiré, et pourquoi
 *
 * Ce fichier alimentait un glouton à un coup d'avance (`next-move.ts`) qui
 * classait des appariements libres selon l'objectif courant. Cinq défauts
 * trouvés le 6 août venaient tous de ce classement, aucun d'ailleurs : des
 * croisements qui ne pouvaient jamais atteindre leur cible (#76), un glouton qui
 * ne montait jamais (#78), le blocage du partenaire manquant (#80), une pénalité
 * finie qui asséchait l'écurie (#83), une règle de réserve retirée faute de
 * tenir (#83). Chaque greffe re-dérivait péniblement ce que l'arbre sait déjà :
 * la frontière, le besoin transitif, l'amortissement par profondeur.
 *
 * L'allocation, elle, reste — c'est la seule partie qui valait. Elle est
 * simplement alimentée par les étapes du plan plutôt que par un classement.
 *
 * ## La limite, assumée
 *
 * L'arbre suppose « parent de génération strictement inférieure à l'enfant ». Il
 * ne saura donc jamais exprimer le raccourci de #59, et reste un **majorant**
 * sur les routes qui en profitent. Le raccourci se traite là où il est, en
 * signalement : voir `drift.ts`.
 */

/** Ce que la fournée a besoin de savoir du catalogue et des tarifs. */
export type LoadoutContext = {
  colors: BreedingColor[];
  generations: Map<string, number>;
  /** Ce qu'une couleur coûterait à se procurer, pour chiffrer ce qu'on consomme. */
  costOf: (colorId: string) => number;
  /** Carburant d'un cycle de fécondité, par monture. Un accouplement en consomme deux. */
  fuelCostPerCycle: number;
  /** Heures d'une fournée d'enclos, et places d'un enclos. */
  batchHours: number;
  slots: number;
  /**
   * Le clonage rend la moitié de ce qu'on consomme, donc le coût net d'un parent
   * est divisé par deux. Même règle qu'ailleurs.
   */
  recycleSteriles: boolean;
};

/** Un côté d'une ligne : la couleur à sortir, et les montures suivies s'il y en a. */
export type LoadoutSide = {
  colorId: string;
  /**
   * Les identifiants des montures désignées, dans l'ordre où `formCouples` les
   * prend. Vide du côté du vrac, qui n'a pas d'individu à nommer.
   */
  mountIds: string[];
};

/** Une ligne de la fournée : une étape du plan, son sens, et combien de fois. */
export type LoadoutLine = {
  /** L'étape du plan que cette ligne exécute : la cible, le taux, le niveau des parents. */
  step: BreedingStep;
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
  /**
   * Cycles de fécondité que la fournée n'a pas à payer, parce que les montures
   * concernées sont déjà **fécondes**.
   *
   * Compté en cycles et non en kamas : c'est du carburant, et son prix change
   * avec le cours du jour. L'écran le monétise avec `fuelCostPerCycle`, qui est
   * le même chiffre que celui du reste de la page.
   */
  cyclesSaved: number;
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

/**
 * Les noms possibles pour les poulains d'une étape.
 *
 * Un nom ne dépend que des deux couleurs de la recette et de la génération de ce
 * qui naît, donc il y en a au plus deux par étape : celui de la génération visée
 * et celui des issues plus basses. On les rend avec la probabilité cumulée qui
 * leur correspond, pour que l'écran dise combien en préparer.
 */
const namesFor = (
  step: BreedingStep,
  context: LoadoutContext,
  nameOf: (colorId: string) => string
): LoadoutLine['names'] => {
  const [first, second] = step.recipe;
  const parentGenerations: [number, number] = [
    context.generations.get(first) ?? 1,
    context.generations.get(second) ?? 1,
  ];

  // Deux montures nues, tirées de la recette : le plan raisonne sur des couleurs
  // et non sur des individus, et c'est bien la recette qui décide du nom.
  const male: Mate = {
    id: null,
    colorId: first,
    sex: 'M',
    level: BULK_MATE_LEVEL,
    parents: null,
  };
  const female: Mate = { ...male, colorId: second, sex: 'F' };

  const byName = new Map<string, { name: string; colorId: string; probability: number }>();
  for (const outcome of matingOutcomes(male, female, context.colors, context.generations)) {
    const generation = context.generations.get(outcome.colorId) ?? 1;
    if (!tracksIndividually(generation, parentGenerations)) continue;

    // Le nom porte le sexe depuis qu'il doit désigner **une** monture dans
    // l'écurie du jeu, et le sexe se tire à la naissance : on prépare donc les
    // deux, chacun pour la moitié de la probabilité. C'est une liste de noms à
    // avoir sous la main, pas une prédiction — et il vaut mieux en préparer un
    // de trop que de buter devant l'enclos.
    for (const sex of ['M', 'F'] as const) {
      const name = mountName({
        carriedGeneration: carriedGeneration(generation, parentGenerations),
        colorName: nameOf(outcome.colorId),
        sex,
        parentNames: [nameOf(first), nameOf(second)],
        code: colorCoder(context.colors),
      });
      const current = byName.get(name);
      if (current) current.probability += outcome.probability / 2;
      else
        byName.set(name, { name, colorId: outcome.colorId, probability: outcome.probability / 2 });
    }
  }

  return [...byName.values()].sort((a, b) => b.probability - a.probability);
};

/**
 * Ce qu'un accouplement de cette recette coûte, parents consommés compris.
 *
 * `cyclesAlreadyPaid` retire les cycles de fécondité qu'on n'aura pas à
 * repayer : une monture **féconde** a déjà traversé ses jauges, elle part telle
 * quelle. C'est toute la différence entre les deux états disponibles, et elle
 * vaut un cycle de carburant par monture — sur une écurie qu'on vient de monter,
 * c'est le poste le plus lourd de la fournée.
 *
 * Par défaut zéro : le simulateur ne cycle jamais une monture d'avance, et une
 * monture de vrac n'a pas d'état enregistré. Supposer le cycle à payer est le
 * sens prudent — on surestime la dépense, on ne promet pas une économie qui
 * n'existe pas.
 */
export const crossingCost = (
  [first, second]: readonly [string, string],
  context: LoadoutContext,
  cyclesAlreadyPaid = 0
): number => {
  const parents =
    (Math.max(context.costOf(first), 0) + Math.max(context.costOf(second), 0)) *
    (context.recycleSteriles ? 0.5 : 1);
  return parents + context.fuelCostPerCycle * Math.max(0, 2 - cyclesAlreadyPaid);
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
  context: LoadoutContext,
  capacity: number,
  nameOf: (colorId: string) => string,
  /**
   * Les montures à ne pas charger : celles que `driftSignals` a repérées comme
   * portant plus haut que leur couleur.
   *
   * Sans cette réserve, la fournée les dépense en premier — `formCouples` sert
   * les individus avant le vrac, et les plus bas niveau devant, ce qui désigne
   * exactement une gen 1 née d'un croisement gen 9. L'écran proposait alors la
   * même monture deux fois : « garde-la, elle vise la gen 10 » d'un côté, et
   * « charge-la sur cette gen 2 » de l'autre.
   */
  reserved: Iterable<string> = []
): Loadout => {
  const working = copyStable(stable);
  const held = new Set(reserved);
  if (held.size > 0) {
    working.individuals = working.individuals.filter((mount) => !held.has(mount.id));
  }

  const { couples, blocked, used } = planCouples(plan, working, capacity);

  const stepByColor = new Map(plan.steps.map((step) => [step.colorId, step]));

  /**
   * Les montures dont le cycle de fécondité est déjà payé.
   *
   * Se lit sur l'écurie **réelle** et non sur celle de travail : `copyStable`
   * recopie l'état, mais c'est l'identité qui nous intéresse et elle ne bouge
   * pas. Le vrac n'y figure pas — il n'enregistre aucun état, donc son cycle est
   * réputé à payer.
   */
  const cycled = new Set(
    stable.individuals.filter((mount) => mount.cycled).map((mount) => mount.id)
  );

  /** Combien des deux parents d'un couple n'auront pas à repasser les jauges. */
  const cyclesPaidBy = (couple: Couple): number =>
    [couple.male.mountId, couple.female.mountId].filter((id) => id !== null && cycled.has(id))
      .length;

  let cyclesSaved = 0;

  /**
   * Les couples repliés en lignes. Deux au plus par étape : la recette fixe les
   * deux couleurs, et seul le sens varie.
   */
  const byLine = new Map<string, LoadoutLine>();
  for (const couple of couples) {
    const step = stepByColor.get(couple.targetColorId);
    if (!step) continue;

    const key = `${couple.targetColorId}|${couple.male.colorId}|${couple.female.colorId}`;
    const line =
      byLine.get(key) ??
      ({
        step,
        male: { colorId: couple.male.colorId, mountIds: [] },
        female: { colorId: couple.female.colorId, mountIds: [] },
        count: 0,
        // Cumulé couple par couple, puis ramené à la moyenne après la boucle :
        // deux accouplements d'une même ligne ne coûtent pas pareil selon que
        // leurs parents sont fertiles ou fécondes.
        cost: 0,
        enclosHours: crossingHours(context),
        names: namesFor(step, context, nameOf),
      } satisfies LoadoutLine);

    const paid = cyclesPaidBy(couple);
    cyclesSaved += paid;
    line.cost += crossingCost(
      [couple.male.colorId, couple.female.colorId],
      context,
      paid
    );
    line.count += 1;
    if (couple.male.mountId) line.male.mountIds.push(couple.male.mountId);
    if (couple.female.mountId) line.female.mountIds.push(couple.female.mountId);
    byLine.set(key, line);
  }

  // Le coût d'une ligne redevient un coût **par accouplement**, ce que son nom
  // annonce et ce que `count * cost` suppose. C'est une moyenne dès que la ligne
  // mélange des parents cyclés et d'autres, et c'est exact au total.
  for (const line of byLine.values()) line.cost /= Math.max(1, line.count);

  // Ce qui monte en tête, comme à l'allocation : les accouplements d'une fournée
  // partent ensemble, donc l'ordre n'est pas celui de l'exécution — c'est celui
  // de la lecture, et ce qu'on vient lire est jusqu'où la fournée porte.
  const lines = [...byLine.values()].sort(
    (a, b) => b.step.generation - a.step.generation || b.count - a.count
  );

  /** Ce qu'il faut sortir, agrégé par couleur et par sexe. */
  const pulled = new Map<string, { males: number; females: number }>();
  for (const couple of couples) {
    for (const [side, sex] of [
      [couple.male, 'M'],
      [couple.female, 'F'],
    ] as [Couple['male'], Sex][]) {
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
    cyclesSaved,
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
