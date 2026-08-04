'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  BreedingColorPrice,
  DofusDBItem,
  DofusDBResponse,
  ItemPrice,
  UserBreedingSettings,
} from '@/lib/supabase/types';
import { computeSupplyCosts, FUEL_TYPE_ID } from '@/lib/dofus/breeding/supplies';
import {
  BREEDING_FAMILIES,
  GENETON_ITEM,
  GENETON_EXCHANGE,
  findFamily,
} from '@/lib/dofus/breeding/trees';
import {
  computeBreedingCosts,
  bestGenetonValue,
  breedingPlan,
  planDuration,
  MAX_MOUNT_LEVEL,
  type BreedingEstimate,
  type BreedingPlan,
  type ColorPrice,
  type EnclosTiming,
  type PlanDuration,
} from '@/lib/dofus/breeding/costs';

/**
 * Assemble les trois sources dont le classement d'élevage a besoin : les arbres
 * figés, les prix de couleurs partagés, et les réglages privés de l'éleveur.
 *
 * Le calcul lui-même reste dans `costs.ts`, pur et testable. Ce hook ne fait que
 * l'alimenter et mémoriser le résultat.
 */

export type FamilyId = 'dragodinde' | 'muldo' | 'volkorne';

/** Ce que le hook applique tant que l'utilisateur n'a rien réglé. */
export const DEFAULT_SETTINGS: Omit<UserBreedingSettings, 'user_id' | 'updated_at'> = {
  breeder_level: 200,
  enclos_count: 6,
  kamas_per_hour: 0,
  minutes_per_fight: 12,
  net_recovery_rate: 0.8,
  recycle_steriles: true,
  never_sell_mounts: false,
  gauge_cap: null,
};

export type BreedingRow = {
  colorId: string;
  name: string;
  generation: number;
  itemId: number | null;
  source: 'game' | 'site' | null;
  estimate: BreedingEstimate;
  /**
   * Le plan complet, multiplicités et recyclage compris. `null` pour les
   * couleurs qu'il vaut mieux acheter ou capturer : il n'y a alors rien à
   * élever, donc pas de plan.
   */
  plan: BreedingPlan | null;
  duration: PlanDuration | null;
  /**
   * Gain net du plan : ce que la sortie retenue rapporte, moins ce que le plan
   * a réellement coûté.
   *
   * Se calcule sur `plan.totalCost` et non sur `estimate.cost` : celui-ci compte
   * chaque exemplaire au prix fort, en ignorant qu'une couleur servant à
   * plusieurs recettes n'est produite qu'une fois de plus, pas deux.
   */
  planMargin: number | null;
  /**
   * Kamas par heure d'enclos — le seul classement qui réponde à « est-ce que ça
   * vaut le coup ».
   *
   * Une marge brute favorise mécaniquement les hautes générations : elles
   * rapportent plus parce qu'elles coûtent plus de travail, pas parce qu'elles
   * sont meilleures. Rapporter au temps d'enclos, qui est la ressource
   * réellement contrainte, remet une gen 6 rapide au-dessus d'une gen 10 qui
   * mobilise le parc trois fois plus longtemps.
   *
   * `null` quand la couleur ne s'élève pas : elle ne consomme alors aucune heure
   * d'enclos, et diviser par zéro n'aurait pas de sens.
   */
  marginPerHour: number | null;
};

/** Le plan d'une couleur, recalculé à la demande avec un stock donné. */
export type MakePlan = (
  colorId: string,
  targetCount?: number,
  stock?: Map<string, number>
) => { plan: BreedingPlan; duration: PlanDuration | null } | null;

