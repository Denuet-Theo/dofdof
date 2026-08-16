'use client';

import { useMemo } from 'react';
import { Dna } from 'lucide-react';
import BreedingMountName, { mountNameOf } from '@/components/breeding/BreedingMountName';
import type { CloneOption, SterileMount } from '@/lib/dofus/breeding/cloning';
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
 * ## Une ligne ne dit que le couple
 *
 * Elle a porté « porte G2 », « 100 % de la garder », « sexe certain ♂ », « mieux
 * vaut extraire ». Toutes exactes, et toutes sans effet : le jeu tire la
 * survivante et son sexe, l'éleveur constate. L'appariement qui rend ces chances
 * les meilleures est justement celui que `cloneOptions` vient de choisir — les
 * jumelles d'abord, le même sexe à valeur égale — donc les afficher, c'est
 * commenter une décision déjà prise, sur toutes les lignes, au-dessus de la
 * seule qu'on vienne y chercher : quelles deux montures aller chercher en jeu.
 *
 * Les chiffres n'ont pas disparu, ils ont changé de destinataire : `data-*` les
 * porte, et les specs les lisent.
 *
 * ## Cet écran est devenu le seul recours des stériles
 *
 * L'onglet Extraction ne montre plus que ce qu'on extrait réellement — ni les
 * « plutôt cloner », ni ce que le projet protège. Tout ce qu'il a cessé d'afficher
 * atterrit donc **ici**, et deux choses en découlent, sans lesquelles le retrait
 * là-bas serait une disparition :
 *
 * 1. la liste n'est plus tronquée (`cloneOptions` est appelé sans plafond) ;
 * 2. `held` porte les protégées que **rien n'apparie** — elles ne sont dans aucune
 *    paire, donc dans aucune ligne, et ce sont les plus précieuses de l'écurie.
 *
 * « Mieux vaut extraire » ne s'affiche jamais sur une monture qui sert le projet.
 * C'est la phrase qui proposait de détruire l'Azur-Turquoise gen 10 du relevé
 * #185 pour 170 000 kamas d'ambre, alors qu'un Doré à mille kamas en tire
 * Azur-Doré à 13,95 %.
 */
const BreedingCloneAdvice = ({
  clonings,
  held = [],
  nameOf,
  individuals,
  objectiveName,
}: {
  clonings: CloneOption[];
  /** Les stériles que le projet protège et qu'aucun clonage n'apparie encore. */
  held?: SterileMount[];
  nameOf: (colorId: string) => string;
  individuals: Individual[];
  /** Le nom de la couleur visée, pour dire *ce que* la monture sert. */
  objectiveName?: string | null;
}) => {
  const nameOfMount = useMemo(() => mountNameOf(individuals), [individuals]);
  if (clonings.length === 0 && held.length === 0) return null;

  const serves = objectiveName ? `vise ${objectiveName}` : 'sert le projet';
  const servesTitle = objectiveName
    ? `Croisée avec un partenaire à portée, cette monture peut donner ${objectiveName} : le projet la protège, on ne l'extrait pas.`
    : 'Cette monture peut donner la couleur visée : le projet la protège, on ne l’extrait pas.';

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
            data-testid="clone-advice"
            /* Deux mesures différentes, et les deux sont vérifiées ailleurs.
               Aucune ne se lit autrement à l'écran : une monture anonyme n'a pas
               de nom pour porter sa génération.

               Les **générations portées** tiennent l'invariant du clonage — on
               n'apparie jamais deux ascendances de générations différentes, sans
               quoi le tirage du jeu en perd une une fois sur deux.

               La **génération affichée** sert à recouper les deux écrans : une
               gen 1 sort de l'extraction parce que le jeu ne l'extrait pas, et
               doit rester ici parce qu'elle se clone. Une seule suffit, le jeu
               n'appariant qu'à génération affichée égale. */
            data-keep-carried={option.keep.carried}
            data-partner-carried={option.partner.carried}
            data-generation={option.keep.generation}
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
            {/* Rien d'autre que le couple, et une seule exception.
                « Porte G2 », « 50 % de la garder », « sexe au tirage », « mieux
                vaut extraire » : quatre mentions qui ne changeaient aucun geste.
                L'éleveur ne choisit **ni** la survivante **ni** son sexe — le jeu
                les tire — et l'appariement qui rend ces chances les meilleures est
                déjà celui que `cloneOptions` a retenu. Les afficher revenait à
                commenter une décision qui n'appartient à personne, sur douze
                lignes qu'on lit pour une seule chose : quelles deux montures aller
                chercher.

                Les mesures restent en attributs : elles se vérifient en test, et
                c'est là qu'elles servent.

                « Vise <couleur> » n'y a pas échappé, et la capture a tranché :
                sur l'écurie du 16/08, **13 lignes sur 15** le portaient. Une
                mention que presque tout porte ne distingue rien, et le clonage se
                fait de toute façon. Elle reste là où elle décide encore quelque
                chose : sur les gardées, plus bas, dont la consigne est justement
                de ne **pas** les extraire. */}
          </div>
        ))}
      </div>

      {/* Les protégées que rien n'apparie. Sans cette liste elles ne seraient sur
          aucun des deux écrans : l'extraction ne les prend pas — elles servent le
          but — et il n'existe aucune paire pour les porter ici. Ce qu'elles
          attendent n'est pas un geste mais une naissance. */}
      {held.length > 0 && (
        <div className="space-y-1 pt-1">
          <p className="text-[11px] text-dark-500 px-1">
            {held.length === 1 ? 'Gardée' : 'Gardées'} pour le projet, sans partenaire de clonage —
            il faut une autre stérile de la même génération affichée. Ne pas
            {held.length === 1 ? ' l’' : ' les '}extraire.
          </p>
          {held.map((mount) => (
            <div
              key={mount.id}
              data-testid="clone-held"
              data-generation={mount.generation}
              className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
                bg-kamas/10 border border-kamas/20"
            >
              <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-200">
                {mount.sex === 'M' ? '♂' : '♀'} {nameOf(mount.colorId)}
                {mount.id && <BreedingMountName name={nameOfMount(mount.id)} />}
              </span>
              <span
                className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
                title={`Cette monture porte une génération ${mount.carried} dans son ascendance : c'est elle qui décide de ce que ses croisements viseront.`}
              >
                porte G{mount.carried}
              </span>
              <span className="ml-auto text-[10px] text-kamas font-semibold" title={servesTitle}>
                {serves}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BreedingCloneAdvice;
