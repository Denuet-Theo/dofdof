import { toNumber } from '@/lib/supabase/types';
import type { DofusDBItem, ItemPrice } from '@/lib/supabase/types';
import { parseGaugeInfo } from '@/lib/utils/gauges';
import {
  bestFuelFor,
  transferRatePerSecond,
  CYCLE_STEPS,
  GAUGE_MAX,
  type Fuel,
  type FuelPlan,
} from './enclos';
import {
  bestCaptureNet,
  mountXpForLevel,
  MAX_MOUNT_LEVEL,
  type CaptureChoice,
  type CaptureNet,
} from './costs';

/**
 * Traduit le catalogue en coûts exploitables par le calcul d'élevage.
 *
 * Les deux consommables de l'élevage vivent déjà dans le miroir DofusDB, avec
 * leurs prix dans `item_prices` : les **carburants d'enclos** (typeId 326, six
 * jauges × vingt paliers) et les **filets de capture** (typeId 99). Il ne reste
 * qu'à les lire correctement — d'où ce module, qui ne calcule rien de nouveau
 * mais évite que la page invente des constantes.
 */

/** Le type d'item des carburants d'enclos, toutes jauges confondues. */
export const FUEL_TYPE_ID = 326;

/**
 * Points de jauge obtenus par kama dépensé, jauge par jauge.
 *
 * Relevés par l'éleveur sur ses propres achats, et non déduits du catalogue :
 * ils intègrent le carburant qu'il utilise réellement et le prix auquel il
 * l'obtient, ce que `item_prices` ne dit pas tant que les 120 carburants ne sont
 * pas tarifés un par un.
 *
 * Ils servent de **repli**, jamais de surcharge : dès qu'une jauge a un
 * carburant tarifé, c'est lui qui décide, puisqu'il porte en plus le palier et
 * donc le débit. Sans ce repli, un éleveur qui n'a rien tarifé n'obtenait aucun
 * coût de cycle, donc aucune durée, donc aucun objectif chiffrable — c'est-à-dire
 * l'état dans lequel on découvre la page.
 *
 * Recoupés contre le modèle du cycle : ils redonnent **exactement** les 7 253
 * kamas par monture que le tableur impute aux cinq jauges de stat et de
 * sérénité, une fois les 75 010 points de `CYCLE_POINTS` partagés sur les dix
 * places d'un enclos.
 *
 * Le cycle complet en ressort à 15 853 kamas pour des parents niveau 67, là où
 * le tableur dit 15 734. L'écart tient entier dans la Mangeoire : le tableur y
 * met 67 000 points ronds quand `mountXpForLevel(67)` en demande 67 942. C'est
 * la courbe d'XP qui tranche, pas l'arrondi.
 */
export const DEFAULT_POINTS_PER_KAMA: Record<string, number> = {
  Baffeur: 5.62,
  Caresseur: 0.89,
  Dragofesse: 0.85,
  Foudroyeur: 1.34,
  Abreuvoir: 0.75,
  Mangeoire: 0.79,
};

/**
 * Les carburants d'une jauge donnée, prêts pour `bestFuelFor`.
 *
 * Le plafond vient de la description de l'item (« sans dépasser 90 000 »), que
 * `parseGaugeInfo` sait déjà lire — c'est lui qui décide du débit accessible,
 * les plafonds du jeu tombant sur les paliers de transfert.
 *
 * Les items sans prix sont écartés plutôt que comptés gratuits : un carburant à
 * zéro raflerait tous les arbitrages en paraissant offert.
 */
export const fuelsByGauge = (
  items: DofusDBItem[],
  prices: Map<number, ItemPrice>
): Map<string, Fuel[]> => {
  const byGauge = new Map<string, Fuel[]>();

  for (const item of items) {
    const info = parseGaugeInfo(item);
    if (!info || info.rechargeAmount <= 0) continue;

    const price = toNumber(prices.get(item.id)?.price);
    if (price <= 0) continue;

    const fuel: Fuel = {
      itemId: item.id,
      name: item.name?.fr ?? String(item.id),
      // Les Élixirs n'ont pas de clause « sans dépasser » : `parseGaugeInfo`
      // retombe alors sur la quantité rechargée, ce qui les ferait passer pour
      // le palier le plus lent alors qu'ils sont les seuls **sans plafond**.
      // Un carburant qui ne remplirait que jusqu'à ce qu'il verse n'aurait
      // d'ailleurs aucun sens.
      cap: info.capAmount === info.rechargeAmount ? GAUGE_MAX : info.capAmount,
      rechargeAmount: info.rechargeAmount,
      price,
    };

    const current = byGauge.get(info.gaugeName);
    if (current) current.push(fuel);
    else byGauge.set(info.gaugeName, [fuel]);
  }

  return byGauge;
};

