/**
 * Arbitrage « acheter ou élever » sur les arbres de croisement d'élevage.
 *
 * Même forme que `computeCraftCost` pour les recettes d'items, à deux
 * différences près qui changent le calcul :
 *
 * 1. **Un croisement consomme ses deux parents.** Ils deviennent stériles
 *    définitivement, donc leur prix est un coût, pas une immobilisation. Deux
 *    montures en produisent une : l'élevage n'est pas une machine à multiplier
 *    des montures, c'est une machine à transformer deux montures bon marché en
 *    une monture chère. Toute la rentabilité tient dans cet écart.
 *
 * 2. **Une recette peut échouer.** Le taux de réussite dépend du niveau des
 *    **montures accouplées** — pas de celui de l'Éleveur, qui ne sert qu'à
 *    débloquer les enclos — et un échec consomme quand même ses deux parents,
 *    d'où une division par la probabilité plutôt qu'une simple majoration.
 *
 * De là vient le vrai arbitrage de l'élevage : monter ses parents coûte de la
 * Mangeoire mais réduit le nombre de tentatives. Voir `optimalParentLevel`.
 *
 * La récursion est sûre parce que `scripts/extract-breeding-trees.mjs` vérifie
 * que tout parent est d'une génération strictement inférieure à son enfant. Le
 * graphe est donc acyclique et un simple parcours par génération croissante
 * suffit : quand on traite une couleur, ses parents ont déjà leur coût.
 */

import { lineageValue } from './lineage';

export type BreedingRecipe = [string, string];

/** Un filet de capture, et combien de montures il rend. */
export type CaptureNet = {
  id: number;
  name: string;
  level: number;
  captures: number;
};

export type CaptureOptions = {
  /** Coût de craft de chaque filet, indexé par identifiant d'item. */
  netCosts: Map<number, number>;
  /**
   * Part des matériaux récupérée au recraft, dans [0,1[. Environ 0,8 en jeu :
   * un filet ne se consomme donc qu'au cinquième de son coût de craft.
   */
  recoveryRate: number;
  /**
   * Minutes pour un combat de capture : trouver un groupe, le battre, revenir.
   *
   * **Un filet vaut un combat**, quel que soit son palier — un filet à 8
   * captures rend 8 montures d'un seul combat. Ce temps se divise donc par le
   * nombre de captures, et c'est ce qui fait basculer le choix vers les gros
   * filets dès qu'on valorise son temps.
   */
  minutesPerFight: number;
  /**
   * Ce que vaut une heure de jeu, en kamas. Propre à chaque joueur — c'est ce
   * qu'il gagnerait à faire autre chose — donc jamais deviné ici.
   */
  kamasPerHour: number;
  /**
   * Compter le prix des filets dans le coût d'une capture.
   *
   * À `false`, un filet est réputé gratuit et il ne reste que le temps de
   * combat. C'est le régime de qui récolte ses propres matériaux : le craft ne
   * sort alors aucun kama de la poche, et lui imputer un prix d'hôtel de vente
   * revient à facturer un coût qu'on n'a pas payé.
   *
   * Deux conséquences, et la seconde importe autant que la première :
   *
   * 1. les filets **sans prix connu** redeviennent éligibles — leur prix ne
   *    décide plus de rien, donc l'ignorer n'est plus une approximation ;
   * 2. le choix du filet bascule entièrement sur le temps, donc sur le **plus
   *    gros** disponible, puisqu'un filet vaut un combat quel que soit son
   *    palier.
   */
  countNetCost?: boolean;
};

export type CaptureChoice = {
  net: CaptureNet;
  /** Coût complet d'une monture capturée, filet consommé et temps compris. */
  costPerMount: number;
  netCostPerMount: number;
  timeCostPerMount: number;
};

/**
 * Le filet au meilleur rapport, temps de capture inclus.
 *
 * Le plus gros filet n'est pas gagnant d'office : les captures doublent à chaque
 * palier mais le coût de craft monte plus vite, si bien qu'à temps négligé le
 * filet de niveau 1 peut l'emporter. Valoriser le temps rétablit les gros
 * filets — d'autant plus fort qu'une session rend plusieurs montures.
 */
export const bestCaptureNet = (
  nets: CaptureNet[],
  { netCosts, recoveryRate, minutesPerFight, kamasPerHour, countNetCost = true }: CaptureOptions
): CaptureChoice | null => {
  let best: CaptureChoice | null = null;

  for (const net of nets) {
    const craftCost = netCosts.get(net.id);
    // Un filet sans prix n'est écarté que si son prix compte : sinon il est
    // aussi utilisable que les autres, et l'exclure priverait du plus gros.
    if (countNetCost && (craftCost === undefined || craftCost < 0)) continue;

    // Le filet et le combat se répartissent tous deux sur les `captures`
    // montures ramenées — un seul combat, quel que soit le palier.
    const netCostPerMount = countNetCost ? ((craftCost ?? 0) * (1 - recoveryRate)) / net.captures : 0;
    const timeCostPerMount = (minutesPerFight / 60) * (kamasPerHour / net.captures);
    const costPerMount = netCostPerMount + timeCostPerMount;

    // À coût égal, le plus gros filet gagne. Le cas se présente vraiment : sans
    // prix de filet **et** sans heure valorisée, toutes les captures reviennent
    // à zéro, et sans départage c'est le premier parcouru — donc le plus petit —
    // qui l'emporterait, pour autant de combats en plus.
    if (
      !best ||
      costPerMount < best.costPerMount ||
      (costPerMount === best.costPerMount && net.captures > best.net.captures)
    ) {
      best = { net, costPerMount, netCostPerMount, timeCostPerMount };
    }
  }

  return best;
};

export type BreedingColor = {
  id: string;
  name: string;
  generation: number;
  /**
   * Provenance des recettes. `game` = relue en jeu, `site` = extraite sans
   * recoupement, `null` = couleur sauvage, qui n'a pas de recette.
   */
  source: 'game' | 'site' | null;
  /**
   * L'item du certificat de monture, qui porte l'icône et se joint à
   * `item_prices`. `null` si DofusDB ne le connaît pas — la couleur reste alors
   * utilisable avec un prix saisi à la main.
   */
  itemId: number | null;
  itemName: string | null;
  recipes: BreedingRecipe[];
};

/** Un item du catalogue, réduit à ce qu'on en affiche. */
export type BreedingItem = {
  id: number;
  name: string;
};

export type BreedingFamily = {
  id: string;
  familyId: number;
  /** Type d'item des certificats : 97 dragodinde, 207 volkorne, 332 muldo. */
  certificateTypeId: number;
  /**
   * La ressource rendue en sacrifiant une monture de cette famille, à raison
   * d'une unité par génération. Propre à la famille : ambre pour le muldo,
   * neurone pour la dragodinde, corne pour le volkorne.
   */
  sacrificeItem: BreedingItem;
  /** Les filets de capture utilisables sur cette famille, du plus petit au plus gros. */
  nets: CaptureNet[];
  /**
   * Les Optimakina, indexées par **génération visée** (2 à 10). Aucune en
   * génération 1 : elle ne se croise pas, elle se capture.
   */
  optimakinaByGeneration: Record<string, BreedingItem>;
  sourceUrl: string;
  colors: BreedingColor[];
};

/**
 * Génétons produits à la naissance, selon la génération de **chaque parent**.
 * Les deux apports s'additionnent : gen 8 × gen 4 → 120 + 8 = 128.
 *
 * La table s'arrête à la génération 9 et c'est suffisant : un parent doit être
 * d'une génération strictement inférieure à son enfant, et les arbres plafonnent
 * à 10. Vérifié sur les 382 croisements des trois familles — la génération de
 * parent la plus haute rencontrée est 9.
 */
const GENETONS_BY_GENERATION: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 15,
  6: 30,
  7: 60,
  8: 120,
  9: 250,
};

/**
 * Génétons rendus par un croisement, co-produit revendable de l'élevage.
 *
 * La règle du jeu est plus stricte que « l'enfant dépasse ses deux parents » :
 * il doit dépasser **toute la généalogie** des deux parents. Le contrôle ci-
 * dessous ne compare qu'aux parents directs, et c'est suffisant *pour les
 * recettes des arbres* : la génération y croît à chaque croisement, donc le
 * maximum d'une ascendance est toujours celui du parent lui-même. Vérifié sur
 * les 382 croisements des trois familles.
 *
 * L'équivalence tomberait pour un croisement libre, hors recette, entre deux
 * montures dont l'ascendance porte une génération plus haute qu'elles.
 */
export const genetonsForCrossing = (
  childGeneration: number,
  parentGenerations: [number, number]
): number => {
  if (parentGenerations.some((generation) => generation >= childGeneration)) return 0;
  return parentGenerations.reduce(
    (total, generation) => total + (GENETONS_BY_GENERATION[generation] ?? 0),
    0
  );
};

