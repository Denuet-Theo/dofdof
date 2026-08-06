'use client';

import { Compass, Dna } from 'lucide-react';
import type { Move } from '@/lib/dofus/breeding/next-move';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';
import type { Mate } from '@/lib/dofus/breeding/pairing';
import { OBJECTIVES, type ObjectiveId } from '@/lib/dofus/breeding/objectives';

/**
 * Ce qu'il faut lancer **maintenant**, compte tenu de ce qu'on tient.
 *
 * Remplace le panneau des raccourcis, qui n'en montrait qu'un cas particulier :
 * les croisements gagnant plus d'une génération. Or un raccourci qui ne mène
 * nulle part ne vaut pas un croisement ordinaire qui avance, et c'est entre eux
 * tous qu'il faut choisir. Voir `next-move.ts`.
 *
 * Le classement suit **l'objectif que l'éleveur a choisi** en haut de page, et
 * pas un critère propre : deux recommandations contradictoires sur le même écran
 * ne s'expliqueraient pas.
 *
 * La liste se recalcule à chaque saisie de naissance, et c'est tout l'intérêt —
 * une fournée chanceuse remonte un raccourci en tête, une malchanceuse le fait
 * disparaître. La route n'est plus un arbre qu'on déroule, c'est une décision
 * qu'on reprend.
 */

type Props = {
  moves: Move[];
  /** Les stériles à appairer pour cloner, du plus rentable au moins. */
  clonings: CloneOption[];
  objective: ObjectiveId;
  nameOf: (colorId: string) => string;
};

const label = (mate: Mate, sex: '♂' | '♀', nameOf: (colorId: string) => string) =>
  `${sex} ${nameOf(mate.colorId)}${mate.id ? ` · ${mate.id.slice(0, 6)}` : ''}`;