/**
 * Le plan de repli d'une jauge, bâti sur `DEFAULT_POINTS_PER_KAMA`.
 *
 * Le prix au point vient du relevé ; le **débit**, lui, n'en vient pas — un prix
 * ne dit pas à quel palier on tient la jauge. On retient donc le plafond imposé
 * s'il y en a un, et le palier haut sinon, qui est le régime que vise un éleveur
 * qui ne veut pas attendre. C'est une hypothèse, et elle ne porte que sur la
 * durée : le coût, lui, est celui du relevé.
 */
const fallbackPlanFor = (
  gauge: string,
  points: number,
  kamasPerHour: number,
  forcedCap: number | null
): FuelPlan | null => {
  const pointsPerKama = DEFAULT_POINTS_PER_KAMA[gauge];
  if (!pointsPerKama || pointsPerKama <= 0) return null;

  const cap = forcedCap ?? GAUGE_MAX;
  const costPerPoint = 1 / pointsPerKama;
  const pointsPerHour = transferRatePerSecond(cap) * 3600;
  const hours = pointsPerHour > 0 ? points / pointsPerHour : Infinity;
  const fuelCost = points * costPerPoint;

  return {
    // Aucun item derrière ce plan : le nom le dit plutôt que d'en inventer un,
    // puisqu'il remonte tel quel dans « quel carburant racheter ».
    fuel: { itemId: -1, name: `${gauge} (prix relevé)`, cap, rechargeAmount: 1, price: costPerPoint },
    costPerPoint,
    pointsPerHour,
    hours,
    fuelCost,
    timeCost: hours * kamasPerHour,
    totalCost: fuelCost + hours * kamasPerHour,
  };
};

/**
 * Le plan de carburant d'une jauge : coût **et** durée.
 *
 * Les carburants tarifés l'emportent toujours : eux seuls portent le palier réel.
 * Le repli n'intervient que faute de plan chiffrable.
 *
 * Le test porte sur le **résultat** de `bestFuelFor` et non sur la présence de
 * carburants, et c'est tout l'objet du correctif : une jauge peut avoir des
 * carburants tarifés sans qu'aucun soit retenu — un plafond imposé qu'aucun
 * palier disponible n'atteint suffit. On repartait alors sans plan du tout,
 * `complete` passait à `false`, et **toutes les durées de la page
 * disparaissaient**. Le classement par coût continuait de fonctionner, celui
 * « au plus vite » n'avait plus rien à trier, et l'écran annonçait qu'aucune
 * route n'existait.
 */
const planFor = (
  gauge: string,
  fuels: Fuel[] | undefined,
  points: number,
  kamasPerHour: number,
  forcedCap: number | null
) =>
  (fuels && fuels.length > 0 ? bestFuelFor(points, fuels, kamasPerHour, forcedCap) : null) ??
  fallbackPlanFor(gauge, points, kamasPerHour, forcedCap);

