'use client';

import { INDIVIDUAL_TRACKING_FROM, type BulkStock } from '@/lib/dofus/breeding/stable';

/**
 * Le « j'en ai » des lignes de plan, désormais sexé.
 *
 * Un accouplement demande un mâle et une femelle, donc un compteur unique ne
 * suffit plus à dire ce qu'on peut lancer : huit Doré ne font quatre couples que
 * s'ils sont quatre de chaque. Le champ se dédouble donc en deux.
 *
 * Au-delà de la génération 2, il n'y a plus rien à saisir ici : les montures y
 * sont suivies une par une, avec leur niveau et leur ascendance, et un compteur
 * ne saurait pas quoi en faire. Le champ passe en lecture seule et renvoie vers
 * l'écurie, qui est le seul endroit où ces montures-là s'ajoutent.
 */

type Props = {
  colorId: string;
  generation: number;
  stockBySex: Map<string, BulkStock>;
  onSaveBulk: (colorId: string, males: number, females: number) => Promise<void>;
  /** Compact : sans le libellé, pour les lignes de plan déjà chargées. */
  compact?: boolean;
};

const clamp = (value: number) => Math.max(0, Math.min(999, value || 0));

const sexInput = (
  value: number,
  title: string,
  onChange: (next: number) => void,
  disabled = false
) => (
  <input
    type="number"
    min={0}
    max={999}
    disabled={disabled}
    value={String(value)}
    onChange={(event) => onChange(clamp(Number(event.target.value)))}
    title={title}
    className="w-12 px-1.5 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
      text-dark-100 text-xs text-right transition-all hover:border-dark-500
      focus:border-kamas/50 disabled:opacity-50 disabled:cursor-not-allowed"
  />
);

const StableCountField = ({
  colorId,
  generation,
  stockBySex,
  onSaveBulk,
  compact = false,
}: Props) => {
  const counts = stockBySex.get(colorId) ?? { males: 0, females: 0 };
  const tracked = generation >= INDIVIDUAL_TRACKING_FROM;

  if (tracked) {
    const total = counts.males + counts.females;
    return (
      <span
        className="flex items-center gap-1.5 shrink-0 text-[10px] text-dark-500"
        title={`Génération ${generation} : ces montures se suivent une par une dans « Mes stocks », avec leur niveau et leur ascendance.`}
      >
        {!compact && <span>j&apos;en ai</span>}
        <span className="text-dark-300 tabular-nums">
          {counts.males}♂ {counts.females}♀
        </span>
        {total === 0 && <span className="text-dark-600">— à ajouter en écurie</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {!compact && <span className="text-[10px] text-dark-500">j&apos;en ai</span>}
      <span className="text-[10px] text-dark-500">♂</span>
      {sexInput(counts.males, 'Mâles fertiles en écurie', (next) =>
        onSaveBulk(colorId, next, counts.females)
      )}
      <span className="text-[10px] text-dark-500">♀</span>
      {sexInput(counts.females, 'Femelles fertiles en écurie', (next) =>
        onSaveBulk(colorId, counts.males, next)
      )}
    </span>
  );
};

export default StableCountField;