/**
 * Points de Mangeoire à dépenser pour amener une monture au niveau `level`.
 *
 * Loi de puissance ajustée sur cinq relevés en jeu (niveaux 50, 67, 100, 150 et
 * 200) : l'écart maximal est de 0,0008 %, ce qui à cinq points pour deux
 * paramètres ne laisse guère de doute sur la forme. L'exposant n'est pas 7/3,
 * qui donnerait 0,6 % d'écart — soit mille fois pire.
 *
 * Le coût est cumulatif, pas incrémental : `mountXpForLevel(200)` est le total
 * à dépenser depuis le niveau 1, pas le prix du dernier niveau.
 */
const MOUNT_XP_COEFFICIENT = 3.795;
const MOUNT_XP_EXPONENT = 2.329;

export const mountXpForLevel = (level: number) =>
  MOUNT_XP_COEFFICIENT * Math.pow(level, MOUNT_XP_EXPONENT);

/** Le niveau auquel se cote une monture montée, et donc celui qu'on chiffre. */
export const MAX_MOUNT_LEVEL = 200;

/**
 * Le niveau qu'on atteint avec `points` de Mangeoire — l'inverse de
 * `mountXpForLevel`, arrondi vers le bas.
 */
export const levelForMountXp = (points: number) => {
  if (points <= 0) return 1;
  const level = Math.pow(points / MOUNT_XP_COEFFICIENT, 1 / MOUNT_XP_EXPONENT);
  return Math.min(MAX_MOUNT_LEVEL, Math.max(1, Math.floor(level)));
};

/**
 * Probabilité d'obtenir la **génération** cible : 30 % de base, plus 0,15 % par
 * niveau, les niveaux des deux parents s'additionnant.
 *
 * Vérifié au point près en jeu. Deux parents niveau 69 donnent 50,70 %, et le
 * jeu affiche bien 40,02 % + 5,34 % + 5,34 % pour les trois couleurs de la
 * génération visée, soit 50,70 %. Le complément, 27,55 % + 21,75 % = 49,30 %,
 * couvre les deux couleurs de génération inférieure.
 *
 * La génération, donc, et **pas la couleur** : c'est le piège de cette formule.
 * Voir `lineageValue` pour ce que ça implique.
 *
 * Deux parents niveau 200 plafonnent à 90 % — la certitude n'est pas atteignable
 * par le niveau seul (il y faudrait 233 niveaux par parent). Les Optimakina
 * poussent au-delà mais ne sont pas modélisées ici.
 */
const TARGET_GENERATION_BASE_RATE = 0.3;
const RATE_PER_PARENT_LEVEL = 0.0015;

export const targetGenerationRate = (levelA: number, levelB: number) =>
  Math.min(1, TARGET_GENERATION_BASE_RATE + RATE_PER_PARENT_LEVEL * (levelA + levelB));

/** Ce qu'une Optimakina ajoute à la probabilité d'obtenir la génération cible. */
const OPTIMAKINA_BONUS = 0.1;

export type ParentLevelChoice = {
  level: number;
  useOptimakina: boolean;
  successRate: number;
  /** Coût attendu d'un bébé de la génération cible, tentatives ratées comprises. */
  expectedCost: number;
  /**
   * La part de `expectedCost` qui ne vient pas des parents : montée en niveau,
   * carburant, Optimakina. Isolée parce qu'elle se multiplie par le nombre de
   * croisements, là où le coût des parents se compte, lui, par exemplaire
   * réellement produit — et le clonage creuse l'écart entre les deux.
   */
  overheadCost: number;
};

/**
 * Le niveau auquel monter les deux parents pour minimiser le coût d'un bébé.
 *
 * L'arbitrage est celui que pose le guide : monter les parents coûte de la
 * Mangeoire mais réduit le nombre de tentatives, et chaque tentative consomme
 * définitivement ses deux parents. Il est réel — l'optimum est le plus souvent
 * **intérieur**, ni 1 ni 200 : à parents bon marché, monter jusqu'à 200 coûte
 * jusqu'à trois fois l'optimum.
 *
 * Les deux parents reçoivent le même niveau, et ce n'est pas une approximation :
 * la probabilité ne dépend que de la **somme** des niveaux alors que le coût
 * suit une courbe convexe, donc à somme fixée le partage égal est le moins cher.
 *
 * Recherche exhaustive sur 200 entiers — le coût est négligeable, et ça évite
 * une résolution analytique qu'un changement d'exposant invaliderait en silence.
 */
export const optimalParentLevel = (
  parentsCost: number,
  fuelCost: number,
  mangeoireCostPerMountPoint: number,
  /** Prix d'une Optimakina de la génération visée, ou `null` si on s'en passe. */
  optimakinaPrice: number | null = null,
  /**
   * Ce que vaut le bébé d'une tentative qui n'a pas donné la génération cible.
   *
   * Un accouplement **produit toujours un bébé** — les 30 % de base portent sur
   * sa couleur, pas sur son existence. Une tentative « ratée » rend donc une
   * monture d'une autre couleur, qui vaut ce qu'on aurait payé pour l'obtenir.
   * L'ignorer surfacturait chaque croisement de `(1/taux − 1)` montures.
   */
  failureValue = 0,
  /**
   * Niveau en dessous duquel il ne sert à rien de descendre.
   *
   * Voir `freeXpPoints` : sous ce niveau, monter les parents **ne coûte aucune
   * heure d'enclos** et augmente le taux de réussite, donc réduit le nombre de
   * fournées. Ce calcul-ci ne compte que des kamas et ne peut pas le voir : il
   * choisirait le niveau 1, en payant 38 % de temps d'enclos en trop pour
   * économiser un peu de carburant.
   */
  minLevel = 1
): ParentLevelChoice => {
  let best: ParentLevelChoice | null = null;

  // Deux décisions couplées : monter les parents et poser une Optimakina jouent
  // toutes deux sur la même probabilité, donc le prix de l'une déplace l'intérêt
  // de l'autre. Les choisir séparément passerait à côté de l'optimum.
  const optimakinaChoices =
    optimakinaPrice !== null && optimakinaPrice > 0 ? [false, true] : [false];

  const floor = Math.min(Math.max(minLevel, 1), MAX_MOUNT_LEVEL);

  for (let level = floor; level <= MAX_MOUNT_LEVEL; level++) {
    for (const useOptimakina of optimakinaChoices) {
      const successRate = Math.min(
        1,
        targetGenerationRate(level, level) + (useOptimakina ? OPTIMAKINA_BONUS : 0)
      );
      const overhead =
        2 * mangeoireCostPerMountPoint * mountXpForLevel(level) +
        fuelCost +
        (useOptimakina ? optimakinaPrice! : 0);

      // `n` tentatives coûtent `n × C` et rendent `n − 1` bébés hors cible, d'où
      // `n·C − (n−1)·V`, qui se réécrit `(C − V)/taux + V`. Le crédit rend donc
      // les tentatives ratées moins chères, ce qui réduit mécaniquement
      // l'intérêt de monter les parents — un effet réel, pas un ajustement.
      const netAttempt = Math.max(parentsCost + overhead - failureValue, 0);
      const expectedCost = netAttempt / successRate + failureValue;

      // À coût égal, le meilleur taux gagne. Le cas se présente vraiment : quand
      // le crédit d'échec couvre toute la dépense, `netAttempt` bute sur zéro et
      // tous les niveaux reviennent au même prix. Sans départage, le niveau 1
      // l'emporterait par simple ordre de parcours — et il faudrait trois fois
      // plus d'accouplements, donc trois fois plus d'heures d'enclos, pour le
      // même résultat. Le kamas ne les distingue pas ; le temps, si.
      if (
        !best ||
        expectedCost < best.expectedCost ||
        (expectedCost === best.expectedCost && successRate > best.successRate)
      ) {
        best = {
          level,
          useOptimakina,
          successRate,
          expectedCost,
          overheadCost: overhead / successRate,
        };
      }
    }
  }

  return best!;
};

/** Le même calcul à niveau imposé, l'Optimakina restant libre. */
const fixedParentLevel = (
  level: number,
  parentsCost: number,
  fuelCost: number,
  mangeoireCostPerMountPoint: number,
  optimakinaPrice: number | null,
  failureValue = 0
): ParentLevelChoice => {
  const overhead = 2 * mangeoireCostPerMountPoint * mountXpForLevel(level) + fuelCost;
  const net = (extra: number) => Math.max(parentsCost + overhead + extra - failureValue, 0);

  const withoutRate = targetGenerationRate(level, level);
  const without: ParentLevelChoice = {
    level,
    useOptimakina: false,
    successRate: withoutRate,
    expectedCost: net(0) / withoutRate + failureValue,
    overheadCost: overhead / withoutRate,
  };

  if (optimakinaPrice === null || optimakinaPrice <= 0) return without;

  const withRate = Math.min(1, withoutRate + OPTIMAKINA_BONUS);
  const withOptimakina: ParentLevelChoice = {
    level,
    useOptimakina: true,
    successRate: withRate,
    expectedCost: net(optimakinaPrice) / withRate + failureValue,
    overheadCost: (overhead + optimakinaPrice) / withRate,
  };

  return withOptimakina.expectedCost < without.expectedCost ? withOptimakina : without;
};

