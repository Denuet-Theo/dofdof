'use client';

import { useState } from 'react';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ColorPriceInputs from '@/components/breeding/ColorPriceInputs';
import type { BreedingRow } from '@/lib/hooks/useBreeding';

/** Ce que dit la stratégie retenue, en un mot et une couleur. */
const STRATEGY_LABEL = {
  buy: { label: 'Acheter', className: 'bg-dark-700/60 text-dark-300' },
  capture: { label: 'Capturer', className: 'bg-sky-500/15 text-sky-300' },
  breed: { label: 'Élever', className: 'bg-kamas/15 text-kamas' },
} as const;

/** Étiquette courte, pour l'en-tête de colonne. */
const EXIT_SHORT = {
  sell0: 'vente niv 0',
  sell200: 'vente niv 200',
  sacrifice: 'extraction',
} as const;

const EXIT_LABEL = {
  sell0: 'revendre le poulain',
  sell200: 'monter au 200 puis revendre',
  sacrifice: 'extraire',
} as const;

type Props = {
  row: BreedingRow;
  onSavePrice: (colorId: string, mountLevel: 0 | 200, price: number) => Promise<boolean>;
};

const ColorRow = ({ row, onSavePrice }: Props) => {
  const [open, setOpen] = useState(false);
  const { estimate } = row;
  const strategy = estimate.strategy ? STRATEGY_LABEL[estimate.strategy] : null;

  // Une marge ne veut rien dire sans prix de vente : mieux vaut inviter à le
  // saisir que d'afficher un zéro qui se lirait comme « pas rentable ».
  const margin = estimate.marginLevel0;

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer
          hover:bg-dark-800/40 transition-colors"
      >
        <ChevronRight
          size={16}
          className={`text-dark-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-dark-100 truncate">{row.name}</span>
            <span className="text-[10px] text-dark-500 shrink-0">gen {row.generation}</span>
            {estimate.strategy === 'breed' && !estimate.verified && (
              <span
                title="Ce chemin passe par une recette extraite d'un site tiers, non recoupée en jeu."
                className="shrink-0"
              >
                <TriangleAlert size={13} className="text-amber-400/80" />
              </span>
            )}
          </div>
          {estimate.strategy === 'breed' && estimate.parents && (
            <p className="text-[11px] text-dark-500 mt-0.5">
              parents niveau {estimate.parents.level} ·{' '}
              {Math.round(estimate.parents.successRate * 100)} % de réussite
              {estimate.parents.useOptimakina && ' · Optimakina'}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-[10px] text-dark-500">Coût de revient</p>
          {estimate.cost === null ? (
            <p className="text-sm text-dark-600">—</p>
          ) : (
            <KamasDisplay amount={Math.round(estimate.cost)} size="sm" />
          )}
        </div>

        <div className="text-right shrink-0 w-32">
          <p className="text-[10px] text-dark-500">Marge ({EXIT_SHORT[estimate.bestExit]})</p>
          {margin === null ? (
            <p className="text-sm text-dark-600">prix manquant</p>
          ) : (
            <p className={`text-sm font-semibold ${margin > 0 ? 'text-profit' : 'text-loss'}`}>
              {margin > 0 ? '+' : ''}
              {Math.round(margin).toLocaleString('fr-FR')}
            </p>
          )}
        </div>

        {strategy && (
          <span className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium ${strategy.className}`}>
            {strategy.label}
          </span>
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-dark-700/40 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
            <div className="md:col-span-1">
              <p className="text-dark-500 mb-2">Prix à l&apos;hôtel de vente</p>
              <ColorPriceInputs
                colorId={row.colorId}
                level0={estimate.priceLevel0}
                level200={estimate.priceLevel200}
                onSave={onSavePrice}
              />
            </div>
            <div>
              <p className="text-dark-500 mb-1">Meilleure sortie</p>
              <p className="text-dark-200">{EXIT_LABEL[estimate.bestExit]}</p>
            </div>
            <div>
              <p className="text-dark-500 mb-1">Extraction</p>
              <p className="text-dark-200">
                {estimate.sacrificeUnits === 0
                  ? 'impossible en gen 1'
                  : `${estimate.sacrificeUnits} ressources`}
              </p>
            </div>
          </div>

          {estimate.breedRecipe && (
            <div className="text-xs">
              <p className="text-dark-500 mb-1">Recette retenue</p>
              <p className="text-dark-200">
                {estimate.breedRecipe.join('  +  ')}
                {estimate.genetons > 0 && (
                  <span className="text-dark-500"> · {estimate.genetons} génétons</span>
                )}
              </p>
            </div>
          )}

          {row.source === 'site' && estimate.strategy === 'breed' && (
            <p className="text-[11px] text-amber-400/80">
              Recette extraite d&apos;un site tiers, non recoupée en jeu.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ColorRow;
