'use client';

import { useMemo } from 'react';
import { Gem } from 'lucide-react';
import BreedingMountName, { mountNameOf } from '@/components/breeding/BreedingMountName';
import type { ExtractionCandidate } from '@/lib/dofus/breeding/extraction';
import type { Individual } from '@/lib/dofus/breeding/stable';

/**
 * Les stériles à vider, de la moins intéressante à reproduire à la plus.
 *
 * ## Pourquoi cette liste n'est pas celle du clonage
 *
 * `BreedingCloneAdvice` ne montre que les stériles qu'il a réussi à **apparier**.
 * Celles qu'il écarte — l'effectif impair d'une génération, les rangs où l'on n'a
 * qu'une seule stérile — n'apparaissent alors nulle part, alors que ce sont
 * précisément celles qu'il faut extraire : dépareillée, une stérile ne vaut plus
 * que son ambre. Voir `extraction.ts`.
 *
 * ## Ce qu'on lit d'abord
 *
 * Le haut de la liste. On ouvre cet onglet pour savoir **par où commencer à
 * vider**, et la mesure qui décide est ce qu'il faudrait payer pour remplacer la
 * monture dans son rôle — la génération que son **ascendance** porte, pas sa
 * couleur. Une gen 1 à parent gen 9 est en bas de liste et c'est voulu.
 *
 * Les gen 1 restent affichées avec « ne s'extrait pas » : elles ne rendent rien,
 * et les taire les laisserait en écurie sans qu'on sache pourquoi elles ne sont
 * dans aucune liste.
 */
const BreedingExtraction = ({
  candidates,
  nameOf,
  individuals,
  resourceName,
}: {
  candidates: ExtractionCandidate[];
  nameOf: (colorId: string) => string;
  individuals: Individual[];
  /** Ambre, neurone ou corne : la ressource dépend de la famille. */
  resourceName: string;
}) => {
  const nameOfMount = useMemo(() => mountNameOf(individuals), [individuals]);

  /**
   * Ce que rend le haut de la liste — celles qu'aucun clonage ne rattrape.
   *
   * Le total de **toutes** les stériles n'aurait pas de sens : il additionnerait
   * des montures qu'on ne détruira pas. Ce qui se décide ici, c'est de vider ce
   * qui ne sert plus, et le chiffre utile est ce que ça rapporte.
   */
  const clearable = candidates.filter((mount) => !mount.keepForBreeding && mount.units > 0);
  const total = clearable.reduce((sum, mount) => sum + mount.amber, 0);

  if (candidates.length === 0) {
    return (
      <p className="text-[11px] text-dark-500 px-1">
        Aucune stérile en écurie — rien à extraire. Elles apparaîtront ici dès qu&apos;un
        accouplement en aura produit.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Gem size={13} className="text-kamas" />
        <span className="text-[11px] font-semibold text-dark-200">
          {candidates.length} stérile{candidates.length > 1 ? 's' : ''} en écurie
        </span>
        <span className="text-[11px] text-dark-500">
          de la moins intéressante à reproduire à la plus — extraire dans cet ordre
        </span>
        {clearable.length > 0 && (
          <span className="ml-auto text-[11px] text-dark-400 tabular-nums">
            {clearable.length} à extraire ·{' '}
            <strong className="text-kamas">
              {Math.round(total).toLocaleString('fr-FR')} kamas
            </strong>
          </span>
        )}
      </div>

      <div className="space-y-1">
        {candidates.map((mount) => (
          <div
            key={mount.id}
            className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
              ${mount.keepForBreeding ? 'bg-dark-800/20' : 'bg-dark-800/40'}`}
          >
            <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-200">
              {mount.sex === 'M' ? '♂' : '♀'} {nameOf(mount.colorId)}
              {mount.id && <BreedingMountName name={nameOfMount(mount.id)} />}
            </span>

            <span
              className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
              title={`Cette monture porte une génération ${mount.carried} dans son ascendance : c'est ce qu'il faudrait racheter pour la remplacer.`}
            >
              porte G{mount.carried}
            </span>

            {/* Ce que la reproduction perdrait. Le classement se lit dessus, donc
                il se montre — sans quoi l'ordre de la liste est une affirmation
                qu'on ne peut pas vérifier. */}
            <span
              className="text-[10px] text-dark-500 tabular-nums"
              title="Prix de la couleur la moins chère de la génération que son ascendance porte : ce qu'il faudrait payer pour la remplacer dans son rôle."
            >
              vaut {Math.round(mount.value).toLocaleString('fr-FR')} en reproduction
            </span>

            <span className="ml-auto shrink-0 text-[10px] tabular-nums">
              {mount.units === 0 ? (
                <span
                  className="text-dark-600"
                  title="Une monture de génération 1 ne s'extrait pas : elle ne rend aucune ressource."
                >
                  ne s&apos;extrait pas
                </span>
              ) : (
                <span className={mount.keepForBreeding ? 'text-dark-500' : 'text-gain'}>
                  {mount.units} {resourceName} ·{' '}
                  {Math.round(mount.amber).toLocaleString('fr-FR')} kamas
                </span>
              )}
            </span>

            {/* Les deux motifs se distinguent, parce qu'ils ne se corrigent pas
                pareil. « Plutôt cloner » attend un geste — l'onglet Clonage la
                propose déjà. « Dépareillée » attend une monture qui n'existe pas
                encore : à ce rang il n'y a personne d'autre, et tant qu'une
                naissance n'en produit pas, l'ambre est tout ce qui reste. */}
            {mount.keepForBreeding ? (
              <span
                className="shrink-0 text-[10px] text-amber-400/70"
                title="Une autre stérile du même rang lui reste disponible, et ce qu'elle vaut en reproduction dépasse son ambre : le clonage la sauve."
              >
                plutôt cloner
              </span>
            ) : (
              !mount.pairable && (
                <span
                  className="shrink-0 text-[10px] text-dark-500"
                  title="Aucune autre stérile de sa génération affichée ne peut l'apparier : le clonage lui est fermé, il ne lui reste que l'extraction."
                >
                  dépareillée
                </span>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BreedingExtraction;
