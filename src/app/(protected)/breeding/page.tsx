'use client';

import { useMemo, useState } from 'react';
import { Egg, Info } from 'lucide-react';
import BreedingStocks from '@/components/breeding/BreedingStocks';
import BreedingTimeline from '@/components/breeding/BreedingTimeline';
import AvailabilityPicker from '@/components/breeding/AvailabilityPicker';
import { couplesToRecordAll, stablePlan } from '@/lib/dofus/breeding/policy';
import { isCrownable, ladderOf } from '@/lib/dofus/breeding/ladder';
import { driftSignals } from '@/lib/dofus/breeding/drift';
import { cloneOptions } from '@/lib/dofus/breeding/cloning';
import { useBreeding, type BreedingRow, type FamilyId } from '@/lib/hooks/useBreeding';
import { planWaves } from '@/lib/dofus/breeding/waves';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import { useBreedingProject } from '@/lib/hooks/useBreedingProject';
import { useBreedingTimeline } from '@/lib/hooks/useBreedingTimeline';
import { useAvailability } from '@/lib/hooks/useAvailability';
import { formatHours } from '@/lib/utils/date';
import { toNumber } from '@/lib/supabase/types';

const FAMILIES: { id: FamilyId; label: string }[] = [
  { id: 'muldo', label: 'Muldos' },
  { id: 'dragodinde', label: 'Dragodindes' },
  { id: 'volkorne', label: 'Volkornes' },
];

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
  const timeline = useBreedingTimeline(family);
  // Les créneaux où l'on peut agir. Le plan ne s'en sert pas encore — il faut
  // d'abord que l'ordonnanceur sache viser une durée — mais le choix du jour se
  // pose dès maintenant, parce que c'est le geste du matin.
  const availability = useAvailability();

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
    savePrice,
    saveSettings,
    saveBulkStock,
    addIndividual,
    updateIndividual,
    recordEnclosExit,
    removeIndividual,
    recordBirths,
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
      recycleSteriles: settings.recycle_steriles,
      filler: filler?.colorId ?? null,
    });
  }, [rows, selectedColorId, stockBySex, settings.enclos_count, settings.recycle_steriles]);

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
    return driftSignals(stable, {
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
    });
  }, [tree, stable]);



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

    const capacity = Math.max(settings.enclos_count, 1) * ENCLOS_SLOTS;
    return {
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
      kamas: toNumber(settings.kamas_available),
      // La gen 10 que l'éleveur poursuit. Le canal est le **projet**, privé, et
      // non le prix : `breeding_color_prices` est partagé entre les joueurs, donc
      // gonfler une gen 10 pour l'atteindre fausserait leur marché — et les coûts
      // affichés avec, puisque le prix sert aussi à chiffrer.
      target: selectedColorId,
    };
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
    selectedColorId,
  ]);

  const policyFill = useMemo(
    () => (policyInput ? stablePlan(policyInput) : null),
    [policyInput]
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
   */
  const policyCouples = useMemo(
    () => (policyInput ? couplesToRecordAll(policyInput) : []),
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
      {/* Le préréglage du jour, juste avant le planning : c'est ce qui décide de
          quand on pourra agir, donc ça se lit avant les consignes. */}
      {availability.restored && (
        <AvailabilityPicker
          presets={availability.state.presets}
          active={availability.active}
          onChoose={availability.choose}
          onSave={availability.savePreset}
          onRemove={availability.removePreset}
        />
      )}

      {/* La fournée réelle voyage avec le planning : le plan du modèle est joué
          sur une graine, donc il sait quand recharger et pas avec quoi. Sans
          elle, « Charger l'enclos ×10 » est la seule consigne que l'écran donne
          — et elle n'en est pas une. */}
      <BreedingTimeline
        timeline={timeline}
        enclosCount={settings.enclos_count}
        fill={policyFill}
        // La liste complète, pas la tranche que `fill` porte : voir #165.
        couples={policyCouples}
        // Ce que valent les stériles, à l'étape où on les clone : voir #163.
        cloneAdvice={clonings}
        nameOf={nameOf}
        // Les montures suivies, pour que la fournée nomme celles qui portent un
        // nom : le vrac est interchangeable, une gen 3+ ne l'est pas.
        individuals={stable.individuals}
        // Le parcours guidé a besoin du catalogue : la fenêtre d'accouplement
        // propose les issues possibles, pas seulement des noms.
        colors={tree?.colors ?? []}
        generations={
          new Map((tree?.colors ?? []).map((color) => [color.id, color.generation]))
        }
        onRecordBirths={recordBirths}
        onRecordClonings={recordClonings}
        onEnclosExit={recordEnclosExit}
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