export type SupplyCosts = {
  /**
   * Coût du cycle de fécondité, ramené à une monture de l'enclos.
   *
   * Un accouplement en demande deux — un par parent, tous deux rendus jauges à
   * zéro. Le doublement se fait chez l'appelant, au croisement.
   */
  fuelCostPerCycle: number | null;
  /**
   * Ce que coûte **un point d'expérience sur une monture**, et non un point de
   * jauge : le rapport est de un à dix.
   *
   * La Mangeoire se comporte comme les autres jauges — elle alimente les dix
   * places de l'enclos d'un coup. Monter dix montures d'un niveau coûte donc
   * autant qu'en monter une, et la dépense se partage.
   *
   * Le nom porte la distinction parce que la confondre avec le prix du point de
   * jauge surfacturait la montée d'un facteur dix, ce qui poussait l'optimiseur
   * vers des parents de niveau 5 là où le 26 était moins cher. Le prix du point
   * de jauge, lui, vit sur `mangeoire.costPerPoint` — c'est celui qu'on paie en
   * carburant.
   */
  mangeoireCostPerMountPoint: number | null;
  /**
   * Heures d'enclos pour amener **une fournée** de montures à la fécondité.
   *
   * C'est un temps par enclos et non par monture : le transfert profite aux dix
   * places à la fois, donc dix montures deviennent fécondes en même temps
   * qu'une seule.
   */
  cycleHours: number | null;
  /**
   * Heures du cycle pendant lesquelles le **second emplacement de jauge reste
   * libre**, et peut donc porter la Mangeoire sans rien rallonger.
   *
   * Trois des quatre étapes ne sollicitent qu'une jauge : l'XP s'y glisse
   * gratuitement. C'est ce qui empêche de compter naïvement montée et cycle
   * comme deux durées à additionner.
   *
   * Confirmé en jeu : la Mangeoire tourne bien en même temps qu'une jauge de
   * stat.
   */
  cycleFreeSlotHours: number | null;
  /** Heures de Mangeoire pour monter une monture au niveau 200. */
  levelUpHours: number | null;
  /**
   * Débit de la Mangeoire une fois le carburant choisi, pour chiffrer la montée
   * à **n'importe quel** niveau et pas seulement au 200.
   *
   * Le carburant retenu ne dépend pas du nombre de points visé : coût et durée
   * y sont tous deux proportionnels, donc le classement des carburants entre eux
   * est le même à 1 000 points qu'à 900 000. Ce débit est donc réutilisable tel
   * quel pour un niveau intermédiaire.
   */
  mangeoirePointsPerHour: number | null;
  /**
   * Le **plafond d'un remplissage** de Mangeoire, lu sur le carburant retenu.
   *
   * Les carburants portent leur plafond dans leur description — « sans dépasser
   * 90 000 » — et ces plafonds sont exactement les paliers de `GAUGE_BANDS` :
   * 40 000, 70 000, 90 000, puis le maximum. Ce n'est donc pas un réglage libre
   * mais le rang du carburant qu'on tient.
   *
   * **C'est une contrainte dure sur le niveau atteignable en une visite.** Le
   * niveau 100 réclame 172 668 points : à un plafond de 70 000 il faut trois
   * remplissages, donc trois passages. Pour un éleveur qui vient une fois par
   * jour, ça n'est pas « le niveau 100 coûte plus cher », c'est « le niveau 100
   * n'existe pas dans une fournée ».
   */
  mangeoirePointsCap: number | null;
  /** Le carburant de Mangeoire retenu, pour dire lequel acheter. */
  mangeoireFuel: string | null;
  /**
   * Points de Mangeoire qu'un cycle absorbe **sans rien rallonger**, en logeant
   * l'XP dans l'emplacement de jauge que les étapes à une seule stat laissent
   * libre.
   *
   * Vaut 35 010 quand cycle et Mangeoire tournent au même palier — soit
   * exactement les trois étapes solitaires — et le rapport des débits l'écarte
   * de cette valeur sinon. C'est ce qui pose le plancher du niveau des parents.
   */
  freeXpPoints: number | null;
  /**
   * Ce qu'un cycle de fécondité demande à chaque jauge, et à quel prix au point.
   *
   * Les points, et non les kamas : c'est en points qu'un stock de carburant se
   * convertit, et une unité d'Élixir vaut huit unités d'Extrait. Compter en
   * kamas obligerait à supposer que l'éleveur rachètera le même carburant que
   * celui qu'il a en réserve.
   *
   * Par fournée d'enclos, pas par monture : le transfert profite aux dix places
   * à la fois.
   */
  cycleGauges: { gauge: string; pointsPerBatch: number; costPerPoint: number; fuel: string }[];
  /** Le carburant de Mangeoire, sous la même forme que les jauges de cycle. */
  mangeoire: { gauge: string; costPerPoint: number; fuel: string } | null;
  /** Coût complet d'une monture sauvage capturée, filet et combat compris. */
  capture: CaptureChoice | null;
  /** Les jauges dont aucun carburant n'est tarifé — donc le calcul incomplet. */
  missingGauges: string[];
};

