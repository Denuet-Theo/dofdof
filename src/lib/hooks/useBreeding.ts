'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  BreedingColorPrice,
  DofusDBItem,
  DofusDBResponse,
  ItemPrice,
  UserBreedingMount,
  UserBreedingSettings,
  UserItemStock,
} from '@/lib/supabase/types';
import { parseGaugeInfo } from '@/lib/utils/gauges';
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
  planGaugeNeeds,
  planFunding,
  MAX_MOUNT_LEVEL,
  type BreedingEstimate,
  type BreedingPlan,
  type ColorPrice,
  type EnclosTiming,
  type GaugeRequirement,
  type PlanDuration,
  type PlanFunding,
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
  // 0 = pas de contrainte. Refuser tous les plans à qui n'a pas renseigné son
  // budget serait la pire lecture possible d'un champ vide.
  kamas_available: 0,
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
   * Le plan complet — étapes, durée, jauges, financement. `null` pour les
   * couleurs qu'il vaut mieux acheter ou capturer : il n'y a alors rien à
   * élever, donc pas de plan.
   */
  planned: PlannedColor | null;
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

export type PlannedColor = {
  plan: BreedingPlan;
  duration: PlanDuration | null;
  gaugeNeeds: GaugeRequirement[];
  funding: PlanFunding | null;
  /**
   * L'estimation du régime retenu — niveau des parents, taux, coût.
   *
   * Portée par le plan et non lue à part : deux régimes de niveau donnent deux
   * estimations, et afficher celle qui n'a pas servi ferait mentir la ligne sur
   * le plan qu'elle résume.
   */
  estimate: BreedingEstimate | null;
};

/** Le plan d'une couleur, recalculé à la demande pour un objectif donné. */
export type MakePlan = (colorId: string, targetCount?: number) => PlannedColor | null;

