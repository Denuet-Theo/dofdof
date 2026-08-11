'use client';

import { useMemo, useState } from 'react';
import { Egg, AlertTriangle, Info, PenLine, Target, Wand2 } from 'lucide-react';
import ColorRow from '@/components/breeding/ColorRow';
import BreedingStocks from '@/components/breeding/BreedingStocks';
import BreedingBatches from '@/components/breeding/BreedingBatches';
import BreedingNextMove from '@/components/breeding/BreedingNextMove';
import BreedingTimeline from '@/components/breeding/BreedingTimeline';
import { buildLoadout } from '@/lib/dofus/breeding/loadout';
import { stablePlan } from '@/lib/dofus/breeding/policy';
import { driftSignals } from '@/lib/dofus/breeding/drift';
import { cloneOptions } from '@/lib/dofus/breeding/cloning';
import PriceEntry from '@/components/breeding/PriceEntry';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useBreeding, type BreedingRow, type FamilyId } from '@/lib/hooks/useBreeding';
import { planWaves } from '@/lib/dofus/breeding/waves';
import { nextBatches } from '@/lib/dofus/breeding/batches';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import { useBreedingProject } from '@/lib/hooks/useBreedingProject';
import { useBreedingTimeline } from '@/lib/hooks/useBreedingTimeline';
import {
  OBJECTIVES,
  rankFor,
  recommendedFor,
  type Candidate,
  type ObjectiveId,
} from '@/lib/dofus/breeding/objectives';
import { formatHours } from '@/lib/utils/date';

/**
 * Les panneaux qui descendent de l'heuristique sont-ils affichés.
 *
 * Trois d'un coup, et c'est bien un seul interrupteur parce que c'est une seule
 * source : « Couleur visée », « La fournée à charger » et « Prochaines
 * fournées » lisent tous le plan que `breedingPlan` construit sur l'arbre des
 * recettes, pour une couleur que le **classement** désigne.
 *
 * Masquer le classement seul n'a donc rien réglé : il a retiré la vue sur
 * l'heuristique en laissant les trois panneaux lui obéir. L'écran annonçait
 * « les étapes du plan Azur-Doré » — une couleur que personne n'avait choisie,
 * puisque le seul endroit où la choisir venait de disparaître.
 *
 * Le modèle, lui, répond à la même question deux panneaux plus haut, avec un
 * plan joué et daté. Entre les deux, ce n'est plus un doublon d'affichage :
 * c'est une contradiction, et c'est la version devinée qui parlait le plus fort.
 *
 * Une constante et non une suppression, parce que ces panneaux portent encore
 * des choses qui n'ont **pas** d'équivalent côté modèle :
 *
 * - la **saisie des naissances** (`BreedingBirthDialog`), seul chemin qui tienne
 *   l'écurie à jour ;
 * - les **clonages à faire** et les **signaux hors recette** (`driftSignals`),
 *   qui ne sortent d'aucun plan et se lisent sur l'écurie seule ;
 * - la saisie des prix de couleurs, la quantité visée, le choix de la couleur.
 *
 * Les reloger est une décision de mise en page à part entière — voir l'issue. En
 * attendant tout le calcul reste branché : seules les vues sont coupées, et les
 * remettre est ce booléen.
 */
const SHOW_HEURISTIC_PANELS = false;

const FAMILIES: { id: FamilyId; label: string }[] = [
  { id: 'muldo', label: 'Muldos' },
  { id: 'dragodinde', label: 'Dragodindes' },
  { id: 'volkorne', label: 'Volkornes' },
];