/** Une contrepartie proposée par Eugène éton contre des génétons. */
export type GenetonExchangeRow = {
  itemId: number;
  name: string;
  tier: 'petit' | 'normal' | 'grand' | 'puissant';
  genetons: number;
  /** Caractéristique en dessous de laquelle le parchemin reste utilisable. */
  requiresBelow: number | null;
};

export type GenetonValuation = {
  row: GenetonExchangeRow;
  /** Prix HDV du parchemin retenu. */
  price: number;
  /** Ce que vaut un généton en kamas, via cet échange. */
  valuePerGeneton: number;
};

/**
 * Ce que vaut un généton, au meilleur échange disponible.
 *
 * Les génétons n'ont pas de prix : ils sont liés au compte et ne se revendent
 * pas. Leur valeur est donc **celle de ce qu'on en tire de mieux** — d'où un
 * maximum sur les contreparties, et non une moyenne.
 *
 * Les quatre paliers ne se valent pas : un parchemin « Puissant » coûte seize
 * fois un « Petit » sans valoir seize fois plus à l'hôtel de vente, et le
 * meilleur rapport se déplace avec les cours. C'est aussi pourquoi la condition
 * d'utilisation ne filtre rien ici : on revend le parchemin, on ne le lit pas.
 */
export const bestGenetonValue = (
  exchange: GenetonExchangeRow[],
  prices: Map<number, number>
): GenetonValuation | null => {
  let best: GenetonValuation | null = null;

  for (const row of exchange) {
    const price = prices.get(row.itemId);
    if (price === undefined || price <= 0 || row.genetons <= 0) continue;

    const valuePerGeneton = price / row.genetons;
    if (!best || valuePerGeneton > best.valuePerGeneton) best = { row, price, valuePerGeneton };
  }

  return best;
};

export type BreedingOptions = {
  /**
   * Niveau auquel monter les parents avant de les accoupler.
   *
   * `'auto'` le choisit par croisement : le bon niveau dépend du prix des
   * parents, qui varie d'une recette à l'autre. Un nombre l'impose partout, ce
   * qui sert surtout à comparer une stratégie fixe à l'optimum.
   */
  parentLevel: number | 'auto';
  /**
   * Coût en kamas du carburant qu'un **cycle de fécondité sur une monture**
   * consomme.
   *
   * Une jauge se vide au rythme de l'enclos, pas de l'animal, et un enclos
   * porte 10 montures : le coût se divise donc par le nombre de montures
   * réellement présentes. C'est l'appelant qui fait cette division — ici on ne
   * reçoit que le résultat par monture.
   *
   * Un croisement en consomme **deux**, un par parent : voir le calcul de
   * `fuelCost` dans `computeBreedingCosts`.
   */
  fuelCostPerCycle: number;
  /**
   * Valeur d'un généton en kamas, échangeable contre des parchemins.
   *
   * À 0, les génétons sont ignorés — c'est le défaut prudent tant que le taux
   * de change n'est pas renseigné, puisque les surestimer ferait paraître
   * rentables des croisements qui ne le sont pas.
   */
  genetonValue: number;
  /**
   * Valeur en kamas d'une unité de la ressource rendue par le sacrifice d'une
   * monture. Le sacrifice en rend autant que la génération : une gen 3 en rend 3.
   *
   * La ressource **dépend de la famille** — ambre pour le muldo, neurone pour la
   * dragodinde, corne pour le volkorne — et son identifiant vit sur la famille
   * (`sacrificeItem`). Ce qui arrive ici n'est que le prix unitaire de celle qui
   * correspond aux couleurs passées en argument.
   *
   * À 0, le sacrifice n'est jamais retenu comme sortie.
   */
  sacrificeUnitValue: number;
  /**
   * Coût en kamas d'un point d'expérience **sur une monture** — pas d'un point
   * de jauge, et l'écart est d'un facteur dix.
   *
   * La Mangeoire alimente les dix places de l'enclos d'un coup, exactement comme
   * les jauges de stat : monter dix montures coûte ce que coûte d'en monter une.
   * L'appelant fait donc la division par l'effectif avant d'arriver ici, comme il
   * la fait déjà pour `fuelCostPerCycle`.
   *
   * À 0, la montée est réputée gratuite et la marge niveau 200 redevient une
   * borne haute plutôt qu'un net.
   */
  mangeoireCostPerMountPoint: number;
  /**
   * Prix des Optimakina, indexés par **génération visée** (2 à 10). Une
   * Optimakina ajoute 10 points de probabilité ; le calcul ne la retient que
   * lorsqu'elle abaisse le coût attendu.
   *
   * Absent ou vide : on n'en pose jamais.
   */
  optimakinaPrices?: Map<number, number>;
  /**
   * Recycler les parents stériles par clonage : deux stériles de même
   * génération donnent une monture fertile, au hasard l'une des deux couleurs.
   *
   * Le coût net de consommer un parent en est **divisé par deux**, et le facteur
   * vaut pour toute monture, achetée comme élevée : `u` usages produisent `u`
   * stériles, donc `u/2` fertiles récupérés, donc il n'y a que `u/2`
   * exemplaires à se procurer.
   *
   * Deux réserves, valables en régime permanent seulement :
   *
   * - le clonage exige deux montures de **même génération**, donc il faut assez
   *   de volume dans chaque génération pour les apparier ;
   * - le clone est au hasard **l'une des deux** couleurs, ce qui ne se compense
   *   que si les deux sont consommées dans les mêmes proportions.
   *
   * Sur un plan de quelques dizaines de croisements les deux tiennent. Sur un
   * croisement isolé, non — d'où l'option.
   */
  recycleSteriles: boolean;
  /**
   * Points de Mangeoire qu'un cycle de fécondité absorbe **sans rien
   * rallonger**.
   *
   * Trois des quatre étapes du cycle ne mobilisent qu'un des deux emplacements
   * de jauge ; la Mangeoire occupe l'autre pendant ce temps-là. Les 35 010
   * points de ces trois étapes sont donc de l'expérience gratuite en temps
   * d'enclos — soit le niveau 50 environ.
   *
   * Ça pose un plancher au niveau des parents. En dessous, monter est gratuit en
   * durée et augmente le taux de réussite, donc réduit le nombre de fournées :
   * il n'y a aucune raison de s'en priver. `optimalParentLevel` ne peut pas le
   * voir seul — il ne compte que des kamas, et la montée coûte du carburant —
   * si bien qu'il choisissait le niveau 9 là où le 50 rend le même bébé pour
   * 38 % d'heures d'enclos en moins.
   *
   * À 0, aucun plancher : le comportement d'avant, purement kamas.
   */
  freeXpPoints?: number;
  /**
   * Coût de capture d'**une** monture sauvage, filet compris.
   *
   * À calculer par l'appelant depuis les filets de la famille : pour chacun,
   * `coût de craft × (1 − taux de récupération) / captures`, puis le minimum.
   * La récupération d'environ 80 % des matériaux au recraft fait qu'un filet ne
   * se consomme qu'au cinquième de son prix, et le nombre de captures double à
   * chaque palier — le meilleur rapport n'est donc pas forcément le plus gros
   * filet, d'où un minimum et non le dernier palier.
   *
   * `null` si on ne capture pas : les couleurs sauvages s'achètent alors.
   */
  captureCost?: number | null;
  /**
   * Valoriser les bébés hors cible à ce qu'ils auraient coûté à se procurer.
   *
   * Un accouplement produit toujours un bébé, et `lineageValue` sait désormais
   * ce qu'il vaut — le modèle d'ascendance est mesuré, pas supposé. C'est exact
   * pour **valoriser**, et optimiste pour **planifier** : un raté rend une
   * couleur tirée dans l'ascendance, pas celle dont le plan a besoin. Sur une
   * route vers la génération 10, on accumule des couleurs de génération 2 dont
   * on ne fera rien.
   *
   * L'écart n'est pas cosmétique : une gen 10 revient à 472 000 kamas sans
   * crédit, et ressort à gain net avec. Et le crédit change le **comportement**
   * de l'optimiseur, pas seulement le chiffre — plus un raté rapporte, moins il
   * vaut la peine de monter les parents, jusqu'à choisir de rater exprès.
   *
   * `false` coupe le crédit : chaque tentative se paie plein pot. Les deux
   * lectures sont défendables, aucune n'est « la » vérité, et c'est pourquoi
   * c'est un réglage.
   */
  creditOffTarget?: boolean;
  /**
   * Écarter la revente des montures et ne valoriser que l'extraction.
   *
   * Le marché des certificats est peu liquide : un prix saisi ne garantit pas
   * un acheteur. Classer sur une revente qui n'aura pas lieu donne un palmarès
   * flatteur mais faux. L'extraction, elle, ne dépend de personne.
   *
   * Les prix restent lus et affichés — ils servent toujours à **acheter** une
   * couleur plutôt que l'élever. Seule la sortie change.
   */
  neverSell?: boolean;
};