export const useBreeding = (
  family: FamilyId,
  /**
   * Combien d'exemplaires de la couleur visée produire.
   *
   * Pilote **tout le classement** et pas seulement le plan qu'on ouvre : à
   * trente exemplaires les fournées d'enclos se remplissent et le clonage a de
   * quoi s'appairer, si bien que le coût par monture s'effondre et que le
   * palmarès change. Le figer à 1 rendrait invisible tout l'intérêt des séries.
   */
  targetCount = 1
) => {
  const [prices, setPrices] = useState<Map<string, ColorPrice>>(new Map());
  const [itemPrices, setItemPrices] = useState<Map<number, ItemPrice>>(new Map());
  const [fuelItems, setFuelItems] = useState<DofusDBItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [mountStock, setMountStock] = useState<Map<string, number>>(new Map());
  const [itemStock, setItemStock] = useState<Map<number, number>>(new Map());
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
        const [colorRows, settingRows, itemRows, mountRows, stockRows, fuelResponse] =
          await Promise.all([
            supabase.from('breeding_color_prices').select('*').eq('family', family),
            supabase.from('user_breeding_settings').select('*').maybeSingle(),
            supabase.from('item_prices').select('*'),
            supabase.from('user_breeding_mounts').select('*').eq('family', family),
            supabase.from('user_item_stock').select('*'),
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

        setMountStock(
          new Map(
            ((mountRows.data ?? []) as UserBreedingMount[])
              .filter((row) => row.count > 0)
              .map((row) => [row.color_id, row.count])
          )
        );
        setItemStock(
          new Map(
            ((stockRows.data ?? []) as UserItemStock[])
              .filter((row) => row.quantity > 0)
              .map((row) => [row.item_id, row.quantity])
          )
        );

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

  /**
   * Ce que la réserve de carburants représente, jauge par jauge, en **points**.
   *
   * C'est la seule monnaie où un stock se compare à un besoin : une unité
   * d'Élixir en vaut huit d'Extrait, et un plan ne demande ni l'un ni l'autre
   * mais des points à transférer.
   */
  const ownedGaugePoints = useMemo(() => {
    const points = new Map<string, number>();

    for (const item of fuelItems) {
      const quantity = itemStock.get(item.id) ?? 0;
      if (quantity <= 0) continue;

      const info = parseGaugeInfo(item);
      if (!info || info.rechargeAmount <= 0) continue;

      points.set(info.gaugeName, (points.get(info.gaugeName) ?? 0) + quantity * info.rechargeAmount);
    }

    return points;
  }, [fuelItems, itemStock]);

  /**
   * Deux jeux d'estimations, qui ne diffèrent que par le niveau des parents.
   *
   * Il n'y a pas un bon niveau mais deux régimes, et l'objectif décide lequel :
   *
   * - **au moins cher en kamas** : l'optimiseur choisit un niveau bas, paie peu
   *   de Mangeoire et accepte de rater souvent ;
   * - **au seuil d'XP gratuite** (niveau 50) : monter jusque-là ne rallonge
   *   aucune fournée, puisque la Mangeoire tient dans l'emplacement de jauge que
   *   les étapes à une seule stat laissent libre.
   *
   * Le second réduit les tentatives, mais coûte du carburant — et les tentatives
   * ne se convertissent en heures d'enclos que par fournées de dix. À un
   * exemplaire, on arrondit à la même fournée dans les deux cas : on paie la
   * montée pour rien. À trente, la réduction devient des fournées entières et le
   * seuil gagne largement.
   *
   * Mesuré sur un muldo gen 4 : le seuil fait perdre 60 % de marge horaire à
   * l'objectif 1, et en gagner 24 % à l'objectif 30. D'où l'essai des deux, et
   * non un plancher imposé.
   */
  const estimateVariants = useMemo(() => {
    if (!tree) return [] as Map<string, BreedingEstimate>[];

    const floors = [0];
    if (supplies?.freeXpPoints) floors.push(supplies.freeXpPoints);

    return floors.map((freeXpPoints) =>
      computeBreedingCosts(tree.colors, prices, {
        parentLevel: 'auto',
        // `null` signifie « prix manquants » et non « gratuit » : on retombe
        // alors sur zéro, ce que la page signale plutôt que de le taire.
        fuelCostPerCycle: supplies?.fuelCostPerCycle ?? 0,
        mangeoireCostPerMountPoint: supplies?.mangeoireCostPerMountPoint ?? 0,
        genetonValue: genetonValuation?.valuePerGeneton ?? 0,
        sacrificeUnitValue: priceOf(tree.sacrificeItem.id),
        captureCost: supplies?.capture?.costPerMount ?? null,
        // Une Optimakina sans prix connu n'est pas gratuite, elle est
        // indisponible : l'omettre vaut mieux que de la faire retenir à tort.
        optimakinaPrices: new Map(
          Object.entries(tree.optimakinaByGeneration)
            .map(([generation, item]) => [Number(generation), priceOf(item.id)] as const)
            .filter(([, price]) => price > 0)
        ),
        recycleSteriles: settings.recycle_steriles,
        freeXpPoints,
        neverSell: settings.never_sell_mounts,
      })
    );
  }, [tree, prices, supplies, genetonValuation, priceOf, settings]);

  /**
   * Le plan d'une couleur : étapes, durée, jauges à remplir et financement.
   *
   * Le stock de montures y entre toujours, y compris pour le classement. Ce
   * n'est pas une entorse à la comparabilité mais ce qui la rend juste : la
   * question n'est pas « que coûterait cette couleur en partant de rien » mais
   * « que me coûte-t-elle, à moi, avec l'écurie que j'ai ». Deux plans se
   * comparent depuis le même point de départ — le mien.
   */
  const makePlan = useCallback<MakePlan>(
    (colorId, count = 1) => {
      if (!tree) return null;

      const genetonValue = genetonValuation?.valuePerGeneton ?? 0;

      const build = (estimates: Map<string, BreedingEstimate>): PlannedColor | null => {
        const estimate = estimates.get(colorId);
        // Rien à planifier pour une couleur qu'il vaut mieux acheter ou
        // capturer : elle n'occupe aucun enclos.
        if (estimate?.strategy !== 'breed') return null;

        const plan = breedingPlan(colorId, tree.colors, estimates, {
          targetCount: count,
          recycleSteriles: settings.recycle_steriles,
          genetonValue,
          stock: mountStock,
        });
        const duration = timing
          ? planDuration(
              plan,
              timing,
              // La montée au 200 ne se paie qu'à la revente à ce niveau ;
              // ailleurs le poulain part tel quel.
              estimate?.bestExit === 'sell200' ? { count, level: MAX_MOUNT_LEVEL } : null
            )
          : null;

        const gaugeNeeds = supplies
          ? planGaugeNeeds(
              plan,
              { slots: timing?.slots },
              supplies.cycleGauges,
              supplies.mangeoire,
              ownedGaugePoints
            )
          : [];

        // Ce que la réserve de carburant dispense de racheter. Plafonné par
        // `planGaugeNeeds` à ce que le plan consomme réellement.
        const gaugeCredit = gaugeNeeds.reduce((total, need) => total + need.credit, 0);

        return {
          plan,
          duration,
          gaugeNeeds,
          estimate,
          funding: planFunding(plan, estimates, settings.kamas_available, {
            genetonValue,
            gaugeCredit,
          }),
        };
      };

      // Les deux régimes de niveau des parents s'essaient et se départagent sur
      // la marge horaire — la même mesure que le classement. Le bon régime
      // dépend de l'objectif, et lui seul le sait : à un exemplaire le niveau
      // bas gagne, à trente c'est le seuil d'XP gratuite.
      const rate = (candidate: PlannedColor) => {
        const hours = candidate.duration?.enclosHours ?? 0;
        const margin = (candidate.estimate?.bestExitValue ?? 0) * count - candidate.plan.totalCost;
        // Sans durée chiffrable, le moins cher fait office d'arbitre.
        return hours > 0 ? margin / hours : -candidate.plan.totalCost;
      };

      const candidates = estimateVariants
        .map(build)
        .filter((candidate): candidate is PlannedColor => candidate !== null);

      return candidates.length === 0
        ? null
        : candidates.reduce((best, candidate) =>
            rate(candidate) > rate(best) ? candidate : best
          );
    },
    [
      tree,
      estimateVariants,
      settings.recycle_steriles,
      settings.kamas_available,
      genetonValuation,
      timing,
      supplies,
      ownedGaugePoints,
      mountStock,
    ]
  );

  const rows = useMemo<BreedingRow[]>(() => {
    if (!tree) return [];

    return tree.colors.flatMap((color) => {
      const planned = makePlan(color.id, targetCount);
      // L'estimation du régime retenu fait foi ; à défaut de plan, celle du
      // régime au moins cher, qui est aussi celle qui a décidé d'acheter.
      const estimate = planned?.estimate ?? estimateVariants[0]?.get(color.id);
      if (!estimate) return [];

      // La sortie rapporte par monture ; le plan en produit `targetCount`.
      const planMargin = planned
        ? estimate.bestExitValue * targetCount - planned.plan.totalCost
        : null;
      const hours = planned?.duration?.enclosHours ?? 0;

      return [
        {
          colorId: color.id,
          name: color.name,
          generation: color.generation,
          itemId: color.itemId,
          source: color.source,
          estimate,
          planned,
          planMargin,
          marginPerHour: planMargin !== null && hours > 0 ? planMargin / hours : null,
        },
      ];
    });
  }, [tree, estimateVariants, makePlan, targetCount]);

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

  /**
   * Enregistre le nombre de montures d'une couleur en écurie.
   *
   * L'état local part devant : le classement entier se recalcule à chaque
   * saisie, et l'attendre du réseau rendrait la frappe poussive.
   */
  const saveMountStock = useCallback(
    async (colorId: string, count: number) => {
      setMountStock((current) => {
        const next = new Map(current);
        if (count > 0) next.set(colorId, count);
        else next.delete(colorId);
        return next;
      });

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_mounts')
        .upsert(
          { family, color_id: colorId, count, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,family,color_id' }
        );

      if (saveError) console.error('[breeding] monture non enregistrée:', saveError);
    },
    [family]
  );

  /** Idem pour un carburant en réserve. */
  const saveItemStock = useCallback(async (itemId: number, quantity: number) => {
    setItemStock((current) => {
      const next = new Map(current);
      if (quantity > 0) next.set(itemId, quantity);
      else next.delete(itemId);
      return next;
    });

    const supabase = createClient();
    const { error: saveError } = await supabase
      .from('user_item_stock')
      .upsert(
        { item_id: itemId, quantity, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,item_id' }
      );

    if (saveError) console.error('[breeding] réserve non enregistrée:', saveError);
  }, []);

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
    fuelItems,
    mountStock,
    itemStock,
    ownedGaugePoints,
    saveMountStock,
    saveItemStock,
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
