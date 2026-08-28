/**
 * Transfert des jauges d'enclos vers les montures.
 *
 * Toutes les 10 secondes, une jauge cède une part de son contenu aux montures
 * de l'enclos. Le montant dépend de son **niveau courant** : plus elle est
 * pleine, plus elle débite vite.
 *
 * Deux choses à ne pas confondre, et l'erreur est facile dans les deux sens :
 *
 * 1. **Ce débit n'est pas une perte.** Les points transférés sont exactement ce
 *    qui fait progresser les montures. Le nombre de points d'un cycle est donc
 *    fixe, et le tenir bas ne fait rien économiser — cela ralentit, sans plus.
 *
 * 2. **Mais monter en palier n'est pas gratuit non plus.** Les plafonds des
 *    carburants (40 000 / 70 000 / 90 000 / 100 000) tombent exactement sur les
 *    paliers de débit : tenir une jauge à 4 pt/s exige le carburant de dernier
 *    palier, fait de ressources plus rares, donc plus cher au point.
 *
 * D'où un vrai arbitrage temps contre kamas, tranché par `bestFuelFor` : le
 * palier haut va jusqu'à quatre fois plus vite, mais se paie plus cher, et le
 * gagnant dépend de ce que vaut une heure de jeu pour le joueur.
 */

/** Une jauge d'enclos est pleine à 100 000. */
export const GAUGE_MAX = 100_000;

/**
 * Places d'un enclos.
 *
 * Décide de tout ce qui se compte en fournées : le transfert se fait au niveau
 * de l'enclos, donc dix montures préparées ensemble coûtent ce qu'en coûte une.
 */
export const ENCLOS_SLOTS = 10;

/** Intervalle entre deux transferts, en secondes. */
const TICK_SECONDS = 10;

/**
 * Paliers de transfert, du plus haut au plus bas : au-dessus de `above`, la
 * jauge cède `perTick` points toutes les dix secondes.
 */
const TRANSFER_TIERS = [
  { above: 90_000, perTick: 40 },
  { above: 70_000, perTick: 30 },
  { above: 40_000, perTick: 20 },
  { above: 0, perTick: 10 },
] as const;

/** Points transférés par seconde à un niveau de jauge donné. */
export const transferRatePerSecond = (level: number): number => {
  if (level <= 0) return 0;
  const tier = TRANSFER_TIERS.find(({ above }) => level > above);
  return (tier ?? TRANSFER_TIERS[TRANSFER_TIERS.length - 1]).perTick / TICK_SECONDS;
};

/** Le débit maximal, jauge tenue pleine — le régime à viser. */
export const MAX_TRANSFER_PER_SECOND = transferRatePerSecond(GAUGE_MAX);
export const MAX_TRANSFER_PER_HOUR = MAX_TRANSFER_PER_SECOND * 3600;

/** Le débit minimal, jauge laissée en bande basse. */
export const MIN_TRANSFER_PER_HOUR = transferRatePerSecond(1) * 3600;

/**
 * Les quatre bandes qu'un éleveur peut tenir, du plus lent au plus rapide.
 *
 * Ce sont les plafonds des carburants, et ils tombent exactement sur les paliers
 * de `TRANSFER_TIERS` : la bande n'est donc pas un réglage libre mais le choix
 * d'un rang de carburant, et `transferRatePerSecond` en donne le débit — 1, 2, 3
 * puis 4 points par seconde.
 *
 * Ordre croissant, et c'est ce qui les rend affichables telles quelles : la
 * position dans le tableau **est** le numéro de bande dont parlent les éleveurs.
 * La contrainte `check` de `gauge_cap` porte sur ces quatre valeurs.
 */
export const GAUGE_BANDS = [40_000, 70_000, 90_000, GAUGE_MAX] as const;

/**
 * La bande tenue faute de choix : la **2**, plafond 70 000.
 *
 * Ce n'est pas un milieu prudent, c'est un relevé — c'est la bande que la guilde
 * tient, et le défaut d'un réglage qu'on vient de rendre doit être ce que font
 * les gens plutôt que ce qui arrange le calcul.
 *
 * Le défaut précédent était `null`, « laisse l'arbitrage temps/kamas décider ».
 * L'option existe toujours, mais elle ne pouvait plus rien arbitrer : cet
 * arbitrage passe entièrement par `kamasPerHour`, qui vaut zéro et n'a plus de
 * contrôle depuis #94. À temps sans valeur, le moins cher au point gagne
 * toujours — donc la bande la plus lente, choisie sans l'avoir dit.
 */
