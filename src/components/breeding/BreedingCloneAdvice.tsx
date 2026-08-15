'use client';

import { useMemo } from 'react';
import { Dna } from 'lucide-react';
import BreedingMountName, { mountNameOf } from '@/components/breeding/BreedingMountName';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';
import type { Individual } from '@/lib/dofus/breeding/stable';

/**
 * Ce que valent les stériles, et laquelle apparier avec laquelle.
 *
 * Une stérile ne s'accouple plus : il ne lui reste que l'extraction, ou de servir
 * d'entrée à un clonage. Le clonage n'est donc pas un arbitrage entre deux
 * emplois — c'est le seul moyen de lui rendre une valeur. Voir `cloning.ts`.
 *
 * ## Pourquoi à côté de l'étape « cloner », et pas ailleurs
 *
 * C'est le **même geste au même moment**. Le ruban dit déjà quels clonages la
 * politique a planifiés (`cloningsToRecord`), ce qui n'est pas la même question :
 * celle-ci dit ce que tes stériles valent et si mieux vaut les extraire. Les deux
 * se lisent devant la même fenêtre du jeu.
 *
 * Elle vivait dans un panneau qui descendait de l'heuristique et qui a été
 * masqué, puis retiré — si bien que ce conseil-là était **invisible** alors même
 * qu'il venait d'être corrigé : l'appariement ne proposait que des pile-ou-face
 * quand des clonages certains dormaient dans l'écurie. Voir #163.
 *
 * `keepChance` à 100 % est le cas qui vaut d'être vu : les deux portent la même
 * ascendance, donc le tirage ne change rien et le clone est certain.
 */
const BreedingCloneAdvice = ({
  clonings,
  nameOf,
  individuals,
}: {
  clonings: CloneOption[];
  nameOf: (colorId: string) => string;
  individuals: Individual[];
}) => {
  const nameOfMount = useMemo(() => mountNameOf(individuals), [individuals]);
  if (clonings.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Dna size={13} className="text-kamas" />
        <span className="text-[11px] font-semibold text-dark-200">Ce que valent tes stériles</span>
        <span className="text-[11px] text-dark-500">
          une stérile ne vaut plus rien tant qu&apos;on ne la clone pas
        </span>
      </div>

      <div className="space-y-1">
        {clonings.map((option) => (
          <div
            key={`${option.keep.id}-${option.partner.id}`}
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
              bg-dark-800/40 text-xs"
          >
            <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-200">
              {option.keep.sex === 'M' ? '♂' : '♀'} {nameOf(option.keep.colorId)}
              {option.keep.id && <BreedingMountName name={nameOfMount(option.keep.id)} />}
            </span>
            <span className="text-dark-600">+</span>
            <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-400">
              {option.partner.sex === 'M' ? '♂' : '♀'} {nameOf(option.partner.colorId)}
              {option.partner.id && <BreedingMountName name={nameOfMount(option.partner.id)} />}
            </span>
            <span
              className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
              title={`Cette monture porte une génération ${option.keep.carried} dans son ascendance : c'est elle qui décide de ce que ses croisements viseront.`}
            >
              porte G{option.keep.carried}
            </span>
            <span
              className={`text-[10px] tabular-nums ${
                option.keepChance === 1 ? 'text-gain' : 'text-dark-500'
              }`}
              title={
                option.keepChance === 1
                  ? 'Les deux portent la même ascendance : le tirage ne change rien, le clone est certain.'
                  : 'Ascendances différentes : une chance sur deux de garder celle-ci.'
              }
            >
              {(option.keepChance * 100).toFixed(0)} % de la garder
            </span>
            <span
              className={`text-[10px] ${option.certainSex ? 'text-gain' : 'text-amber-400/70'}`}
              title={
                option.certainSex
                  ? 'Les deux sont du même sexe : celui du clone est certain.'
                  : 'Sexes différents : celui du clone suit le tirage.'
              }
            >
              {option.certainSex
                ? `sexe certain ${option.sex === 'M' ? '♂' : '♀'}`
                : 'sexe au tirage'}
            </span>
            {option.gain <= 0 && (
              <span
                className="text-[10px] text-loss"
                title="L'extraction en ambre rend plus que ce clonage n'est censé rapporter."
              >
                mieux vaut extraire
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BreedingCloneAdvice;
