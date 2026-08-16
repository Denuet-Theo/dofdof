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
 * ## Les gen 1 n'y sont plus
 *
 * Elles y étaient, marquées « ne s'extrait pas ». Le jeu ne les extrait pas, et
 * le tri étant croissant sur la valeur de reproduction, elles occupaient tout le
 * haut de la liste : des dizaines de lignes sans effet devant les
 * quelques-unes qui rapportent. `extractionOrder` les écarte désormais.
 *
 * Elles ne disparaissent pas de l'app pour autant : une gen 1 stérile s'apparie,
 * et l'onglet Clonage la propose. C'est là qu'elle a quelque chose à faire.
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
  const clearable = candidates.filter((mount) => !mount.keepForBreeding);
  const total = clearable.reduce((sum, mount) => sum + mount.amber, 0);

  if (candidates.length === 0) {
    return (
      <p className="text-[11px] text-dark-500 px-1">
        Rien à extraire — aucune stérile de génération 2 ou plus en écurie. Les gen 1 ne
        s&apos;extraient pas : elles ne servent qu&apos;au clonage, à l&apos;onglet Clonage.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Gem size={13} className="text-kamas" />
        <span className="text-[11px] font-semibold text-dark-200">
          {candidates.length} stérile{candidates.length > 1 ? 's' : ''} extractible
          {candidates.length > 1 ? 's' : ''}
        </span>
        <span className="text-[11px] text-dark-500">
          de la moins intéressante à reproduire à la plus — extraire dans cet ordre. Les gen 1
          n&apos;y sont pas : le jeu ne les extrait pas.
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
            data-testid="extraction-row"
            /* La génération affichée et ce qu'elle rend, exposées pour être
               vérifiables : aucune ligne d'ici ne doit être une gen 1, que le
               jeu n'extrait pas. L'écran ne l'écrit pas autrement — une monture
               anonyme n'a pas de nom pour porter sa génération. */
            data-generation={mount.generation}
            data-units={mount.units}
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

            {/* Plus de cas « ne s'extrait pas » : les gen 1 ne sont plus dans
                cette liste, `extractionOrder` les écarte. Une ligne d'ici rend
                donc toujours quelque chose. */}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums">
              <span className={mount.keepForBreeding ? 'text-dark-500' : 'text-gain'}>
                {mount.units} {resourceName} ·{' '}
                {Math.round(mount.amber).toLocaleString('fr-FR')} kamas
              </span>
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