export const DEFAULT_GAUGE_BAND = 70_000;

/**
 * Secondes pour qu'une jauge passe de `from` à `to` sans être rechargée.
 *
 * Palier par palier, jamais avec un débit moyen : de 100 000 à 0 les débits vont
 * de 4 à 1 point par seconde, et une moyenne fausserait tout ce qui s'y appuie.
 * Une jauge pleine met 17 h 49 à se vider entièrement.
 */
export const transferSeconds = (from: number, to = 0): number => {
  const top = Math.min(from, GAUGE_MAX);
  const bottom = Math.max(to, 0);
  if (top <= bottom) return 0;

  let seconds = 0;
  let level = top;

  for (const { above, perTick } of TRANSFER_TIERS) {
    if (level <= bottom) break;
    const floor = Math.max(above, bottom);
    if (level <= floor) continue;

    seconds += ((level - floor) / perTick) * TICK_SECONDS;
    level = floor;
  }

  return seconds;
};

/** Points transférés en partant de `from` pendant `seconds`, sans recharge. */
export const transferredPoints = (from: number, seconds: number): number => {
  let level = Math.min(from, GAUGE_MAX);
  let remaining = seconds;

  for (const { above, perTick } of TRANSFER_TIERS) {
    if (level <= 0 || remaining <= 0) break;
    if (level <= above) continue;

    const rate = perTick / TICK_SECONDS;
    const secondsInTier = (level - above) / rate;

    if (remaining < secondsInTier) {
      level -= remaining * rate;
      remaining = 0;
      break;
    }
    remaining -= secondsInTier;
    level = above;
  }

  return Math.min(from, GAUGE_MAX) - level;
};

/**
 * Heures pour transférer `points` à un débit horaire donné.
 */
export const hoursToTransfer = (points: number, pointsPerHour: number) =>
  pointsPerHour > 0 ? points / pointsPerHour : Infinity;

/**
 * Un carburant d'enclos, tel que `parseGaugeInfo` le lit sur l'item.
 *
 * `cap` est le plafond au-delà duquel ce carburant ne remplit plus — et il
 * décide de tout : les plafonds du jeu (40 000 / 70 000 / 90 000 / 100 000)
 * tombent exactement sur les paliers de débit. Tenir une jauge à 4 pt/s exige
 * donc le carburant de dernier palier, dont les ressources sont plus rares et
 * le prix par point plus élevé.
 */
export type Fuel = {
  itemId: number;
  name: string;
  /** Plafond de remplissage : 40 000, 70 000, 90 000 ou 100 000. */
  cap: number;
  /** Points rendus par unité de carburant. */
  rechargeAmount: number;
  /** Prix d'achat ou coût de craft d'une unité. */
  price: number;
};

export type FuelPlan = {
  fuel: Fuel;
  costPerPoint: number;
  pointsPerHour: number;
  hours: number;
  fuelCost: number;
  timeCost: number;
  /** Ce que coûte réellement l'opération, temps de jeu valorisé. */
  totalCost: number;
  /**
   * Les bandes traversées, du plafond le plus bas au retenu.
   *
   * Le plan n'est pas « un carburant » mais un **empilement** : `fuel` dit
   * jusqu'où on monte, `bands` dit ce qu'on paie en chemin. Elles remontent
   * jusqu'à l'appelant parce qu'un coût par point n'a plus de sens seul — voir
   * `layeredTransferCost`.
   */
  bands: FuelBand[];
};

/**
 * Le prix au point, bande par bande, du moins cher de chaque palier.
 *
 * `null` quand aucun carburant tarifé n'est connu : l'appelant retombe alors sur
 * le prix plat du relevé, qui ne sait pas distinguer les bandes.
 */
export type FuelBand = { cap: number; costPerPoint: number };

/**
 * Les bandes tarifées d'une jauge, du plafond le plus bas au plus haut.
 *
 * Une bande par plafond de carburant, au prix du moins cher qui l'atteint.
 * `forcedCap` coupe ce qui est au-dessus : le réglage dit jusqu'où l'éleveur
 * accepte de monter, donc les paliers supérieurs n'existent pas pour lui.
 */
