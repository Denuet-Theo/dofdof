'use client';

import { useMemo, useState } from 'react';
import { Egg, AlertTriangle, Info, PenLine, Target, Wand2 } from 'lucide-react';
import ColorRow from '@/components/breeding/ColorRow';
import BreedingSettings from '@/components/breeding/BreedingSettings';
import BreedingStocks from '@/components/breeding/BreedingStocks';
import BreedingBatches from '@/components/breeding/BreedingBatches';
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

type SortBy = 'hourly' | 'margin' | 'cost' | 'generation';

/**
 * Ce sur quoi le tri horaire compare.
 *
 * Une couleur qu'on achète ou capture ne mobilise **aucun** enclos : elle ne
 * concourt pas pour la ressource dont ce classement parle. À marge positive
 * elle bat donc tout ce qui en demande — c'est du gain sans immobiliser le
 * parc — et à marge négative elle ne vaut rien de plus. La renvoyer en queue
 * dans les deux cas, comme le ferait un simple `?? -Infinity`, dirait l'inverse
 * de la vérité sur les couleurs sauvages, qui sont justement les plus rentables
 * à l'heure.
 */
const hourlyKey = (row: BreedingRow) => {
  if (row.marginPerHour !== null) return row.marginPerHour;
  const margin = row.estimate.bestMargin;
  return margin !== null && margin > 0 ? Infinity : -Infinity;
};

const BreedingPage = () => {
  const [family, setFamily] = useState<FamilyId>('muldo');
  // Par heure d'enclos par défaut : c'est la question que se pose l'éleveur.
  // Trier sur la marge brute mettrait les hautes générations en tête par
  // construction, puisqu'elles coûtent plus de travail à produire.
  const [sortBy, setSortBy] = useState<SortBy>('hourly');
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

    // Un objectif explicite décide seul de l'ordre, et le tri manuel disparaît
    // avec lui : les deux répondraient à la même question, en se contredisant.
    if (objective !== 'color') {
      return rankFor(candidates, objective).map((ranked) => ranked.item.row);
    }

    const kept = pricedOnly ? rows.filter((row) => row.estimate.priceLevel0 !== null) : rows;

    return [...kept].sort((a, b) => {
      if (sortBy === 'generation') return a.generation - b.generation;
      if (sortBy === 'cost') {
        // Les couleurs sans coût chiffrable finissent en queue plutôt que d'être
        // traitées comme gratuites.
        return (a.estimate.cost ?? Infinity) - (b.estimate.cost ?? Infinity);
      }
      if (sortBy === 'hourly') return hourlyKey(b) - hourlyKey(a);
      // Même base de coût que la colonne : celui du plan quand il y en a un.
      return (
        (b.planMargin ?? b.estimate.bestMargin ?? -Infinity) -
        (a.planMargin ?? a.estimate.bestMargin ?? -Infinity)
      );
    });
  }, [rows, candidates, objective, sortBy, pricedOnly, selectedColorId]);

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
    });
  }, [
    rows,
    selectedColorId,
    stable,
    settings.enclos_count,
    settings.recycle_steriles,
    generationOf,
  ]);

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
        ownedGaugePoints={ownedGaugePoints}
        settings={settings}
        onSaveBulk={saveBulkStock}
        onAddIndividual={addIndividual}
        onUpdateIndividual={updateIndividual}
        onRemoveIndividual={removeIndividual}
        onSaveItem={saveItemStock}
        onSaveSettings={saveSettings}
      />

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
            colors={rows.map((row) => ({
              colorId: row.colorId,
              name: row.name,
              generation: row.generation,
            }))}
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
                    : objective === 'color'
                      ? 'Choisis une couleur ci-dessous'
                      : 'Aucune route chiffrable'}
                </Button>
              )}
            </div>

            {/* Trois états distincts, et les confondre était le défaut : aucune
                route du tout, une route trop chère, ou rien à signaler. */}
            {!project.current && objective !== 'color' && !recommendation && (
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

            {/* Tri manuel : réservé à « une couleur précise ». Ailleurs c'est
                l'objectif qui ordonne, et deux tris concurrents se
                contrediraient. */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-dark-500">
              {!selectedColorId && objective === 'color' && (
                <>
                  <span>Trier par</span>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as SortBy)}
                    className="px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
                      text-dark-200 text-xs hover:border-dark-500 focus:border-kamas/50 cursor-pointer"
                  >
                    <option value="hourly">Marge par heure d&apos;enclos</option>
                    <option value="margin">Marge par monture</option>
                    <option value="cost">Coût de revient</option>
                    <option value="generation">Génération</option>
                  </select>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pricedOnly}
                      onChange={(event) => setPricedOnly(event.target.checked)}
                      className="accent-kamas cursor-pointer"
                    />
                    Seulement les couleurs tarifées
                  </label>
                </>
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
    </div>
  );
};

export default BreedingPage;
