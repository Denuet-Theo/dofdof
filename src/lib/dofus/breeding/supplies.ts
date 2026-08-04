import type { DofusDBItem, ItemPrice } from '@/lib/supabase/types';
import { parseGaugeInfo } from '@/lib/utils/gauges';
import { bestFuelFor, CYCLE_STEPS, GAUGE_MAX, type Fuel } from './enclos';
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

    const price = prices.get(item.id)?.price ?? 0;
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

/** Le plan de carburant d'une jauge : coût **et** durée. */
const planFor = (
  fuels: Fuel[] | undefined,
  points: number,
  kamasPerHour: number,
  forcedCap: number | null
) => (fuels && fuels.length > 0 ? bestFuelFor(points, fuels, kamasPerHour, forcedCap) : null);

export type SupplyCosts = {
  /** Coût du cycle de fécondité, ramené à une monture de l'enclos. */
  fuelCostPerBaby: number | null;
  /** Coût d'un point de Mangeoire, qui chiffre la montée en niveau. */
  mangeoireCostPerPoint: number | null;
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
  /** Le carburant de Mangeoire retenu, pour dire lequel acheter. */
  mangeoireFuel: string | null;
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
 * deux emplacements en parallèle.
 *
 * Chaque leg peut passer par l'une ou l'autre jauge selon le sens choisi
 * (Baffeur ou Caresseur, Foudroyeur ou Dragofesse) : on retient la moins chère,
 * puisque le cycle est symétrique et que rien n'impose le sens.
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
  }: {
    kamasPerHour: number;
    minutesPerFight: number;
    netRecoveryRate: number;
    mountsInEnclos: number;
    gaugeCap: number | null;
  }
): SupplyCosts => {
  const byGauge = fuelsByGauge(fuelItems, prices);
  const missingGauges: string[] = [];

  let cycleCost = 0;
  let cycleHours = 0;
  let cycleFreeSlotHours = 0;
  let complete = true;

  for (const phase of CYCLE_PHASES) {
    let phaseHours = 0;

    for (const { points, candidates } of phase) {
      const plans = candidates
        .map((gauge) => planFor(byGauge.get(gauge), points, kamasPerHour, gaugeCap))
        .filter((plan): plan is NonNullable<typeof plan> => plan !== null);

      if (plans.length === 0) {
        complete = false;
        for (const gauge of candidates) {
          if (!byGauge.has(gauge) && !missingGauges.includes(gauge)) missingGauges.push(gauge);
        }
        continue;
      }

      const cheapest = plans.reduce((best, plan) =>
        plan.totalCost < best.totalCost ? plan : best
      );
      cycleCost += cheapest.fuelCost;
      // Les jauges d'une même phase tournent ensemble : la phase dure ce que
      // dure la plus lente, pas la somme des deux.
      phaseHours = Math.max(phaseHours, cheapest.hours);
    }

    // Les phases, elles, s'enchaînent : deux emplacements ne suffisent pas à
    // mener les trois stats de front, il faut piloter la sérénité entre chaque.
    cycleHours += phaseHours;
    // Une phase qui n'occupe qu'un emplacement laisse l'autre à la Mangeoire.
    if (phase.length < GAUGE_SLOTS) cycleFreeSlotHours += phaseHours;
  }

  const mangeoirePoints = mountXpForLevel(MAX_MOUNT_LEVEL);
  const mangeoirePlan = planFor(byGauge.get('Mangeoire'), mangeoirePoints, kamasPerHour, gaugeCap);
  if (mangeoirePlan === null && !missingGauges.includes('Mangeoire')) {
    missingGauges.push('Mangeoire');
  }

  return {
    // Un enclos transfère à ses dix places d'un coup : le cycle se partage.
    fuelCostPerBaby: complete && mountsInEnclos > 0 ? cycleCost / mountsInEnclos : null,
    mangeoireCostPerPoint: mangeoirePlan ? mangeoirePlan.fuelCost / mangeoirePoints : null,
    cycleHours: complete ? cycleHours : null,
    cycleFreeSlotHours: complete ? cycleFreeSlotHours : null,
    levelUpHours: mangeoirePlan?.hours ?? null,
    mangeoirePointsPerHour: mangeoirePlan?.pointsPerHour ?? null,
    mangeoireFuel: mangeoirePlan?.fuel.name ?? null,
    capture: bestCaptureNet(netItems, {
      netCosts: new Map(
        netItems.map((net) => [net.id, prices.get(net.id)?.price ?? -1] as const)
      ),
      recoveryRate: netRecoveryRate,
      minutesPerFight,
      kamasPerHour,
    }),
    missingGauges,
  };
};
