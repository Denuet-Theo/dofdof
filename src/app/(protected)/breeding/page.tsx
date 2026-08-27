'use client';

import { useMemo, useState } from 'react';
import { Egg, Info } from 'lucide-react';
import BreedingStocks from '@/components/breeding/BreedingStocks';
import BreedingPolicyPanel from '@/components/breeding/BreedingPolicyPanel';
import { couplesToRecordAll, stablePlan } from '@/lib/dofus/breeding/policy';
import { isCrownable, ladderOf } from '@/lib/dofus/breeding/ladder';
import { tunedLevel, valuePerSuccessToward } from '@/lib/dofus/breeding/tuned-level';

/**
 * Heures entre deux fournées que l'éleveur **lance vraiment** : une par jour.
 *
 * Relevé de l'éleveur, répété plusieurs fois : il dort et il travaille, donc il
 * lance une fournée par jour. Ce n'est pas la durée d'un cycle d'enclos, et
 * confondre les deux faisait conseiller le **niveau 23** — le calcul divisait par
 * les heures d'enclos, donc il fuyait une montée longue comme si elle coûtait des
 * fournées. À une par jour, la Mangeoire tourne pendant qu'il n'est pas là : elle
 * ne coûte rien.
 *
 * Mesuré sur son écurie réelle, 90 fournées, comparaison appariée sur 200
 * marchés : l'optimum est **autour de 100**, plateau de 80 à 105, et le niveau 60
 * coûte déjà 4,7 M sur un trimestre (t = −6,06). Voir `hoursBetweenLoads`.
 *
 * **Dette assumée** : c'est une constante et ça devrait être un réglage.
 * `user_breeding_settings` n'a pas de champ pour le rythme de jeu, et en ajouter
 * un demande une migration et un écran ; la valeur juste pour l'unique éleveur de
 * cette app est 24, alors qu'un défaut faux serait pire qu'une constante nommée.
 */
const HOURS_BETWEEN_LOADS = 24;
import { driftSignals } from '@/lib/dofus/breeding/drift';
import {
  afterClonings,
  cloneOptions,
  isProjected,
  unpairedObjectiveSteriles,
} from '@/lib/dofus/breeding/cloning';
import { extractionOrder } from '@/lib/dofus/breeding/extraction';
import {
  useBreeding,
  FROZEN_ANSWERS,
  type BreedingRow,
  type FamilyId,
} from '@/lib/hooks/useBreeding';
import { planWaves } from '@/lib/dofus/breeding/waves';
import { MAX_MOUNT_LEVEL, mountXpForLevel } from '@/lib/dofus/breeding/costs';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import { useBreedingProject } from '@/lib/hooks/useBreedingProject';
import { useBreedingBatch } from '@/lib/hooks/useBreedingBatch';
import { pennedUnits, withoutPenned } from '@/lib/dofus/breeding/batch';
import { formatHours } from '@/lib/utils/date';
import { toNumber } from '@/lib/supabase/types';

const FAMILIES: { id: FamilyId; label: string }[] = [
  { id: 'muldo', label: 'Muldos' },
  { id: 'dragodinde', label: 'Dragodindes' },
  { id: 'volkorne', label: 'Volkornes' },
];

/**
 * Les deux endroits où un prix se saisit, et il faut le dire à chaque fois.
 *
 * L'app tient **deux** réservoirs de prix, et cette barre les mélange : les
 * parchemins, l'ambre et les carburants sont des *items*, la cible est une
 * *couleur*. Rien ne le disait, et les deux se saisissent sur des écrans
 * différents.
 *
 * Le 22/08 : « il manque le prix de Azur-Dore » a envoyé saisir 600 000 kamas
 * sur l'item « Muldo Azur » de la page Items & Prix — un prix bien enregistré,
 * dans le réservoir que l'élevage ne lit pas, sur une couleur qui n'était même
 * pas celle qu'on demandait. Un message qui nomme ce qui manque sans dire où
 * l'écrire coûte plus cher que pas de message du tout : il fait travailler pour
 * rien.
 */
const PRICE_PLACES = {
  /** Les items : parchemins, ambre. La page de recherche d'items. */
  items: 'Items & Prix',
  /** Les carburants d'enclos, tarifés au fil de la liste de réserve. */
  fuels: 'Mes stocks › Carburants d’enclos',
  /** Les couleurs, à deux prix chacune — niveau 1 et niveau 200. */
  colors: 'Mes stocks › Saisir les prix',
} as const;

/** Ce qui manque, suivi de l'écran où on le saisit. */
const Missing = ({ what, where }: { what: string; where: string }) => (
  <>
    {what}
    <span className="text-dark-500 font-normal"> · {where}</span>
  </>
);