/**
 * Une couleur se cote à deux niveaux, et l'écart est loin d'être cosmétique :
 * un bébé naît **niveau 1**, donc l'élevage produit toujours du niveau 0. Le
 * prix niveau 200 n'est atteignable qu'en investissant du temps de montée.
 *
 * Conséquence sur le calcul : le coût de revient se compare au prix niveau 0
 * (c'est ce qu'on produit et ce qu'on rachète comme parent, au moins cher), et
 * le niveau 200 n'apparaît que comme stratégie de sortie alternative.
 */
export type ColorPrice = {
  level0: number | null;
  level200: number | null;
};

export type BreedingEstimate = {
  colorId: string;
  /** Prix HDV du poulain, ou `null` si personne ne l'a renseigné. */
  priceLevel0: number | null;
  /** Prix HDV une fois monté au niveau 200. */
  priceLevel200: number | null;
  /**
   * Coût de revient du meilleur croisement, ou `null` si aucune recette n'est
   * chiffrable — il manque un prix quelque part en amont.
   */
  breedCost: number | null;
  /** La recette retenue pour `breedCost`. */
  breedRecipe: BreedingRecipe | null;
  /** Génétons rendus par ce seul croisement, hors ceux des croisements en amont. */
  genetons: number;
  /**
   * Le niveau auquel monter les parents et l'usage d'une Optimakina, tels que
   * retenus pour `breedCost`. `null` si la couleur ne s'élève pas.
   */
  parents: ParentLevelChoice | null;
  /**
   * Le moins cher entre acheter au niveau 0 et élever. `null` quand ni l'un ni
   * l'autre n'est chiffrable. C'est ce coût qui remonte aux générations
   * suivantes : un parent n'a pas besoin d'être monté pour se reproduire.
   */
  cost: number | null;
  /**
   * Comment se procurer cette couleur au meilleur prix. `capture` n'est possible
   * qu'en génération 1 — au-delà, aucun filet ne remplace un croisement.
   */
  strategy: 'buy' | 'capture' | 'breed' | null;
  /**
   * `false` dès qu'une recette non recoupée intervient dans le chemin d'élevage
   * retenu. Un achat est toujours vérifié : aucune recette n'y intervient.
   */
  verified: boolean;
  /**
   * Gain à élever puis revendre le poulain tel quel, taxe de l'hôtel de vente
   * déduite.
   */
  marginLevel0: number | null;
  /**
   * Gain à élever, monter au niveau 200 puis revendre — taxe **et coût de
   * montée** déduits. La montée se paie en points de Mangeoire, donc en kamas :
   * contrairement au temps de jeu, elle a un prix objectif.
   */
  marginLevel200: number | null;
  /** Coût en kamas d'amener cette monture du niveau 1 au niveau 200. */
  levelUpCost: number;
  /** Unités rendues par le sacrifice de cette monture : sa génération. */
  sacrificeUnits: number;
  /**
   * Ce que rapporte le sacrifice. Pas de taxe : on ne passe pas par l'hôtel de
   * vente pour détruire sa monture.
   */
  sacrificeValue: number;
  /**
   * La sortie la plus rentable, et ce qu'elle rapporte net. Les trois sont
   * exclusives : une monture vendue n'est pas sacrifiée, et une monture montée
   * au niveau 200 ne se vend plus au prix du poulain.
   */
  bestExit: 'sell0' | 'sell200' | 'sacrifice';
  bestExitValue: number;
  /**
   * Gain net de la meilleure sortie, **coût d'acquisition** déduit — celui de
   * `cost`, donc le moins cher entre acheter, capturer et élever.
   *
   * Se déduire de `breedCost` serait une erreur : la question « que rapporte
   * cette couleur » ne dépend pas de la façon dont on se l'est procurée. Le
   * faire priverait de marge toute couleur qu'il vaut mieux acheter, et toutes
   * les couleurs sauvages, qui n'ont aucune recette.
   *
   * C'est le seul classement valable dans les deux régimes : avec revente il
   * suit la vente, sans revente il suit l'extraction.
   */
  bestMargin: number | null;
};

/** Taxe prélevée à la vente en hôtel de vente. */
const HDV_TAX_RATE = 0.02;

/**
 * Coût de revient de chaque couleur d'une famille, par génération croissante.
 *
 * `prices` est indexé par identifiant de couleur (`corail_pourpre`) et non par
 * `item_id` DofusDB : les couleurs de génération 9 et 10 existent en jeu mais
 * pas dans le catalogue DofusDB, donc elles n'ont pas d'`item_id` à quoi
 * s'accrocher. Les indexer par slug est ce qui les rend représentables.
 */