export const useBreeding = (family: FamilyId) => {
  const [prices, setPrices] = useState<Map<string, ColorPrice>>(new Map());
  const [itemPrices, setItemPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [fuelItems, setFuelItems] = useState<DofusDBItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // Même patron que la page Farm : la transition porte l'état de chargement,
  // ce qui évite un `setState` synchrone dans l'effet.
  const [loading, startLoading] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const supabase = createClient();

    startLoading(async () => {
      try {
        // Les prix de couleurs sont partagés, les réglages sont privés : deux
        // requêtes distinctes, mais rien ne les sérialise.
        const [colorRows, settingRows, itemRows, fuelResponse] = await Promise.all([
          supabase.from('breeding_color_prices').select('*').eq('family', family),
          supabase.from('user_breeding_settings').select('*').maybeSingle(),
          supabase.from('item_prices').select('*'),
          // Les 120 carburants d'enclos tiennent en une page du miroir local :
          // c'est ce qui chiffre le cycle de fécondité et la montée en niveau.
          fetch(`/api/dofusdb/items?typeId=${FUEL_TYPE_ID}&limit=200`).then((response) =>
            response.ok ? response.json() : { data: [] }
          ),
        ]);

        if (colorRows.error) throw colorRows.error;

        const nextPrices = new Map<string, ColorPrice>();
        for (const row of (colorRows.data ?? []) as BreedingColorPrice[]) {
          const current = nextPrices.get(row.color_id) ?? { level0: null, level200: null };
          nextPrices.set(row.color_id, {
            ...current,
            [row.mount_level === 0 ? 'level0' : 'level200']: row.price,
          });
        }
        setPrices(nextPrices);

        setItemPrices(
          new Map(((itemRows.data ?? []) as ItemPrice[]).map((row) => [row.item_id, row]))
        );
        setFuelItems((fuelResponse as DofusDBResponse<DofusDBItem>).data ?? []);

        // Absence de ligne = utilisateur qui n'a jamais réglé : les défauts
        // s'appliquent sans qu'il faille créer la ligne à l'avance.
        if (settingRows.data) setSettings({ ...DEFAULT_SETTINGS, ...settingRows.data });
        setError(null);
      } catch (err) {
        console.error('[breeding] chargement impossible:', err);
        setError('Impossible de charger les données d’élevage');
      } finally {
        setLoaded(true);
      }
    });
  }, [family]);

  useEffect(() => {
    load();
  }, [load]);

  const tree = findFamily(family);

  /** Prix nu d'un item, pour les co-produits qu'on ne fait que revendre. */
  const priceOf = useCallback(
    (itemId: number) => itemPrices.get(itemId)?.price ?? 0,
    [itemPrices]
  );

  /** Valeur d'un généton : le meilleur des échanges de parchemins. */
  const genetonValuation = useMemo(
    () => bestGenetonValue(GENETON_EXCHANGE, new Map([...itemPrices].map(([id, row]) => [id, row.price]))),
    [itemPrices]
  );

  /** Carburants et filets, traduits en coûts par le catalogue et les prix. */
  const supplies = useMemo(
    () =>
      tree
        ? computeSupplyCosts(fuelItems, tree.nets, itemPrices, {
            kamasPerHour: settings.kamas_per_hour,
            minutesPerFight: settings.minutes_per_fight,
            netRecoveryRate: settings.net_recovery_rate,
            // Un enclos plein amortit le cycle sur dix montures ; c'est le
            // régime visé, et le seul qui ne gaspille pas de transfert.
            mountsInEnclos: 10,
            gaugeCap: settings.gauge_cap,
          })
        : null,
    [tree, fuelItems, itemPrices, settings]
  );

  /**
   * Ce que l'enclos sait faire, une fois les carburants tarifés. `null` tant
   * qu'il en manque : une durée déduite de prix partiels serait fausse sans le
   * dire.
   */
  const timing = useMemo<EnclosTiming | null>(() => {
    if (
      supplies?.cycleHours == null ||
      supplies.cycleFreeSlotHours == null ||
      !supplies.mangeoirePointsPerHour
    ) {
      return null;
    }
    return {
      cycleHours: supplies.cycleHours,
      freeSlotHours: supplies.cycleFreeSlotHours,
      mangeoirePointsPerHour: supplies.mangeoirePointsPerHour,
      enclosCount: settings.enclos_count,
    };
  }, [supplies, settings.enclos_count]);

  const estimates = useMemo(() => {
    if (!tree) return new Map<string, BreedingEstimate>();

    return computeBreedingCosts(tree.colors, prices, {
      parentLevel: 'auto',
      // `null` signifie « prix manquants » et non « gratuit » : on retombe alors
      // sur zéro, ce que la page signale explicitement plutôt que de le taire.
      fuelCostPerBaby: supplies?.fuelCostPerBaby ?? 0,
      mangeoireCostPerPoint: supplies?.mangeoireCostPerPoint ?? 0,
      genetonValue: genetonValuation?.valuePerGeneton ?? 0,
      sacrificeUnitValue: priceOf(tree.sacrificeItem.id),
      captureCost: supplies?.capture?.costPerMount ?? null,
      // Une Optimakina sans prix connu n'est pas gratuite, elle est indisponible :
      // l'omettre vaut mieux que de la faire retenir à tort par l'optimiseur.
      optimakinaPrices: new Map(
        Object.entries(tree.optimakinaByGeneration)
          .map(([generation, item]) => [Number(generation), priceOf(item.id)] as const)
          .filter(([, price]) => price > 0)
      ),
      recycleSteriles: settings.recycle_steriles,
      neverSell: settings.never_sell_mounts,
    });
  }, [tree, prices, supplies, genetonValuation, priceOf, settings]);

  /**
   * Le plan d'une couleur et sa durée, stock déduit.
   *
   * Exposé plutôt que gardé pour soi : l'écran de suivi le rappelle à chaque
   * saisie, avec le stock du moment, et c'est ce recalcul qui fait le
   * rattrapage. Le stock n'entre donc jamais dans le classement, qui doit rester
   * comparable d'une couleur à l'autre.
   */
  const makePlan = useCallback(
    (colorId: string, targetCount = 1, stock?: Map<string, number>) => {
      if (!tree) return null;

      const estimate = estimates.get(colorId);
      const plan = breedingPlan(colorId, tree.colors, estimates, {
        targetCount,
        recycleSteriles: settings.recycle_steriles,
        genetonValue: genetonValuation?.valuePerGeneton ?? 0,
        stock,
      });
      const duration = timing
        ? planDuration(
            plan,
            timing,
            // La montée au 200 ne se paie qu'à la revente à ce niveau ; ailleurs
            // le poulain part tel quel.
            estimate?.bestExit === 'sell200'
              ? { count: targetCount, level: MAX_MOUNT_LEVEL }
              : null
          )
        : null;

      return { plan, duration };
    },
    [tree, estimates, settings.recycle_steriles, genetonValuation, timing]
  );

  const rows = useMemo<BreedingRow[]>(() => {
    if (!tree) return [];

    return tree.colors.flatMap((color) => {
      const estimate = estimates.get(color.id);
      if (!estimate) return [];

      // Rien à planifier pour une couleur qu'il vaut mieux acheter : elle
      // n'occupe aucun enclos, donc aucune heure à rapporter.
      const planned = estimate.strategy === 'breed' ? makePlan(color.id) : null;
      const planMargin = planned ? estimate.bestExitValue - planned.plan.totalCost : null;
      const hours = planned?.duration?.enclosHours ?? 0;

      return [
        {
          colorId: color.id,
          name: color.name,
          generation: color.generation,
          itemId: color.itemId,
          source: color.source,
          estimate,
          plan: planned?.plan ?? null,
          duration: planned?.duration ?? null,
          planMargin,
          marginPerHour: planMargin !== null && hours > 0 ? planMargin / hours : null,
        },
      ];
    });
  }, [tree, estimates, makePlan]);

  /** Enregistre un prix et le reflète localement sans recharger toute la page. */
  const savePrice = useCallback(
    async (colorId: string, mountLevel: 0 | 200, price: number) => {
      const supabase = createClient();
      const { error: saveError } = await supabase.from('breeding_color_prices').upsert(
        {
          family,
          color_id: colorId,
          mount_level: mountLevel,
          price,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'family,color_id,mount_level' }
      );

      if (saveError) {
        console.error('[breeding] enregistrement du prix impossible:', saveError);
        return false;
      }

      setPrices((current) => {
        const next = new Map(current);
        const existing = next.get(colorId) ?? { level0: null, level200: null };
        next.set(colorId, {
          ...existing,
          [mountLevel === 0 ? 'level0' : 'level200']: price,
        });
        return next;
      });
      return true;
    },
    [family]
  );

  const saveSettings = useCallback(async (next: typeof DEFAULT_SETTINGS) => {
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from('user_breeding_settings')
      .upsert({ ...next, updated_at: new Date().toISOString() });

    if (saveError) {
      console.error('[breeding] enregistrement des réglages impossible:', saveError);
      return false;
    }
    setSettings(next);
    return true;
  }, []);

  return {
    tree,
    rows,
    prices,
    settings,
    genetonValuation,
    supplies,
    makePlan,
    sacrificePrice: tree ? priceOf(tree.sacrificeItem.id) : 0,
    // `loaded` couvre le tout premier rendu, avant que la transition démarre :
    // sans lui la page clignoterait sur un « aucun résultat » vide.
    loading: loading || !loaded,
    error,
    savePrice,
    saveSettings,
    reload: load,
  };
};

export { BREEDING_FAMILIES, GENETON_ITEM };