/**
 * Le cycle de fécondité, découpé en **phases** plutôt qu'en jauges.
 *
 * La distinction décide de la durée : les jauges d'une même phase tournent
 * ensemble, donc leurs coûts s'additionnent mais leurs durées non — la phase dure
 * ce que dure sa jauge la plus lente. Additionner les cinq legs surestimerait le
 * cycle de la dernière étape entière, qui est justement la seule à occuper les
 * deux emplacements en parallèle. Confirmé en jeu : le cycle complet prend
 * 15 h 17 au palier Extrait, et non les 20 h 50 d'un enchaînement séquentiel.
 *
 * Chaque leg peut passer par l'une ou l'autre jauge selon le sens choisi
 * (Baffeur ou Caresseur, Foudroyeur ou Dragofesse) : rien n'impose le sens, donc
 * on retient la moins chère — mais **une jauge déjà employée ne se repropose
 * pas**. C'est ce qui manquait : la sérénité monte avec une jauge et redescend
 * avec l'autre, on ne peut pas prendre deux fois la même ; et les trois stats se
 * montent chacune avec la sienne. Sans cette exclusion, le Foudroyeur seul
 * couvrait les trois legs de stat dès qu'il était le moins cher, et le cycle
 * ressortait à deux tiers de son prix.
 *
 * L'attribution gloutonne, dans l'ordre des legs, est ici optimale : les trois
 * legs de stat pèsent le même nombre de points, donc leur coût total ne dépend
 * pas de l'ordre, et les deux legs de sérénité étant de tailles différentes, la
 * jauge la moins chère doit aller au plus gros — ce que donne le parcours dans
 * l'ordre.
 */
const CYCLE_PHASES: { points: number; candidates: string[] }[][] = [
  [{ points: CYCLE_STEPS[0].points, candidates: ['Baffeur', 'Caresseur'] }],
  [{ points: CYCLE_STEPS[1].points, candidates: ['Foudroyeur', 'Dragofesse'] }],
  [{ points: CYCLE_STEPS[2].points, candidates: ['Caresseur', 'Baffeur'] }],
  // Les deux dernières stats montent ensemble : les trois jauges de stat sont
  // sollicitées sur l'ensemble du cycle, on répartit sur celles qui restent.
  [
    { points: CYCLE_STEPS[3].points / 2, candidates: ['Foudroyeur', 'Dragofesse', 'Abreuvoir'] },
    { points: CYCLE_STEPS[3].points / 2, candidates: ['Abreuvoir', 'Dragofesse', 'Foudroyeur'] },
  ],
];

/** Emplacements de jauge active par enclos. */
const GAUGE_SLOTS = 2;

