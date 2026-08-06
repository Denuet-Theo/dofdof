'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { saveItemPrice } from '@/lib/hooks/useItemPrices';
import type {
  BreedingColorPrice,
  DofusDBItem,
  DofusDBResponse,
  ItemPrice,
  UserBreedingIndividual,
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
import { planWaves, wavesByStep, type Wave } from '@/lib/dofus/breeding/waves';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import {
  emptyStable,
  stableBySex,
  tracksIndividually,
  type Individual,
  type Pairing,
  type Sex,
  type Stable,
} from '@/lib/dofus/breeding/stable';
import { carriedGeneration, mountName } from '@/lib/dofus/breeding/naming';

/**
 * Ce qu'un accouplement a donné : ses deux parents, et le bébé qui en est né.
 *
 * Un accouplement produit **toujours** un bébé — les 30 à 90 % portent sur sa
 * couleur, pas sur son existence — donc il n'y a pas de cas « rien n'est né ».
 * Un raté se saisit comme une couleur parmi d'autres.
 */
export type BirthEntry = {
  male: Pairing;
  female: Pairing;
  colorId: string;
  sex: Sex;
};

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
  // Le comportement d'avant : le crédit s'applique. Le couper est un choix
  // explicite, pas un défaut imposé.
  credit_off_target: true,
  // Le prix des filets compte par défaut : c'est vrai de qui les achète, et
  // celui qui récolte ses matériaux sait, lui, qu'il doit décocher.
  count_net_cost: true,
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
  /**
   * Ce que **tout le processus** coûte, et non ce que coûte une monture.
   *
   * C'est la question qu'on se pose devant l'écran : « combien ça va me
   * coûter », pas « quel est le prix unitaire ». Le prix unitaire n'intéresse
   * personne sur un objectif qu'on ne poursuit qu'une fois.
   *
   * Et c'est aussi ce qui rendait la ligne illisible : le gain net est **déjà**
   * un total — `bestExitValue × produites − plan.totalCost` — si bien qu'un
   * coût ramené à la monture posait un prix unitaire à côté d'un total. Les deux
   * chiffres ne pouvaient pas se réconcilier, et c'est exactement ce que les
   * joueurs ont buté dessus.
   *
   * Pour une couleur qu'on achète ou capture, il n'y a pas de plan : le total
   * est alors le prix unitaire multiplié par ce qu'on en veut.
   */
  planTotalCost: number | null;
};

