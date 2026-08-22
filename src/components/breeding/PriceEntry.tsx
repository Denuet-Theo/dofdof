'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import ColorPriceInputs from '@/components/breeding/ColorPriceInputs';
import type { BreedingRow } from '@/lib/hooks/useBreeding';

type Props = {
  rows: BreedingRow[];
  onSavePrice: (colorId: string, mountLevel: 0 | 200, price: number) => Promise<boolean>;
};

/**
 * Saisie en masse des prix de couleurs.
 *
 * Le détail d'une ligne suffit pour corriger un prix, mais pas pour en entrer
 * cent : il faudrait déplier autant de lignes. Ce mode les met à plat, filtre
 * par nom et met **les couleurs non tarifées d'abord** — c'est là qu'est le
 * travail, et une couleur déjà remplie n'a pas à occuper le haut de l'écran.
 *
 * Rien n'oblige à tout saisir : cinq prix de couleurs sauvages suffisent à
 * rendre les 120 muldos chiffrables, le reste ne fait qu'affiner en révélant
 * qu'un intermédiaire est moins cher à racheter qu'à produire.
 */
const PriceEntry = ({ rows, onSavePrice }: Props) => {
  const [query, setQuery] = useState('');
  const [missingFirst, setMissingFirst] = useState(true);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = needle
      ? rows.filter((row) => row.name.toLowerCase().includes(needle))
      : [...rows];

    return kept.sort((a, b) => {
      if (missingFirst) {
        const aMissing = a.estimate.priceLevel0 === null ? 0 : 1;
        const bMissing = b.estimate.priceLevel0 === null ? 0 : 1;
        if (aMissing !== bMissing) return aMissing - bMissing;
      }
      return a.generation - b.generation || a.name.localeCompare(b.name);
    });
  }, [rows, query, missingFirst]);

  const missing = rows.filter((row) => row.estimate.priceLevel0 === null).length;

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrer par nom (ex : Corail, Prune...)"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
              text-dark-100 text-sm placeholder:text-dark-500 transition-all
              hover:border-dark-500 focus:border-kamas/50"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer">
          <input
            type="checkbox"
            checked={missingFirst}
            onChange={(event) => setMissingFirst(event.target.checked)}
            className="accent-kamas cursor-pointer"
          />
          Les couleurs sans prix d&apos;abord
        </label>
        <span className="text-xs text-dark-500">
          {missing} sur {rows.length} sans prix
        </span>
      </div>

      <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
        {shown.map((row) => (
          <div
            key={row.colorId}
            className="flex items-center gap-4 px-3 py-2 rounded-xl hover:bg-dark-800/40 transition-colors"
          >
            <div className="w-52 shrink-0 min-w-0">
              <p className="text-sm text-dark-200 truncate">{row.name}</p>
              <p className="text-[10px] text-dark-500">
                gen {row.generation}
                {row.estimate.priceLevel0 === null && ' · sans prix'}
              </p>
            </div>
            <div className="flex-1 min-w-0">
              <ColorPriceInputs
                colorId={row.colorId}
                // Ce qui est saisi **sur la couleur**, et non ce que
                // l'estimation retient : elle comble le niveau 1 avec le prix de
                // l'item, qui s'affiche en repère sous le champ vide.
                level0={row.own.level0}
                level200={row.own.level200}
                inheritedLevel0={row.own.level0 === null ? row.estimate.priceLevel0 : null}
                onSave={onSavePrice}
                compact
              />
            </div>
          </div>
        ))}

        {shown.length === 0 && (
          <p className="text-xs text-dark-500 text-center py-6">Aucune couleur ne correspond.</p>
        )}
      </div>
    </div>
  );
};

export default PriceEntry;