export const computeBreedingCosts = (
  colors: BreedingColor[],
  prices: Map<string, ColorPrice>,
  {
    parentLevel,
    fuelCostPerCycle,
    genetonValue,
    sacrificeUnitValue,
    mangeoireCostPerMountPoint,
    optimakinaPrices,
    recycleSteriles,
    freeXpPoints = 0,
    captureCost,
    neverSell = false,
    creditOffTarget = true,
  }: BreedingOptions
): Map<string, BreedingEstimate> => {
  if (parentLevel !== 'auto' && (parentLevel < 1 || parentLevel > MAX_MOUNT_LEVEL)) {
    throw new RangeError(`parentLevel doit être dans [1, ${MAX_MOUNT_LEVEL}], reçu ${parentLevel}`);
  }

  // Identique pour toutes les couleurs : la courbe d'expérience ne dépend que du
  // niveau visé, pas de la rareté de la monture.
  const levelUpCost = mountXpForLevel(MAX_MOUNT_LEVEL) * mangeoireCostPerMountPoint;

  // Le niveau que l'expérience gratuite du cycle permet d'atteindre. Constant
  // sur tout l'arbre : il ne dépend que du cycle, pas de la couleur.
  const parentLevelFloor = levelForMountXp(freeXpPoints);

  const estimates = new Map<string, BreedingEstimate>();
  const byId = new Map(colors.map((color) => [color.id, color]));

  /**
   * Ce qu'apporte un parent à la valeur d'un bébé hors cible.
   *
   * Les poids ne sont plus posés par symétrie : ils sont **mesurés**, sur sept
   * relevés en jeu consignés dans l'issue #49. Voir `lineage.ts`, qui porte la
   * table et ce qu'elle recouvre — un parent pèse 15/19 de sa lignée quand ses
   * grands-parents sont d'une génération inférieure, là où le modèle précédent
   * lui en donnait la moitié.
   *
   * Une couleur vaut ce qu'elle aurait coûté à se procurer : l'obtenir sans
   * payer économise exactement cela. Quand un parent est acheté ou capturé, il
   * n'a pas d'ascendants dans notre plan, et sa part de grands-parents revient
   * sur lui — ce que le relevé 2 confirme.
   *
   * Limite de fond, inchangée : la répartition dépend de la généalogie de
   * l'**individu**, pas de la couleur. Deux muldos Amande ne se valent pas selon
   * d'où ils viennent. Ce calcul-ci raisonne sur des couleurs et approxime la
   * lignée d'un parent par sa recette ; il ne peut pas coller à l'individu. Le
   * suivi individuel de l'écurie, lui, le peut — voir `lineageDistribution`.
   */
  const lineageValueOf = (parentId: string): number => {
    const parent = estimates.get(parentId);
    if (!parent?.cost) return 0;

    const slot = { colorId: parentId, cost: Math.max(parent.cost, 0) };
    const recipe = parent.strategy === 'breed' ? parent.breedRecipe : null;
    if (!recipe) return lineageValue(slot, null);

    return lineageValue(
      slot,
      recipe.map((id) => ({
        colorId: id,
        // Borné à zéro comme ailleurs : une monture ne vaut pas moins que rien,
        // et un coût négatif ferait baisser le crédit au lieu de le monter.
        cost: Math.max(estimates.get(id)?.cost ?? 0, 0),
      }))
    );
  };
  const byGeneration = [...colors].sort((a, b) => a.generation - b.generation);
  /** Un prix nul ou négatif vaut « non renseigné » : la saisie part de 0. */
  const positive = (value: number | null | undefined) =>
    value !== null && value !== undefined && value > 0 ? value : null;

  for (const color of byGeneration) {
    const priceLevel0 = positive(prices.get(color.id)?.level0);
    const priceLevel200 = positive(prices.get(color.id)?.level200);

    let breedCost: number | null = null;
    let breedRecipe: BreedingRecipe | null = null;
    let breedVerified = false;
    let breedGenetons = 0;
    let breedParents: ParentLevelChoice | null = null;

    const optimakinaPrice = positive(optimakinaPrices?.get(color.generation));

    for (const recipe of color.recipes) {
      const [first, second] = recipe.map((parent) => estimates.get(parent));

      // Un parent sans coût connu rend la recette inchiffrable. On ne la
      // remplace pas par une valeur par défaut : un coût inventé se propagerait
      // en silence jusqu'au classement, et « je ne sais pas » y ressemblerait à
      // « c'est gratuit ». Comparaison à `null` explicite : un coût nul est une
      // valeur légitime, que le raccourci `!cost` confondrait avec l'absence.
      if (first?.cost == null || second?.cost == null) continue;

      const genetons = genetonsForCrossing(color.generation, [
        byId.get(recipe[0])!.generation,
        byId.get(recipe[1])!.generation,
      ]);

      // Le niveau des parents se choisit **par recette** : il dépend du prix des
      // parents, qui n'est pas le même d'une recette à l'autre. Un niveau unique
      // pour tout l'arbre surpaierait les croisements bon marché.
      // Le clonage rend la moitié de ce qu'on consomme. La montée, elle, est à
      // refaire : le niveau est une jauge, et le clone repart à zéro — c'est
      // pourquoi seul le prix des parents est divisé, pas le coût de montée.
      //
      // Les coûts sont bornés à zéro avant d'être réinjectés. Un croisement dont
      // les génétons dépassent la dépense affiche un coût négatif, ce qui est
      // exact et intéressant à voir — mais le propager casserait tout : diviser
      // un négatif par le taux de réussite rend un **mauvais** taux préférable,
      // et l'optimiseur choisirait alors des parents niveau 1. Une monture ne
      // peut pas coûter moins que rien à se procurer ; ce qu'elle rapporte en
      // plus se lit sur sa propre marge, pas sur le prix de ses enfants.
      const parentsCost =
        (Math.max(first.cost, 0) + Math.max(second.cost, 0)) * (recycleSteriles ? 0.5 : 1);
      // Un accouplement demande **deux** parents à fécondité pleine et les rend
      // tous deux à zéro : il faut donc deux cycles, un par parent, quelle que
      // soit leur provenance. Le facturer à l'usage plutôt qu'à la naissance
      // n'est pas un choix de présentation — imputer un cycle à chaque bébé
      // laisserait les montures achetées, capturées et clonées ne jamais payer
      // le leur. `planDuration` et `planGaugeNeeds` comptent déjà `2 ×
      // tentatives` montures à préparer ; le coût attendu suit enfin.
      const fuelCost = fuelCostPerCycle * 2;

      // Un accouplement rend toujours un bébé : celui d'une tentative hors cible
      // a une couleur de la généalogie proche, et vaut ce qu'elle coûte.
      const failureValue = creditOffTarget
        ? lineageValueOf(recipe[0]) + lineageValueOf(recipe[1])
        : 0;

      const parents =
        parentLevel === 'auto'
          ? optimalParentLevel(
              parentsCost,
              fuelCost,
              mangeoireCostPerMountPoint,
              optimakinaPrice,
              failureValue,
              parentLevelFloor
            )
          : fixedParentLevel(
              parentLevel,
              parentsCost,
              fuelCost,
              mangeoireCostPerMountPoint,
              optimakinaPrice,
              failureValue
            );

      // Les génétons ne tombent qu'à la naissance : ils se déduisent une fois,
      // après la division par le taux de réussite qui, elle, frappe chaque
      // tentative — y compris celles qui échouent sans rien produire.
      const cost = parents.expectedCost - genetons * genetonValue;
      if (breedCost !== null && cost >= breedCost) continue;

      breedCost = cost;
      breedRecipe = recipe;
      breedGenetons = genetons;
      breedParents = parents;
      // Le chemin ne vaut que par son maillon le plus faible : une recette sûre
      // dont un parent vient d'un croisement non recoupé ne l'est pas.
      breedVerified = color.source === 'game' && first.verified && second.verified;
    }

    // Capturer ne concerne que les couleurs sauvages : au-delà de la première
    // génération, une monture s'élève ou s'achète, aucun filet ne la sort d'une
    // zone.
    const capturable = color.recipes.length === 0 ? positive(captureCost) : null;

    // À égalité, acheter l'emporte : c'est immédiat, et ça n'engage ni une
    // recette qui pourrait être fausse ni une session de capture.
    const options: { strategy: NonNullable<BreedingEstimate['strategy']>; cost: number }[] = [];
    if (priceLevel0 !== null) options.push({ strategy: 'buy', cost: priceLevel0 });
    if (capturable !== null) options.push({ strategy: 'capture', cost: capturable });
    if (breedCost !== null) options.push({ strategy: 'breed', cost: breedCost });

    const chosen = options.reduce<(typeof options)[number] | null>(
      (best, option) => (best === null || option.cost < best.cost ? option : best),
      null
    );

    const strategy = chosen?.strategy ?? null;
    const cost = chosen?.cost ?? null;

    /** Produit net d'une vente, une fois la taxe de l'hôtel de vente payée. */
    const netSale = (price: number | null) =>
      price === null ? null : price - Math.floor(price * HDV_TAX_RATE);

    // L'extraction rend une ressource par génération — mais les montures de
    // génération 1 ne s'extraient pas du tout. Ce n'est pas « une ressource »,
    // c'est zéro, et une couleur sauvage n'a donc pas cette sortie.
    const sacrificeUnits = color.generation > 1 ? color.generation : 0;
    const sacrificeValue = sacrificeUnits * sacrificeUnitValue;

    // La meilleure des trois sorties. Le sacrifice sert de plancher : il ne
    // dépend d'aucun prix saisi, donc il reste disponible pour les couleurs que
    // personne n'a cotées — souvent les plus rares, faute d'un marché liquide.
    const net200 = netSale(priceLevel200);
    // Sans revente il ne reste que l'extraction — elle ne dépend d'aucun
    // acheteur, ce qui est précisément l'intérêt de l'option.
    const exits = neverSell
      ? [{ exit: 'sacrifice' as const, value: sacrificeValue }]
      : [
          { exit: 'sell0' as const, value: netSale(priceLevel0) },
          // La montée se paie avant la vente : ce qu'elle coûte sort d'ici,
          // sinon le niveau 200 gagnerait toujours par construction.
          { exit: 'sell200' as const, value: net200 === null ? null : net200 - levelUpCost },
          { exit: 'sacrifice' as const, value: sacrificeValue },
        ];
    const best = exits.reduce((chosen, candidate) =>
      (candidate.value ?? -Infinity) > (chosen.value ?? -Infinity) ? candidate : chosen
    );

    const marginOf = (value: number | null) =>
      value === null || breedCost === null ? null : value - breedCost;

    estimates.set(color.id, {
      colorId: color.id,
      priceLevel0,
      priceLevel200,
      breedCost,
      breedRecipe,
      genetons: breedGenetons,
      parents: breedParents,
      cost,
      strategy,
      // Acheter n'engage aucune recette, donc rien à vérifier.
      // Ni l'achat ni la capture n'engagent de recette : rien à vérifier.
      verified: strategy === 'breed' ? breedVerified : strategy !== null,
      marginLevel0: marginOf(netSale(priceLevel0)),
      marginLevel200: marginOf(net200 === null ? null : net200 - levelUpCost),
      levelUpCost,
      sacrificeUnits,
      sacrificeValue,
      bestExit: best.exit,
      bestExitValue: best.value ?? 0,
      // Contre `cost` et non `breedCost` : ce que rapporte une couleur ne dépend
      // pas de la voie par laquelle on l'a obtenue.
      bestMargin: best.value === null || cost === null ? null : best.value - cost,
    });
  }

  return estimates;
};

export type BreedingStep = {
  colorId: string;
  generation: number;
  recipe: BreedingRecipe;
  /** Coût d'un exemplaire. Multiplier par `count` pour le coût de l'étape. */
  cost: number;
  /** Génétons rendus par un croisement, à multiplier par `count` de même. */
  genetons: number;
  /**
   * Combien de bébés de cette couleur produire. Rarement 1 : chaque croisement
   * consomme deux parents, donc une couleur qui sert de parent à deux recettes
   * différentes doit être produite deux fois.
   */
  count: number;
  /**
   * Accouplements à tenter pour obtenir ces `count` bébés — donc plus que
   * `count`, puisque la génération cible n'est pas garantie. C'est ce nombre-là
   * qu'on prépare en enclos, et donc lui qui coûte du temps.
   */
  attempts: number;
  /** Niveau auquel monter les deux parents, et probabilité qui en découle. */
  parentLevel: number;
  successRate: number;
  useOptimakina: boolean;
  /** Exemplaires déjà en stock, déduits de `count`. */
  owned: number;
};

export type BreedingPurchase = {
  colorId: string;
  generation: number;
  count: number;
  unitCost: number;
  strategy: 'buy' | 'capture';
  owned: number;
};

