'use client';

import { useState } from 'react';
import ItemCard from '@/components/ui/ItemCard';
import CounterSearch from '@/components/counters/CounterSearch';
import { KIND_LABEL, type CounterTarget } from '@/lib/dofus/counters';
import type { CounterCell as Cell } from '@/lib/hooks/useCounters';

/**
 * Une case de la grille : un compteur, ou de quoi en poser un.
 *
 * L'icône **est** le bouton +1. C'est le geste qu'on répète quarante fois de
 * suite en revenant du jeu, donc c'est lui qui reçoit la plus grande cible de
 * l'écran ; tout le reste — retirer, supprimer — est une correction, et vit dans
 * une bande discrète en bas de la case.
 */

interface CounterCellProps {
  slot: number;
  cell: Cell | null;
  onPick: (target: CounterTarget) => void;
  onBump: (delta: number) => void;
  onRemove: () => void;
}

/**
 * Une case remplie.
 *
 * Composant séparé pour une seule raison, et elle est fonctionnelle : il porte
 * l'état « suppression armée », et la clé que lui donne `CounterCell` le remonte
 * quand la case change de cible. Sans ça, supprimer un compteur puis en poser un
 * autre au même endroit rouvrirait la confirmation du précédent sur le nouveau.
 */
const FilledCell = ({
  slot,
  cell,
  onBump,
  onRemove,
}: {
  slot: number;
  cell: Cell;
  onBump: (delta: number) => void;
  onRemove: () => void;
}) => {
  /**
   * Le ❌ demande confirmation, et **sans minuterie**.
   *
   * Un compteur à 200 est un après-midi de farm, et sa suppression ne se
   * rattrape pas : la ligne part de la base, le total avec. Deux clics au même
   * endroit ne se font pas par accident, là où un seul, lui, se fait.
   *
   * L'état armé reste donc affiché jusqu'à ce qu'on tranche — même raisonnement
   * que le presse-papier du panneau d'accouplement et que les bannières
   * d'écriture perdue : une confirmation qui s'efface au bout de deux secondes
   * est une confirmation qu'on rate en regardant le jeu à côté, ce qui est
   * exactement la posture de travail de cet écran.
   */
  const [armed, setArmed] = useState(false);

  // Un clic sur le compteur pendant que la suppression attend dit qu'on est
  // passé à autre chose : la question se referme plutôt que de rester en
  // embuscade sous une case qu'on est en train d'utiliser.
  const bump = (delta: number) => {
    setArmed(false);
    onBump(delta);
  };

  return (
    <div
      data-testid="counter-cell"
      data-slot={slot}
      data-label={cell.label}
      data-tally={cell.tally}
      data-unsaved={cell.unsaved ? '1' : '0'}
      className="glass rounded-2xl p-4 min-h-[172px] flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        {/* L'enveloppe ne sert qu'au `data-testid` : `ItemCard.Icon` rend
            lui-même le bouton, et la suite de tests vise des identifiants, pas
            des libellés (cf. e2e/README.md). */}
        <div data-testid="counter-bump" className="flex-shrink-0">
          <ItemCard.Icon
            src={cell.img}
            alt={cell.label}
            size="lg"
            scaleOnHover={false}
            onClick={() => bump(1)}
            title={`+1 ${cell.label}`}
          />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p
            data-testid="counter-tally"
            className="text-3xl font-bold text-kamas tabular-nums leading-none"
          >
            {cell.tally}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-dark-500">
            {KIND_LABEL[cell.kind]}
          </p>
        </div>
      </div>

      <p className="text-sm font-semibold text-dark-100 truncate" title={cell.label}>
        {cell.label}
      </p>

      <div className="mt-auto flex items-center gap-2 border-t border-dark-700/40 pt-2">
        {armed ? (
          <>
            {/* Le total est répété dans la question : c'est lui qu'on perd, et
                le nom seul ne dit pas ce que la case a coûté. */}
            <span className="text-[11px] text-dark-300">
              Supprimer&nbsp;? <span className="text-dark-500">({cell.tally})</span>
            </span>
            <button
              type="button"
              data-testid="counter-remove-confirm"
              onClick={onRemove}
              title={`Supprimer le compteur « ${cell.label} » et son total de ${cell.tally}`}
              aria-label={`Supprimer le compteur « ${cell.label} » et son total de ${cell.tally}`}
              className="ml-auto px-2 py-1 rounded-lg text-[11px] font-semibold leading-none
                bg-loss/20 text-loss-light hover:bg-loss/30 transition-colors cursor-pointer"
            >
              Oui
            </button>
            <button
              type="button"
              data-testid="counter-remove-cancel"
              onClick={() => setArmed(false)}
              title="Garder le compteur"
              aria-label="Garder le compteur"
              className="px-2 py-1 rounded-lg text-[11px] font-semibold leading-none
                bg-dark-800/60 text-dark-300 hover:bg-dark-700/60 transition-colors cursor-pointer"
            >
              Non
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="counter-back"
              onClick={() => bump(-1)}
              disabled={cell.tally === 0}
              title={`Retirer un ${cell.label}`}
              aria-label={`Retirer un ${cell.label}`}
              className="px-2 py-1 rounded-lg text-base leading-none
                bg-dark-800/60 hover:bg-dark-700/60 transition-colors cursor-pointer
                disabled:opacity-30 disabled:cursor-not-allowed"
            >
              🔙
            </button>
            <button
              type="button"
              data-testid="counter-remove"
              onClick={() => setArmed(true)}
              title={`Supprimer le compteur « ${cell.label} »`}
              aria-label={`Supprimer le compteur « ${cell.label} »`}
              className="px-2 py-1 rounded-lg text-base leading-none
                bg-dark-800/60 hover:bg-loss/20 transition-colors cursor-pointer"
            >
              ❌
            </button>

            {/* Le total est juste, c'est son enregistrement qui a échoué. Le dire
                ici est tout l'écart entre un compteur sauvé et un compteur perdu :
                la bannière d'écriture perdue dit qu'il y a un problème, cette
                étiquette dit sur quelle case. */}
            {cell.unsaved && (
              <span
                data-testid="counter-unsaved"
                className="ml-auto text-[10px] font-medium text-loss"
                title="Ce total n'est pas enregistré : la base a refusé l'écriture."
              >
                non enregistré
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const CounterCell = ({ slot, cell, onPick, onBump, onRemove }: CounterCellProps) => {
  if (!cell) {
    return (
      <div
        data-testid="counter-cell"
        data-slot={slot}
        // `relative focus-within:z-40` : la liste de résultats déborde sous la
        // case, donc par-dessus la case du dessous. Or l'animation d'entrée de
        // la grille laisse un `transform` sur chaque case (`stagger-children`,
        // en `forwards`), ce qui fait de chacune un contexte d'empilement : un
        // z-index posé *dans* la case ne peut plus passer devant sa voisine, et
        // la liste se retrouvait sous une case qui interceptait les clics.
        className="relative focus-within:z-40 rounded-2xl border border-dashed border-dark-600/50
          bg-dark-900/20 p-4 min-h-[172px] flex flex-col justify-center transition-colors
          hover:border-dark-500"
      >
        <CounterSearch onPick={onPick} />
      </div>
    );
  }

  // La clé remonte la case quand elle change de cible : voir `FilledCell`.
  return (
    <FilledCell
      key={`${cell.kind}-${cell.targetId}`}
      slot={slot}
      cell={cell}
      onBump={onBump}
      onRemove={onRemove}
    />
  );
};

export default CounterCell;
