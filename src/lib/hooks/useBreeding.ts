'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { priceSaveMessage, saveItemPrice } from '@/lib/hooks/useItemPrices';
import { toNumber } from '@/lib/supabase/types';
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
import { DEFAULT_GAUGE_BAND, ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import {
  emptyStable,
  cycledOf,
  FRESH_LEVEL,
  stableBySex,
  statusFlags,
  tracksIndividually,
  type Individual,
  type MountStatus,
  type Pairing,
  type Sex,
  type Stable,
} from '@/lib/dofus/breeding/stable';
import { carriedGeneration, colorCoder, mountName } from '@/lib/dofus/breeding/naming';
// Le vrac n'a pas de ligne en base : son identité est fabriquée par `flatten`, et
// c'est elle qui dit dans quelle table une sortie d'enclos doit s'écrire.
import { parseCountedMountId } from '@/lib/dofus/breeding/search';
// Toute écriture qui échoue passe par là : voir l'en-tête du module sur
// pourquoi un `console.error` ne compte pas comme un signalement.
import { reportWriteFailure } from '@/lib/errors/write-failures';

/**
 * Ce qu'une insertion de monture a donné.
 *
 * Un `null` ne suffisait pas. L'assistant en déduisait « ça n'a pas marché » et
 * restait sur son étape sans rien afficher : l'éleveur cliquait, rien ne bougeait,
 * et rien ne disait pourquoi. Sur une saisie de cent trente montures, c'est un
 * silence qui coûte une soirée.
 */
export type AddResult = { ok: true; mount: Individual } | { ok: false; message: string };

/**
 * Ce qu'un enregistrement de prix de carburant a donné.
 *
 * Même leçon qu'`AddResult`, sur la saisie la plus dense de l'écran : cent vingt
 * champs, un enregistrement par frappe, et jusqu'ici pas un mot quand la base
 * refusait. Le nom de l'item voyage avec le message parce que la bannière est
 * unique pour toute la liste — sans lui, elle dirait qu'un prix est perdu sans
 * dire lequel.
 */
export type FuelPriceResult =
  | { ok: true }
  | { ok: false; itemName: string; message: string };

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
 * Un parent tel qu'il était **avant** l'accouplement qui l'a consommé.
 *
 * C'est ce qui rend l'annulation possible. Une monture accouplée passe stérile
 * et perd son cycle ; la remettre « fertile » ne suffirait pas à défaire le
 * geste, puisqu'une féconde doit retrouver sa fécondité et pas seulement sa
 * fertilité — sans quoi l'annulation coûterait un cycle d'enclos que l'éleveur
 * n'a jamais dépensé.
 */
export type ConsumedParent = { id: string; fertile: boolean; cycled: boolean };

/** Une naissance écrite en base, et de quoi la défaire. */
export type BirthRecord = {
  /** L'identifiant du poulain, celui que la base a attribué. */
  id: string;
  colorId: string;
  sex: Sex;
  /** Le nom dicté, celui à recopier en jeu. */
  name: string;
  parents: ConsumedParent[];
};

/**
 * Ce qu'une saisie de naissance a donné.
 *
 * `ok: false` veut dire **rien n'a été écrit** : ni poulain, ni parent stérilisé.
 * C'est ce que garantit l'ordre des écritures dans `recordBirths`, et c'est ce
 * qui permet à la fenêtre de saisie de garder le clic pour le rejouer.
 */
export type RecordBirthsResult =
  | { ok: true; born: BirthRecord[] }
  | { ok: false; message: string };

/**
 * Ce qu'un clonage enregistré a donné.
 *
 * `ok: false` veut dire **rien n'a été écrit** : le clone n'est pas en base et
 * les deux stériles y sont toujours. La fenêtre peut donc laisser le clonage
 * dans le lot à faire au lieu de le compter fait.
 */
/**
 * Ce qu'une écriture rend à qui l'a demandée : passée, ou refusée **avec le
 * message de la base**.
 *
 * Un `void` qui journalise est la classe qui a coûté 22 montures : la fournée
 * annonçait « enregistré », la ligne n'était pas partie, et rien à l'écran ne
 * séparait les deux cas. Toute écriture dont un écran annonce le résultat rend
 * donc ceci, et l'écran affiche le refus là où on vient de cliquer.
 */
export type WriteResult = { ok: true } | { ok: false; message: string };

export type CloningResult = WriteResult;

/**
 * Assemble les trois sources dont le classement d'élevage a besoin : les arbres
 * figés, les prix de couleurs partagés, et les réglages privés de l'éleveur.
 *
 * Le calcul lui-même reste dans `costs.ts`, pur et testable. Ce hook ne fait que
 * l'alimenter et mémoriser le résultat.
 */

export type FamilyId = 'dragodinde' | 'muldo' | 'volkorne';

/**
 * Les réglages **une fois convertis** : à partir d'ici tout est nombre.
 *
 * `UserBreedingSettings` décrit ce qui sort du réseau, où trois champs sont des
 * `Numeric` — voir `numericSettings`, qui est le seul endroit à les traverser.
 * Le reste de l'app ne doit plus jamais rencontrer une chaîne, et ce type est ce
 * qui le garantit.
 *
 * ## Les trois colonnes retirées de ce type
 *
 * `credit_off_target`, `never_sell_mounts` et `breeder_level` restent en base —
 * les retirer du type est ce qui les met hors de portée. #81 avait retiré les
 * trois de l'écran, en tranchant : le crédit hors cible s'applique toujours, la
 * revente est toujours valorisée, et le niveau d'Éleveur ne nourrissait qu'un
 * avertissement sur le champ d'en dessous.
 *
 * Mais le hook, lui, continuait d'en lire deux. Une ligne enregistrée avant le
 * 6 août figeait donc le comportement à ce qu'elle portait, sans case pour le
 * changer ni rien à l'écran qui le dise — c'est #179, et c'est le genre de panne
 * qui ne ressemble pas à une panne : l'écran affichait une écurie où **aucune**
 * couleur n'est rentable, ce qui se lit comme un marché difficile et non comme
 * un réglage bloqué.
 *
 * Le type est maintenant ce qui l'empêche : plus aucun code ne peut atteindre
 * ces colonnes, et `saveSettings` cesse de les écrire. Elles survivent en base
 * le temps qu'une migration les enlève, avec le commentaire qui dit pourquoi.
 *
 * ## Les six de #94, et pourquoi deux reviennent plutôt que six
 *
 * #94 avait retiré six réglages de plus au nom du même principe — « the model now
 * gives the answer on its own », en prévenant qu'« a wrong value there silently
 * moves every figure on the screen ». Aucun ne s'est arrêté d'être lu, et #181 a
 * demandé de trancher colonne par colonne. Mesuré sur l'export du 17/08, la
 * réponse n'est pas la même pour les six :
 *
 * | colonne | valeur relevée | effet réel | sort |
 * | --- | --- | --- | --- |
 * | `count_net_cost` | `false` | met le prix des filets à zéro | **contrôle rendu** |
 * | `gauge_cap` | `90000` | force la bande, donc toutes les durées | **contrôle rendu** |
 * | `kamas_per_hour` | `0` | aucun — égal au défaut | figé |
 * | `minutes_per_fight` | `1` | **aucun**, voir plus bas | figé |
 * | `net_recovery_rate` | `0.8` | aucun — égal au défaut | figé |
 * | `recycle_steriles` | `true` | aucun — égal au défaut | figé |
 *
 * Les deux premiers sont des faits sur la façon de jouer, comme le nombre
 * d'enclos : ils retournent à l'écran, dans « Mes stocks », à côté de lui.
 *
 * Les quatre autres quittent ce type, ce qui les met hors de portée — voir
 * `FROZEN_ANSWERS`, qui porte la réponse et le raisonnement de chacun. Et
 * `recycle_steriles` était le **sixième** : #181 le rangeait parmi ceux qui
 * gardent leur contrôle, mais il n'en avait aucun non plus.
 */
export type BreedingSettings = Omit<
  UserBreedingSettings,
  | 'user_id'
  | 'updated_at'
  | 'kamas_available'
  | 'credit_off_target'
  | 'never_sell_mounts'
  | 'breeder_level'
  | 'kamas_per_hour'
  | 'minutes_per_fight'
  | 'net_recovery_rate'
  | 'recycle_steriles'
> & {
  kamas_available: number;
};

/**
 * Les réponses que le modèle donne à la place des quatre réglages figés.
 *
 * Elles valent toutes le défaut de leur colonne, et c'est vérifié plutôt que
 * supposé : sur la ligne du 17/08, `kamas_per_hour`, `net_recovery_rate` et
 * `recycle_steriles` portaient déjà exactement ces valeurs. Les figer ne
 * réécrit donc rien.
 *
 * `minutes_per_fight` est le seul qui divergeait — 1 contre 12 — et le seul dont
 * il faut prouver que ça ne change rien. C'est
 * `timeCostPerMount = (minutes / 60) × (kamasPerHour / captures)` : à
 * `kamasPerHour` nul, le facteur entier est nul, quel que soit le nombre de
 * minutes. Le douze contre un n'était pas un écart de coût, c'était un écart
 * multiplié par zéro.
 *
 * **Ce qui rend les trois derniers inertes est le premier.** `kamas_per_hour`
 * n'est pas un réglage parmi les quatre, c'est l'interrupteur du temps : tous les
 * termes de durée du calcul le traversent. Rendre `minutes_per_fight` ou
 * `net_recovery_rate` sans lui n'aurait aucun effet observable ; les revaloriser
 * un jour se fera donc à trois, pas à un.
 */
export const FROZEN_ANSWERS = {
  /** Une heure de jeu ne se convertit pas en kamas — donc aucun coût de temps. */
  kamas_per_hour: 0,
  /** Douze minutes par combat de capture, le défaut de la colonne. */
  minutes_per_fight: 12,
  /** Quatre filets sur cinq se récupèrent après une capture. */
  net_recovery_rate: 0.8,
  /** Les stériles se clonent par deux plutôt que de partir en ambre. */
  recycle_steriles: true,
} as const;

/** Ce que le hook applique tant que l'utilisateur n'a rien réglé. */
export const DEFAULT_SETTINGS: BreedingSettings = {
  enclos_count: 6,
  // 0 = pas de contrainte. Refuser tous les plans à qui n'a pas renseigné son
  // budget serait la pire lecture possible d'un champ vide.
  kamas_available: 0,
  // Le succès de collection est ignoré par défaut, et ce n'est pas de la
  // prudence : les deux autres modes coûtent, l'un et l'autre, des montures que
  // l'échelle réclamait. Voir `success.ts`, qui porte les deux mesures.
  success_mode: 'ignore',
  // Le prix des filets compte par défaut : c'est vrai de qui les achète, et
  // celui qui récolte ses matériaux décoche la case.
  count_net_cost: true,
  gauge_cap: DEFAULT_GAUGE_BAND,
};

/**
 * Les réglages relus **en nombres**, et pas tels que PostgREST les rend.
 *
 * `kamas_available` et `kamas_per_hour` sont des `bigint`, `net_recovery_rate` un
 * `numeric`. PostgREST les sérialise en **chaînes décimales** — un `bigint`
 * dépasse `Number.MAX_SAFE_INTEGER`, donc il ne peut pas voyager en nombre JSON
 * sans risque de perdre des unités. `UserBreedingSettings` les déclare `number` :
 * le type ment sur ce qui arrive vraiment, et `tsc` ne peut rien y voir puisque
 * la valeur ne traverse aucune frontière qu'il inspecte.
 *
 * Le coût de ce mensonge est démesuré. `census.kamas` part de ce champ, et
 * `census.ts` le fait avancer avec `+=` : sur une chaîne, `+=` **concatène**. Le
 * solde devient alors un texte, `expectedScore` et `myopic` rendent un texte à
 * leur tour, et la recherche compare ses candidats **lexicographiquement**. Le
 * classement de la politique n'a plus aucun rapport avec des kamas.
 *
 * Mesuré sur l'écurie du 14/08, à 3 000 000 kamas et 50 places :
 *
 * | | places | croisements | achats |
 * | --- | --- | --- | --- |
 * | solde en chaîne | 2 | 1 | 0 |
 * | solde en nombre | **50** | **23** | **30** |
 *
 * Et ça ne se voyait pas comme une panne : l'écran affichait « 1 accouplement ·
 * 2/50 places », ce qui ressemble à une écurie pauvre, pas à un défaut. Ni le
 * nombre d'enclos ni le budget n'y changeaient rien — 300 M donnaient le même
 * plan que 3 M, ce qui est le seul indice qu'il y avait quelque chose à voir.
 *
 * On convertit donc à l'entrée, une fois, plutôt que chez chaque lecteur : c'est
 * le seul endroit qui sache que la valeur vient d'arriver du réseau.
 */
const numericSettings = (row: UserBreedingSettings): BreedingSettings => {
  const merged = { ...DEFAULT_SETTINGS, ...row };
  // Champ par champ, et non par diffusion : les colonnes retirées voyagent
  // encore dans `row`, et un `...merged` les ferait rentrer par la fenêtre —
  // jusque dans l'`upsert` de `saveSettings`, qui réécrirait ce qu'on vient de
  // cesser de lire.
  return {
    enclos_count: Number(merged.enclos_count),
    kamas_available: Number(merged.kamas_available),
    count_net_cost: merged.count_net_cost,
    success_mode: merged.success_mode,
    // Seul champ qui a le droit d'être absent : `null` veut dire « le moins cher,
    // sans regarder la vitesse », et `Number(null)` vaudrait zéro, c'est-à-dire
    // « plafond nul ». Les deux ne disent pas la même chose.
    //
    // Le `null` d'une ligne existante est donc conservé, et non remplacé par le
    // nouveau défaut : c'est une option que l'écran propose, pas une absence de
    // réponse. La migration qui pose le défaut comble les lignes d'avant, où
    // l'option n'était pas choisissable.
    gauge_cap: merged.gauge_cap === null ? null : Number(merged.gauge_cap),
  };
};

/**
 * Une ligne de la base relue en monture — le **seul** chemin.
 *
 * Cinq endroits le faisaient chacun à la main : le chargement, l'ajout, la
 * promotion d'une sortie d'enclos, la naissance et le clonage. Cinq copies du
 * même dépliage, dont deux réécrivaient en dur ce que la ligne disait déjà
 * (`fertile: true` sur le retour d'un `insert` qui venait de poser `true`), et
 * une posait `parents: null` là où la ligne n'en portait de toute façon pas.
 *
 * Elles étaient toutes justes. Le défaut n'est pas là : c'est qu'ajouter un
 * champ à `Individual` demandait de trouver les cinq, et qu'un sixième site
 * écrit demain n'a rien qui l'oblige à connaître les précédents. `createdAt`,
 * ajouté pour l'audit des clonages, est arrivé par exactement cette porte — il
 * manquait à quatre des cinq, et une monture sans date se serait rangée au
 * hasard dans une liste triée par récence.
 *
 * Le commentaire sur `cycled` a suivi la lecture qu'il explique : c'est ici qu'on
 * décide, une fois, qu'un cycle inconnu vaut « à repayer ».
 */
const individualFromRow = (row: UserBreedingIndividual): Individual => ({
  id: row.id,
  colorId: row.color_id,
  name: row.name ?? null,
  sex: row.sex,
  level: row.level,
  fertile: row.fertile,
  // `?? false` et non le champ nu : la colonne date de la migration
  // 20260809210000, et une base non migrée rendrait `undefined` — ce qui vaut
  // « cycle inconnu », donc à repayer, le sens prudent.
  cycled: row.cycled ?? false,
  // Les deux couleurs vont ensemble ou pas du tout : une ascendance à moitié
  // connue ne se distingue pas d'une monture achetée, et la traiter comme telle
  // vaut mieux que d'inventer le parent manquant.
  parents:
    row.parent_a_color && row.parent_b_color
      ? [row.parent_a_color, row.parent_b_color]
      : null,
  createdAt: row.created_at ?? null,
});

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
  /**
   * Les couleurs déjà nées au moins une fois — le succès de collection.
   *
   * Un `Set` et non un compte : le succès demande « au moins une fois », donc
   * l'appartenance est toute l'information. Voir `success.ts`.
   */
  const [hatched, setHatched] = useState<ReadonlySet<string>>(new Set<string>());
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
          priceRows,
          mountRows,
          individualRows,
          stockRows,
          hatchedRows,
          fuelResponse,
        ] = await Promise.all([
            supabase.from('breeding_color_prices').select('*').eq('family', family),
            supabase.from('user_breeding_settings').select('*').maybeSingle(),
            // Les trois tables sans borne connue passent par `fetchAllRows` : le
            // catalogue tarifé dépasse les 1000 lignes depuis longtemps, et rien
            // ne majore le stock ni le nombre de montures suivies une à une.
            // Un `select` nu les tronquerait en silence — l'élevage lisait alors
            // « prix manquants » sur des recettes tarifées la semaine d'avant.
            fetchAllRows<ItemPrice>((from, to) =>
              supabase
                .from('item_prices')
                .select('*')
                .order('item_id', { ascending: true })
                .range(from, to)
            ),
            supabase.from('user_breeding_mounts').select('*').eq('family', family),
            fetchAllRows<UserBreedingIndividual>((from, to) =>
              supabase
                .from('user_breeding_individuals')
                .select('*')
                .eq('family', family)
                .order('id', { ascending: true })
                .range(from, to)
            ),
            fetchAllRows<UserItemStock>((from, to) =>
              supabase
                .from('user_item_stock')
                .select('*')
                .order('item_id', { ascending: true })
                .range(from, to)
            ),
            // La collection : une ligne par couleur déjà née, donc au plus 120 par
            // famille. Une page suffit, et `fetchAllRows` serait du zèle.
            supabase.from('user_breeding_hatched').select('color_id').eq('family', family),
            // Les 120 carburants d'enclos tiennent en une page du miroir local :
            // c'est ce qui chiffre le cycle de fécondité et la montée en niveau.
            fetch(`/api/dofusdb/items?typeId=${FUEL_TYPE_ID}&limit=200`).then((response) =>
              response.ok ? response.json() : { data: [] }
            ),
          ]);

        if (colorRows.error) throw colorRows.error;

        /**
         * Les prix de couleurs, **en nombres**.
         *
         * `breeding_color_prices.price` est un `bigint` : PostgREST le sérialise
         * en chaîne décimale, et `ColorPrice` le déclare `number`. Le type mentait
         * donc, exactement comme il mentait sur les réglages — voir
         * `numericSettings`.
         *
         * Et `tsc` ne pouvait pas le voir, pour une raison qui vaut d'être nommée :
         * la valeur passait par une **clé calculée**,
         * `[row.mount_level === 0 ? 'level0' : 'level200']: row.price`. Une clé
         * calculée élargit le type du littéral, si bien que le compilateur cesse de
         * confronter la valeur au champ visé. Écrire les deux champs en clair est
         * donc autant le correctif que la conversion : remettre un `Numeric` ici
         * échoue maintenant à la compilation, ce qui rend la classe détectable la
         * prochaine fois.
         *
         * Ce que ça coûtait : `estimate.cost` valait la chaîne `"6000"` sur toute
         * couleur qu'il vaut mieux **acheter** — cette stratégie retient le prix
         * saisi tel quel. Les multiplications s'en sortaient, JS coerçant `*`, donc
         * le chiffrage des routes tenait. Une **addition** non. L'onglet HDV,
         * premier à en faire une, affichait un Indigo gen 1 à `"6000" + 74872` =
         * **600 074 872** kamas de revient.
         */
        const nextPrices = new Map<string, ColorPrice>();
        for (const row of (colorRows.data ?? []) as BreedingColorPrice[]) {
          const current = nextPrices.get(row.color_id) ?? { level0: null, level200: null };
          const price = toNumber(row.price);
          nextPrices.set(row.color_id, {
            level0: row.mount_level === 0 ? price : current.level0,
            level200: row.mount_level === 200 ? price : current.level200,
          });
        }
        setPrices(nextPrices);

        setHatched(
          new Set((hatchedRows.data ?? []).map((row) => (row as { color_id: string }).color_id))
        );
        setItemPrices(new Map(priceRows.map((row) => [row.item_id, row])));
        setFuelItems((fuelResponse as DofusDBResponse<DofusDBItem>).data ?? []);

        setStable({
          bulk: new Map(
            ((mountRows.data ?? []) as UserBreedingMount[])
              .filter((row) => row.males > 0 || row.females > 0)
              .map((row) => [
                row.color_id,
                {
                  males: row.males,
                  females: row.females,
                  // Absentes des lignes écrites avant la migration : `?? 0` vaut
                  // « aucune féconde », ce qui est l'état d'avant.
                  cycledMales: row.cycled_males ?? 0,
                  cycledFemales: row.cycled_females ?? 0,
                },
              ])
          ),
          individuals: individualRows.map(individualFromRow),
        });
        setItemStock(
          new Map(
            stockRows
              .filter((row) => row.quantity > 0)
              .map((row) => [row.item_id, row.quantity])
          )
        );

        // Absence de ligne = utilisateur qui n'a jamais réglé : les défauts
        // s'appliquent sans qu'il faille créer la ligne à l'avance.
        if (settingRows.data) setSettings(numericSettings(settingRows.data));
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
        [...stockBySex].map(
          ([colorId, { males, females }]) =>
            // Une couleur dont l'écurie ne tient qu'un sexe ne fait aucun couple :
            // la créditer figerait le plan sur une étape qu'il croit faite. Voir
            // `breedableStock`, dont c'est la règle — appliquée ici sur les
            // effectifs déjà agrégés plutôt qu'en reparcourant l'écurie.
            [colorId, males > 0 && females > 0 ? males + females : 0] as const
        )
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
    (colorId: string, parents: [string, string], sex: Sex): string =>
      mountName({
        carriedGeneration: carriedGeneration(colorIndex.generations.get(colorId) ?? 1, [
          colorIndex.generations.get(parents[0]) ?? 1,
          colorIndex.generations.get(parents[1]) ?? 1,
        ]),
        colorName: colorIndex.names.get(colorId) ?? colorId,
        sex,
        parentNames: [
          colorIndex.names.get(parents[0]) ?? parents[0],
          colorIndex.names.get(parents[1]) ?? parents[1],
        ],
        code: colorCoder(tree?.colors ?? []),
      }),
    [colorIndex, tree]
  );

  /** Prix nu d'un item, pour les co-produits qu'on ne fait que revendre. */
  const priceOf = useCallback(
    (itemId: number) => toNumber(itemPrices.get(itemId)?.price),
    [itemPrices]
  );

  /** Valeur d'un généton : le meilleur des échanges de parchemins. */
  const genetonValuation = useMemo(
    () =>
      bestGenetonValue(
        GENETON_EXCHANGE,
        new Map([...itemPrices].map(([id, row]) => [id, toNumber(row.price)]))
      ),
    [itemPrices]
  );

  /** Carburants et filets, traduits en coûts par le catalogue et les prix. */
  const supplies = useMemo(
    () =>
      tree
        ? computeSupplyCosts(fuelItems, tree.nets, itemPrices, {
            // Les trois réponses figées, et non des réglages : voir `FROZEN_ANSWERS`.
            kamasPerHour: FROZEN_ANSWERS.kamas_per_hour,
            minutesPerFight: FROZEN_ANSWERS.minutes_per_fight,
            netRecoveryRate: FROZEN_ANSWERS.net_recovery_rate,
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
        recycleSteriles: FROZEN_ANSWERS.recycle_steriles,
        freeXpPoints,
      })
    );
    // Plus de `settings` ici : le seul réglage que ce calcul lisait était
    // `recycle_steriles`, qui est devenu une réponse figée. Le garder ferait
    // recalculer les 120 couleurs à chaque frappe dans « Kamas engageables ».
  }, [tree, prices, supplies, genetonValuation, priceOf]);

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
          recycleSteriles: FROZEN_ANSWERS.recycle_steriles,
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
          recycleSteriles: FROZEN_ANSWERS.recycle_steriles,
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
          funding: planFunding(plan, estimates, toNumber(settings.kamas_available), {
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
        reportWriteFailure('le prix de cette couleur', saveError);
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
    async (
      colorId: string,
      totalMales: number,
      totalFemales: number,
      cycled?: { males: number; females: number }
    ) => {
      const tracked = stable.individuals.filter(
        (mount) => mount.colorId === colorId && mount.fertile
      );
      const trackedMales = tracked.filter((mount) => mount.sex === 'M').length;
      const trackedFemales = tracked.length - trackedMales;

      const males = Math.max(0, totalMales - trackedMales);
      const females = Math.max(0, totalFemales - trackedFemales);

      // Les fécondes sont un sous-ensemble : on ne peut pas en avoir plus que de
      // fertiles, et un appel qui ne les mentionne pas garde celles qui sont là.
      const kept = stable.bulk.get(colorId);
      const cycledMales = Math.min(cycled?.males ?? kept?.cycledMales ?? 0, males);
      const cycledFemales = Math.min(cycled?.females ?? kept?.cycledFemales ?? 0, females);

      setStable((current) => {
        const bulk = new Map(current.bulk);
        if (males > 0 || females > 0) {
          bulk.set(colorId, { males, females, cycledMales, cycledFemales });
        } else bulk.delete(colorId);
        return { ...current, bulk };
      });

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_mounts')
        .upsert(
          {
            family,
            color_id: colorId,
            males,
            females,
            cycled_males: cycledMales,
            cycled_females: cycledFemales,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,family,color_id' }
        );

      // L'état local est déjà parti devant — c'est voulu, le classement entier
      // se recalcule à chaque frappe — donc l'écran montre le compteur saisi
      // que la base l'ait pris ou non. D'où le signalement : sans lui, rien ne
      // distingue les deux jusqu'au rechargement.
      if (saveError) reportWriteFailure('le compteur de vrac de cette couleur', saveError);
    },
    [family, stable.bulk, stable.individuals]
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
      /** Fertile, féconde ou stérile — voir `mountStatus`. Fertile par défaut. */
      status?: MountStatus;
    }) => {
      const supabase = createClient();
      const { data, error: saveError } = await supabase
        .from('user_breeding_individuals')
        .insert({
          family,
          color_id: mount.colorId,
          // Une monture sans ascendance est achetée ou capturée : elle n'a rien
          // à inscrire, donc « Anonyme » — qui est déjà son nom dans le jeu. En
          // dicter un ferait renommer pour rien.
          name: mount.parents ? nameForBirth(mount.colorId, mount.parents, mount.sex) : null,
          sex: mount.sex,
          level: mount.level ?? 1,
          ...statusFlags(mount.status ?? 'fertile'),
          parent_a_color: mount.parents?.[0] ?? null,
          parent_b_color: mount.parents?.[1] ?? null,
        })
        .select()
        .single();

      if (saveError || !data) {
        reportWriteFailure('la monture à ajouter à l’écurie', saveError);
        // Le message de la base et non un texte à nous : une colonne absente,
        // une contrainte violée ou une session expirée demandent trois gestes
        // différents, et seul PostgREST sait lequel. Le résumer en « échec »
        // rendrait l'écran aussi muet qu'avant.
        return {
          ok: false as const,
          message: saveError?.message ?? 'La base n’a rien renvoyé.',
        };
      }

      const added = individualFromRow(data as UserBreedingIndividual);

      setStable((current) => ({ ...current, individuals: [...current.individuals, added] }));
      return { ok: true as const, mount: added };
    },
    [family, nameForBirth]
  );

  /**
   * Passe en **fécondes** les montures qui sortent de l'enclos.
   *
   * C'est la boucle qui manquait à tout le parcours. Le ruban savait dire quoi
   * charger, quand ce serait fini, et quoi saisir ensuite — mais rien n'écrivait
   * jamais le résultat du chargement. Une fournée de quarante places laissait
   * donc quarante cases à recocher une par une dans « Mes stocks », et tant
   * qu'elles ne l'étaient pas, la politique voyait des fertiles là où l'éleveur
   * tenait des fécondes : elle leur réservait des places d'enclos déjà payées et
   * proposait d'acheter à côté.
   *
   * Ne touche que les **fertiles** : une stérile qui traînerait dans la liste ne
   * doit pas ressusciter en féconde, et la base refuse la combinaison de toute
   * façon (migration 20260809210000).
   *
   * ## Le niveau sort d'ici aussi
   *
   * Une monture ne ressort pas de l'enclos comme elle y est entrée : elle a
   * monté. Et le niveau n'est pas décoratif — c'est lui qui décide du taux de
   * réussite d'un croisement, donc de ce que la politique propose ensuite. Le
   * relever ailleurs voudrait dire le relever plus tard, c'est-à-dire jamais :
   * la seule fois où l'éleveur a les quarante fiches sous les yeux, c'est en les
   * sortant. D'où une saisie par monture plutôt qu'un simple drapeau.
   *
   * Les écritures se groupent par niveau : une fournée en porte deux ou trois
   * valeurs distinctes, pas quarante, et une requête par monture ferait
   * quarante allers-retours pour la même chose.
   *
   * ## Sortir de l'enclos, c'est entrer à l'écurie suivie
   *
   * Trois sortes de montures entrent dans un enclos : des suivies, du vrac en
   * stock, et ce que le plan est allé **procurer** — acheté ou capturé, et que
   * rien n'enregistre avant cet écran.
   *
   * Toutes en sortent **suivies**, avec leur niveau. Tant qu'une monture n'est
   * qu'un compteur, elle vaut `BULK_MATE_LEVEL`, soit 1 : or le niveau décide du
   * taux de réussite d'un croisement, donc la laisser au compteur après un cycle
   * d'enclos saboterait tous ses accouplements suivants — et c'est le seul moment
   * où l'éleveur a les quarante fiches sous les yeux.
   *
   * Ce qui quitte le vrac est décompté du stock : on ne le compte plus par
   * couleur, on le connaît une par une. Une procurée n'était nulle part, il n'y a
   * donc rien à en retirer — seulement une ligne à ouvrir.
   *
   * Aucune n'a d'ascendance, et c'est un état que l'écurie suivie accepte déjà
   * (l'ajout manuel propose « les deux couleurs de l'ascendance, **ou rien** »).
   * Leur lecture généalogique est donc inchangée : ce qu'elles gagnent, c'est
   * leur niveau.
   */
  const recordEnclosExit = useCallback(
    async (entries: { id: string; level: number }[]) => {
      const known = new Map(stable.individuals.map((mount) => [mount.id, mount]));

      /** Les suivies : un niveau et un drapeau, ligne par ligne. */
      const levelOf = new Map<number, string[]>();
      const levelById = new Map<string, number>();
      /**
       * Les comptées : des quantités, par couleur et par sexe.
       *
       * Le vrac qui sort d'un enclos **quitte le compteur** : il devient une
       * monture suivie. Ce qu'on ne compte plus par couleur, on le connaît une par
       * une — ce qui est tout l'objet de cette sortie.
       */
      const bulkExits = new Map<string, { males: number; females: number }>();

      /**
       * Les montures à inscrire à l'écurie suivie.
       *
       * Une monture comptée — vrac en stock ou procurée — vaut `BULK_MATE_LEVEL`,
       * soit 1, tant qu'elle n'a pas de ligne à elle. Or c'est le **niveau** qui
       * décide du taux de réussite d'un croisement : la laisser au compteur après
       * un cycle d'enclos reviendrait à saboter tous ses accouplements suivants,
       * alors qu'on tient justement sa fiche sous les yeux.
       *
       * Sans ascendance : ni le vrac ni un achat n'en ont, et c'est un état que
       * l'écurie suivie accepte déjà — l'ajout manuel le propose (« les deux
       * couleurs de l'ascendance, ou rien »). Elles gardent donc exactement la
       * même lecture généalogique qu'au compteur, et gagnent leur niveau.
       */
      const promoted: { colorId: string; sex: Sex; level: number }[] = [];

      for (const entry of entries) {
        const counted = parseCountedMountId(entry.id);
        if (counted) {
          promoted.push({
            colorId: counted.colorId,
            sex: counted.sex,
            level: Math.max(1, Math.min(200, entry.level)),
          });
          // Une monture procurée n'était pas au compteur : rien à en retirer.
          if (!counted.acquired) {
            const current = bulkExits.get(counted.colorId) ?? { males: 0, females: 0 };
            if (counted.sex === 'M') current.males += 1;
            else current.females += 1;
            bulkExits.set(counted.colorId, current);
          }
          continue;
        }

        // Une stérile qui traînerait dans la liste ne doit pas ressusciter en
        // féconde, et la base refuse la combinaison de toute façon.
        const mount = known.get(entry.id);
        if (!mount || !mount.fertile) continue;
        const level = Math.max(1, Math.min(200, entry.level));
        levelById.set(entry.id, level);
        levelOf.set(level, [...(levelOf.get(level) ?? []), entry.id]);
      }

      // Rien à écrire n'est pas un échec : la liste ne portait que des stériles,
      // et l'enclos peut quitter la fournée sans laisser de dette.
      if (levelById.size === 0 && promoted.length === 0) return { written: 0, complete: true };

      // Ce qui quitte le compteur en sort pour de bon. `cycledOf` borne déjà les
      // fécondes au stock, mais le plancher se reprend ici : la base refuse un
      // compteur négatif, et une fournée peut vider une couleur entièrement.
      const nextBulk = new Map([...stable.bulk].map(([id, counts]) => [id, { ...counts }]));
      for (const [colorId, out] of bulkExits) {
        const current = nextBulk.get(colorId);
        if (!current) continue;
        const banked = cycledOf(current);
        const males = Math.max(0, current.males - out.males);
        const females = Math.max(0, current.females - out.females);
        nextBulk.set(colorId, {
          males,
          females,
          // Les sortantes n'étaient pas fécondes — la liste de sortie les exclut —
          // donc le compte de fécondes ne baisse pas, il se reborne seulement.
          cycledMales: Math.min(males, banked.males),
          cycledFemales: Math.min(females, banked.females),
        });
      }

      const supabase = createClient();
      const stamp = new Date().toISOString();

      /**
       * Est-ce que **tout** a atterri ?
       *
       * Chaque écriture ci-dessous signalait son échec dans la bannière puis
       * laissait la fonction rendre le compte de ce qu'elle avait *tenté*.
       * L'appelant lisait ce compte comme un succès et retirait l'enclos de la
       * fournée : les montures restaient en enclos dans le jeu, absentes de
       * l'écurie et absentes de la fournée — introuvables des deux côtés, ce qui
       * est strictement pire que le défaut d'origine.
       *
       * On rend donc ce qui a été écrit **et** si quelque chose manque, parce
       * que seul le second permet de décider s'il reste quelque chose à
       * rattraper.
       */
      let complete = true;

      // Les promues d'abord : leurs identifiants viennent de la base, et l'état
      // local doit porter les mêmes pour qu'un accouplement puisse les désigner.
      let inserted: Individual[] = [];
      if (promoted.length > 0) {
        const { data, error: promoteError } = await supabase
          .from('user_breeding_individuals')
          .insert(
            promoted.map((mount) => ({
              family,
              color_id: mount.colorId,
              sex: mount.sex,
              level: mount.level,
              // Elle sort de l'enclos : son cycle est payé.
              fertile: true,
              cycled: true,
              // Pas d'ascendance, et pas de nom : l'éleveur n'en a dicté aucun en
              // jeu, et en inventer un ici désignerait une monture introuvable.
              name: null,
              parent_a_color: null,
              parent_b_color: null,
            }))
          )
          .select();

        if (promoteError) {
          reportWriteFailure(
            `les ${promoted.length} montures comptées à inscrire à l’écurie`,
            promoteError
          );
          complete = false;
        }

        // Sans ascendance : la promotion n'en insère aucune, donc la ligne
        // relue n'en porte pas — le `parents: null` qui était écrit ici en dur
        // disait la même chose, une fois de plus.
        inserted = (data ?? []).map(individualFromRow);
      }

      // Les mises à jour **avant** l'état local, et non l'inverse : une monture
      // affichée féconde sur une écriture perdue redeviendrait fertile au
      // rechargement suivant, sans que rien n'ait prévenu entre les deux. On ne
      // reflète donc que ce que la base a pris.
      const cycled = new Map<string, number>();
      for (const [level, ids] of levelOf) {
        const { error: saveError } = await supabase
          .from('user_breeding_individuals')
          .update({ cycled: true, level, updated_at: stamp })
          .in('id', ids);
        if (saveError) {
          reportWriteFailure(`la sortie d’enclos de ${ids.length} monture(s) au niveau ${level}`, saveError);
          complete = false;
          continue;
        }
        for (const id of ids) cycled.set(id, level);
      }

      let bulkWritten = false;
      if (bulkExits.size > 0) {
        const { error: bulkError } = await supabase.from('user_breeding_mounts').upsert(
          [...bulkExits.keys()].map((colorId) => ({
            family,
            color_id: colorId,
            males: nextBulk.get(colorId)?.males ?? 0,
            females: nextBulk.get(colorId)?.females ?? 0,
            cycled_males: nextBulk.get(colorId)?.cycledMales ?? 0,
            cycled_females: nextBulk.get(colorId)?.cycledFemales ?? 0,
            updated_at: stamp,
          })),
          { onConflict: 'user_id,family,color_id' }
        );
        if (bulkError) {
          reportWriteFailure('le vrac sorti d’enclos', bulkError);
          complete = false;
        } else bulkWritten = true;
      }

      setStable((current) => ({
        ...current,
        bulk: bulkWritten ? nextBulk : current.bulk,
        individuals: [
          ...current.individuals.map((mount) =>
            cycled.has(mount.id)
              ? { ...mount, cycled: true, level: cycled.get(mount.id)! }
              : mount
          ),
          ...inserted,
        ],
      }));

      // Ce qui est **écrit**, et non ce qui a été tenté. Le compte couvre les
      // deux familles — suivies et comptées — sinon la sortie annoncerait moins
      // de montures que la liste n'en portait.
      return { written: cycled.size + inserted.length, complete };
    },
    [family, stable.bulk, stable.individuals]
  );

  /**
   * Corrige une monture suivie : niveau, sexe ou fertilité.
   *
   * L'écran part devant — la liste se refiltre à la frappe — mais un refus
   * **revient en arrière** et se dit. Il ne faisait ni l'un ni l'autre : l'état
   * local gardait la correction, la base gardait l'ancienne valeur, et les deux
   * ne se départageaient qu'au rechargement suivant. Même classe que la
   * suppression d'à côté, qui elle remettait déjà la monture retirée.
   *
   * Elle rend maintenant son résultat, parce qu'un appelant l'annonce : l'audit
   * des clonages dit « remise stérile » après avoir cliqué, et le dire sur une
   * écriture refusée est exactement le mensonge que `reportWriteFailure` existe
   * pour empêcher.
   */
  const updateIndividual = useCallback(
    async (
      id: string,
      patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'cycled' | 'name'>>
    ): Promise<WriteResult> => {
      // Ce qu'on écrase, gardé de côté pour pouvoir le remettre.
      const before = stable.individuals.find((mount) => mount.id === id);

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

      if (saveError) {
        if (before) {
          setStable((current) => ({
            ...current,
            individuals: current.individuals.map((mount) =>
              mount.id === id ? before : mount
            ),
          }));
        }
        return {
          ok: false as const,
          message: reportWriteFailure('la correction de cette monture', saveError),
        };
      }
      return { ok: true as const };
    },
    [stable.individuals]
  );

  /**
   * Réécrit **l'identité** d'une monture : couleur, sexe, nom, ascendance.
   *
   * Le rattrapage d'un clonage saisi de travers. Le jeu tire la survivante,
   * l'éleveur consigne l'autre, et la ligne porte alors une ascendance qui n'est
   * pas celle de la monture qui existe réellement. Voir `clone-audit.ts`.
   *
   * ## Pourquoi corriger la ligne et non la remplacer
   *
   * Supprimer puis rajouter donnerait le même contenu et perdrait le reste :
   * l'identifiant, que les `parent_a_id` / `parent_b_id` des enfants
   * référencent, et la date d'entrée. La compétence `ecurie-en-jeu` pose la
   * règle après un recensement entier — « éditer sur place, ça préserve
   * l'ascendance et l'historique qu'un supprimer-réimporter jette ».
   *
   * `updateIndividual` ne pouvait pas le faire, et pas par oubli : ses clés sont
   * celles du modèle (`colorId`, `parents`) et se versent telles quelles dans
   * l'`update`, là où la base attend `color_id`, `parent_a_color`,
   * `parent_b_color`. La traduction se fait donc ici, une fois, plutôt que
   * d'élargir un chemin qui marche par coïncidence de noms.
   */
  const recastIndividual = useCallback(
    async (
      id: string,
      identity: { colorId: string; sex: Sex; name: string | null; parents: [string, string] | null }
    ): Promise<WriteResult> => {
      const before = stable.individuals.find((mount) => mount.id === id);
      if (!before) {
        return { ok: false as const, message: 'Cette monture n’est plus dans l’écurie.' };
      }

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_individuals')
        .update({
          color_id: identity.colorId,
          sex: identity.sex,
          name: identity.name,
          parent_a_color: identity.parents?.[0] ?? null,
          parent_b_color: identity.parents?.[1] ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (saveError) {
        return {
          ok: false as const,
          message: reportWriteFailure('la correction de cette monture', saveError),
        };
      }

      // Après l'écriture et non avant : celle-ci n'est pas une frappe dans un
      // champ, c'est un clic unique. Rien ne gagne à afficher une identité que
      // la base n'a pas prise, et l'annuler ensuite ferait clignoter la ligne.
      setStable((current) => ({
        ...current,
        individuals: current.individuals.map((mount) =>
          mount.id === id ? { ...mount, ...identity } : mount
        ),
      }));
      return { ok: true as const };
    },
    [stable.individuals]
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
   *
   * ## L'ordre des deux écritures, qui a coûté 22 montures
   *
   * Les deux partaient ensemble, dans un `Promise.all`. Le 15 août 2026 à
   * 12:44:26, sur une fournée de 22 accouplements, la stérilisation est passée
   * et l'insertion a échoué : 44 parents stériles, zéro poulain, et un
   * `console.error` dans une console que personne ne regardait. La fenêtre a
   * annoncé « 22 naissances enregistrées » et s'est refermée en effaçant la
   * saisie. L'écart s'est vu le lendemain, à la main, en comparant l'écurie du
   * jeu — 225 — à celle de l'outil — 203.
   *
   * Les deux sens d'échec ne se valent pas, et c'est ce qui décide de l'ordre :
   *
   * * **poulain écrit, parents encore fertiles** — la fournée suivante
   *   reproposera deux montures déjà dépensées. L'éleveur le voit devant
   *   l'enclos, qui refuse l'accouplement, et corrige en deux clics.
   * * **parents stérilisés, poulain perdu** — rien à l'écran ne le dit, et la
   *   seule information qui manquait, c'est-à-dire *ce qui est né*, n'existait
   *   que dans la fenêtre qui vient de se fermer. Irrécupérable.
   *
   * Donc : **le poulain d'abord, seul, et les parents seulement s'il est
   * passé.** Un échec à la première étape ne laisse rien derrière lui — d'où le
   * `ok: false` que la fenêtre relit pour garder le clic.
   */
  const recordBirths = useCallback(
    async (entries: BirthEntry[]): Promise<RecordBirthsResult> => {
      if (entries.length === 0 || !tree) return { ok: true as const, born: [] };
      const supabase = createClient();
      const generations = new Map(tree.colors.map((color) => [color.id, color.generation]));

      /** Individus à passer stériles, et effectifs de vrac à décrémenter. */
      const steriles = new Set<string>();
      const bulkSpent = new Map<string, { males: number; females: number }>();
      const byId = new Map(stable.individuals.map((mount) => [mount.id, mount]));
      /**
       * L'état de chaque parent **avant** qu'on le consomme, retenu couple par
       * couple : c'est ce que l'annulation d'une naissance rendra. Voir
       * `ConsumedParent` — une féconde doit retrouver sa fécondité, pas
       * seulement sa fertilité.
       */
      const consumedBy: ConsumedParent[][] = [];

      for (const entry of entries) {
        const consumed: ConsumedParent[] = [];
        consumedBy.push(consumed);
        for (const side of [entry.male, entry.female]) {
          // Une monture comptée n'a **pas** de ligne à passer stérile : `flatten`
          // lui fabrique un identifiant pour que le plan puisse la désigner par
          // son indice, et cet identifiant ne désigne aucune ligne. Le producteur
          // rend maintenant `null` dans ce cas (voir `couplesToRecord`) ; le
          // relire ici est le second verrou, parce que la panne était muette —
          // Postgres refusait `dore#M0` sur une colonne `uuid`, la fournée
          // repartait en lecture, et les poulains étaient déjà insérés.
          if (side.mountId && parseCountedMountId(side.mountId) === null) {
            steriles.add(side.mountId);
            const before = byId.get(side.mountId);
            if (before) {
              consumed.push({
                id: before.id,
                fertile: before.fertile,
                cycled: before.cycled,
              });
            }
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
          name: nameForBirth(entry.colorId, [entry.male.colorId, entry.female.colorId], entry.sex),
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
        // Les fécondes partent en premier, parce que c'est ce que le plan fait :
        // un couple de fécondes ne coûte aucune place, donc la politique les
        // dépense avant tout le reste. Le vrac n'a pas d'identité, donc on ne peut
        // pas le savoir monture par monture — on suit la même règle qu'elle.
        const banked = cycledOf(current);
        nextBulk.set(colorId, {
          males: Math.max(0, current.males - spent.males),
          females: Math.max(0, current.females - spent.females),
          cycledMales: Math.max(0, banked.males - spent.males),
          cycledFemales: Math.max(0, banked.females - spent.females),
        });
      }
      for (const [colorId, born] of bulkBorn) {
        const current = nextBulk.get(colorId) ?? { males: 0, females: 0 };
        // Un poulain naît fertile et **non fécond** : son cycle est à payer.
        nextBulk.set(colorId, {
          ...current,
          males: current.males + born.males,
          females: current.females + born.females,
        });
      }

      // 1. Le poulain, seul et en premier. Tant que cette ligne n'est pas en
      //    base, rien d'autre ne bouge : un échec ici doit laisser la fournée
      //    exactement dans l'état où on l'a trouvée, pour qu'elle se rejoue.
      const insertResult =
        individualsBorn.length > 0
          ? await supabase.from('user_breeding_individuals').insert(individualsBorn).select()
          : { data: [] as UserBreedingIndividual[], error: null };

      if (insertResult.error || !insertResult.data) {
        return {
          ok: false as const,
          message: reportWriteFailure(
            entries.length > 1
              ? `${entries.length} naissances de la fournée`
              : 'la naissance saisie',
            insertResult.error ?? 'La base n’a rien renvoyé.'
          ),
        };
      }

      const rows = insertResult.data as UserBreedingIndividual[];
      const added = rows.map(individualFromRow);

      // 2. Les parents. Le poulain est acquis : ce qui suit ne peut plus rien
      //    faire perdre, seulement laisser une monture dépensée en trop dans la
      //    fournée suivante — ce que l'enclos signalera de lui-même. On le dit
      //    quand même, fort, parce que « visible plus tard » n'est pas
      //    « visible ».
      let partial = false;

      /**
       * La collection, et c'est le **seul** chemin qui la remplit.
       *
       * Ni déduction depuis l'écurie, ni saisie manuelle : l'éleveur achète aussi
       * des montures qui portent une généalogie, donc « parents renseignés » ne
       * prouve pas qu'il l'a fait naître. Une naissance saisie ici, oui.
       *
       * Conséquence assumée : le compteur part de zéro et ignore tout ce qui a été
       * élevé avant que cette table existe. Rien de faux n'y entre, ce qui est le
       * compromis retenu — voir `success.ts`.
       *
       * `ignoreDuplicates` parce que le succès demande « au moins une fois » :
       * réenregistrer une couleur déjà collectionnée doit être un geste vide, pas
       * un conflit. Et l'échec ne perd rien de récupérable — la monture est en
       * base, seul le compteur du succès retarde — donc il se signale sans faire
       * échouer la saisie.
       */
      const bornColors = [...new Set(added.map((mount) => mount.colorId))];
      const fresh = bornColors.filter((colorId) => !hatched.has(colorId));
      if (fresh.length > 0) {
        const { error: hatchedError } = await supabase
          .from('user_breeding_hatched')
          .upsert(
            fresh.map((colorId) => ({ family, color_id: colorId })),
            { onConflict: 'user_id,family,color_id', ignoreDuplicates: true }
          );
        if (hatchedError) {
          partial = true;
          reportWriteFailure(
            fresh.length > 1
              ? `les ${fresh.length} couleurs à ajouter au succès — les poulains, eux, sont enregistrés`
              : 'la couleur à ajouter au succès — le poulain, lui, est enregistré',
            hatchedError
          );
        } else {
          setHatched((current) => new Set([...current, ...fresh]));
        }
      }

      /*
       * Ici se referme la boucle des anonymes stériles, et ce n'est **pas**
       * corrigé : un parent anonyme consommé devient une anonyme stérile, que
       * l'écurie propose ensuite de retirer. Chaque fournée en refabrique.
       *
       * Le geste juste serait de le supprimer plutôt que de le stériliser — il
       * ne peut plus rien, et sans nom il n'y a rien à préserver. Ce qui manque
       * est l'annulation : `ConsumedParent` ne porte que `{ id, fertile, cycled }`,
       * donc `undoBirth` remet un état par `update`, et un `update` sur une ligne
       * supprimée ne trouve rien **sans erreur**. Annuler une naissance perdrait
       * le parent, en silence, sur le chemin d'écriture qui a déjà coûté 22
       * montures.
       *
       * Le faire proprement demande d'élargir `ConsumedParent` à la monture
       * entière et de réinsérer à l'annulation. C'est un changement à part.
       */
      if (steriles.size > 0) {
        const { error: sterileError } = await supabase
          .from('user_breeding_individuals')
          // L'accouplement consomme les deux parents **et** leur cycle : une
          // stérile n'est plus cyclée, elle n'a plus de jauges à porter.
          .update({ fertile: false, cycled: false, updated_at: new Date().toISOString() })
          .in('id', [...steriles]);
        if (sterileError) {
          partial = true;
          reportWriteFailure(
            `les ${steriles.size} parents à passer stériles — le poulain, lui, est bien enregistré`,
            sterileError
          );
        }
      }

      const touched = [...new Set([...bulkSpent.keys(), ...bulkBorn.keys()])];
      if (touched.length > 0) {
        const { error: bulkError } = await supabase.from('user_breeding_mounts').upsert(
          touched.map((colorId) => ({
            family,
            color_id: colorId,
            males: nextBulk.get(colorId)?.males ?? 0,
            females: nextBulk.get(colorId)?.females ?? 0,
            cycled_males: nextBulk.get(colorId)?.cycledMales ?? 0,
            cycled_females: nextBulk.get(colorId)?.cycledFemales ?? 0,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'user_id,family,color_id' }
        );
        if (bulkError) {
          partial = true;
          reportWriteFailure('le compteur de vrac de la fournée', bulkError);
        }
      }

      setStable((current) => ({
        bulk: nextBulk,
        individuals: [
          ...current.individuals.map((mount) =>
            steriles.has(mount.id) ? { ...mount, fertile: false, cycled: false } : mount
          ),
          ...added,
        ],
      }));

      // Une écriture d'après-naissance a manqué : l'état local vient d'être posé
      // sur une base qui ne dit pas la même chose. On relit plutôt que de garder
      // les deux versions.
      if (partial) load();

      return {
        ok: true as const,
        // L'ordre des lignes rendues est celui de l'insertion, donc celui des
        // entrées : c'est ce qui rattache chaque poulain aux parents qu'il a
        // consommés. La fenêtre de saisie n'en écrit qu'un à la fois depuis
        // qu'elle enregistre au clic, donc le cas à plusieurs ne sert plus qu'aux
        // rattrapages.
        born: rows.map((row, index) => ({
          id: row.id,
          colorId: row.color_id,
          sex: row.sex,
          name: row.name ?? '',
          parents: consumedBy[index] ?? [],
        })),
      };
    },
    // `hatched` sert à ne pas réécrire une couleur déjà collectionnée. Le lire
    // ici n'est qu'une économie de requête : l'`upsert` est de toute façon
    // idempotent, donc une lecture périmée ne peut rien casser.
    [family, tree, stable, load, nameForBirth, hatched]
  );

  /**
   * Défait une naissance déjà écrite : le poulain part, les parents reviennent.
   *
   * Existe parce que la saisie enregistre désormais **au clic**. Le brouillon
   * qui permettait de se reprendre avant d'écrire n'existe plus — c'était lui le
   * défaut, puisqu'il pouvait disparaître avec la fenêtre — donc « annuler le
   * dernier » doit maintenant défaire quelque chose de réel.
   *
   * Les parents retrouvent l'état retenu au moment du clic, et non « fertile » :
   * une féconde accouplée par erreur doit récupérer son cycle, sans quoi
   * l'annulation lui coûterait une place d'enclos qu'elle a déjà payée.
   */
  const undoBirth = useCallback(
    async (record: BirthRecord): Promise<boolean> => {
      const supabase = createClient();

      const { error: deleteError } = await supabase
        .from('user_breeding_individuals')
        .delete()
        .eq('id', record.id);

      if (deleteError) {
        reportWriteFailure(`l’annulation de « ${record.name} »`, deleteError);
        return false;
      }

      // À partir d'ici la naissance **est** défaite : le poulain n'est plus en
      // base. Ce qui suit ne peut plus la ramener, donc l'appelant reçoit `true`
      // même si un parent résiste — sinon la fenêtre garderait à l'écran une
      // naissance qui n'existe plus, ce qui est précisément le mensonge qu'on
      // vient de supprimer partout ailleurs. Le parent récalcitrant, lui, part
      // dans la bannière.
      //
      // Les parents un par un : ils ne reviennent pas tous au même état, et un
      // `update … in(…)` écrirait le même couple de booléens sur les deux.
      let restored = true;
      for (const parent of record.parents) {
        const { error: restoreError } = await supabase
          .from('user_breeding_individuals')
          .update({
            fertile: parent.fertile,
            cycled: parent.cycled,
            updated_at: new Date().toISOString(),
          })
          .eq('id', parent.id);
        if (restoreError) {
          restored = false;
          reportWriteFailure(
            'un parent à remettre dans son état d’avant l’accouplement',
            restoreError
          );
        }
      }

      setStable((current) => ({
        ...current,
        individuals: current.individuals
          .filter((mount) => mount.id !== record.id)
          .map((mount) => {
            const parent = record.parents.find((candidate) => candidate.id === mount.id);
            return parent ? { ...mount, fertile: parent.fertile, cycled: parent.cycled } : mount;
          }),
      }));

      if (!restored) load();
      return true;
    },
    [load]
  );

  /** Retire une monture de l'écurie — vendue, sacrifiée, ou saisie par erreur. */
  /**
   * Un clonage : deux stériles disparaissent, une fertile prend la place de celle
   * qu'on a gardée.
   *
   * Le clone **est** la monture choisie — même couleur, même ascendance, même nom —
   * à ceci près qu'elle a retrouvé sa reproduction. On ne pouvait donc pas se
   * contenter de rendre une des deux fertile : les deux originales partent, et une
   * troisième entre. C'est ce que le jeu fait, et c'est ce qui laisse le compte
   * juste — un clonage consomme bien deux montures pour en rendre une.
   *
   * Une stérile est toujours une monture **suivie** : le vrac ne porte que des
   * fertiles, par construction du type. Il n'y a donc jamais rien à deviner ici.
   */
  const recordClonings = useCallback(
    async (entries: { keep: string; drop: string }[]): Promise<CloningResult> => {
      if (entries.length === 0) return { ok: true as const };
      const byId = new Map(stable.individuals.map((mount) => [mount.id, mount]));

      /* Un refus d'écriture vivait ici : il rejetait le lot quand la monture
         gardée portait moins que celle qui part. Il était faux, et il faut dire
         pourquoi plutôt que de le retirer en silence.

         Il supposait que l'éleveur **choisit** la survivante. Le jeu la tire au
         hasard. Ce que cette fonction reçoit n'est donc pas une décision qu'on
         peut refuser, c'est un **constat** — et refuser de l'écrire n'annulait
         aucun clonage : les deux montures étaient déjà consommées en jeu.
         L'unique effet était d'empêcher l'écurie de dire ce qu'elle contenait,
         exactement le jour où elle venait de perdre une lignée.

         La règle est remontée à l'appariement, seul endroit où elle protège :
         `cloneOptions` et `cloningsToRecord` n'apparient plus que des
         ascendances de même génération portée. Voir `cloning.ts`. */

      const kept = entries
        .map((entry) => byId.get(entry.keep))
        .filter((mount): mount is Individual => mount !== undefined);
      const gone = entries.flatMap((entry) => [entry.keep, entry.drop]);

      const supabase = createClient();

      // Le clone d'abord, les originales ensuite — même règle que `recordBirths`,
      // et pour la même raison. Les deux écritures partaient ensemble : une
      // insertion refusée laissait la suppression passer, donc **deux montures
      // détruites pour rien** et aucun clone en échange. C'est le sens
      // irrécupérable. Dans l'autre, on garde trois lignes au lieu de deux, ce
      // qui se voit dans l'écurie et se corrige à la main.
      const insertResult = await supabase
        .from('user_breeding_individuals')
        .insert(
          kept.map((mount) => ({
            family,
            color_id: mount.colorId,
            name: mount.name,
            sex: mount.sex,
            /*
             * **Niveau 1**, et non celui de la stérile consommée.
             *
             * Le jeu ne rend pas une monture expérimentée : il rend une monture
             * neuve qui porte le nom et l'ascendance de celle qu'on a
             * sacrifiée. Jauges à zéro, niveau à zéro. Vérifié en jeu.
             *
             * Ça copiait `mount.level`, donc typiquement 48 — une stérile a
             * vécu. Et le niveau n'est pas décoratif : il décide du taux de
             * réussite d'un croisement, `0,3 + 0,0015 × (niveauA + niveauB)`
             * dans `mating.ts`. Deux clones ainsi surévalués s'annonçaient à
             * **44,4 %** là où le jeu en donne **30,3 %** — la moitié en trop,
             * sur des croisements que la politique choisit justement parce
             * qu'ils ont l'air sûrs.
             */
            level: FRESH_LEVEL,
            // Le clone naît **fertile et non fécond** : son cycle est à payer,
            // comme celui d'un poulain.
            fertile: true,
            cycled: false,
            parent_a_color: mount.parents?.[0] ?? null,
            parent_b_color: mount.parents?.[1] ?? null,
          }))
        )
        .select();

      if (insertResult.error) {
        return {
          ok: false as const,
          message: reportWriteFailure(
            entries.length > 1 ? `les ${entries.length} clonages` : 'le clonage',
            insertResult.error
          ),
        };
      }

      const { error: dropError } = await supabase
        .from('user_breeding_individuals')
        .delete()
        .in('id', gone);

      if (dropError) {
        reportWriteFailure(
          `les ${gone.length} stériles à retirer — le clone, lui, est bien enregistré`,
          dropError
        );
        load();
        // Le clone **est** en base. L'appelant peut avancer : le rattrapage
        // porte sur les stériles restées, et la bannière le dit.
        return { ok: true as const };
      }

      setStable((current) => ({
        ...current,
        individuals: [
          ...current.individuals.filter((mount) => !gone.includes(mount.id)),
          // `fertile: true, cycled: false` étaient écrits en dur ici : c'est ce
          // que l'`insert` juste au-dessus vient de poser, donc ce que la ligne
          // relue rend. Deux vérités à tenir d'accord là où il n'en faut qu'une.
          ...(insertResult.data ?? []).map(individualFromRow),
        ],
      }));

      return { ok: true as const };
    },
    [family, stable.individuals, load]
  );

  /**
   * Retire un lot de montures en **une** écriture.
   *
   * Boucler sur `removeIndividual` marcherait, et c'est précisément ce qu'il ne
   * faut pas faire ici : soixante-dix suppressions, c'est soixante-dix allers
   * -retours dont chacun peut être refusé séparément, donc un état final que
   * personne ne peut décrire — ni « fait », ni « pas fait ». Un `.in()` échoue
   * ou passe en bloc.
   *
   * Même forme que le retrait unitaire pour le reste : on enlève de l'écran
   * d'abord, on remet tout si la base refuse, et le refus se dit. Une
   * suppression refusée qui laisse l'écran vide est une monture ressuscitée au
   * rechargement suivant, sans que rien n'ait prévenu.
   */
  const removeIndividuals = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const removed = stable.individuals.filter((mount) => gone.has(mount.id));
      if (removed.length === 0) return;

      setStable((current) => ({
        ...current,
        individuals: current.individuals.filter((mount) => !gone.has(mount.id)),
      }));

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_individuals')
        .delete()
        .in('id', ids);

      if (saveError) {
        reportWriteFailure(
          `le retrait de ${removed.length} monture${removed.length > 1 ? 's' : ''} de l’écurie`,
          saveError
        );
        setStable((current) => ({
          ...current,
          individuals: [...current.individuals, ...removed],
        }));
      }
    },
    [stable.individuals]
  );

  const removeIndividual = useCallback(
    async (id: string) => {
      // Ce qu'on retire de l'écran, gardé de côté : une suppression refusée
      // laissait la monture disparue à l'écran et bien vivante en base, donc
      // ressuscitée au rechargement suivant sans que rien n'ait prévenu.
      const removed = stable.individuals.find((mount) => mount.id === id);

      setStable((current) => ({
        ...current,
        individuals: current.individuals.filter((mount) => mount.id !== id),
      }));

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from('user_breeding_individuals')
        .delete()
        .eq('id', id);

      if (saveError) {
        reportWriteFailure(
          `le retrait de « ${removed?.name ?? 'cette monture'} » de l’écurie`,
          saveError
        );
        if (removed) {
          setStable((current) => ({
            ...current,
            individuals: [...current.individuals, removed],
          }));
        }
      }
    },
    [stable.individuals]
  );

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
    async (itemId: number, itemName: string, price: number): Promise<FuelPriceResult> => {
      const updated_at = new Date().toISOString();
      // Ce que la base porte avant la saisie : c'est là qu'on revient si elle
      // refuse. Sans ça, l'état local partait devant et **y restait**, si bien
      // qu'un prix jamais enregistré continuait de nourrir le coût du cycle
      // jusqu'au rechargement suivant.
      const previous = itemPrices.get(itemId);
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

      if (price <= 0) return { ok: true as const };
      try {
        await saveItemPrice({ itemId, itemName, price });
        return { ok: true as const };
      } catch (saveError) {
        reportWriteFailure(`le prix de ${itemName}`, saveError);
        setItemPrices((current) => {
          const next = new Map(current);
          if (previous) next.set(itemId, previous);
          else next.delete(itemId);
          return next;
        });
        return { ok: false as const, itemName, message: priceSaveMessage(saveError) };
      }
    },
    [itemPrices]
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

    // Comme le compteur de vrac : l'état local est déjà parti devant, donc rien
    // ne distingue à l'écran une réserve enregistrée d'une réserve perdue.
    if (saveError) reportWriteFailure('la quantité en réserve de ce carburant', saveError);
  }, []);

  const saveSettings = useCallback(async (next: BreedingSettings) => {
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from('user_breeding_settings')
      .upsert({ ...next, updated_at: new Date().toISOString() });

    if (saveError) {
      reportWriteFailure('les réglages d’élevage', saveError);
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
    hatched,
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
    recastIndividual,
    recordEnclosExit,
    removeIndividual,
    removeIndividuals,
    recordBirths,
    undoBirth,
    recordClonings,
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
