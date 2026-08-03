'use client';

import { useMemo, useState } from 'react';
import { Egg, AlertTriangle, Info, PenLine } from 'lucide-react';
import ColorRow from '@/components/breeding/ColorRow';
import BreedingSettings from '@/components/breeding/BreedingSettings';
import PriceEntry from '@/components/breeding/PriceEntry';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useBreeding, type FamilyId } from '@/lib/hooks/useBreeding';

const FAMILIES: { id: FamilyId; label: string }[] = [
  { id: 'muldo', label: 'Muldos' },
  { id: 'dragodinde', label: 'Dragodindes' },
  { id: 'volkorne', label: 'Volkornes' },
];

type SortBy = 'margin' | 'cost' | 'generation';

/**
 * Une durée d'enclos, en jours au-delà de 48 h.
 *
 * Les cycles se comptent en heures, mais monter une monture au niveau 200 en
 * demande des centaines : « 289h » ne se lit pas, « 12 j » si.
 */
const formatHours = (hours: number) => {
  if (hours >= 48) return `${Math.round(hours / 24)} j`;
  const whole = Math.floor(hours);
  return `${whole}h${String(Math.round((hours - whole) * 60)).padStart(2, '0')}`;
};

const BreedingPage = () => {
  const [family, setFamily] = useState<FamilyId>('muldo');
  const [sortBy, setSortBy] = useState<SortBy>('margin');
  const [pricedOnly, setPricedOnly] = useState(false);
  const [entryMode, setEntryMode] = useState(false);

  const {
    tree,
    rows,
    settings,
    genetonValuation,
    sacrificePrice,
    supplies,
    loading,
    error,
    savePrice,
    saveSettings,
  } = useBreeding(family);

  const sorted = useMemo(() => {
    const kept = pricedOnly ? rows.filter((row) => row.estimate.priceLevel0 !== null) : rows;

    return [...kept].sort((a, b) => {
      if (sortBy === 'generation') return a.generation - b.generation;
      if (sortBy === 'cost') {
        // Les couleurs sans coût chiffrable finissent en queue plutôt que d'être
        // traitées comme gratuites.
        return (a.estimate.cost ?? Infinity) - (b.estimate.cost ?? Infinity);
      }
      return (b.estimate.bestMargin ?? -Infinity) - (a.estimate.bestMargin ?? -Infinity);
    });
  }, [rows, sortBy, pricedOnly]);

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
            {supplies?.fuelCostPerBaby != null
              ? `${Math.round(supplies.fuelCostPerBaby).toLocaleString('fr-FR')} kamas / monture`
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
          Aucun carburant tarifé pour {supplies.missingGauges.join(', ')} — le coût des cycles
          et de la montée en niveau est sous-estimé tant que ces prix manquent.
        </p>
      )}

      {/* Tri */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-dark-500">
        <span>Trier par</span>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortBy)}
          className="px-2 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-200 text-xs hover:border-dark-500 focus:border-kamas/50 cursor-pointer"
        >
          <option value="margin">Marge</option>
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

        <button
          type="button"
          onClick={() => setEntryMode((value) => !value)}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all
            cursor-pointer ${
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
        <EmptyState icon={AlertTriangle} title="Classement indisponible" description={error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Egg}
          title="Aucune couleur à afficher"
          description="Décoche le filtre, ou renseigne un premier prix pour amorcer le calcul."
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => (
            <ColorRow key={row.colorId} row={row} onSavePrice={savePrice} />
          ))}
        </div>
      )}

    </div>
  );
};

export default BreedingPage;