const BreedingPage = () => {
  const [family, setFamily] = useState<FamilyId>('muldo');
  const [pricedOnly, setPricedOnly] = useState(false);
  const [entryMode, setEntryMode] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(true);
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
  const timeline = useBreedingTimeline(family);

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
    loading,
    error,
    savePrice,
    saveSettings,
    saveBulkStock,
    addIndividual,
    updateIndividual,
    removeIndividual,
    recordBirths,
    saveItemStock,
  } = useBreeding(family, targetCount);

  /** Les prix nus, la table complète portant aussi les noms et les icônes. */
  const fuelPrices = useMemo(
    () => new Map([...itemPrices].map(([id, row]) => [id, row.price] as const)),
    [itemPrices]
  );

  /** Le plan ne porte que des identifiants ; les lignes ont les noms. */
  const nameOf = useMemo(() => {
    const names = new Map(rows.map((row) => [row.colorId, row.name]));
    return (colorId: string) => names.get(colorId) ?? colorId;
  }, [rows]);

  /**
   * La génération d'une couleur, qui décide de la façon dont l'écurie la porte :
   * comptée en vrac jusqu'à la gen 2, suivie monture par monture au-delà.
   */
  const generationOf = useMemo(() => {
    const generations = new Map(rows.map((row) => [row.colorId, row.generation]));
    return (colorId: string) => generations.get(colorId) ?? 1;
  }, [rows]);

  /** La couleur du plan suivi, qui réduit la liste à elle seule. */
  const selectedColorId = project.current?.target_color_id ?? null;

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
      recycleSteriles: settings.recycle_steriles,
      filler: filler?.colorId ?? null,
    });
  }, [rows, selectedColorId, stockBySex, settings.enclos_count, settings.recycle_steriles]);

  /**
   * Ce que le plan cherche — et pourquoi on ne le demande plus.
   *
   * Le choix entre « rentabilité », « gen 10 à l'équilibre » et « gen 10 au
   * moins cher » n'a de sens que face à **plusieurs générateurs** de plans,
   * qu'on arbitre alors les uns contre les autres. Il n'y en a qu'un, et les
   * autres optimisations sont encore à écrire : proposer un arbitrage entre une
   * seule option, c'est faire croire à un levier qui n'en est pas un, et faire
   * porter au lecteur la charge de comprendre trois critères pour n'en exercer
   * aucun.
   *
   * Le sélecteur est donc retiré, pas la machinerie : `objectives.ts` et le
   * partage de financement de `ColorRow` restent entiers, et rebrancher le choix
   * sera un changement d'écran quand il y aura de quoi choisir.
   */
  const objective: ObjectiveId = 'profit';

  /** Les lignes réduites à ce dont un objectif a besoin pour les départager. */
  const candidates = useMemo<(Candidate & { row: BreedingRow })[]>(
    () =>
      rows.map((row) => ({
        row,
        colorId: row.colorId,
        generation: row.generation,
        planMargin: row.planMargin,
        marginPerHour: row.marginPerHour,
        enclosHours: row.planned?.duration?.enclosHours ?? null,
        wallClockHours: row.planned?.duration?.wallClockHours ?? null,
        crossings: row.planned?.plan.crossings ?? null,
        totalCost: row.planned?.plan.totalCost ?? null,
        bestMargin: row.estimate.bestMargin,
        breedable: row.planned !== null,
      })),
    [rows]
  );

  /**
   * La couleur que l'objectif désigne, **parmi celles qu'on peut financer**.
   *
   * Un plan hors budget n'est pas une recommandation, c'est une frustration :
   * l'écarter vaut mieux que de le proposer en sachant qu'il bloquera.
   */
  const recommendation = useMemo(
    () =>
      recommendedFor(
        candidates,
        objective,
        // Le budget trie, il n'élimine pas : si rien n'est finançable, on désigne
        // quand même la meilleure route et l'écran dit ce qu'il y manque.
        (candidate) =>
          !candidate.row.planned?.funding || candidate.row.planned.funding.affordable
      ),
    [candidates, objective]
  );

  const recommended = recommendation?.item.row ?? null;

  /* La répartition du parc qui tient l'équilibre — le curseur de financement et
     les parts par couleur — vivait ici. Elle n'existait que sous l'objectif
     « gen 10 à l'équilibre », qui ne peut plus être sélectionné : la garder
     aurait laissé à l'écran une consigne qu'aucun réglage ne pouvait plus
     atteindre. `fundingSplit`, `combinedRate` et `minimumFunderPercent` restent
     dans `objectives.ts`, et `ColorRow` sait toujours afficher une part. */

  /** Ce qui manque au pire moment de la route recommandée, quand elle déborde. */
  const shortfall =
    recommendation && !recommendation.affordable
      ? (recommendation.item.row.planned?.funding?.shortfall ?? null)
      : null;

  const sorted = useMemo(() => {
    // Suivre un plan, c'est avoir tranché : le classement a servi à choisir, il
    // n'a plus rien à départager. Garder les autres couleurs à l'écran invite à
    // comparer une décision déjà prise, et noie la seule ligne qu'on vient
    // consulter. Ni le tri ni `pricedOnly` ne s'y appliquent — la ligne suivie
    // doit rester visible même sous un filtre qui la masquerait.
    if (selectedColorId) return rows.filter((row) => row.colorId === selectedColorId);

    // L'objectif décide seul de l'ordre. Les deux objectifs « gen 10 » ne
    // gardent que la génération maximale ; « rentabilité » n'écarte rien, et
    // c'est donc là qu'on va chercher une couleur précise à la main.
    const ranked = rankFor(candidates, objective).map((entry) => entry.item.row);
    return pricedOnly ? ranked.filter((row) => row.estimate.priceLevel0 !== null) : ranked;
  }, [candidates, objective, pricedOnly, selectedColorId, rows]);

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
    return driftSignals(stable, {
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
    });
  }, [tree, stable]);

  /** Les montures signalées, que ni la fournée ni les suivantes ne doivent charger. */
  const reserved = useMemo(() => drift.map((signal) => signal.mount.id), [drift]);

  /**
   * Les deux prochaines fournées du plan suivi, montures nommées.
   *
   * Ne se calcule que pour le plan suivi : c'est une consigne d'action, pas une
   * comparaison, et l'établir pour les 120 couleurs n'aurait ni sens ni intérêt.
   */
  const batches = useMemo(() => {
    const target = rows.find((row) => row.colorId === selectedColorId);
    if (!target?.planned) return [];

    return nextBatches(target.planned.plan, stable, {
      capacity: Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS,
      count: 2,
      recycleSteriles: settings.recycle_steriles,
      generationOf,
      reserved,
    });
  }, [
    rows,
    selectedColorId,
    stable,
    settings.enclos_count,
    settings.recycle_steriles,
    generationOf,
    reserved,
  ]);

  /**
   * La couleur dont on charge le plan : celle qu'on suit, ou à défaut la mieux
   * classée **qui s'élève**.
   *
   * Le repli n'est pas une commodité : la fournée doit se lire **avant** d'avoir
   * choisi, sans quoi l'écran ne dit rien à qui découvre son écurie. Il ne peut
   * pas s'arrêter à la recommandation, qui sous l'objectif « rentabilité » est
   * souvent une couleur qu'il vaut mieux **acheter** — donc sans plan, donc sans
   * rien à charger. On descend alors le classement jusqu'à la première qui en a
   * un, ce qui est bien la meilleure route au sens de l'objectif courant.
   */
  const routedColorId = useMemo(() => {
    if (selectedColorId) return selectedColorId;
    if (recommended?.planned) return recommended.colorId;
    return sorted.find((row) => row.planned)?.colorId ?? null;
  }, [selectedColorId, recommended, sorted]);

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
  const policyFill = useMemo(() => {
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
      return item ? (itemPrices.get(item.id)?.price ?? 0) : 0;
    });

    const capacity = Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS;
    return stablePlan({
      stable,
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
      kamas: settings.kamas_available,
    });
  }, [
    tree,
    rows,
    stable,
    itemPrices,
    genetonValuation,
    sacrificePrice,
    supplies,
    settings.enclos_count,
    settings.kamas_available,
  ]);

  /**
   * La fournée à charger : les étapes du plan que l'écurie permet de lancer.
   *
   * La route se calcule sur l'arbre des recettes une bonne fois, parents avant
   * enfants — elle ne se redevine plus coup par coup. Ce qui change à chaque
   * saisie de naissance est ce que l'écurie **permet** d'en lancer, et le plan
   * lui-même se reprend sur le stock. Voir `loadout.ts`.
   */
  const loadout = useMemo(() => {
    const target = rows.find((row) => row.colorId === routedColorId);
    if (!target?.planned || !routedColorId) return null;

    const byId = new Map(rows.map((row) => [row.colorId, row]));
    const colors = tree?.colors ?? [];

    return buildLoadout(
      target.planned.plan,
      routedColorId,
      stable,
      {
        colors,
        generations: new Map(colors.map((color) => [color.id, color.generation])),
        costOf: (colorId) => byId.get(colorId)?.estimate.cost ?? 0,
        fuelCostPerCycle: supplies?.fuelCostPerCycle ?? 0,
        // La durée d'un cycle de fécondité suffit à chiffrer : la montée en
        // niveau se glisse en grande partie dans les emplacements libres du
        // cycle, et ce qui dépasse ne dépend pas de l'étape.
        batchHours: supplies?.cycleHours ?? 0,
        slots: ENCLOS_SLOTS,
        recycleSteriles: settings.recycle_steriles,
      },
      Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS,
      nameOf,
      reserved
    );
  }, [
    tree,
    rows,
    routedColorId,
    stable,
    supplies,
    settings.recycle_steriles,
    settings.enclos_count,
    nameOf,
    reserved,
  ]);

  /**
   * Les clonages à faire, et ce qu'ils rendent.
   *
   * Une stérile ne vaut plus rien tant qu'on ne la clone pas : il ne lui reste
   * que l'extraction. L'arbitrage porte donc sur **qui appairer avec qui**, et
   * la valeur d'une monture s'y lit sur la génération que son ascendance porte
   * — une gen 1 à parent gen 9 vaut une gen 9. Voir `cloning.ts`.
   */
  const clonings = useMemo(() => {
    if (!tree) return [];

    const byId = new Map(rows.map((row) => [row.colorId, row]));
    /** La couleur la moins chère d'une génération : le prix de remplacement du rôle. */
    const cheapest = new Map<number, number>();
    for (const row of rows) {
      const cost = row.estimate.cost;
      if (cost === null || cost <= 0) continue;
      const current = cheapest.get(row.generation);
      if (current === undefined || cost < current) cheapest.set(row.generation, cost);
    }

    return cloneOptions(stable, {
      generations: new Map(tree.colors.map((color) => [color.id, color.generation])),
      costOf: (colorId) => byId.get(colorId)?.estimate.cost ?? 0,
      cheapestAt: (generation) => cheapest.get(generation) ?? 0,
      sacrificeUnitValue: sacrificePrice,
    });
  }, [tree, rows, stable, sacrificePrice]);

  const priced = rows.filter((row) => row.estimate.priceLevel0 !== null).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Egg size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Élevage</h1>
        </div>
        <p className="text-sm text-dark-400">
          Pour chaque couleur, le moins cher entre acheter, capturer et élever — puis ce que
          la revente rapporte.
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

      {/* La timeline vient avant tout le reste, et pour une raison d'usage : le
          reste de l'écran répond à « quoi faire », elle seule répond à « quand ».
          On ouvre cette page entre deux allers-retours en jeu, et la question
          qu'on s'y pose neuf fois sur dix est « est-ce que j'ai quelque chose à
          faire maintenant ». La faire descendre sous les réglages et les stocks
          obligerait à défiler pour lire un compte à rebours. */}
      {/* La fournée réelle voyage avec le planning : le plan du modèle est joué
          sur une graine, donc il sait quand recharger et pas avec quoi. Sans
          elle, « Charger l'enclos ×10 » est la seule consigne que l'écran donne
          — et elle n'en est pas une. */}
      <BreedingTimeline
        timeline={timeline}
        enclosCount={settings.enclos_count}
        fill={policyFill}
        nameOf={nameOf}
        // Les montures suivies, pour que la fournée nomme celles qui portent un
        // nom : le vrac est interchangeable, une gen 3+ ne l'est pas.
        individuals={stable.individuals}
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
      {SHOW_HEURISTIC_PANELS && loadout && (
        <BreedingNextMove
          loadout={loadout}
          drift={drift}
          clonings={clonings}
          nameOf={nameOf}
          individuals={stable.individuals}
          fuelCostPerCycle={supplies?.fuelCostPerCycle ?? null}
        />
      )}

      <BreedingStocks
        // Le catalogue et non les lignes de l'écran : l'écurie a besoin des
        // icônes de certificats, que seule `BreedingColor` porte.
        colors={tree?.colors ?? []}
        fuelItems={fuelItems}
        individuals={stable.individuals}
        bulk={stable.bulk}
        itemStock={itemStock}
        itemPrices={fuelPrices}
        onSaveFuelPrice={saveFuelPrice}
        ownedGaugePoints={ownedGaugePoints}
        settings={settings}
        onSaveBulk={saveBulkStock}
        onAddIndividual={addIndividual}
        onUpdateIndividual={updateIndividual}
        onRemoveIndividual={removeIndividual}
        onSaveItem={saveItemStock}
        onSaveSettings={saveSettings}
      />

      {/* La couleur visée : le classement, replié derrière ce qu'on cherche. La
          question « combien j'en veux » vient avant « laquelle », puisqu'elle
          change la réponse — à trente exemplaires les fournées se remplissent et
          le palmarès n'est plus le même. */}
      <div className={`glass rounded-2xl ${SHOW_HEURISTIC_PANELS ? '' : 'hidden'}`}>
        <button
          type="button"
          onClick={() => setGoalsOpen((value) => !value)}
          className="w-full flex items-center gap-2 px-5 py-4 cursor-pointer text-left"
        >
          <Target size={16} className="text-kamas" />
          <span className="text-sm font-semibold text-dark-200">Couleur visée</span>
          <span className="text-xs text-dark-500 ml-2 truncate">
            {project.current
              ? `${project.current.target_count} × ${nameOf(project.current.target_color_id)}`
              : 'aucun plan sélectionné'}
          </span>
          <span className="ml-auto text-xs text-dark-500 shrink-0">
            {goalsOpen ? 'Fermer' : 'Ouvrir'}
          </span>
        </button>

        {goalsOpen && (
          <div className="px-5 pb-5 pt-4 border-t border-dark-700/40 space-y-4">
            {/* Le sélecteur d'objectif vivait ici, avec la consigne
                d'équilibre qui en découlait. Voir `objective` plus haut : un
                arbitrage entre trois critères suppose plusieurs générateurs de
                plans à opposer, et il n'y en a qu'un. Le classement se lit donc
                sur la rentabilité, dite une fois ci-dessous plutôt que choisie
                à chaque visite. */}
            <p className="text-[11px] text-dark-600">
              {OBJECTIVES.find((option) => option.id === objective)?.hint}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-xs text-dark-400">
              <label className="flex items-center gap-2">
                Je veux
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={String(targetCount)}
                  onChange={(event) =>
                    setTargetCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
                  }
                  className="w-20 px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
                    text-dark-100 text-xs text-right transition-all hover:border-dark-500
                    focus:border-kamas/50"
                />
                monture{targetCount > 1 ? 's' : ''} de la couleur visée
              </label>

              {project.current ? (
                <span className="flex flex-wrap items-center gap-3 ml-auto">
                  <span className="text-dark-300">
                    Plan suivi :{' '}
                    <strong className="text-kamas">
                      {nameOf(project.current.target_color_id)}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={project.abandon}
                    className="text-dark-500 hover:text-loss transition-colors cursor-pointer"
                  >
                    abandonner
                  </button>
                </span>
              ) : (
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!recommended}
                  onClick={() =>
                    recommended && project.select(recommended.colorId, targetCount, objective)
                  }
                >
                  <Wand2 size={13} />
                  {recommended
                    ? `Suivre : ${recommended.name}${recommendation?.affordable === false ? ' (hors budget)' : ''}`
                    : 'Aucune route chiffrable'}
                </Button>
              )}
            </div>

            {/* Trois états distincts, et les confondre était le défaut : aucune
                route du tout, une route trop chère, ou rien à signaler. */}
            {!project.current && !recommendation && (
              <p className="text-[11px] text-amber-400/80">
                Aucune route chiffrable pour cet objectif. Il manque des prix de
                couleurs — renseigne-les avec « Saisir les prix ».
              </p>
            )}

            {!project.current && recommendation && !recommendation.affordable && (
              <p className="text-[11px] text-amber-400/80">
                {recommended?.name} est la meilleure route pour cet objectif, mais elle
                dépasse ton budget
                {shortfall !== null && (
                  <>
                    {' '}
                    de{' '}
                    <strong>{Math.round(shortfall).toLocaleString('fr-FR')} kamas</strong>
                  </>
                )}
                . Elle reste sélectionnable — le plan te dira où l&apos;argent manque.
              </p>
            )}

            {/* Plus de tri manuel : l'objectif ordonne, et deux tris
                concurrents répondraient à la même question en se contredisant.
                Le filtre, lui, reste — il réduit la liste sans en changer
                l'ordre. */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-dark-500">
              {!selectedColorId && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pricedOnly}
                    onChange={(event) => setPricedOnly(event.target.checked)}
                    className="accent-kamas cursor-pointer"
                  />
                  Seulement les couleurs tarifées
                </label>
              )}

              {selectedColorId && (
                <span>
                  Les autres couleurs sont masquées tant que ce plan est suivi — abandonne-le
                  pour revoir le classement.
                </span>
              )}

              <button
                type="button"
                onClick={() => setEntryMode((value) => !value)}
                className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border
                  transition-all cursor-pointer ${
                    entryMode
                      ? 'bg-kamas/15 text-kamas border-kamas/40'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
              >
                <PenLine size={13} />
                {entryMode ? 'Fermer la saisie' : 'Saisir les prix'}
              </button>
            </div>

            {entryMode && !loading && <PriceEntry rows={rows} onSavePrice={savePrice} />}

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" count={6} />
              </div>
            ) : error ? (
              <EmptyState
                icon={AlertTriangle}
                title="Classement indisponible"
                description={error}
              />
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={Egg}
                title="Aucune couleur à afficher"
                description="Décoche le filtre, ou renseigne un premier prix pour amorcer le calcul."
              />
            ) : (
              <div className="space-y-2">
                {sorted.map((row) => (
                  <ColorRow
                    key={row.colorId}
                    row={row}
                    nameOf={nameOf}
                    generationOf={generationOf}
                    stockBySex={stockBySex}
                    onSaveBulk={saveBulkStock}
                    // La part de parc à financer n'a de sens que sous
                    // l'objectif d'équilibre, qui ne peut plus être choisi.
                    // `ColorRow` sait toujours l'afficher, et la reprendra
                    // quand il y aura un générateur qui la calcule.
                    fundingShare={null}
                    enclosCount={settings.enclos_count}
                    targetCount={targetCount}
                    waves={row.colorId === selectedColorId ? waves : null}
                    selected={project.current?.target_color_id === row.colorId}
                    onSelect={() => project.select(row.colorId, targetCount)}
                    onAbandon={project.abandon}
                    onSavePrice={savePrice}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Les fournées : la seule partie de l'écran qui se lise devant l'enclos,
          d'où sa place, juste sous les stocks qu'elle consomme. Elle n'apparaît
          qu'une fois un plan suivi — sans cible, il n'y a rien à charger. */}
      {SHOW_HEURISTIC_PANELS && selectedColorId && (
        <div className="glass rounded-2xl px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-dark-200">
              Prochaines fournées — {nameOf(selectedColorId)}
            </span>
            <span className="text-xs text-dark-500">
              les montures à charger, et ce qui en est né
            </span>
          </div>
          <BreedingBatches
            batches={batches}
            nameOf={nameOf}
            individuals={stable.individuals}
            // Les couleurs brutes de la famille, et non les lignes de l'écran :
            // la popin a besoin des recettes pour nommer la couleur que la
            // recombinaison des deux lignées donnera. Voir `matingOutcomes`.
            colors={tree?.colors ?? []}
            onRecord={recordBirths}
          />
        </div>
      )}

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
            {genetonValuation
              ? `${Math.round(genetonValuation.valuePerGeneton).toLocaleString('fr-FR')} kamas`
              : 'prix des parchemins manquants'}
          </strong>
        </span>
        {tree && (
          <span className="text-dark-400">
            {tree.sacrificeItem.name} :{' '}
            <strong className="text-dark-200">
              {sacrificePrice > 0
                ? `${sacrificePrice.toLocaleString('fr-FR')} kamas`
                : 'prix manquant'}
            </strong>
          </span>
        )}
        <span className="text-dark-400">
          Cycle de fécondité :{' '}
          <strong className="text-dark-200">
            {supplies?.fuelCostPerCycle != null
              ? `${Math.round(supplies.fuelCostPerCycle).toLocaleString('fr-FR')} kamas / monture`
              : 'carburants non tarifés'}
            {supplies?.cycleHours != null && ` · ${formatHours(supplies.cycleHours)} / enclos`}
          </strong>
        </span>
        {supplies?.levelUpHours != null && (
          <span className="text-dark-400">
            Montée au niveau 200 :{' '}
            <strong className="text-dark-200">
              {formatHours(supplies.levelUpHours)}
              {supplies.mangeoireFuel && ` · ${supplies.mangeoireFuel}`}
            </strong>
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