export type BreedingPlan = {
  /** Les croisements à réaliser, parents avant enfants. */
  steps: BreedingStep[];
  /** Les couleurs à se procurer sans les élever, et en combien d'exemplaires. */
  purchases: BreedingPurchase[];
  /** Nombre total de croisements, multiplicités comprises. */
  crossings: number;
  /**
   * Exemplaires de la cible que le plan met en main, stock compris.
   *
   * Peut dépasser l'objectif, qui est un plancher : remplir la dernière fournée
   * rend quelques montures de plus sans carburant ni délai supplémentaires. Tout
   * ce qui valorise le plan doit compter sur ce nombre et non sur l'objectif,
   * sans quoi les tentatives ajoutées grèveraient le coût sans jamais créditer
   * la recette qu'elles produisent.
   */
  targetProduced: number;
  /**
   * Appairages de clonage que le plan suppose, toutes couleurs confondues.
   *
   * Gratuits : deux stériles de même rang donnent un fertile, sans égard à leurs
   * jauges. Rien à facturer donc, ni enclos ni carburant — le clone sort les
   * jauges vides et son cycle de fécondité est déjà compté avec les autres, la
   * durée se comptant par usage de parent et non par monture distincte.
   *
   * Reste que c'est une manipulation à faire, et sans elle le plan manque de
   * parents : c'est à ce titre qu'on l'affiche, comme une consigne et non comme
   * une dépense.
   */
  clonings: number;
  genetons: number;
  /**
   * Bébés produits hors génération cible, sur l'ensemble du plan.
   *
   * Ils existent bel et bien — les 30 à 90 % portent sur la couleur du bébé, pas
   * sur sa venue au monde — mais ils ne sont **pas** déduits de `totalCost`. Leur
   * valeur dépend de la répartition des couleurs à l'échec, qui reste
   * provisoire ; la déduire ici propagerait cette incertitude au classement.
   * Le coût du plan est donc un majorant, et ce nombre dit de combien.
   */
  offTargetBabies: number;
  /** Ce que coûtent les montures à acheter ou capturer. */
  purchasesCost: number;
  /** Montée en niveau, carburant et Optimakina de tous les croisements. */
  crossingsCost: number;
  /** Ce que valent les génétons rendus par l'ensemble des croisements. */
  genetonCredit: number;
  /**
   * Le coût réel du plan. À préférer au `breedCost` de la couleur cible, qui
   * ignore les multiplicités et le recyclage — il surestime dès qu'une couleur
   * sert à plusieurs recettes.
   */
  totalCost: number;
};

export type BreedingPlanOptions = {
  /** Combien d'exemplaires de la cible produire. */
  targetCount?: number;
  recycleSteriles?: boolean;
  /**
   * Valeur d'un généton, pour créditer le plan de ceux qu'il rend.
   *
   * Contrairement aux bébés hors cible, ce co-produit-là est certain : il tombe
   * à chaque naissance de la génération visée, en quantité fixée par la
   * génération des parents. Rien d'incertain à en déduire la valeur.
   */
  genetonValue?: number;
  /**
   * Ce que l'éleveur possède déjà, par couleur.
   *
   * C'est ce qui rend le plan reprenable : les besoins se déduisent du stock
   * avant de remonter aux parents, donc une fournée chanceuse allège tout
   * l'amont et une fournée malchanceuse le laisse à refaire. Sans cela, un plan
   * ne servirait qu'une fois, au premier croisement.
   */
  stock?: Map<string, number>;
  /**
   * Places d'un enclos, pour saturer la dernière fournée de la cible.
   *
   * Sans cette valeur le plan produit le compte exact et laisse la dernière
   * fournée à moitié vide — du carburant payé pour des places inoccupées.
   */
  slots?: number;
};

/**
 * Tentatives arrondies pour que la dernière fournée d'enclos parte pleine.
 *
 * L'objectif est un **plancher**, pas un compte exact. Le carburant se consomme
 * au niveau de l'enclos et non de la monture (voir `cyclePointsCostPerMount`) :
 * une fournée à six places occupées coûte exactement ce que coûte une fournée
 * pleine. Les quatre places libres sont donc du carburant déjà payé, et les
 * tentatives qu'elles portent ne coûtent plus que leurs parents.
 *
 * Deux parents par tentative, dix places par enclos : une fournée porte cinq
 * tentatives.
 */
export const fillLastBatch = (attempts: number, slots: number) =>
  slots > 0 ? (Math.ceil((2 * attempts) / slots) * slots) / 2 : attempts;

/**
 * Les croisements à réaliser pour produire `colorId`, parents avant enfants.
 *
 * Ne descend que dans les couleurs que le calcul a décidé d'élever : celles
 * qu'il vaut mieux acheter sont des feuilles, on s'arrête à leur prix. C'est ce
 * qui distingue cette liste d'un arbre généalogique complet — une couleur de
 * génération 10 en descend d'une vingtaine, mais n'en demande que quelques-uns
 * si l'on rachète les intermédiaires au lieu de tout produire.
 */
/**
 * Exemplaires à réellement se procurer pour `uses` utilisations, une fois le
 * recyclage par clonage pris en compte.
 *
 * Chaque utilisation laisse un stérile, et deux stériles donnent un fertile. En
 * déroulant la chaîne depuis `b` exemplaires frais : `b` usages, puis `⌊b/2⌋`,
 * puis `⌊b/4⌋`… ce qui totalise `2b − 1` usages. D'où l'inverse ci-dessous.
 *
 * Le cas `uses = 1` en sort naturellement avec `b = 1` : un stérile seul n'a
 * personne à qui s'appairer, donc aucun gain. C'est précisément ce qu'un facteur
 * ½ uniforme rate — il rendait un muldo Corail-Pourpre 29 fois trop bon marché.
 *
 * On appaire deux exemplaires de la **même couleur** : le clone est au hasard
 * l'une des deux montures, donc n'appairer que des identiques rend le résultat
 * certain. Appairer deux couleurs d'une même génération marcherait aussi et
 * gagnerait un peu, au prix d'un tirage aléatoire qu'il faudrait modéliser.
 */
export const copiesToObtain = (uses: number, recycleSteriles: boolean) =>
  recycleSteriles && uses > 0 ? Math.floor(uses / 2) + 1 : uses;

