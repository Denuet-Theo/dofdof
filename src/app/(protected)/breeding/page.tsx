'use client';

import { useMemo, useState } from 'react';
import { Egg, AlertTriangle, Info, PenLine, Target, Wand2 } from 'lucide-react';
import ColorRow from '@/components/breeding/ColorRow';
import BreedingSettings from '@/components/breeding/BreedingSettings';
import BreedingStocks from '@/components/breeding/BreedingStocks';
import BreedingBatches from '@/components/breeding/BreedingBatches';
import BreedingNextMove from '@/components/breeding/BreedingNextMove';
import { buildLoadout } from '@/lib/dofus/breeding/loadout';
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
import {
  OBJECTIVES,
  combinedRate,
  fundingSplit,
  minimumFunderPercent,
  rankFor,
  recommendedFor,
  type Candidate,
  type ObjectiveId,
} from '@/lib/dofus/breeding/objectives';
import { formatHours } from '@/lib/utils/date';

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
  /** L'objectif tant qu'aucun plan n'est suivi — ensuite, c'est le projet qui le porte. */
  const [draftObjective, setDraftObjective] = useState<ObjectiveId>('profit');

  const project = useBreedingProject(family);

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
   * Ce que le plan cherche. Porté par le projet quand il y en a un, sinon local :
   * on doit pouvoir changer d'objectif **avant** d'avoir choisi une couleur,
   * puisque c'est justement l'objectif qui la désigne.
   */
  const objective = project.current?.objective ?? draftObjective;

  const setObjective = (next: ObjectiveId) => {
    if (project.current) project.setObjective(next);
    else setDraftObjective(next);
  };

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

  /**
   * La répartition du parc qui tient l'équilibre, sur l'objectif qui la vise.
   *
   * Calculée sur la couleur **suivie** quand il y en a une, et sur la
   * recommandation sinon : c'est une consigne d'exécution, donc elle doit
   * parler du plan qu'on mène et pas de celui qu'on aurait pu mener.
   */
  const split = useMemo(() => {
    if (objective !== 'gen10_balanced') return null;
    const target = candidates.find(
      (candidate) => candidate.colorId === (selectedColorId ?? recommended?.colorId)
    );
    return target ? fundingSplit(target, candidates) : null;
  }, [objective, candidates, selectedColorId, recommended]);

  /**
   * La part imposée au financeur, quand on veut plus que l'équilibre.
   *
   * Rester à l'équilibre monte le plus vite possible sans perdre d'argent ;
   * au-dessus, on avance moins vite mais on dégage une marge. C'est un
   * arbitrage que seul l'éleveur peut faire, d'où un réglage plutôt qu'un
   * arrondi imposé.
   */
  const [fundingBoost, setFundingBoost] = useState<number | null>(null);

  const minFunderPercent = split ? minimumFunderPercent(split) : 0;
  const funderPercent = Math.max(minFunderPercent, fundingBoost ?? 0);
  /** Ce que le parc dégage à cette part, en kamas par heure d'enclos. */
  const surplus = split ? combinedRate(split, funderPercent / 100) : 0;

  /**
   * La part de parc à financer, couleur par couleur, sous l'objectif
   * d'équilibre.
   *
   * C'est le chiffre comparable d'une route à l'autre — une gen 10 à 15 % de
   * financement vaut mieux qu'une à 40 % — et c'est celui sur lequel le
   * classement trie. La marge isolée, elle, est négative par construction sur
   * toutes : l'afficher laissait croire que l'objectif ne servait à rien.
   */
  // Sur la couleur suivie, c'est la part **saisie** qui vaut, pas le minimum
  // calculé : le curseur ne servirait à rien s'il ne déplaçait pas la ligne
  // qu'il concerne. Les autres gardent leur minimum, qui est ce sur quoi le
  // classement les départage. Voir l'appel à ColorRow.
  const fundingShares = useMemo(() => {
    if (objective !== 'gen10_balanced') return new Map<string, number>();
    return new Map(
      candidates.flatMap((candidate) => {
        const share = fundingSplit(candidate, candidates)?.funderShare;
        return share === undefined ? [] : [[candidate.colorId, share] as const];
      })
    );
  }, [objective, candidates]);

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
   * De quoi classer et chiffrer un croisement, partagé par la fournée à charger
   * et par les fournées suivantes.
   *
   * Un seul contexte pour les deux : deux copies divergeraient, et l'écran
   * afficherait un coût dans un panneau et un autre dans le suivant.
   */
  const moveContext = useMemo(() => {
    const colors = tree?.colors ?? [];
    const byId = new Map(rows.map((row) => [row.colorId, row]));
    return {
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
      costOf: (colorId: string) => byId.get(colorId)?.estimate.cost ?? 0,
      valueOf: (colorId: string) => byId.get(colorId)?.estimate.bestExitValue ?? 0,
      fuelCostPerCycle: supplies?.fuelCostPerCycle ?? 0,
      // La durée d'un cycle de fécondité suffit à chiffrer : la montée en niveau
      // se glisse en grande partie dans les emplacements libres du cycle, et ce
      // qui dépasse ne dépend pas de l'étape.
      batchHours: supplies?.cycleHours ?? 0,
      slots: ENCLOS_SLOTS,
      recycleSteriles: settings.recycle_steriles,
      topGeneration: colors.reduce((top, color) => Math.max(top, color.generation), 0),
    };
  }, [tree, rows, supplies, settings.recycle_steriles]);

  /**
   * Les deux prochaines fournées, montures nommées.
   *
   * Ne se calcule que pour le plan suivi : c'est une consigne d'action, pas une
   * comparaison, et l'établir pour les 120 couleurs n'aurait ni sens ni intérêt.
   */
  const batches = useMemo(() => {
    const target = rows.find((row) => row.colorId === selectedColorId);
    if (!target?.planned) return [];

    return nextBatches(stable, {
      capacity: Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS,
      count: 2,
      recycleSteriles: settings.recycle_steriles,
      generationOf,
      objective,
      context: moveContext,
    });
  }, [
    rows,
    selectedColorId,
    stable,
    settings.enclos_count,
    settings.recycle_steriles,
    generationOf,
    objective,
    moveContext,
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
   * La fournée à charger : les croisements les mieux classés que l'écurie
   * permet, jusqu'à remplir le parc.
   *
   * Le plan reste, mais pour le **diagnostic** : ce qu'il réclame encore et ce
   * qui lui manque. Ce qu'on lance vient du classement — mesuré 2,6 fois moins
   * cher et 2,5 fois moins de fournées vers la gen 10. Voir `loadout.ts`.
   */
  const loadout = useMemo(() => {
    const target = rows.find((row) => row.colorId === routedColorId);
    if (!target?.planned || !routedColorId) return null;

    return buildLoadout(
      target.planned.plan,
      routedColorId,
      stable,
      objective,
      moveContext,
      Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS,
      nameOf
    );
  }, [
    rows,
    routedColorId,
    stable,
    objective,
    moveContext,
    settings.enclos_count,
    nameOf,
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

      <BreedingSettings settings={settings} onSave={saveSettings} />

      <BreedingStocks
        rows={rows}
        fuelItems={fuelItems}
        stockBySex={stockBySex}
        individuals={stable.individuals}
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

      {/* Objectifs : le classement, replié derrière ce qu'on vise. La question
          « combien j'en veux » vient avant « laquelle », puisqu'elle change la
          réponse — à trente exemplaires les fournées se remplissent et le
          palmarès n'est plus le même. */}
      <div className="glass rounded-2xl">
        <button
          type="button"
          onClick={() => setGoalsOpen((value) => !value)}
          className="w-full flex items-center gap-2 px-5 py-4 cursor-pointer text-left"
        >
          <Target size={16} className="text-kamas" />
          <span className="text-sm font-semibold text-dark-200">Objectifs</span>
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
            {/* Ce qu'on cherche vient avant tout le reste : c'est ce qui décide
                du gagnant, et les trois critères ne désignent pas la même
                couleur. La marge horaire, seule, ne pouvait jamais recommander
                une route vers la gen 10 — elle y perd toujours. */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {OBJECTIVES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setObjective(option.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer border ${
                      objective === option.id
                        ? 'bg-kamas/15 border-kamas/40 text-kamas'
                        : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-dark-500'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-dark-600">
                {OBJECTIVES.find((option) => option.id === objective)?.hint}
              </p>

              {/* La consigne concrète de l'objectif d'équilibre : deux élevages
                  menés de front, et la part du parc qui rend l'ensemble
                  neutre. C'est ça, ne pas alterner. */}
              {split && (
                <div className="text-[11px] text-dark-300 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-dark-500">Consacrer</span>
                    {/* Jamais en dessous du minimum : descendre sous l'équilibre
                        ferait perdre de l'argent, ce que ce réglage est
                        justement là pour éviter. Au-dessus, en revanche, c'est
                        une marge de sécurité qu'on peut vouloir. */}
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={minFunderPercent}
                        max={100}
                        value={String(funderPercent)}
                        onChange={(event) =>
                          setFundingBoost(
                            Math.max(
                              minFunderPercent,
                              Math.min(100, Number(event.target.value) || minFunderPercent)
                            )
                          )
                        }
                        title={`Minimum ${minFunderPercent} % — en dessous, le parc perd de l'argent. Au-dessus, tu montes moins vite mais tu dégages une marge.`}
                        className="w-14 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                          border-dark-600/50 text-kamas text-[11px] text-right font-semibold
                          transition-all hover:border-dark-500 focus:border-kamas/50"
                      />
                      <span className="text-kamas font-semibold">%</span>
                    </span>
                    <span className="text-dark-500">du parc à</span>
                    <strong className="text-dark-100">{split.funder.row.name}</strong>
                    <span className="text-dark-500">
                      ({Math.round(split.funderRate).toLocaleString('fr-FR')} k/h), les
                    </span>
                    <strong className="text-kamas">{100 - funderPercent} %</strong>
                    <span className="text-dark-500">
                      restants à{' '}
                      {selectedColorId ? nameOf(selectedColorId) : recommended?.name}. Les deux
                      tournent en même temps — c&apos;est ce qui évite d&apos;alterner.
                    </span>
                  </p>
                  <p className="text-[10px] text-dark-600">
                    {surplus > 0.5 ? (
                      <>
                        Au-dessus du minimum de {minFunderPercent} % : le parc dégage{' '}
                        <strong className="text-profit">
                          +{Math.round(surplus).toLocaleString('fr-FR')} kamas / heure
                        </strong>{' '}
                        au lieu d&apos;être à zéro, et la montée avance d&apos;autant moins
                        vite.
                      </>
                    ) : (
                      <>
                        À {minFunderPercent} %, le parc est exactement à l&apos;équilibre.
                        Monte la part si tu préfères dégager une marge plutôt que d&apos;aller
                        vite.
                      </>
                    )}
                  </p>
                </div>
              )}

              {objective === 'gen10_balanced' && !split && recommended && (
                <p className="text-[11px] text-amber-400/80">
                  Aucune couleur ne dégage de marge horaire positive : rien ne peut
                  financer la montée, et le parc ne peut pas s&apos;équilibrer seul.
                  Renseigne des prix de revente, ou décoche « ne jamais vendre ».
                </p>
              )}
            </div>

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
                    fundingShare={
                      row.colorId === selectedColorId && split
                        ? funderPercent / 100
                        : (fundingShares.get(row.colorId) ?? null)
                    }
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

      {/* La fournée vient avant les lots, et ce n'est pas un détail de mise en
          page : c'est elle qui désigne les montures, les lots ne font que les
          regrouper. Le panneau disparaît de lui-même tant qu'aucune couleur
          n'est planifiable. */}
      {loadout && <BreedingNextMove loadout={loadout} clonings={clonings} nameOf={nameOf} />}

      {/* Les fournées : la seule partie de l'écran qui se lise devant l'enclos,
          d'où sa place, juste sous les stocks qu'elle consomme. Elle n'apparaît
          qu'une fois un plan suivi — sans cible, il n'y a rien à charger. */}
      {selectedColorId && (
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