export const bandsFor = (fuels: Fuel[], forcedCap: number | null = null): FuelBand[] => {
  const cheapest = new Map<number, number>();
  for (const fuel of fuels) {
    if (fuel.rechargeAmount <= 0 || fuel.price < 0) continue;
    if (forcedCap !== null && fuel.cap > forcedCap) continue;
    const perPoint = fuel.price / fuel.rechargeAmount;
    const known = cheapest.get(fuel.cap);
    if (known === undefined || perPoint < known) cheapest.set(fuel.cap, perPoint);
  }
  return [...cheapest]
    .map(([cap, costPerPoint]) => ({ cap, costPerPoint }))
    .sort((a, b) => a.cap - b.cap);
};

/**
 * Ce que coûte de transférer `points`, **une jauge remplie par tranches**.
 *
 * ## Le relevé qui a corrigé le modèle
 *
 * L'éleveur, le 28/08 : « je la remplis en une fois : 40 000 points de niveau 0
 * et 30 000 points de niveau 1 ». Un carburant ne remplit que jusqu'à son
 * plafond — c'est ce que `Fuel.cap` dit déjà — donc atteindre 70 000 demande le
 * carburant de bande 0 pour les 40 000 premiers points, puis celui de bande 1
 * pour les 30 000 suivants. Les deux prix au point sont différents, et le second
 * est le plus cher.
 *
 * Le calcul facturait `points × costPerPoint` d'**un seul** carburant, celui que
 * `bestFuelFor` retenait. Une montée de 34 365 points — le niveau 50 — était donc
 * chiffrée au tarif du palier haut alors qu'elle tient entière dans le bas ; et
 * une montée de 67 942 — le niveau 67 — au même tarif alors qu'elle n'y déborde
 * que de 27 942. Le coût était **linéaire** là où il est convexe, ce qui rend les
 * petites montées trop chères et les grandes trop bon marché, l'une par rapport à
 * l'autre.
 *
 * ## Au-delà d'un remplissage
 *
 * La jauge se vide et se recharge : au-dessus du plafond le plus haut, on paie
 * autant de remplissages entiers que nécessaire, plus le reste. Le prix moyen au
 * point y redevient donc constant — c'est seulement **à l'intérieur** d'un
 * remplissage que la convexité se voit. Elle s'y voit d'autant plus que
 * `pointsCap` impose une fournée à un seul remplissage.
 *
 * ## Ce que ce modèle suppose, et qui n'est pas neutre
 *
 * Qu'on remplit **depuis vide**. Un éleveur qui maintiendrait sa jauge en haut de
 * plage — le régime que `bestFuelFor` suppose pour le **débit** — rachèterait
 * toujours du carburant de palier haut, et paierait tout au prix fort. Les deux
 * régimes sont réels ; celui-ci est celui qui a été relevé.
 */
export const layeredTransferCost = (points: number, bands: FuelBand[]): number | null => {
  if (bands.length === 0 || points <= 0) return bands.length === 0 ? null : 0;

  /** Le coût d'un remplissage complet, du vide jusqu'au plafond le plus haut. */
  const sliceCost = (upTo: number): number => {
    let spent = 0;
    let floor = 0;
    for (const band of bands) {
      const slice = Math.min(upTo, band.cap) - floor;
      if (slice > 0) spent += slice * band.costPerPoint;
      floor = band.cap;
      if (upTo <= band.cap) break;
    }
    // Au-dessus du plafond le plus haut, le dernier prix continue de s'appliquer :
    // c'est le seul carburant qui remplit encore.
    if (upTo > floor) spent += (upTo - floor) * bands[bands.length - 1].costPerPoint;
    return spent;
  };

  const ceiling = bands[bands.length - 1].cap;
  const fillings = Math.floor(points / ceiling);
  return fillings * sliceCost(ceiling) + sliceCost(points - fillings * ceiling);
};

/**
 * Le carburant qui minimise le coût total pour transférer `points`.
 *
 * L'arbitrage est réel dans les deux sens : monter en palier multiplie le débit
 * par quatre au plus, mais les carburants hauts se paient plus cher au point.
 * Le gagnant dépend donc de `kamasPerHour` — à temps sans valeur le palier bas
 * gagne toujours, à temps cher le palier haut.
 *
 * On suppose la jauge tenue dans le haut de la plage du carburant retenu,
 * c'est-à-dire rechargée dès qu'elle décroche : c'est ce que veut dire
 * « utiliser ce palier », et c'est le seul régime où son débit est celui-là.
 */