const BreedingPage = () => {
  const [family, setFamily] = useState<FamilyId>('muldo');
  /**
   * Combien d'exemplaires viser, tant qu'aucun plan n'est sélectionné.
   *
   * Un pour un succès ou une quête, trente pour rentabiliser : ce n'est pas le
   * même élevage, et ce n'est pas le même classement. À trente, les fournées
   * d'enclos se remplissent et le clonage a de quoi s'appairer, si bien que le
   * coût par monture s'effondre. D'où un réglage global, en tête des objectifs,
   * et non un champ enfoui dans un plan.
   */
  const [draftCount, setDraftCount] = useState(1);

  const project = useBreedingProject(family);
  /**
   * La fournée réellement en enclos.
   *
   * Distincte du plan de la politique, et c'est tout l'objet : le plan dit ce
   * qu'il **faudrait** charger, la fournée dit ce qui **est** chargé. Les deux se
   * confondaient, si bien qu'un enclos rempli le matin se recalculait tout seul
   * dans la journée. Voir `batch.ts`.
   */
  const batch = useBreedingBatch(family);

  /* « Ma journée » — le préréglage de disponibilité — a été retiré de l'écran.
     Il posait une question à laquelle rien ne répondait : l'ordonnanceur ne sait
     pas encore viser une durée, donc le créneau choisi n'entrait dans aucun
     calcul. Un réglage sans effet en tête d'écran se lit comme une consigne, et
     il passait devant les gestes qui, eux, en ont un. `useAvailability` et
     `AvailabilityPicker` restent en place pour le jour où le plan saura s'en
     servir.

     La timeline est masquée pour la même raison, à l'envers : elle décrivait un
     parc simulé — le plan du modèle est joué sur une graine — et son horloge
     n'avait aucun lien avec les enclos réellement chargés. Deux comptes à
     rebours contradictoires devant le même enclos. Le verrou de la fournée porte
     désormais l'heure de chargement, qui est la seule vraie. `BreedingTimeline`
     et `useBreedingTimeline` sont conservés : c'est le ruban qu'on veut
     reposer proprement, pas le supprimer. */

  // Le plan sélectionné fait foi : c'est la quantité retenue en le choisissant,
  // et le classement doit se relire dans les mêmes termes. Dérivé plutôt que
  // recopié dans un effet, qui écraserait une saisie en cours.
  const targetCount = project.current?.target_count ?? draftCount;
  const setTargetCount = (count: number) => {
    if (project.current) project.setTargetCount(count);
    else setDraftCount(count);
  };

  const {
    tree,
    rows,
    settings,
    hatched,
    genetonValuation,
    sacrificePrice,
    supplies,
    fuelItems,
    itemPrices,
    saveFuelPrice,
    stable,
    stockBySex,
    itemStock,
    ownedGaugePoints,
    savePrice,
    saveSettings,
    saveBulkStock,
    addIndividual,
    updateIndividual,
    updateIndividuals,
    recordEnclosExit,
    removeIndividual,
    removeIndividuals,
    recordBirths,
    undoBirth,
    recordClonings,
    saveItemStock,
  } = useBreeding(family, targetCount);

  /** Les prix nus, la table complète portant aussi les noms et les icônes. */
  const fuelPrices = useMemo(
    () => new Map([...itemPrices].map(([id, row]) => [id, toNumber(row.price)] as const)),
    [itemPrices]
  );

  /** Le plan ne porte que des identifiants ; les lignes ont les noms. */
  const nameOf = useMemo(() => {
    const names = new Map(rows.map((row) => [row.colorId, row.name]));
    return (colorId: string) => names.get(colorId) ?? colorId;
  }, [rows]);

  /** La couleur du plan suivi, qui réduit la liste à elle seule. */
  const selectedColorId = project.current?.target_color_id ?? null;

  /**
   * Les gen 10 qu'on peut réellement poursuivre.
   *
   * Pas toutes : `crownAt` exige une recette qui marie une gen 9 à une gen 1
   * **rattachée à un bloc**, donc achetable. Une cible qui ne remplit pas ces
   * conditions serait ignorée en silence, et proposer un choix sans effet est
   * pire que ne pas le proposer.
   */
  const crownable = useMemo(() => {
    const colors = tree?.colors ?? [];
    if (colors.length === 0) return [];
    const plan = ladderOf(colors);
    return colors
      .filter((color) => isCrownable(plan, colors, color.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [tree]);

  /**
   * Le programme des fournées du plan suivi, places libres comprises.
   *
   * Se recalcule ici et non dans le hook : la couleur qui occupe les places
   * libres est la mieux classée **après** la cible, donc elle suppose le
   * classement construit — ce que le plan, qui en fait partie, ne peut pas
   * supposer de lui-même. Rien d'autre n'en dépend : le remplissage ne change
   * ni le coût, ni le délai, qui se comptent sur la cible seule.
   */
  const waves = useMemo(() => {
    const target = rows.find((row) => row.colorId === selectedColorId);
    if (!target?.planned) return null;

    // Seules les couleurs qu'on élève concourent : une couleur qu'on achète
    // n'occupe aucune place, elle ne remplit donc rien.
    const candidates = rows.filter(
      (row) =>
        row.colorId !== selectedColorId && row.planned !== null && (row.planMargin ?? 0) > 0
    );

    // La marge horaire départage quand elle existe, faute de quoi la marge du
    // plan prend le relais. Sans ce repli, un éleveur qui n'a pas encore tarifé
    // ses carburants n'avait aucune couleur de remplissage — or c'est
    // exactement l'état dans lequel on découvre l'écran. Les deux mesures ne se
    // mélangent pas : ou bien les durées sont chiffrables et toutes les lignes
    // ont la première, ou bien aucune ne l'a.
    const hourly = candidates.some((row) => row.marginPerHour !== null);
    const rank = (row: BreedingRow) =>
      (hourly ? row.marginPerHour : row.planMargin) ?? -Infinity;

    const filler = candidates.reduce<BreedingRow | null>(
      (best, row) => (best === null || rank(row) > rank(best) ? row : best),
      null
    );

    return planWaves(target.planned.plan, {
      stock: stockBySex,
      capacity: Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS,
      recycleSteriles: FROZEN_ANSWERS.recycle_steriles,
      filler: filler?.colorId ?? null,
    });
  }, [rows, selectedColorId, stockBySex, settings.enclos_count]);

  /**
   * L'écurie **dont on dispose** : la vraie, moins ce qui est en enclos.
   *
   * Une monture verrouillée dans un enclos est indisponible au sens le plus
   * concret : le jeu ne la laissera ni s'accoupler, ni se faire cloner, ni se
   * faire sacrifier tant que son cycle tourne. L'écurie enregistrée, elle, la
   * décrit toujours comme fertile et non féconde — et c'est juste, puisqu'elle
   * ne deviendra féconde qu'à la sortie d'enclos, seul moment où l'on connaît
   * son niveau.
   *
   * La politique la comptait donc deux fois : une fois dans l'enclos où elle
   * est, une fois dans les gestes proposés à côté. Un éleveur qui verrouillait
   * cinq enclos se voyait proposer d'accoupler dans la foulée les cinquante
   * montures qu'il venait d'y enfermer, et les cherchait dans un coffre où
   * elles n'étaient plus.
   *
   * Le retrait se fait **ici et une seule fois**, en amont des quatre
   * arbitrages, plutôt qu'à chacun. Les filtrer un par un aurait marché quatre
   * fois et raté le cinquième — c'est exactement la forme de bug que
   * `AGENTS.md` décrit. Ce qui descend vers l'affichage — « Mes stocks », les
   * noms des montures — garde l'écurie entière : ces montures sont toujours à
   * vous, c'est seulement qu'on n'en dispose pas ce matin.
   */
  const available = useMemo(() => withoutPenned(stable, batch.pens), [stable, batch.pens]);

  /* La répartition du parc qui tient l'équilibre — le curseur de financement et
     les parts par couleur — vivait ici. Elle n'existait que sous l'objectif
     « gen 10 à l'équilibre », qui ne peut plus être sélectionné : la garder
     aurait laissé à l'écran une consigne qu'aucun réglage ne pouvait plus
     atteindre. `fundingSplit`, `combinedRate` et `minimumFunderPercent` restent
     dans `objectives.ts`, et `ColorRow` sait toujours afficher une part. */

  /**
   * Les occasions que l'arbre ne peut pas exprimer.
   *
   * Une monture dont l'ascendance porte plus haut que sa couleur — le raccourci
   * de #59 — n'est dans aucune recette, donc aucun plan ne la proposera. Elle se
   * signale, elle ne se planifie pas : c'est de l'opportunisme, et l'éleveur en
   * décide. Voir `drift.ts`.
   *
   * Se calcule **avant** les deux, qui doivent savoir ne pas les dépenser : le
   * prochain coup comme les fournées suivantes. Une seule des deux réservait, et
   * l'écran donnait alors deux consignes contraires sur la même monture.
   */
  const drift = useMemo(() => {
    const colors = tree?.colors ?? [];
    if (colors.length === 0) return [];
    return driftSignals(available, {
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
    });
  }, [tree, available]);



  /**
   * Ce que la politique entraînée ferait de l'écurie.
   *
   * C'est la recherche du Rust, portée et rejouée ici — `check-search.mjs`
   * verrouille qu'elle rend le même plan. Elle vit dans l'app et non dans le
   * modèle pour une raison qui n'est pas d'architecture : le Rust produit des
   * poids, mais l'écurie et les cours sont les vôtres, et les cours changent d'un
   * jour à l'autre. Un plan compilé la veille répondrait sur le marché de la
   * veille.
   *
   * Elle remplace `buildLoadout` dans la timeline. Les deux ne répondent pas à la
   * même question : le chargement heuristique déroule un plan de recettes vers une
   * couleur choisie, la politique décide quoi faire de l'écurie telle qu'elle est.
   * Voir `policy.ts`.
   */
  /**
   * Le niveau auquel monter les montures, sur les prix de l'éleveur.
   *
   * Le seul arbitrage que le prix seul ne tranche pas : monter coûte des kamas
   * et fait gagner des heures d'enclos. `optimalParentLevel` ne compte que des
   * kamas et le dit lui-même ; celui-ci compte les deux. Voir `tunedLevel`.
   *
   * `null` tant qu'il manque une pièce — pas de cible, pas de prix, pas de cycle
   * relevé. Un niveau inventé affiché à côté de chiffres réels se lirait comme
   * une mesure.
   */
  /**
   * De quel niveau à quel niveau on monte, pour chiffrer la Mangeoire.
   *
   * Deux bornes plutôt qu'une : la ligne n'annonçait que le 1 → 200, c'est-à-dire
   * le seul cas où il n'y a rien à calculer. Devant l'enclos la question est
   * « mes muldos sont à 48, je les veux à 100 », et personne ne devrait faire
   * cette soustraction de tête sur une loi de puissance.
   *
   * Pas de persistance : c'est une question qu'on se pose en chargeant la
   * Mangeoire, pas un réglage de l'écurie. La ranger en base demanderait une
   * migration pour une valeur qui change à chaque fournée.
   */
  const [fromLevel, setFromLevel] = useState(1);
  const [toLevel, setToLevel] = useState(MAX_MOUNT_LEVEL);

  /**
   * Les points de Mangeoire d'une montée, et ce qu'ils coûtent en heures.
   *
   * `mountXpForLevel` est **cumulatif depuis le niveau 1** — voir sa
   * définition — donc une montée est une différence, jamais une somme de
   * paliers. Bornée à zéro : une cible sous le niveau actuel ne rend pas des
   * points, elle n'en demande aucun.
   *
   * Le niveau 1 est le départ et ne coûte rien : la loi de puissance y rend 3,8
   * points, qui sont un artefact d'ajustement. Les retrancher ferait dire 867 578
   * points au 1 → 200 quand `supplies` en compte 867 582 pour la même montée, et
   * deux nombres qui se contredisent de quatre points sur le même écran valent
   * moins que l'un des deux.
   */
  const mangeoire = useMemo(() => {
    const spent = (level: number) => (level <= 1 ? 0 : mountXpForLevel(level));
    const points = Math.max(0, Math.round(spent(toLevel) - spent(fromLevel)));
    const perHour = supplies?.mangeoirePointsPerHour ?? null;
    return { points, hours: perHour && perHour > 0 ? points / perHour : null };
  }, [fromLevel, toLevel, supplies]);

  /** Une borne de niveau, bornée au barème du jeu. */
  const levelInput = (
    value: number,
    onChange: (next: number) => void,
    testId: string
  ) => (
    <input
      type="number"
      min={1}
      max={MAX_MOUNT_LEVEL}
      value={String(value)}
      data-testid={testId}
      onChange={(event) =>
        onChange(Math.max(1, Math.min(MAX_MOUNT_LEVEL, Number(event.target.value) || 1)))
      }
      className="w-14 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border border-dark-600/50
        text-dark-100 text-[11px] text-right transition-all hover:border-dark-500
        focus:border-kamas/50"
    />
  );

  const advisedLevel = useMemo(() => {
    const colors = tree?.colors ?? [];
    const crown = colors.find((color) => color.id === selectedColorId);
    if (!crown || !supplies) return null;

    // Sans prix saisi sur la cible, on ne sait pas ce qu'une réussite vaut. On
    // rend la raison plutôt que rien : un espace vide se lit comme « le calcul
    // dit non », pas comme « il me manque une donnée » — c'est la panne #179,
    // qu'un prix bloqué avait fait passer pour un marché difficile.
    const crownValue = rows.find((row) => row.colorId === crown.id)?.estimate.priceLevel0 ?? 0;
    if (!(crownValue > 0)) return { missing: `le prix de ${crown.name}` } as const;
    // La frontière : la génération la plus haute que l'écurie tient déjà. C'est
    // sur ce qui reste à gravir qu'une réussite s'amortit.
    // La frontière **de la route**, et non la meilleure monture de l'écurie.
    //
    // Un éleveur qui tient déjà une gen 10 hors plan — une Azur-Turquoise quand
    // il vise Azur-Doré — n'est pas pour autant arrivé : ces montures-là
    // n'avancent pas d'un barreau. Compter la meilleure de toutes donnait une
    // frontière de 10, donc un amortissement sur un seul barreau, donc « monte
    // au plafond » quel que soit le reste. On ne compte donc que les couleurs
    // que le plan réclame.
    const plan = ladderOf(colors);
    const generationOf = new Map(colors.map((color) => [color.id, color.generation]));
    const onRoute = (colorId: string) => plan.wanted.has(colorId);
    let frontier = 1;
    for (const mount of available.individuals) {
      if (onRoute(mount.colorId)) {
        frontier = Math.max(frontier, generationOf.get(mount.colorId) ?? 1);
      }
    }
    for (const [colorId, counts] of available.bulk) {
      if (onRoute(colorId) && counts.males + counts.females > 0) {
        frontier = Math.max(frontier, generationOf.get(colorId) ?? 1);
      }
    }

    const tuned = tunedLevel({
      cycleHours: supplies.cycleHours ?? 0,
      fuelPerLoad: (supplies.fuelCostPerCycle ?? 0) * ENCLOS_SLOTS,
      mangeoireCostPerMountPoint: supplies.mangeoireCostPerMountPoint ?? 0,
      levelUpHours: supplies.levelUpHours ?? 0,
      valuePerSuccess: valuePerSuccessToward(crownValue, crown.generation, frontier),
      hoursBetweenLoads: HOURS_BETWEEN_LOADS,
      pointsCap: supplies.mangeoirePointsCap ?? undefined,
    });
    // Le prix de la Mangeoire manque : `tunedLevel` refuse plutôt que de rendre
    // le plafond, qui est ce qu'un niveau gratuit donne toujours.
    if (tuned === null) return { missing: 'le carburant de Mangeoire' } as const;
    return { ...tuned, missing: null } as const;
  }, [tree, supplies, selectedColorId, rows, available]);

  const policyInput = useMemo(() => {
    const colors = tree?.colors ?? [];
    if (colors.length === 0) return null;

    // Les prix du jour, tels que l'écran les porte. Une couleur sans prix vaut
    // zéro, donc la politique ne cherchera pas à la produire — c'est le
    // comportement honnête, mais il explique une fournée maigre sur une écurie
    // dont les prix n'ont pas été saisis.
    const level0 = new Map(rows.map((row) => [row.colorId, row.estimate.priceLevel0 ?? 0]));

    // L'Optimakina, par génération visée. Une sans prix connu n'est pas gratuite,
    // elle est indisponible : zéro la laisse simplement hors de portée.
    const optimakina = Array.from({ length: 11 }, (_, generation) => {
      const item = tree?.optimakinaByGeneration?.[String(generation)];
      return item ? (toNumber(itemPrices.get(item.id)?.price)) : 0;
    });

    /**
     * Les places **libres**, et non celles du parc.
     *
     * Le jumeau du retrait des montures, et il fallait les deux. Sans lui, la
     * politique voyait bien une écurie amputée de ce qui est en enclos, mais
     * toujours cinquante places libres — donc elle planifiait aussitôt une
     * seconde fournée de cinquante montures dans un parc qui n'en a plus une
     * seule de libre. Un enclos occupé l'est pour tout le monde.
     *
     * À zéro, `search.ts` ne charge rien : ses deux gardes sont
     * `state.places < capacity`, qui est faux d'entrée. C'est le comportement
     * juste — parc plein, rien à charger — et non un cas dégradé.
     */
    const free = Math.max(
      0,
      Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS - pennedUnits(batch.pens).length
    );
    const capacity = free;
    return {
      // Ce dont on dispose, pas ce qu'on possède : les montures en enclos sont
      // dans le jeu, pas au coffre. Voir `available`.
      stable: available,
      colors,
      market: {
        // Le prix de vente, pas la valeur : `liquidationValue` prend le plus haut
        // entre lui et l'extraction en ambre, parce qu'on ne fait pas les deux.
        marketPrice: (colorId: string) => level0.get(colorId) ?? 0,
        genetonValue: genetonValuation?.valuePerGeneton ?? 0,
        amberPerGeneration: sacrificePrice,
        optimakina,
      },
      capacity,
      // Le carburant d'un cycle est chiffré **par monture** : une jauge se vide au
      // rythme de l'enclos, pas de l'animal. Le chargement en coûte donc autant que
      // de places occupées.
      loadKamas: (supplies?.fuelCostPerCycle ?? 0) * capacity,
      kamas: toNumber(settings.kamas_available),
      // La gen 10 que l'éleveur poursuit. Le canal est le **projet**, privé, et
      // non le prix : `breeding_color_prices` est partagé entre les joueurs, donc
      // gonfler une gen 10 pour l'atteindre fausserait leur marché — et les coûts
      // affichés avec, puisque le prix sert aussi à chiffrer.
      target: selectedColorId,
      /**
       * Le succès de collection, et il ne voyage que s'il est demandé.
       *
       * `undefined` sur le mode par défaut : la passe ne s'applique alors pas du
       * tout, ce qui garde la fournée sur exactement la physique que les gardes de
       * parité et la simulation mesurent. Voir `applySuccess`.
       */
      success:
        settings.success_mode === 'ignore'
          ? undefined
          : { mode: settings.success_mode, hatched },
    };
  }, [
    tree,
    rows,
    available,
    itemPrices,
    genetonValuation,
    sacrificePrice,
    supplies,
    settings.enclos_count,
    settings.kamas_available,
    selectedColorId,
    // Le mode et la collection : les deux changent la fournée quand le mode n'est
    // pas « ignoré », donc les deux doivent la faire recalculer.
    settings.success_mode,
    hatched,
    // Les enclos verrouillés décident des places libres : voir `free`.
    batch.pens,
  ]);

  const policyFill = useMemo(
    () => (policyInput ? stablePlan(policyInput) : null),
    [policyInput]
  );

  /**
   * Les clonages à faire, et ce qu'ils rendent.
   *
   * Une stérile ne vaut plus rien tant qu'on ne la clone pas : il ne lui reste
   * que l'extraction. L'arbitrage porte donc sur **qui appairer avec qui**, et
   * la valeur d'une monture s'y lit sur la génération que son ascendance porte
   * — une gen 1 à parent gen 9 vaut une gen 9. Voir `cloning.ts`.
   */
  const cloneContext = useMemo(() => {
    if (!tree) return null;

    const byId = new Map(rows.map((row) => [row.colorId, row]));
    /** La couleur la moins chère d'une génération : le prix de remplacement du rôle. */
    const cheapest = new Map<number, number>();
    for (const row of rows) {
      const cost = row.estimate.cost;
      if (cost === null || cost <= 0) continue;
      const current = cheapest.get(row.generation);
      if (current === undefined || cost < current) cheapest.set(row.generation, cost);
    }

    return {
      generations: new Map(tree.colors.map((color) => [color.id, color.generation])),
      costOf: (colorId: string) => byId.get(colorId)?.estimate.cost ?? 0,
      cheapestAt: (generation: number) => cheapest.get(generation) ?? 0,
      sacrificeUnitValue: sacrificePrice,
      // Le projet entre dans l'arbitrage. Sans lui, une stérile ne valait que son
      // prix de rang — net des génétons, donc pas même croissant en génération —
      // et l'écran proposait de détruire une gen 10 qui nomme la couleur visée.
      // Voir `cloning.ts`, § « le projet ».
      objective: selectedColorId ? { colorId: selectedColorId, colors: tree.colors } : null,
    };
  }, [tree, rows, sacrificePrice, selectedColorId]);

  /**
   * Tous les appariements, et non les dix meilleurs.
   *
   * Le plafond servait à ne pas noyer un écran de conseils. Il est devenu
   * intenable le jour où l'extraction a cessé d'afficher ce qu'elle n'extrait
   * pas : une stérile écartée là-bas parce qu'un clonage vaut mieux, mais coupée
   * ici par le plafond, ne serait plus nulle part.
   */
  const clonings = useMemo(
    () => (cloneContext ? cloneOptions(available, cloneContext, Number.POSITIVE_INFINITY) : []),
    [cloneContext, available]
  );

  /**
   * **Tous** les accouplements réalisables maintenant, et non la première tranche.
   *
   * Le plan n'en publie qu'une partie — les couples à zéro place — et saisir cette
   * partie en découvre une autre au rafraîchissement suivant, puis encore une.
   * Voir `couplesToRecordAll` : la boucle est là-bas, parce qu'elle a besoin de
   * l'entrée de la politique et non de son résultat.
   *
   * Une passe coûte une vingtaine de millisecondes sur une écurie de cent
   * montures, et il en faut trois à cinq. C'est le prix d'une liste qui ne repousse
   * pas.
   *
   * ## Et l'écurie d'entrée est celle **d'après les clonages**
   *
   * La boucle ne garantissait le point fixe qu'à écurie constante. Or l'onglet
   * d'à côté demande vingt clonages, qui retirent quarante stériles et rendent
   * vingt fertiles : la politique réaffecte alors ses fécondes et publie des
   * couples gratuits qu'elle avait laissés de côté. L'éleveur, lui, lit ça comme
   * une liste qui repousse — le défaut de #165, revenu par une autre porte.
   * Mesuré sur l'écurie du 17/08 : 3 accouplements avant les clonages, 7 après,
   * à fécondes identiques. Voir `afterClonings`.
   *
   * `policyFill` reste sur l'écurie **réelle**, et c'est délibéré : une fournée
   * se fige en base au premier verrou (`batch.ts`), et y projeter une monture
   * qui n'a pas encore de ligne mettrait dans `pens` un identifiant que la
   * sortie d'enclos ne saurait pas relire — elle l'écarterait en silence. Un
   * clone ne peut pas déborder ici, lui : il ressort non fécond, donc jamais
   * dans un couple à zéro place. Le filtre ci-dessous est le second verrou.
   */
  const policyPlan = useMemo(
    () =>
      policyInput
        ? couplesToRecordAll(
            policyInput,
            cloneContext
              ? (working) => {
                  const options = cloneOptions(working, cloneContext, Number.POSITIVE_INFINITY);
                  return { stable: afterClonings(working, options), clonings: options };
                }
              : null
          )
        : { couples: [], clonings: [] },
    [policyInput, cloneContext]
  );

  const policyCouples = useMemo(
    () =>
      policyPlan.couples.filter(
        (couple) => !isProjected(couple.male.mountId) && !isProjected(couple.female.mountId)
      ),
    [policyPlan]
  );

  /**
   * Les clonages que la fournée **suppose**, et qu'il faut donc annoncer.
   *
   * `clonings` au-dessus n'énumère que ceux qu'on peut faire **tout de suite**. La
   * boucle d'accouplements, elle, en suppose davantage : chaque vague saisie
   * stérilise ses parents, et deux stériles de même génération sont une paire
   * clonable de plus. Elle planifiait donc sur une écurie déjà clonée sans que
   * personne l'ait demandé.
   *
   * Mesuré au navigateur : la boucle projetait 203 montures et 20 poulains puis
   * finissait à 201 — **22 clonages** tenus pour acquis. L'éleveur saisissait ses
   * 20 accouplements, ne clonait rien, et **4 accouplements repoussaient**. La
   * liste ne repoussait pas : elle disait la moitié de ce qu'elle demandait.
   *
   * On garde donc le compte entier ici. Les derniers ne sont pas encore faisables
   * — leurs stériles n'existeront qu'après la saisie — donc l'onglet continue de ne
   * **proposer** que `clonings`, et ce compte-ci dit ce que la fournée demande en
   * tout.
   */
  const assumedClonings = policyPlan.clonings;

  /** Les protégées du projet que rien n'apparie : le seul écran qui puisse les dire. */
  const heldForObjective = useMemo(
    () => (cloneContext ? unpairedObjectiveSteriles(available, cloneContext) : []),
    [cloneContext, available]
  );

  /**
   * Toutes les stériles, de la moins intéressante à reproduire à la plus.
   *
   * Ce n'est pas le complément de `clonings` : celui-ci n'énumère que les
   * stériles qu'il a réussi à **apparier**, donc l'effectif impair d'une
   * génération et les rangs à monture unique n'y sont dans aucune ligne. Or ce
   * sont exactement celles à extraire — dépareillée, une stérile ne vaut plus que
   * son ambre. Voir `extraction.ts`.
   */
  const extraction = useMemo(
    () => (cloneContext ? extractionOrder(available, cloneContext) : []),
    [cloneContext, available]
  );

  const priced = rows.filter((row) => row.estimate.priceLevel0 !== null).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Egg size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Élevage</h1>
        </div>
        {/* La phrase d'avant promettait « pour chaque couleur, le moins cher entre
            acheter, capturer et élever — puis ce que la revente rapporte ». Elle
            décrivait le classement de `ColorRow`, débranché par #178, et n'a plus
            été tenue pendant deux semaines : un sous-titre qui décrit une fonction
            absente ne se lit pas comme une phrase périmée mais comme une fonction
            en panne, et il a fait chercher un bug qui n'existait pas.
            L'onglet HDV en rend la moitié, mais le mal était ailleurs — elle
            décrivait un onglet sur cinq et taisait le ruban, qui est ce qu'on voit
            d'abord. Celle-ci nomme les trois choses que l'écran optimise, dans
            l'ordre où les onglets les présentent. Voir #184. */}
        <p className="text-sm text-dark-400">
          Optimise ton élevage : meilleurs croisements, meilleures fournées et meilleurs prix.
        </p>
      </div>

      {/* Familles */}
      <div className="flex flex-wrap gap-2">
        {FAMILIES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFamily(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all cursor-pointer ${
              family === id
                ? 'bg-kamas/15 text-kamas border-kamas/40'
                : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Les gestes du jour, en tête d'écran : c'est pour eux qu'on ouvre cette
          page entre deux allers-retours en jeu. Un onglet à la fois — accoupler,
          cloner, charger, extraire — parce que chacun se fait dans le jeu, une
          monture à la fois, et que quatre consignes simultanées font perdre les
          quatre. Voir `BreedingPolicyPanel`. */}
      <BreedingPolicyPanel
        fill={policyFill}
        // Ce qui est réellement en enclos, par opposition à ce que la politique
        // proposerait maintenant : c'est la distinction que le verrou introduit.
        batch={batch}
        // La liste complète, pas la tranche que `fill` porte : voir #165.
        couples={policyCouples}
        // Ce que valent les stériles, à l'étape où on les clone : voir #163.
        cloneAdvice={clonings}
        assumedCloningCount={assumedClonings.length}
        // Celles que le projet protège et que rien n'apparie : elles ne sont sur
        // aucun autre écran.
        cloneHeld={heldForObjective}
        // La couleur visée, pour que le badge dise ce que la monture sert.
        objectiveName={selectedColorId ? nameOf(selectedColorId) : null}
        // Ce qui s'extrait, et rien d'autre : l'onglet « Extraction ».
        extraction={extraction}
        // Ambre, neurone ou corne — la ressource dépend de la famille.
        sacrificeName={tree?.sacrificeItem.name ?? 'ambre'}
        nameOf={nameOf}
        // Les montures suivies, pour que la fournée nomme celles qui portent un
        // nom : le vrac est interchangeable, une gen 3+ ne l'est pas.
        individuals={stable.individuals}
        // Le parcours guidé a besoin du catalogue : la fenêtre d'accouplement
        // propose les issues possibles, pas seulement des noms.
        colors={tree?.colors ?? []}
        // Les coûts de revient et l'écurie entière, pour l'onglet « HDV » : le
        // prix conseillé se lit sur le chiffrage, et le raccourci d'une monture
        // se cherche contre les partenaires que l'écurie porte. Le vrac compte,
        // donc c'est bien `stable` et non `stable.individuals`.
        rows={rows}
        stable={stable}
        // La collection et les réglages, pour l'onglet « Succès » : ce qu'il reste
        // à faire naître, et le seul contrôle de `success_mode`.
        hatched={hatched}
        settings={settings}
        onSaveSettings={saveSettings}
        onRecordBirths={recordBirths}
        onUndoBirth={undoBirth}
        onRecordClonings={recordClonings}
        onEnclosExit={recordEnclosExit}
        // L'extraction faite en jeu : la monture est consommée, donc elle quitte
        // l'écurie. `removeIndividual` porte déjà le rollback — un retrait refusé
        // remet la monture à l'écran plutôt que de la faire disparaître des deux
        // côtés.
        onExtract={removeIndividual}
      />

      {/* La fournée suit le planning immédiatement, et c'est la même raison qui
          les met tous les deux en tête : le planning dit **quand**, la fournée
          dit **quoi**, et on ouvre cet écran pour ces deux réponses-là. Elle
          était sous les stocks, les réglages et le classement — trois panneaux
          qu'on ne consulte qu'une fois par semaine, à défiler à chaque
          aller-retour en jeu. Elle reste avant les fournées suivantes : un
          croisement hors recette rend inutile une partie du plan qu'on
          s'apprêtait à charger, et le voir après aurait consommé les montures
          qui le portent. Le panneau disparaît de lui-même tant qu'aucune
          couleur n'est planifiable. */}
      <BreedingStocks
        // Le catalogue et non les lignes de l'écran : l'écurie a besoin des
        // icônes de certificats, que seule `BreedingColor` porte.
        colors={tree?.colors ?? []}
        fuelItems={fuelItems}
        individuals={stable.individuals}
        bulk={stable.bulk}
        // Le nom de la famille tel que l'onglet l'écrit : les filtres du jeu ont
        // une ligne « Type » qui le porte, et c'est un chiffre de plus à comparer.
        familyLabel={FAMILIES.find((entry) => entry.id === family)?.label ?? family}
        itemStock={itemStock}
        itemPrices={fuelPrices}
        onSaveFuelPrice={saveFuelPrice}
        ownedGaugePoints={ownedGaugePoints}
        settings={settings}
        onSaveBulk={saveBulkStock}
        onAddIndividual={addIndividual}
        onUpdateIndividual={updateIndividual}
        // Le geste qui ramène une fournée entière quand la sortie d’enclos ne
        // peut plus le faire : cocher un lot, poser « fécondes, niveau 44 ».
        onUpdateIndividuals={updateIndividuals}
        onRemoveIndividual={removeIndividual}
        // Le purge des anonymes stériles part en une écriture : soixante-dix
        // suppressions séparées laisseraient un état que personne ne peut dire.
        onRemoveIndividuals={removeIndividuals}
        onSaveItem={saveItemStock}
        onSaveSettings={saveSettings}
        // Les prix de couleurs et la quantité visée, relogés ici depuis « Couleur
        // visée » : sans eux rien ne se chiffre, et leur seul chemin était masqué.
        rows={rows}
        onSavePrice={savePrice}
        drift={drift}
        targetCount={targetCount}
        onSetTargetCount={setTargetCount}
        targetColorId={selectedColorId}
        // Le découpage en vagues **est** le compte de fournées : il respecte
        // l'ordre parents-avant-enfants, donc il ne se comprime pas en dessous du
        // nombre de barreaux, et il part du stock réel au parc réel.
        minBatches={waves?.length ?? null}
        crownable={crownable}
        onSelectTarget={(colorId) => {
          if (colorId) project.select(colorId, targetCount);
          else project.abandon();
        }}
      />

      {/* Ce sur quoi le calcul s'appuie, dit explicitement : sans ces prix, des
          pans entiers du résultat valent zéro et il vaut mieux le voir. */}
      <div className="glass rounded-2xl px-5 py-4 flex flex-wrap gap-x-8 gap-y-2 text-xs">
        <span className="flex items-center gap-2 text-dark-400">
          <Info size={13} className="text-dark-500" />
          Couleurs tarifées : <strong className="text-dark-200">{priced}/{rows.length}</strong>
        </span>
        <span className="text-dark-400">
          Généton :{' '}
          <strong className="text-dark-200">
            {genetonValuation ? (
              `${Math.round(genetonValuation.valuePerGeneton).toLocaleString('fr-FR')} kamas`
            ) : (
              <Missing what="prix des parchemins manquants" where={PRICE_PLACES.items} />
            )}
          </strong>
        </span>
        {tree && (
          <span className="text-dark-400">
            {tree.sacrificeItem.name} :{' '}
            <strong className="text-dark-200">
              {sacrificePrice > 0 ? (
                `${sacrificePrice.toLocaleString('fr-FR')} kamas`
              ) : (
                <Missing what="prix manquant" where={PRICE_PLACES.items} />
              )}
            </strong>
          </span>
        )}
        <span className="text-dark-400">
          Cycle de fécondité :{' '}
          <strong className="text-dark-200">
            {supplies?.fuelCostPerCycle != null ? (
              `${Math.round(supplies.fuelCostPerCycle).toLocaleString('fr-FR')} kamas / monture`
            ) : (
              <Missing what="carburants non tarifés" where={PRICE_PLACES.fuels} />
            )}
            {supplies?.cycleHours != null && ` · ${formatHours(supplies.cycleHours)} / enclos`}
          </strong>
        </span>
        {/* Le niveau conseillé. Il vit ici, à côté du cycle et de la Mangeoire
            dont il est l'arbitrage, et pas dans la fournée : c'est une décision
            de Mangeoire que l'éleveur prend avant de charger. */}
        {advisedLevel && (
          <span className="text-dark-400" data-testid="advised-level">
            Niveau conseillé :{' '}
            <strong className="text-dark-200">
              {advisedLevel.missing !== null ? (
                <Missing what={`il manque ${advisedLevel.missing}`} where={PRICE_PLACES.colors} />
              ) : (
                <>
                  {advisedLevel.level}
                  <span className="text-dark-500 font-normal"> · au-delà, la Mangeoire coûte plus d’heures qu’elle n’en fait gagner</span>
                </>
              )}
            </strong>
          </span>
        )}
        {supplies?.levelUpHours != null && (
          /*
           * La montée, de **où on en est** à **où on va**.
           *
           * Elle n'annonçait que le 1 → 200, c'est-à-dire le seul cas où
           * l'éleveur n'a rien à calculer. Devant l'enclos la question est
           * l'autre : « mes muldos sont à 48, je les veux à 100, combien de
           * points de Mangeoire ? » — et `mountXpForLevel` est cumulatif depuis
           * le niveau 1, donc la réponse est une soustraction que personne ne
           * devrait avoir à faire de tête.
           *
           * Les bornes par défaut redonnent la ligne d'avant, à l'unité près :
           * de 1 à 200, ce sont bien les heures et le carburant qui étaient
           * affichés.
           */
          <span className="flex flex-wrap items-center gap-1.5 text-dark-400">
            Montée : de
            {levelInput(fromLevel, setFromLevel, 'mangeoire-from')}à
            {levelInput(toLevel, setToLevel, 'mangeoire-to')}
            <strong className="text-dark-200" data-testid="mangeoire-points">
              {mangeoire.points.toLocaleString('fr-FR')} points
            </strong>
            <span className="text-dark-500">de Mangeoire</span>
            {mangeoire.hours !== null && (
              <strong className="text-dark-200">· {formatHours(mangeoire.hours)}</strong>
            )}
            {supplies.mangeoireFuel && (
              <span className="text-dark-500">· {supplies.mangeoireFuel}</span>
            )}
          </span>
        )}
        <span className="text-dark-400">
          Capture :{' '}
          <strong className="text-dark-200">
            {supplies?.capture
              ? `${Math.round(supplies.capture.costPerMount).toLocaleString('fr-FR')} kamas (${supplies.capture.net.captures}×)`
              : 'filets non tarifés'}
          </strong>
        </span>
      </div>

      {/* Ce qui manque se dit, plutôt que de disparaître dans un zéro. */}
      {supplies && supplies.missingGauges.length > 0 && (
        <p className="text-[11px] text-amber-400/80">
          Aucun carburant tarifé pour {supplies.missingGauges.join(', ')} — ces jauges sont
          chiffrées au prix relevé par défaut. Renseigne les carburants pour coller au
          cours du jour et au palier que tu utilises vraiment.
        </p>
      )}

    </div>
  );
};

export default BreedingPage;
