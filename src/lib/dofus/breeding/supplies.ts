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

/** Le coût d'un point sur une jauge, au meilleur carburant compte tenu du temps. */
const costPerPointOf = (fuels: Fuel[] | undefined, points: number, kamasPerHour: number) => {
  if (!fuels || fuels.length === 0) return null;
  const plan = bestFuelFor(points, fuels, kamasPerHour);
  return plan ? plan.totalCost / points : null;
};

export type SupplyCosts = {
  /** Coût du cycle de fécondité, ramené à une monture de l'enclos. */
  fuelCostPerBaby: number | null;
  /** Coût d'un point de Mangeoire, qui chiffre la montée en niveau. */
  mangeoireCostPerPoint: number | null;
  /** Coût complet d'une monture sauvage capturée, filet et combat compris. */
  capture: CaptureChoice | null;
  /** Les jauges dont aucun carburant n'est tarifé — donc le calcul incomplet. */
  missingGauges: string[];
};

/**
 * Les jauges qu'un cycle de fécondité sollicite, et pour combien de points.
 *
 * Chaque étape peut passer par l'une ou l'autre jauge selon le sens choisi
 * (Baffeur ou Caresseur, Foudroyeur ou Dragofesse) : on retient la moins chère,
 * puisque le cycle est symétrique et que rien n'impose le sens.
 */
const CYCLE_GAUGES: { points: number; candidates: string[] }[] = [
  { points: CYCLE_STEPS[0].points, candidates: ['Baffeur', 'Caresseur'] },
  { points: CYCLE_STEPS[1].points, candidates: ['Foudroyeur', 'Dragofesse'] },
  { points: CYCLE_STEPS[2].points, candidates: ['Caresseur', 'Baffeur'] },
  // Les deux dernières stats montent ensemble : les trois jauges de stat sont
  // sollicitées sur l'ensemble du cycle, on répartit sur celles qui restent.
  { points: CYCLE_STEPS[3].points / 2, candidates: ['Foudroyeur', 'Dragofesse', 'Abreuvoir'] },
  { points: CYCLE_STEPS[3].points / 2, candidates: ['Abreuvoir', 'Dragofesse', 'Foudroyeur'] },
];

export const computeSupplyCosts = (
  fuelItems: DofusDBItem[],
  netItems: CaptureNet[],
  prices: Map<number, ItemPrice>,
  {
    kamasPerHour,
    minutesPerFight,
    netRecoveryRate,
    mountsInEnclos,
  }: {
    kamasPerHour: number;
    minutesPerFight: number;
    netRecoveryRate: number;
    mountsInEnclos: number;
  }
): SupplyCosts => {
  const byGauge = fuelsByGauge(fuelItems, prices);
  const missingGauges: string[] = [];

  let cycleCost = 0;
  let complete = true;

  for (const { points, candidates } of CYCLE_GAUGES) {
    const costs = candidates
      .map((gauge) => costPerPointOf(byGauge.get(gauge), points, kamasPerHour))
      .filter((cost): cost is number => cost !== null);

    if (costs.length === 0) {
      complete = false;
      for (const gauge of candidates) {
        if (!byGauge.has(gauge) && !missingGauges.includes(gauge)) missingGauges.push(gauge);
      }
      continue;
    }
    cycleCost += points * Math.min(...costs);
  }

  const mangeoirePoints = mountXpForLevel(MAX_MOUNT_LEVEL);
  const mangeoireCostPerPoint = costPerPointOf(
    byGauge.get('Mangeoire'),
    mangeoirePoints,
    kamasPerHour
  );
  if (mangeoireCostPerPoint === null && !missingGauges.includes('Mangeoire')) {
    missingGauges.push('Mangeoire');
  }

  return {
    // Un enclos transfère à ses dix places d'un coup : le cycle se partage.
    fuelCostPerBaby: complete && mountsInEnclos > 0 ? cycleCost / mountsInEnclos : null,
    mangeoireCostPerPoint,
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