export const breedingPlan = (
  colorId: string,
  colors: BreedingColor[],
  estimates: Map<string, BreedingEstimate>,
  {
    targetCount = 1,
    recycleSteriles = false,
    genetonValue = 0,
    stock,
    slots = 10,
  }: BreedingPlanOptions = {}
): BreedingPlan => {
  const generationOf = new Map(colors.map((color) => [color.id, color.generation]));
  const counts = new Map<string, number>([[colorId, targetCount]]);
  /** Ce qu'il faut produire, une fois le recyclage et le stock déduits. */
  const produced = new Map<string, number>();
  /** Exemplaires pris sur le stock, gardés pour l'affichage. */
  const fromStock = new Map<string, number>();
  /** Accouplements à réaliser, tentatives ratées comprises. */
  const attemptsBy = new Map<string, number>();
  /**
   * Appairages de clonage supposés, toutes couleurs confondues.
   *
   * Chaque clonage transforme deux stériles en un fertile, donc rend
   * exactement un usage de plus que les exemplaires frais n'en portent : sur
   * `needed` usages tirés de `copies` exemplaires, il en faut `needed − copies`.
   */
  let clonings = 0;

  // Les besoins se propagent des enfants vers les parents, donc en génération
  // décroissante : quand on traite une couleur, tout ce qui la réclame a déjà
  // été compté. Un simple parcours en profondeur compterait chaque couleur une
  // fois et sous-estimerait tout ce qui sert à plusieurs recettes — pour un
  // muldo Corail-Pourpre, cela revient à annoncer 19 croisements au lieu des 99
  // exemplaires réellement nécessaires.
  const descending = [...colors].sort((a, b) => b.generation - a.generation);

  for (const color of descending) {
    // Les besoins se propagent en espérance et tombent donc fractionnaires ;
    // on ne peut pas élever une demi-monture, d'où l'arrondi au supérieur.
    const needed = Math.ceil(counts.get(color.id) ?? 0);
    if (needed === 0) continue;

    // Le recyclage s'applique ici, sur le besoin de **cette** couleur, et pas
    // en facteur global : il dépend du nombre d'exemplaires, qui varie d'une
    // couleur à l'autre dans un même plan.
    //
    // Sauf sur la cible, qu'il faut posséder et non consommer. `copiesToObtain`
    // répond à « combien d'exemplaires frais pour N *utilisations comme
    // parent* » : chaque usage rend un stérile, et deux stériles font un
    // clone. La couleur visée n'est parent de rien ici, donc elle ne produit
    // aucun stérile et il n'y a rien à recycler. L'y appliquer quand même
    // ramenait un objectif de 10 à 6 montures produites.
    const copies =
      color.id === colorId ? needed : copiesToObtain(needed, recycleSteriles);

    // Le clonage ne comble que ce que les exemplaires frais ne portent pas, et
    // une écurie fournie en porte davantage que le minimum : `copies` est le
    // plancher d'achat, pas le compte réel de montures fraîches disponibles.
    // Compter les clonages dessus en annoncerait à qui n'en a pas besoin — et
    // comme l'appairage est gratuit, rien n'incite à en faire plus que
    // nécessaire.
    const fresh = Math.max(copies, Math.min(stock?.get(color.id) ?? 0, needed));
    clonings += needed - fresh;

    // Le stock se déduit **avant** de remonter aux parents : ce qu'on possède
    // déjà n'a plus à être élevé, donc plus rien de son ascendance non plus.
    // C'est tout le mécanisme de rattrapage — un plan repris après une fournée
    // ne redemande que ce qui manque encore.
    const owned = Math.min(stock?.get(color.id) ?? 0, copies);
    const toProduce = copies - owned;
    fromStock.set(color.id, owned);
    produced.set(color.id, toProduce);
    if (toProduce === 0) continue;

    const estimate = estimates.get(color.id);
    if (estimate?.strategy !== 'breed' || !estimate.breedRecipe) continue;

    // Une tentative ratée consomme ses deux parents sans rien produire : il en
    // faut donc `1/taux` pour obtenir un bébé, et autant d'exemplaires de chaque
    // parent. Propager `toProduce` au lieu des tentatives sous-compterait tout
    // l'amont, et d'autant plus qu'on remonte les générations.
    let attempts = toProduce / estimate.parents!.successRate;

    // Sur la cible seulement, l'objectif se lit comme un plancher : on remplit
    // la dernière fournée plutôt que de la laisser à moitié vide, ce qui rend
    // quelques montures de plus pour le même carburant et le même délai. Les
    // couleurs intermédiaires restent tirées par la demande — en surproduire
    // n'immobiliserait des enclos que pour du stock dont personne ne veut.
    //
    // À condition que l'élevage rapporte : sur une couleur à marge négative,
    // chaque tentative supplémentaire creuse la perte. C'est bien `breedCost`
    // qui arbitre, et non `bestMargin`, qui se compte contre le prix d'achat —
    // une couleur moins chère à acheter qu'à élever reste rentable à revendre
    // sans qu'il faille pour autant en élever davantage.
    if (
      color.id === colorId &&
      estimate.breedCost !== null &&
      estimate.bestExitValue > estimate.breedCost
    ) {
      attempts = fillLastBatch(attempts, slots);
      produced.set(
        color.id,
        Math.max(toProduce, Math.floor(attempts * estimate.parents!.successRate))
      );
    }

    attemptsBy.set(color.id, attempts);

    for (const parent of estimate.breedRecipe) {
      counts.set(parent, (counts.get(parent) ?? 0) + attempts);
    }
  }

  const steps: BreedingStep[] = [];
  const purchases: BreedingPlan['purchases'] = [];

  for (const [id, count] of produced) {
    const estimate = estimates.get(id);
    if (!estimate || count === 0) continue;

    const generation = generationOf.get(id) ?? 0;
    const owned = fromStock.get(id) ?? 0;

    if (estimate.strategy === 'breed' && estimate.breedRecipe) {
      steps.push({
        colorId: id,
        generation,
        recipe: estimate.breedRecipe,
        cost: estimate.cost ?? 0,
        genetons: estimate.genetons,
        count,
        attempts: Math.ceil(attemptsBy.get(id) ?? count),
        parentLevel: estimate.parents?.level ?? 1,
        successRate: estimate.parents?.successRate ?? 1,
        useOptimakina: estimate.parents?.useOptimakina ?? false,
        owned,
      });
    } else if (estimate.strategy === 'buy' || estimate.strategy === 'capture') {
      purchases.push({
        colorId: id,
        generation,
        count,
        unitCost: estimate.cost ?? 0,
        strategy: estimate.strategy,
        owned,
      });
    }
  }

  // Parents avant enfants : l'ordre d'exécution réel.
  steps.sort((a, b) => a.generation - b.generation || a.colorId.localeCompare(b.colorId));
  purchases.sort((a, b) => b.count * b.unitCost - a.count * a.unitCost);

  // Le coût du plan se recompose ici plutôt que de reprendre `breedCost` de la
  // cible : cette estimation-là ignore les multiplicités, donc elle compte
  // chaque exemplaire au prix fort. Ce total est le seul qui tienne compte du
  // recyclage, qui ne se connaît qu'une fois la cible fixée.
  const purchasesCost = purchases.reduce(
    (total, purchase) => total + purchase.count * purchase.unitCost,
    0
  );
  const crossingsCost = steps.reduce((total, step) => {
    const parents = estimates.get(step.colorId)?.parents;
    return total + step.count * (parents?.overheadCost ?? 0);
  }, 0);

  // Les génétons ne tombent qu'aux naissances de la génération visée : un bébé
  // hors cible est d'une génération que ses parents atteignent déjà, et n'en
  // rend aucun. On compte donc sur `count`, pas sur `attempts`.
  const genetons = steps.reduce((total, step) => total + step.genetons * step.count, 0);
  const genetonCredit = genetons * genetonValue;

  return {
    steps,
    purchases,
    // Les accouplements réellement à faire, ratés compris — donc plus nombreux
    // que les bébés obtenus. `overheadCost` porte déjà la division par le taux
    // de réussite, d'où un coût calculé sur `count` et non sur les tentatives.
    crossings: steps.reduce((total, step) => total + step.attempts, 0),
    targetProduced: (fromStock.get(colorId) ?? 0) + (produced.get(colorId) ?? 0),
    clonings,
    genetons,
    offTargetBabies: steps.reduce((total, step) => total + (step.attempts - step.count), 0),
    purchasesCost,
    crossingsCost,
    genetonCredit,
    totalCost: purchasesCost + crossingsCost - genetonCredit,
  };
};

/**
 * Ce que l'enclos sait faire, réduit à ce dont la durée d'un plan dépend.
 *
 * Vient de `computeSupplyCosts`, qui l'a lu sur les carburants tarifés.
 */
export type EnclosTiming = {
  /** Heures d'un cycle de fécondité, pour une fournée entière d'enclos. */
  cycleHours: number;
  /** Heures du cycle où le second emplacement reste libre pour la Mangeoire. */
  freeSlotHours: number;
  /** Débit de la Mangeoire une fois son carburant choisi. */
  mangeoirePointsPerHour: number;
  /** Places par enclos — dix en jeu, et c'est ce qui fait l'intérêt des fournées. */
  slots?: number;
  /** Enclos menés de front. Ne change pas le total, seulement le délai. */
  enclosCount: number;
};

export type PlanDuration = {
  /**
   * Heures d'enclos consommées par le plan, tous enclos confondus.
   *
   * C'est **la** ressource rare de l'élevage : elle ne dépend pas du nombre
   * d'enclos possédés, seulement de ce qu'il y a à faire. D'où son rôle de
   * dénominateur pour la rentabilité horaire.
   */
  enclosHours: number;
  /**
   * Le délai incompressible, même avec une infinité d'enclos : une génération
   * ne peut commencer qu'une fois la précédente sortie.
   */
  criticalPathHours: number;
  /** Le délai réel, avec le nombre d'enclos de l'éleveur. */
  wallClockHours: number;
  /** Fournées d'enclos à mener, toutes générations confondues. */
  batches: number;
};

/**
 * Heures d'enclos pour amener une fournée de montures au niveau `level` **et** à
 * la fécondité.
 *
 * Les deux ne s'additionnent pas : trois des quatre étapes du cycle
 * n'occupent qu'un emplacement de jauge, et la Mangeoire s'y glisse
 * gratuitement. Elle ne rallonge la fournée que par ce qui dépasse.
 */
export const batchHoursForLevel = (
  level: number,
  { cycleHours, freeSlotHours, mangeoirePointsPerHour }: EnclosTiming
): number => {
  if (mangeoirePointsPerHour <= 0) return Infinity;
  const xpHours = mountXpForLevel(level) / mangeoirePointsPerHour;
  return cycleHours + Math.max(0, xpHours - freeSlotHours);
};

/**
 * Le temps qu'un plan demande, en heures d'enclos et en délai.
 *
 * Ce qui coûte du temps n'est pas le croisement lui-même — il est instantané —
 * mais la **préparation de ses deux parents** : les monter au niveau retenu,
 * puis leur faire faire un cycle de fécondité. Un accouplement raté ayant
 * consommé ses parents tout autant qu'un réussi, c'est bien sur les tentatives
 * que le temps se compte, pas sur les bébés obtenus.
 *
 * Les dix places d'un enclos se préparent ensemble : vingt parents ne coûtent
 * pas dix fois deux parents, mais deux fournées. C'est ce qui rend les grosses
 * séries proportionnellement plus rapides, et donc les hautes générations moins
 * pénalisées qu'il n'y paraît.
 */