export const computeSupplyCosts = (
  fuelItems: DofusDBItem[],
  netItems: CaptureNet[],
  prices: Map<number, ItemPrice>,
  {
    kamasPerHour,
    minutesPerFight,
    netRecoveryRate,
    mountsInEnclos,
    gaugeCap,
    countNetCost = true,
  }: {
    kamasPerHour: number;
    minutesPerFight: number;
    netRecoveryRate: number;
    mountsInEnclos: number;
    gaugeCap: number | null;
    /** Compter le prix des filets, ou ne facturer que le temps de combat. */
    countNetCost?: boolean;
  }
): SupplyCosts => {
  const byGauge = fuelsByGauge(fuelItems, prices);
  const missingGauges: string[] = [];

  let cycleCost = 0;
  let cycleHours = 0;
  let cycleFreeSlotHours = 0;
  let complete = true;
  /** Points demandés à chaque jauge sur un cycle, cumulés phase par phase. */
  const cycleGauges = new Map<string, { pointsPerBatch: number; costPerPoint: number; fuel: string }>();

  /**
   * Les jauges déjà employées dans ce cycle.
   *
   * Une jauge ne sert qu'une fois : la sérénité monte avec l'une et redescend
   * avec l'autre, et chaque stat a la sienne. Sans ce jeu d'exclusion, la moins
   * chère raflait tous les legs et le cycle ressortait à deux tiers de son prix.
   */
  const used = new Set<string>();

  for (const phase of CYCLE_PHASES) {
    let phaseHours = 0;

    for (const { points, candidates } of phase) {
      const plans = candidates
        .filter((gauge) => !used.has(gauge))
        .map((gauge) => {
          const plan = planFor(gauge, byGauge.get(gauge), points, kamasPerHour, gaugeCap);
          return plan ? { gauge, plan } : null;
        })
        .filter((entry): entry is { gauge: string; plan: NonNullable<ReturnType<typeof planFor>> } =>
          entry !== null
        );

      // Une jauge servie par le repli reste signalée : le chiffre tient, mais il
      // vient d'un relevé et non du cours du jour, et l'éleveur doit le savoir.
      for (const gauge of candidates) {
        if (!byGauge.has(gauge) && !missingGauges.includes(gauge)) missingGauges.push(gauge);
      }

      if (plans.length === 0) {
        complete = false;
        continue;
      }

      const cheapest = plans.reduce((best, entry) =>
        entry.plan.totalCost < best.plan.totalCost ? entry : best
      );
      used.add(cheapest.gauge);
      cycleCost += cheapest.plan.fuelCost;

      // Une jauge peut servir à plusieurs phases (la sérénité monte puis
      // redescend) : les points s'y cumulent.
      const current = cycleGauges.get(cheapest.gauge);
      cycleGauges.set(cheapest.gauge, {
        pointsPerBatch: (current?.pointsPerBatch ?? 0) + points,
        costPerPoint: cheapest.plan.costPerPoint,
        fuel: cheapest.plan.fuel.name,
      });

      // Les jauges d'une même phase tournent ensemble : la phase dure ce que
      // dure la plus lente, pas la somme des deux.
      phaseHours = Math.max(phaseHours, cheapest.plan.hours);
    }

    // Les phases, elles, s'enchaînent : deux emplacements ne suffisent pas à
    // mener les trois stats de front, il faut piloter la sérénité entre chaque.
    cycleHours += phaseHours;
    // Une phase qui n'occupe qu'un emplacement laisse l'autre à la Mangeoire.
    if (phase.length < GAUGE_SLOTS) cycleFreeSlotHours += phaseHours;
  }

  const mangeoirePoints = mountXpForLevel(MAX_MOUNT_LEVEL);
  const mangeoirePlan = planFor(
    'Mangeoire',
    byGauge.get('Mangeoire'),
    mangeoirePoints,
    kamasPerHour,
    gaugeCap
  );
  if (!byGauge.has('Mangeoire') && !missingGauges.includes('Mangeoire')) {
    missingGauges.push('Mangeoire');
  }

  return {
    // Un enclos transfère à ses dix places d'un coup : le cycle se partage.
    fuelCostPerCycle: complete && mountsInEnclos > 0 ? cycleCost / mountsInEnclos : null,
    // Divisé par l'effectif, comme le cycle juste au-dessus : la Mangeoire monte
    // les dix places ensemble. Sans cette division, la montée revenait dix fois
    // son prix — et c'est elle qui décide du niveau des parents.
    mangeoireCostPerMountPoint:
      mangeoirePlan && mountsInEnclos > 0
        ? mangeoirePlan.fuelCost / mangeoirePoints / mountsInEnclos
        : null,
    cycleHours: complete ? cycleHours : null,
    cycleFreeSlotHours: complete ? cycleFreeSlotHours : null,
    levelUpHours: mangeoirePlan?.hours ?? null,
    mangeoirePointsPerHour: mangeoirePlan?.pointsPerHour ?? null,
    mangeoirePointsCap: mangeoirePlan?.fuel.cap ?? null,
    mangeoireFuel: mangeoirePlan?.fuel.name ?? null,
    // Les heures libres du cycle, converties au débit de la Mangeoire.
    freeXpPoints:
      complete && mangeoirePlan ? cycleFreeSlotHours * mangeoirePlan.pointsPerHour : null,
    cycleGauges: [...cycleGauges].map(([gauge, usage]) => ({ gauge, ...usage })),
    mangeoire: mangeoirePlan
      ? {
          gauge: 'Mangeoire',
          costPerPoint: mangeoirePlan.costPerPoint,
          fuel: mangeoirePlan.fuel.name,
        }
      : null,
    capture: bestCaptureNet(netItems, {
      netCosts: new Map(
        // -1 = pas de ligne de prix, et il faut le distinguer d'un prix **nul** :
        // le repli de `toNumber` ne vaut que pour l'absence, pas pour un zéro saisi.
        netItems.map((net) => [net.id, toNumber(prices.get(net.id)?.price, -1)] as const)
      ),
      recoveryRate: netRecoveryRate,
      minutesPerFight,
      kamasPerHour,
      countNetCost,
    }),
    missingGauges,
  };
};