const BreedingNextMove = ({ moves, clonings, objective, nameOf }: Props) => {
  if (moves.length === 0 && clonings.length === 0) return null;

  const hint = OBJECTIVES.find((option) => option.id === objective)?.label ?? '';

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Compass size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Le prochain coup</span>
        <span className="text-xs text-dark-500">
          ce que l&apos;écurie permet de lancer maintenant, classé pour « {hint} »
        </span>
      </div>

      <p className="text-[11px] text-dark-500">
        Un plan se calcule avant la première naissance, et chaque accouplement est un tirage :
        au troisième croisement il décrit déjà un parc qui n&apos;existe pas. Cette liste-là se
        relit à chaque saisie de fournée — une naissance chanceuse remonte un raccourci en
        tête, une malchanceuse le fait disparaître.
      </p>

      <div className="space-y-1">
        {moves.map((move, index) => (
          <div
            key={`${move.male.id ?? move.male.colorId}-${move.female.id ?? move.female.colorId}`}
            className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
              ${index === 0 ? 'bg-kamas/10' : 'bg-dark-800/40'}`}
          >
            <span className="text-dark-600 w-4 shrink-0 tabular-nums">{index + 1}.</span>
            <span className="text-dark-200">{label(move.male, '♂', nameOf)}</span>
            <span className="text-dark-600">×</span>
            <span className="text-dark-200">{label(move.female, '♀', nameOf)}</span>

            <span
              className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
              title={`Ce couple vise la génération ${move.targetGeneration} : c'est la plus haute de toute sa généalogie, plus un.`}
            >
              GEN. {move.targetGeneration}
            </span>
            {move.gained > 1 && (
              <span
                className="text-[10px] text-profit"
                title="Générations gagnées d'un coup sur la plus haute des deux montures accouplées."
              >
                +{move.gained} générations
              </span>
            )}
            {move.leap > 0 && (
              <span
                className="text-[10px] text-profit/80"
                title={`Aucune recette ne porte ce croisement : elle annoncerait la génération ${move.targetGeneration - move.leap}.`}
              >
                hors recette
              </span>
            )}

            <span className="text-[10px] text-dark-500 tabular-nums">
              {(move.successRate * 100).toFixed(1)} %
            </span>
            <span className="text-[10px] text-dark-500 tabular-nums">
              {Math.round(move.cost).toLocaleString('fr-FR')} k
            </span>
            {move.targetColors.length > 0 && (
              <span className="text-[10px] text-dark-600 truncate">
                → {nameOf(move.targetColors[0].colorId)}
                {move.targetColors.length > 1 && ` (+${move.targetColors.length - 1})`}
              </span>
            )}
            {move.available > 1 && (
              <span
                className="ml-auto text-[10px] text-dark-600"
                title="Couples formables avec ces deux ascendances : les montures interchangeables sont repliées."
              >
                × {move.available}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-dark-600">
        Le coût compte les deux parents consommés et le carburant de leurs deux cycles, moitié
        prix sur les parents quand le recyclage par clonage est activé. Une monture du vrac est
        comptée au niveau 1, faute d&apos;en suivre le niveau.
      </p>

      {clonings.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-dark-700/40">
          <div className="flex flex-wrap items-center gap-2">
            <Dna size={14} className="text-kamas" />
            <span className="text-xs font-semibold text-dark-200">Clonages à faire</span>
            <span className="text-[11px] text-dark-500">
              une stérile ne vaut plus rien tant qu&apos;on ne la clone pas
            </span>
          </div>

          <p className="text-[11px] text-dark-500">
            Deux stériles de <strong>même génération affichée</strong>
            {' entrent, l’une des deux ressort — avec sa couleur, son sexe, son nom et sa généalogie. Ce qui compte n’est pas qui va avec qui, mais qui reste '}
            <strong>dépareillée</strong>
            {' : une stérile sans partenaire ne vaut plus que son extraction.'}
          </p>

          <div className="space-y-1">
            {clonings.map((option) => (
              <div
                key={`${option.keep.id}-${option.partner.id}`}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                  bg-dark-800/40 text-xs"
              >
                <span className="text-dark-200">
                  {option.keep.sex === 'M' ? '♂' : '♀'} {nameOf(option.keep.colorId)}
                  {option.keep.id && (
                    <span className="text-dark-500"> · {option.keep.id.slice(0, 6)}</span>
                  )}
                </span>
                <span className="text-dark-600">+</span>
                <span className="text-dark-400">
                  {option.partner.sex === 'M' ? '♂' : '♀'} {nameOf(option.partner.colorId)}
                  {option.partner.id && (
                    <span className="text-dark-600"> · {option.partner.id.slice(0, 6)}</span>
                  )}
                </span>

                <span
                  className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
                  title={`Cette monture porte une génération ${option.keep.carried} dans son ascendance : c'est elle qui décide de ce que ses croisements viseront.`}
                >
                  porte G{option.keep.carried}
                </span>
                <span
                  className={`text-[10px] tabular-nums ${
                    option.keepChance === 1 ? 'text-profit' : 'text-dark-500'
                  }`}
                  title={
                    option.keepChance === 1
                      ? 'Même ascendance des deux côtés : le tirage ne change rien, on la garde à coup sûr.'
                      : 'Le jeu clone l’une des deux au hasard.'
                  }
                >
                  {(option.keepChance * 100).toFixed(0)} % de la garder
                </span>
                <span
                  className={`text-[10px] ${option.certainSex ? 'text-profit' : 'text-amber-400/70'}`}
                  title={
                    option.certainSex
                      ? 'Les deux sont du même sexe : celui du clone est certain.'
                      : 'Sexes différents : celui du clone suit le tirage. Préfère une partenaire du même sexe si tu en as une.'
                  }
                >
                  {option.certainSex ? `sexe certain ${option.sex === 'M' ? '♂' : '♀'}` : 'sexe au tirage'}
                </span>
                <span className="ml-auto text-[10px] text-dark-500 tabular-nums">
                  {Math.round(option.expectedValue).toLocaleString('fr-FR')} k espérés
                </span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-dark-600">
            Une monture vaut ce qu&apos;il faudrait payer pour la remplacer dans son rôle : le
            prix de la génération que son <strong>ascendance</strong> porte, pas celui de sa
            couleur. Une gen 1 dont un parent est gen 9 vaut donc une gen 9.
          </p>
        </div>
      )}
    </div>
  );
};

export default BreedingNextMove;