export const planDuration = (
  plan: BreedingPlan,
  timing: EnclosTiming,
  /**
   * Monter les montures finales avant de les vendre, le cas échéant.
   *
   * À ne pas oublier quand la sortie retenue est la vente niveau 200 : la
   * montée coûte des centaines d'heures de Mangeoire, bien plus qu'un cycle de
   * fécondité. L'omettre ferait passer cette sortie pour gratuite en temps
   * alors qu'elle est de loin la plus longue.
   *
   * Pas de cycle de fécondité ici : une monture qu'on vend n'a pas à être
   * fécondée, seulement montée.
   */
  finalLevelUp: { count: number; level: number } | null = null,
  /**
   * Tours de cycles que chaque étape demande réellement, par couleur produite.
   *
   * Sans ce compte, le chemin critique vaut une fournée par génération, ce qui
   * suppose tous les parents d'une étape préparables de front. C'est faux dès
   * que l'écurie est courte sur l'un d'eux : les manquants viennent du clonage
   * des stériles de la vague précédente, et un clone sort les jauges vides, donc
   * refait un cycle entier. Ces tours-là s'ajoutent, ils ne se recouvrent pas.
   *
   * Voir `planWaves`. Absent, on retombe sur un tour par étape.
   */
  waveCounts: Map<string, number> | null = null
): PlanDuration => {
  const slots = timing.slots ?? 10;
  const enclos = Math.max(timing.enclosCount, 1);

  let enclosHours = 0;
  let batches = 0;
  /** Le plus long chemin de dépendances : une fournée par génération au moins. */
  const longestByGeneration = new Map<number, number>();

  for (const step of plan.steps) {
    const perBatch = batchHoursForLevel(step.parentLevel, timing);
    // Deux parents par accouplement, préparés dans la limite des places.
    const stepBatches = Math.ceil((2 * step.attempts) / slots);

    enclosHours += stepBatches * perBatch;
    batches += stepBatches;

    // Les vagues d'une étape s'enchaînent, faute de quoi le clonage qui les
    // sépare n'aurait pas lieu d'être ; celles de deux étapes d'une même
    // génération se mènent en parallèle, tant que le parc suit.
    const rounds = waveCounts?.get(step.colorId) ?? 1;

    longestByGeneration.set(
      step.generation,
      Math.max(longestByGeneration.get(step.generation) ?? 0, rounds * perBatch)
    );
  }

  let criticalPathHours = [...longestByGeneration.values()].reduce(
    (total, hours) => total + hours,
    0
  );

  if (finalLevelUp && finalLevelUp.count > 0 && timing.mangeoirePointsPerHour > 0) {
    const hours = mountXpForLevel(finalLevelUp.level) / timing.mangeoirePointsPerHour;
    const finalBatches = Math.ceil(finalLevelUp.count / slots);
    enclosHours += finalBatches * hours;
    batches += finalBatches;
    // La montée vient après le dernier croisement : elle rallonge le chemin.
    criticalPathHours += hours;
  }

  return {
    enclosHours,
    criticalPathHours,
    // Plus d'enclos raccourcit le délai, mais jamais en deçà de la chaîne des
    // générations : la gen 5 attend la gen 4, quel que soit le parc.
    wallClockHours: Math.max(enclosHours / enclos, criticalPathHours),
    batches,
  };
};

/** Ce qu'une jauge demande à un plan, et ce que le stock en couvre. */
export type GaugeRequirement = {
  gauge: string;
  /** Points à transférer sur l'ensemble du plan. */
  points: number;
  /** Points déjà en réserve, plafonnés à ce que le plan consomme. */
  covered: number;
  costPerPoint: number;
  /** Ce que coûtent les points restants. */
  cost: number;
  /** Ce que la réserve dispense de racheter. */
  credit: number;
  /** Le carburant retenu, pour dire lequel racheter. */
  fuel: string;
};

/**
 * Ce qu'un plan demande à chaque jauge, une fois le stock déduit.
 *
 * Compté en **points** et non en unités : une unité d'Élixir en vaut huit
 * d'Extrait, donc un stock ne se compare à un besoin que dans cette monnaie-là.
 *
 * Les fournées portent le calcul, pas les montures : l'enclos transfère à ses
 * dix places d'un coup, donc préparer dix parents coûte le même carburant qu'en
 * préparer un. C'est ce qui rend les objectifs élevés proportionnellement moins
 * chers, et ce qu'un compte par monture raterait.
 */
export const planGaugeNeeds = (
  plan: BreedingPlan,
  timing: Pick<EnclosTiming, 'slots'>,
  cycleGauges: { gauge: string; pointsPerBatch: number; costPerPoint: number; fuel: string }[],
  mangeoire: { gauge: string; costPerPoint: number; fuel: string } | null,
  /** Points déjà en réserve, par jauge. */
  ownedPoints: Map<string, number> = new Map()
): GaugeRequirement[] => {
  const slots = timing.slots ?? 10;
  const needs = new Map<string, { points: number; costPerPoint: number; fuel: string }>();

  const add = (gauge: string, points: number, costPerPoint: number, fuel: string) => {
    const current = needs.get(gauge);
    needs.set(gauge, { points: (current?.points ?? 0) + points, costPerPoint, fuel });
  };

  for (const step of plan.steps) {
    const batches = Math.ceil((2 * step.attempts) / slots);

    for (const gauge of cycleGauges) {
      add(gauge.gauge, batches * gauge.pointsPerBatch, gauge.costPerPoint, gauge.fuel);
    }
    // La Mangeoire dépend du niveau visé, qui change d'un croisement à l'autre.
    if (mangeoire) {
      add(
        mangeoire.gauge,
        batches * mountXpForLevel(step.parentLevel),
        mangeoire.costPerPoint,
        mangeoire.fuel
      );
    }
  }

  return [...needs].map(([gauge, { points, costPerPoint, fuel }]) => {
    // Le stock ne vaut que ce que le plan en consomme : dix mille points
    // d'Abreuvoir en réserve ne financent rien si le plan n'en demande mille.
    const covered = Math.min(ownedPoints.get(gauge) ?? 0, points);
    return {
      gauge,
      points,
      covered,
      costPerPoint,
      cost: (points - covered) * costPerPoint,
      credit: covered * costPerPoint,
      fuel,
    };
  });
};

export type PlanFunding = {
  budget: number;
  /**
   * Ce qu'il faut sortir en kamas, réserves déduites.
   *
   * Le carburant déjà en réserve n'est pas une dépense : il a été payé. Les
   * montures possédées, elles, ne comptent déjà plus — le plan ne les demande
   * plus du tout.
   */
  cashNeeded: number;
  affordable: boolean;
  /** Ce qui manque au pire moment, ou 0 si le budget tient. */
  shortfall: number;
  /**
   * La première étape que le budget ne couvre plus.
   *
   * Un plan se paie dans l'ordre, et les génétons rentrent en cours de route :
   * ce n'est donc pas le total qui bloque mais le point le plus tendu. Dire
   * *où* ça coince vaut mieux que dire que ça coince — c'est là qu'il faut
   * vendre, ou réduire l'objectif.
   */
  blockedAt: { kind: 'purchase' | 'crossing'; colorId: string } | null;
};

/**
 * Si le budget tient le plan, et où il lâche sinon.
 *
 * Les dépenses se suivent dans l'ordre d'exécution : d'abord les montures de
 * base, puis les croisements par génération. Les génétons se déduisent au
 * passage, puisqu'ils tombent à chaque naissance et se revendent aussitôt.
 *
 * Un budget de 0 vaut « pas de contrainte » plutôt que « rien n'est possible » :
 * c'est la valeur par défaut, et refuser tous les plans à un éleveur qui n'a
 * simplement pas renseigné son budget serait absurde.
 */
export const planFunding = (
  plan: BreedingPlan,
  estimates: Map<string, BreedingEstimate>,
  budget: number,
  { genetonValue = 0, gaugeCredit = 0 }: { genetonValue?: number; gaugeCredit?: number } = {}
): PlanFunding => {
  const cashNeeded = Math.max(plan.totalCost - gaugeCredit, 0);
  if (budget <= 0) {
    return { budget, cashNeeded, affordable: true, shortfall: 0, blockedAt: null };
  }

  // Le carburant en réserve dispense d'autant de dépense : pour le suivi de
  // trésorerie, c'est équivalent à disposer de ces kamas-là en plus.
  let remaining = budget + gaugeCredit;
  let worst = 0;
  let blockedAt: PlanFunding['blockedAt'] = null;

  const spend = (amount: number, at: NonNullable<PlanFunding['blockedAt']>) => {
    remaining -= amount;
    if (remaining < 0 && -remaining > worst) {
      worst = -remaining;
      blockedAt = at;
    }
  };

  for (const purchase of plan.purchases) {
    spend(purchase.count * purchase.unitCost, { kind: 'purchase', colorId: purchase.colorId });
  }

  for (const step of plan.steps) {
    const overhead = (estimates.get(step.colorId)?.parents?.overheadCost ?? 0) * step.count;
    spend(overhead - step.genetons * step.count * genetonValue, {
      kind: 'crossing',
      colorId: step.colorId,
    });
  }

  return { budget, cashNeeded, affordable: worst === 0, shortfall: worst, blockedAt };
};