export type PlannedColor = {
  plan: BreedingPlan;
  duration: PlanDuration | null;
  /**
   * Le plan découpé en tours de cycles, contraint par l'écurie.
   *
   * Sans remplissage des places libres : la couleur qui les occupe se choisit
   * sur le classement, qui n'existe pas encore quand ce plan se construit. Le
   * panneau le recalcule avec elle, sans que rien d'autre en dépende.
   */
  waves: Wave[];
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
  const [stable, setStable] = useState<Stable>(emptyStable);
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
        const [
          colorRows,
          settingRows,
          itemRows,
          mountRows,
          individualRows,
          stockRows,
          fuelResponse,
        ] = await Promise.all([
            supabase.from('breeding_color_prices').select('*').eq('family', family),
            supabase.from('user_breeding_settings').select('*').maybeSingle(),
            supabase.from('item_prices').select('*'),
            supabase.from('user_breeding_mounts').select('*').eq('family', family),
            supabase.from('user_breeding_individuals').select('*').eq('family', family),
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

        setStable({
          bulk: new Map(
            ((mountRows.data ?? []) as UserBreedingMount[])
              .filter((row) => row.males > 0 || row.females > 0)
              .map((row) => [row.color_id, { males: row.males, females: row.females }])
          ),
          individuals: ((individualRows.data ?? []) as UserBreedingIndividual[]).map((row) => ({
            id: row.id,
            colorId: row.color_id,
            name: row.name ?? null,
            sex: row.sex,
            level: row.level,
            fertile: row.fertile,
            // Les deux couleurs vont ensemble ou pas du tout : une ascendance à
            // moitié connue ne se distingue pas d'une monture achetée, et la
            // traiter comme telle vaut mieux que d'inventer le parent manquant.
            parents:
              row.parent_a_color && row.parent_b_color
                ? [row.parent_a_color, row.parent_b_color]
                : null,
          })),
        });
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

  /**
   * L'écurie vue par couleur et par sexe — ce dont le découpage en fournées a
   * besoin, puisqu'un accouplement demande un mâle et une femelle.
   */
  const stockBySex = useMemo(() => stableBySex(stable), [stable]);

  /**
   * Les effectifs totaux, sexes confondus.
   *
   * C'est ce que `breedingPlan` consomme : le **coût** d'un plan ne dépend pas
   * de la répartition des sexes, seulement du nombre de montures à se procurer.
   * Le déséquilibre ne coûte pas de kamas, il coûte des tours d'enclos — et
   * c'est donc au découpage en vagues, pas au chiffrage, de le voir.
   */
  const mountStock = useMemo(
    () =>
      new Map(
        [...stockBySex].map(([colorId, { males, females }]) => [colorId, males + females] as const)
      ),
    [stockBySex]
  );

  /** Générations et noms d'affichage des couleurs, indexés une fois par famille. */
  const colorIndex = useMemo(
    () => ({
      generations: new Map((tree?.colors ?? []).map((color) => [color.id, color.generation])),
      names: new Map((tree?.colors ?? []).map((color) => [color.id, color.name])),
    }),
    [tree]
  );

  /**
   * Le nom à inscrire **dans le jeu** sur un poulain qui vient de naître.
   *
   * Se calcule sur la généalogie et non sur la couleur du bébé : ce qu'il faut
   * lire depuis la liste de l'écurie, c'est la génération qu'il **porte** — la
   * plus haute de son ascendance — parce que c'est elle qui décidera de ce que
   * ses propres accouplements visent. Voir `naming.ts`.
   */
  const nameForBirth = useCallback(
    (colorId: string, parents: [string, string]): string =>
      mountName(
        carriedGeneration(colorIndex.generations.get(colorId) ?? 1, [
          colorIndex.generations.get(parents[0]) ?? 1,
          colorIndex.generations.get(parents[1]) ?? 1,
        ]),
        [colorIndex.names.get(parents[0]) ?? parents[0], colorIndex.names.get(parents[1]) ?? parents[1]]
      ),
    [colorIndex]
  );

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
            countNetCost: settings.count_net_cost,
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
        creditOffTarget: settings.credit_off_target,
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
          // L'objectif est un plancher : les places d'enclos permettent de
          // saturer la dernière fournée plutôt que de la lancer à moitié vide.
          slots: timing?.slots,
        });
        // Le découpage en vagues sert d'abord le délai, d'où ce calcul ici,
        // sans remplissage : la couleur qui occupe les places libres dépend du
        // classement, donc de plans qui ne sont pas encore construits. Elle se
        // rajoute à l'affichage, où elle ne change aucun chiffre.
        const waves = planWaves(plan, {
          stock: stockBySex,
          capacity: Math.max(settings.enclos_count, 1) * (timing?.slots ?? ENCLOS_SLOTS),
          recycleSteriles: settings.recycle_steriles,
          filler: null,
        });

        const duration = timing
          ? planDuration(
              plan,
              timing,
              // La montée au 200 ne se paie qu'à la revente à ce niveau ;
              // ailleurs le poulain part tel quel.
              // Ce sont les montures réellement produites qu'il faut monter,
              // pas l'objectif : le plancher en rend souvent quelques-unes de
              // plus, et elles passent par la Mangeoire comme les autres.
              estimate?.bestExit === 'sell200'
                ? { count: plan.targetProduced, level: MAX_MOUNT_LEVEL }
                : null,
              wavesByStep(waves)
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
          waves,
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
        const margin =
          (candidate.estimate?.bestExitValue ?? 0) * candidate.plan.targetProduced -
          candidate.plan.totalCost;
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
      // Le parc dimensionne les vagues : plus d'enclos, moins de tours.
      settings.enclos_count,
      settings.recycle_steriles,
      settings.kamas_available,
      genetonValuation,
      timing,
      supplies,
      ownedGaugePoints,
      mountStock,
      stockBySex,
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

      // La sortie rapporte par monture, et le plan en produit au moins
      // `targetCount` — davantage quand remplir la dernière fournée le permet.
      // Compter sur l'objectif retiendrait le coût des tentatives ajoutées sans
      // leur recette, et ferait passer pour moins bonne une couleur qu'on vient
      // justement de produire en plus grand nombre à carburant constant.
      const planMargin = planned
        ? estimate.bestExitValue * planned.plan.targetProduced - planned.plan.totalCost
        : null;
      const hours = planned?.duration?.enclosHours ?? 0;
      // Le total du plan tel quel — c'est déjà la bonne unité, la même que le
      // gain net. À défaut de plan, ce qu'il en coûterait de simplement en
      // acheter ou capturer le nombre visé.
      const planTotalCost = planned
        ? planned.plan.totalCost
        : estimate.cost !== null
          ? estimate.cost * targetCount
          : null;

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
          planTotalCost,
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
   * Le compteur saisi est un **total**, alors que la base ne stocke que le vrac.
   * Les deux ne coïncidaient plus depuis qu'une gen 1 ou 2 peut être suivie
   * individuellement — voir `tracksIndividually` : une couleur peut porter à la
   * fois trois montures en vrac et une née d'un croisement haut. Écrire le total
   * tel quel compterait cette dernière deux fois, une fois dans le vrac et une
   * fois comme individu.
   *
   * On retranche donc les individus avant d'écrire. Saisir moins que ce qu'ils
   * représentent vide le vrac sans les toucher : une monture suivie se retire
   * dans la liste de l'écurie, où on la voit, pas par un compteur qui ne dit pas
   * laquelle.
   *
   * L'état local part devant : le classement entier se recalcule à chaque
   * saisie, et l'attendre du réseau rendrait la frappe poussive.
   */
  const saveBulkStock = useCallback(
    async (colorId: string, totalMales: number, totalFemales: number) => {
      const tracked = stable.individuals.filter(
        (mount) => mount.colorId === colorId && mount.fertile
      );
      const trackedMales = tracked.filter((mount) => mount.sex === 'M').length;
      const trackedFemales = tracked.length - trackedMales;

      const males = Math.max(0, totalMales - trackedMales);
      const females = Math.max(0, totalFemales - trackedFemales);

      setStable((current) => {
        const bulk = new Map(current.bulk);
        if (males > 0 || females > 0) bulk.set(colorId, { males, females });
        else bulk.delete(colorId);
        return { ...current, bulk };
      });

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_mounts')
        .upsert(
          { family, color_id: colorId, males, females, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,family,color_id' }
        );

      if (saveError) console.error('[breeding] monture non enregistrée:', saveError);
    },
    [family, stable.individuals]
  );

  /**
   * Ajoute une monture suivie individuellement.
   *
   * L'identifiant vient de la base et non d'un tirage local : les ascendances
   * s'y référencent, et une monture dont l'identifiant changerait au rechargement
   * casserait la généalogie de ses enfants. D'où l'attente du retour, contrairement
   * aux compteurs où l'état local peut partir devant sans risque.
   */
  const addIndividual = useCallback(
    async (mount: {
      colorId: string;
      sex: Sex;
      level?: number;
      parents?: [string, string] | null;
    }) => {
      const supabase = createClient();
      const { data, error: saveError } = await supabase
        .from('user_breeding_individuals')
        .insert({
          family,
          color_id: mount.colorId,
          // Une monture ajoutée à la main est achetée ou capturée : elle n'a pas
          // d'ascendance, donc rien à inscrire, donc « Anonyme » — qui est déjà
          // son nom dans le jeu. En dicter un ferait renommer pour rien.
          name: mount.parents ? nameForBirth(mount.colorId, mount.parents) : null,
          sex: mount.sex,
          level: mount.level ?? 1,
          parent_a_color: mount.parents?.[0] ?? null,
          parent_b_color: mount.parents?.[1] ?? null,
        })
        .select()
        .single();

      if (saveError || !data) {
        console.error('[breeding] individu non enregistré:', saveError);
        return null;
      }

      const row = data as UserBreedingIndividual;
      const added: Individual = {
        id: row.id,
        colorId: row.color_id,
        name: row.name ?? null,
        sex: row.sex,
        level: row.level,
        fertile: row.fertile,
        parents:
          row.parent_a_color && row.parent_b_color
            ? [row.parent_a_color, row.parent_b_color]
            : null,
      };

      setStable((current) => ({ ...current, individuals: [...current.individuals, added] }));
      return added;
    },
    [family, nameForBirth]
  );

  /** Corrige une monture suivie : niveau, sexe ou fertilité. */
  const updateIndividual = useCallback(
    async (id: string, patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'name'>>) => {
      setStable((current) => ({
        ...current,
        individuals: current.individuals.map((mount) =>
          mount.id === id ? { ...mount, ...patch } : mount
        ),
      }));

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_individuals')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (saveError) console.error('[breeding] individu non mis à jour:', saveError);
    },
    []
  );

  /**
   * Enregistre ce qu'une fournée a donné : parents stériles, bébés en écurie.
   *
   * C'est ce qui rend le plan reprenable sans rien noter ailleurs. Un
   * accouplement **produit toujours un bébé** — les 30 à 90 % portent sur sa
   * couleur, pas sur sa venue au monde — donc chaque couple rend une ligne, et
   * l'échec se saisit comme une couleur parmi d'autres et non comme un vide.
   *
   * Les parents passent stériles dans le même mouvement : c'est l'accouplement
   * qui les consomme, et les laisser fertiles ferait reproposer à la fournée
   * suivante des montures déjà dépensées.
   */
  const recordBirths = useCallback(
    async (entries: BirthEntry[]) => {
      if (entries.length === 0 || !tree) return;
      const supabase = createClient();
      const generations = new Map(tree.colors.map((color) => [color.id, color.generation]));

      /** Individus à passer stériles, et effectifs de vrac à décrémenter. */
      const steriles = new Set<string>();
      const bulkSpent = new Map<string, { males: number; females: number }>();

      for (const entry of entries) {
        for (const side of [entry.male, entry.female]) {
          if (side.mountId) {
            steriles.add(side.mountId);
            continue;
          }
          const spent = bulkSpent.get(side.colorId) ?? { males: 0, females: 0 };
          if (side.sex === 'M') spent.males += 1;
          else spent.females += 1;
          bulkSpent.set(side.colorId, spent);
        }
      }

      const bulkBorn = new Map<string, { males: number; females: number }>();
      const individualsBorn: {
        family: FamilyId;
        color_id: string;
        name: string;
        sex: Sex;
        parent_a_color: string;
        parent_b_color: string;
      }[] = [];

      for (const entry of entries) {
        const generation = generations.get(entry.colorId) ?? 1;
        // Le seuil se juge sur l'ascendance et non sur la couleur née. Un bébé
        // hors cible est d'une génération basse mais garde la généalogie de ses
        // parents : une gen 2 née d'une Amande gen 3 vise la gen 4 à son tour.
        // La ranger dans le vrac effaçait ce raccourci — voir `pairing.ts`.
        const tracked = tracksIndividually(generation, [
          generations.get(entry.male.colorId) ?? 1,
          generations.get(entry.female.colorId) ?? 1,
        ]);

        if (!tracked) {
          const born = bulkBorn.get(entry.colorId) ?? { males: 0, females: 0 };
          if (entry.sex === 'M') born.males += 1;
          else born.females += 1;
          bulkBorn.set(entry.colorId, born);
          continue;
        }
        individualsBorn.push({
          family,
          color_id: entry.colorId,
          // Le nom qu'on vient de dicter à l'éleveur : on le retient pour
          // pouvoir désigner cette monture-là au tour suivant. S'il ne le
          // recopie pas en jeu, la fournée le lui redira — c'est le seul
          // rattrapage possible, l'outil ne voit pas le jeu.
          name: nameForBirth(entry.colorId, [entry.male.colorId, entry.female.colorId]),
          sex: entry.sex,
          // La généalogie du bébé, c'est-à-dire les couleurs de ses deux
          // parents : c'est elle qui décidera de ses propres ratés.
          parent_a_color: entry.male.colorId,
          parent_b_color: entry.female.colorId,
        });
      }

      // Le vrac se recalcule depuis l'état courant : dépensé d'un côté, né de
      // l'autre, et les deux peuvent porter sur la même couleur.
      const nextBulk = new Map([...stable.bulk].map(([id, counts]) => [id, { ...counts }]));
      for (const [colorId, spent] of bulkSpent) {
        const current = nextBulk.get(colorId) ?? { males: 0, females: 0 };
        nextBulk.set(colorId, {
          males: Math.max(0, current.males - spent.males),
          females: Math.max(0, current.females - spent.females),
        });
      }
      for (const [colorId, born] of bulkBorn) {
        const current = nextBulk.get(colorId) ?? { males: 0, females: 0 };
        nextBulk.set(colorId, {
          males: current.males + born.males,
          females: current.females + born.females,
        });
      }

      const [sterileResult, insertResult] = await Promise.all([
        steriles.size > 0
          ? supabase
              .from('user_breeding_individuals')
              .update({ fertile: false, updated_at: new Date().toISOString() })
              .in('id', [...steriles])
          : Promise.resolve({ error: null }),
        individualsBorn.length > 0
          ? supabase.from('user_breeding_individuals').insert(individualsBorn).select()
          : Promise.resolve({ data: [], error: null }),
      ]);

      const touched = [...bulkSpent.keys(), ...bulkBorn.keys()];
      const bulkResult = await (touched.length > 0
        ? supabase.from('user_breeding_mounts').upsert(
            [...new Set(touched)].map((colorId) => ({
              family,
              color_id: colorId,
              males: nextBulk.get(colorId)?.males ?? 0,
              females: nextBulk.get(colorId)?.females ?? 0,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'user_id,family,color_id' }
          )
        : Promise.resolve({ error: null }));

      if (sterileResult.error || insertResult.error || bulkResult.error) {
        console.error(
          '[breeding] fournée non enregistrée:',
          sterileResult.error ?? insertResult.error ?? bulkResult.error
        );
        // L'écriture a pu passer à moitié : on relit plutôt que de deviner.
        load();
        return;
      }

      const added = ((insertResult.data ?? []) as UserBreedingIndividual[]).map((row) => ({
        id: row.id,
        colorId: row.color_id,
        name: row.name ?? null,
        sex: row.sex,
        level: row.level,
        fertile: row.fertile,
        parents:
          row.parent_a_color && row.parent_b_color
            ? ([row.parent_a_color, row.parent_b_color] as [string, string])
            : null,
      }));

      setStable((current) => ({
        bulk: nextBulk,
        individuals: [
          ...current.individuals.map((mount) =>
            steriles.has(mount.id) ? { ...mount, fertile: false } : mount
          ),
          ...added,
        ],
      }));
    },
    [family, tree, stable, load, nameForBirth]
  );

  /** Retire une monture de l'écurie — vendue, sacrifiée, ou saisie par erreur. */
  const removeIndividual = useCallback(async (id: string) => {
    setStable((current) => ({
      ...current,
      individuals: current.individuals.filter((mount) => mount.id !== id),
    }));

    const supabase = createClient();
    const { error: saveError } = await supabase
      .from('user_breeding_individuals')
      .delete()
      .eq('id', id);

    if (saveError) console.error('[breeding] individu non supprimé:', saveError);
  }, []);

  /**
   * Enregistre le prix d'un carburant, et le reflète aussitôt localement.
   *
   * Les prix de carburants sont l'entrée la plus déterminante de tout le calcul
   * d'élevage : ils fixent le coût du cycle, le coût d'un point de Mangeoire —
   * donc le niveau des parents — et ils décident du **palier** retenu, donc du
   * délai. Ils vivaient pourtant sur une autre page, si bien que l'écran où on
   * les cherche n'en montrait aucun.
   *
   * L'état local part devant, comme pour les prix de couleurs : tout le
   * classement se recalcule à chaque saisie, et l'attendre du réseau rendrait
   * la frappe poussive.
   */
  const saveFuelPrice = useCallback(
    async (itemId: number, itemName: string, price: number) => {
      const updated_at = new Date().toISOString();
      setItemPrices((current) => {
        const next = new Map(current);
        if (price > 0) {
          next.set(itemId, {
            ...(next.get(itemId) ?? { item_id: itemId, icon_url: null, updated_by: null }),
            item_id: itemId,
            item_name: itemName,
            price,
            updated_at,
          } as ItemPrice);
        } else {
          // Un prix effacé n'est pas un prix nul : un carburant à zéro raflerait
          // tous les arbitrages en paraissant offert. On le retire.
          next.delete(itemId);
        }
        return next;
      });

      if (price <= 0) return;
      try {
        await saveItemPrice({ itemId, itemName, price });
      } catch (saveError) {
        console.error('[breeding] prix de carburant non enregistré:', saveError);
      }
    },
    []
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
    itemPrices,
    saveFuelPrice,
    stable,
    stockBySex,
    mountStock,
    itemStock,
    ownedGaugePoints,
    saveBulkStock,
    addIndividual,
    updateIndividual,
    removeIndividual,
    recordBirths,
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
