'use client';

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import BreedingMountName, { mountNameOf } from '@/components/breeding/BreedingMountName';
import type { DriftSignal } from '@/lib/dofus/breeding/drift';
import type { Individual } from '@/lib/dofus/breeding/stable';

/**
 * Les occasions que l'arbre ne peut pas exprimer.
 *
 * Une monture dont l'ascendance porte plus haut que sa couleur — le raccourci de
 * #59 — n'est dans **aucune recette**, donc aucun plan ne la proposera jamais.
 * On la signale au lieu de la planifier : c'est de l'opportunisme, et c'est à
 * l'éleveur d'en décider.
 *
 * ## Pourquoi ici, dans l'écurie
 *
 * Ça se lit sur l'écurie **seule** — pas sur un plan, pas sur un marché — et
 * c'est en regardant ses montures qu'on se demande laquelle vaut plus qu'elle
 * n'en a l'air. Le panneau qui l'abritait descendait de l'heuristique et a été
 * retiré ; l'effet du signal, lui, n'avait jamais cessé de compter : `reserved`
 * empêche la fournée de dépenser un porteur. Seul le **conseil** était devenu
 * invisible.
 */
const BreedingDriftSignals = ({
  drift,
  nameOf,
  individuals,
}: {
  drift: DriftSignal[];
  nameOf: (colorId: string) => string;
  individuals: Individual[];
}) => {
  const nameOfMount = useMemo(() => mountNameOf(individuals), [individuals]);
  if (drift.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Sparkles size={13} className="text-gain" />
        <p className="text-xs text-dark-400">Hors recette</p>
        <span className="text-[11px] text-dark-500">
          l&apos;arbre ne sait pas les voir : à toi de décider
        </span>
      </div>

      <div className="space-y-1">
        {drift.map((signal) => (
          <div
            key={signal.mount.id}
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-gain/10 text-xs"
          >
            <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-200">
              {signal.mount.sex === 'M' ? '♂' : '♀'} {nameOf(signal.mount.colorId)}
              <BreedingMountName name={nameOfMount(signal.mount.id)} />
            </span>
            <span
              className="px-1.5 py-0.5 rounded-lg bg-dark-700/60 text-dark-300 text-[10px] font-semibold"
              title="Cette monture traîne dans son ascendance une génération plus haute que sa propre couleur : c'est elle qui décide de ce que ses accouplements visent."
            >
              porte G{signal.carried}
            </span>
            <span className="text-dark-600">+</span>
            <span className="text-dark-300">
              {signal.partner.sex === 'M' ? '♂' : '♀'} {nameOf(signal.partner.colorId)}
            </span>
            <span
              className="px-1.5 py-0.5 rounded-lg bg-gain/20 text-gain text-[10px] font-semibold"
              title={`Aucune recette ne porte ce croisement : elle annoncerait la génération ${signal.targetGeneration - signal.leap}.`}
            >
              VISE GEN. {signal.targetGeneration}
            </span>
            <span className="text-[10px] text-dark-500 tabular-nums">
              {(signal.successRate * 100).toFixed(0)} %
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BreedingDriftSignals;
