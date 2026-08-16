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
 *
 * ## Une seule population, donc un seul total
 *
 * Le même retrait a fini par emporter les « plutôt cloner ». L'écran portait
 * **42 lignes pour 4 extractions**, en-tête « 4 à extraire · 408 000 kamas »
 * devant une liste dont la somme visible faisait 1 700 000. Rien ne disait
 * lesquelles des 42 faisaient les 408 000, et le lecteur n'avait aucun moyen de
 * recouper le chiffre qu'on lui donnait.
 *
 * `extractionOrder` ne rend donc plus que ce qui s'extrait, et `keepForBreeding`
 * n'existe plus : le total ne **peut** plus être autre chose que la somme des
 * lignes affichées.
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

  /** Ce que la liste rapporte, en entier : elle ne porte plus que des extractions. */
  const total = candidates.reduce((sum, mount) => sum + mount.amber, 0);

  if (candidates.length === 0) {
    return (
      <p className="text-[11px] text-dark-500 px-1">
        Rien à extraire — tout ce que l&apos;écurie porte de stérile vaut mieux cloné, sert le
        projet, ou est une gen 1 que le jeu n&apos;extrait pas. Tout ça se règle à
        l&apos;onglet Clonage.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Gem size={13} className="text-kamas" />
        <span className="text-[11px] font-semibold text-dark-200">
          {candidates.length} stérile{candidates.length > 1 ? 's' : ''} à extraire
        </span>
        <span className="text-[11px] text-dark-500">
          de la moins intéressante à reproduire à la plus — extraire dans cet ordre. N&apos;y sont
          pas : les gen 1, que le jeu n&apos;extrait pas, et tout ce qui vaut mieux cloné ou sert
          le projet.
        </span>
        {/* Le total est exposé en clair : c'est la somme des lignes affichées, et
            c'est exactement ce que la version précédente ne tenait pas — 408 000
            annoncés devant une liste qui en faisait 1 700 000. Un chiffre que le
            lecteur ne peut pas recouper à l'œil doit pouvoir l'être par la suite. */}
        <span
          data-testid="extraction-total"
          data-total={Math.round(total)}
          className="ml-auto text-[11px] text-dark-400 tabular-nums"
        >
          <strong className="text-kamas">{Math.round(total).toLocaleString('fr-FR')} kamas</strong>{' '}
          en tout
        </span>
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
            data-amber={Math.round(mount.amber)}
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
              bg-dark-800/40"
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
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gain">
              {mount.units} {resourceName} ·{' '}
              {Math.round(mount.amber).toLocaleString('fr-FR')} kamas
            </span>

            {/* Le motif, quand il y en a un à donner. « Dépareillée » attend une
                monture qui n'existe pas encore : à ce rang il n'y a personne
                d'autre, et tant qu'une naissance n'en produit pas, l'ambre est
                tout ce qui reste. Une appariable qui est quand même ici n'a pas
                besoin d'explication — son ambre bat sa valeur, c'est écrit sur la
                ligne. */}
            {!mount.pairable && (
              <span
                className="shrink-0 text-[10px] text-dark-500"
                title="Aucune autre stérile de sa génération affichée ne peut l'apparier : le clonage lui est fermé, il ne lui reste que l'extraction."
              >
                dépareillée
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BreedingExtraction;