export const bestFuelFor = (
  points: number,
  fuels: Fuel[],
  kamasPerHour: number,
  /**
   * Plafond imposé, ou `null` pour laisser l'arbitrage décider.
   *
   * Convertir son temps en kamas ne parle pas à tout le monde : on peut vouloir
   * aller vite parce qu'on a peu de sessions, ou lentement parce qu'on laisse
   * tourner. Fixer le palier court-circuite alors `kamasPerHour`.
   */
  forcedCap: number | null = null
): FuelPlan | null => {
  let best: FuelPlan | null = null;
  const eligible = forcedCap === null ? fuels : fuels.filter((fuel) => fuel.cap === forcedCap);

  for (const fuel of eligible) {
    if (fuel.rechargeAmount <= 0 || fuel.price < 0) continue;

    // Le palier retenu dit **jusqu'où** on monte la jauge, pas à quel prix on
    // remplit tout : les points sous 40 000 se paient au carburant de bande 0,
    // qu'on vise 70 000 ou non. Voir `layeredTransferCost` — le calcul facturait
    // `points × costPerPoint` du seul carburant retenu, ce qui surfacture de 55 %
    // une montée qui tient dans la bande basse.
    const bands = bandsFor(fuels, fuel.cap);
    const costPerPoint = fuel.price / fuel.rechargeAmount;
    const pointsPerHour = transferRatePerSecond(fuel.cap) * 3600;
    const hours = hoursToTransfer(points, pointsPerHour);
    const fuelCost = layeredTransferCost(points, bands) ?? points * costPerPoint;
    const timeCost = hours * kamasPerHour;
    const totalCost = fuelCost + timeCost;

    if (!best || totalCost < best.totalCost) {
      best = { fuel, costPerPoint, pointsPerHour, hours, fuelCost, timeCost, totalCost, bands };
    }
  }

  return best;
};

/**
 * Coût en kamas de `points` transférés à des montures.
 *
 * Ne dépend ni du niveau de la jauge ni du nombre de montures : la
 * consommation se fait au niveau de l'enclos, et les 10 places profitent du
 * même transfert. Un enclos à moitié vide coûte donc deux fois plus **par
 * monture** — c'est le seul vrai gaspillage du système.
 */
export const transferCost = (points: number, costPerPoint: number) => points * costPerPoint;

/**
 * Points à transférer pour amener une monture de fertile à féconde.
 *
 * La séquence tient à la limite de **deux jauges actives** : on ne peut pas
 * monter les trois stats de front, il faut les enchaîner en pilotant la
 * sérénité, qui décide laquelle progresse.
 *
 * 1. Aligner la sérénité à ±5000 (Baffeur ou Caresseur) — elle couvre une plage
 *    de 10 000, d'où le montant : environ un point de jauge par point de
 *    sérénité.
 * 2. Monter la première stat à l'extrême : Foudroyeur à −5000, Dragofesse à
 *    +5000.
 * 3. Ramener la sérénité à ±1, soit les 5 000 du retour plus une marge.
 * 4. Sérénité au centre, les **deux** dernières stats montent ensemble — c'est
 *    là que les deux emplacements servent enfin en parallèle.
 *
 * La Mangeoire tourne en plus, pour l'XP, et ne fait pas partie de ce total :
 * son montant dépend du niveau visé (voir `mountXpForLevel`).
 */
export const CYCLE_STEPS = [
  { step: 'Aligner la sérénité à ±5000', gauge: 'Baffeur/Caresseur', points: 10_000 },
  { step: 'Monter la première stat', gauge: 'Foudroyeur ou Dragofesse', points: 20_000 },
  { step: 'Ramener la sérénité à ±1', gauge: 'Caresseur/Baffeur', points: 5_010 },
  // 20 000 par stat restante, comme la première.
  { step: 'Monter les deux dernières stats', gauge: 'les 2 restantes', points: 40_000 },
] as const;

/**
 * Points d'un cycle de fécondité complet, Mangeoire exclue.
 *
 * Les quatre montants sont relevés en jeu. La dernière étape vaut 20 000 par
 * stat restante, soit les mêmes 20 000 que la première : les trois jauges de
 * stat coûtent donc autant l'une que l'autre.
 */
export const CYCLE_POINTS = CYCLE_STEPS.reduce((total, { points }) => total + points, 0);

/**
 * Coût en kamas d'un cycle de fécondité, ramené à une monture.
 *
 * L'enclos transfère à ses 10 places à la fois : le coût par monture se divise
 * donc par l'effectif réellement présent. Un enclos à 5 montures revient au
 * double par tête.
 */
export const cyclePointsCostPerMount = (costPerPoint: number, mountsInEnclos = 10) =>
  mountsInEnclos > 0 ? (CYCLE_POINTS * costPerPoint) / mountsInEnclos : Infinity;
