'use client';

import { Compass, Dna, Flag } from 'lucide-react';
import type { Loadout } from '@/lib/dofus/breeding/loadout';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';
import { OBJECTIVES, type ObjectiveId } from '@/lib/dofus/breeding/objectives';

/**
 * La fournée à charger, dans l'ordre où on s'en sert devant l'enclos.
 *
 * Trois blocs, et l'ordre n'est pas décoratif : **où j'en suis**, **ce que je
 * lance**, **ce que je sors de l'écurie**. C'est la séquence dans laquelle la
 * question se pose en jeu, et c'est celle qu'on a suivie en la faisant à la main
 * avant de l'écrire.
 *
 * Le classement suit l'objectif choisi juste au-dessus — pas un critère propre :
 * deux recommandations contradictoires sur le même écran ne s'expliqueraient pas.
 *
 * Tout se recalcule à chaque saisie de naissance, et c'est l'intérêt : une
 * fournée chanceuse remonte un raccourci en tête, une malchanceuse le fait
 * disparaître. La route n'est plus un arbre qu'on déroule, c'est une décision
 * qu'on reprend.
 */

type Props = {
  loadout: Loadout;
  clonings: CloneOption[];
  objective: ObjectiveId;
  nameOf: (colorId: string) => string;
};

const BreedingNextMove = ({ loadout, clonings, objective, nameOf }: Props) => {
  if (loadout.lines.length === 0 && clonings.length === 0) return null;

  const hint = OBJECTIVES.find((option) => option.id === objective)?.label ?? '';
  const climbing = objective !== 'profit';

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Compass size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">La fournée à charger</span>
        <span className="text-xs text-dark-500">classée pour « {hint} »</span>
        <span className="ml-auto text-[11px] text-dark-500 tabular-nums">
          {loadout.crossings} accouplements · {loadout.used}/{loadout.slots} places
        </span>
      </div>

      {/* Où j'en suis : la frontière, et ce qui la bloque. C'est la première
          question qu'on se pose, et rien ne la répondait avant. */}
      {climbing && loadout.frontier > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <Flag size={13} className="text-kamas self-center" />
          <span className="text-dark-300">
            Frontière : <strong className="text-dark-100">génération {loadout.frontier}</strong>
          </span>
          {loadout.missing.length > 0 ? (
            <span className="text-dark-500">
              {' — il manque '}
              <span className="text-amber-400/90">
                {loadout.missing.slice(0, 4).map(nameOf).join(', ')}
                {loadout.missing.length > 4 && ` +${loadout.missing.length - 4}`}
              </span>
              {` pour monter en génération ${loadout.frontier + 1}`}
            </span>
          ) : (
            <span className="text-dark-500">
              {` — tout est en main pour monter en génération ${loadout.frontier + 1}`}
            </span>
          )}
        </div>
      )}

      {/* Ce que je lance. */}
      <div className="space-y-1">
        {loadout.lines.map((line, index) => (
          <div
            key={`${line.male.colorId}-${line.female.colorId}-${index}`}
            className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
              ${index === 0 ? 'bg-kamas/10' : 'bg-dark-800/40'}`}
          >
            <span className="text-dark-300 font-semibold tabular-nums w-8 shrink-0">
              {line.count} ×
            </span>
            <span className="text-dark-200">
              ♂ {nameOf(line.male.colorId)}
              {line.male.id && <span className="text-dark-500"> · {line.male.id.slice(0, 6)}</span>}
            </span>
            <span className="text-dark-600">+</span>
            <span className="text-dark-200">
              ♀ {nameOf(line.female.colorId)}
              {line.female.id && (
                <span className="text-dark-500"> · {line.female.id.slice(0, 6)}</span>
              )}
            </span>

            {/* Une cible sans couleur n'est pas une cible : aucune couleur de
                la génération visée ne se compose de ces deux lignées. Le
                croisement reste faisable — c'est le cas de la purification — mais
                ce qu'il rend n'est pas modélisé, et l'annoncer serait mentir. */}
            {line.move.targetColors.length === 0 ? (
              <span
                className="px-1.5 py-0.5 rounded-lg bg-dark-700/60 text-dark-400 text-[10px] font-semibold"
                title="Aucune couleur de la génération visée ne se compose de ces deux lignées : le jeu bascule alors dans un régime que le modèle ne couvre pas encore (relevé #68). Le croisement reste faisable — c'est ce qu'on fait pour purifier une lignée — mais on ne sait pas dire ce qu'il rend."
              >
                ISSUES INCONNUES
              </span>
            ) : (
              <span
                className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
                title={`Ce couple vise la génération ${line.move.targetGeneration} : la plus haute de toute sa généalogie, plus un.`}
              >
                GEN. {line.move.targetGeneration}
              </span>
            )}
            {line.move.leap > 0 && (
              <span
                className="text-[10px] text-profit/80"
                title={`Aucune recette ne porte ce croisement : elle annoncerait la génération ${line.move.targetGeneration - line.move.leap}.`}
              >
                hors recette
              </span>
            )}
            <span className="text-[10px] text-dark-500 tabular-nums">
              {(line.move.successRate * 100).toFixed(0)} %
            </span>
            {line.move.targetColors.length > 0 && (
              <span className="text-[10px] text-dark-600 truncate">
                → {nameOf(line.move.targetColors[0].colorId)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Ce que je sors de l'écurie : la seule chose qui se lise vraiment devant
          le coffre. Les sexes ne sont pas interchangeables, d'où le détail. */}
      {loadout.pull.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-dark-700/40">
          <p className="text-[11px] text-dark-400">À sortir de l&apos;écurie</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {loadout.pull.map((pull) => (
              <span key={pull.colorId} className="text-xs text-dark-300">
                {nameOf(pull.colorId)}{' '}
                <span className="text-dark-100 tabular-nums font-semibold">
                  {pull.males > 0 && `${pull.males}♂`}
                  {pull.males > 0 && pull.females > 0 && ' '}
                  {pull.females > 0 && `${pull.females}♀`}
                </span>
                {pull.exhausts && (
                  <span
                    className="text-[10px] text-amber-400/70"
                    title="La fournée vide cette couleur : il n'en restera aucune fertile."
                  >
                    {' '}
                    vidée
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Les noms à recopier en jeu. C'est la seule chose qui distingue ensuite
          deux montures de même couleur, et elle se perd si on ne la fait pas
          tout de suite. */}
      {loadout.names.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-dark-700/40">
          <p className="text-[11px] text-dark-400">
            Noms à donner en jeu aux poulains — sans eux, l&apos;ascendance se perd
          </p>
          <div className="flex flex-wrap gap-1.5">
            {loadout.names.map((entry) => (
              <span
                key={entry.name}
                className="text-[11px] text-dark-200 bg-dark-800/60 px-2 py-1 rounded-lg"
              >
                <code>{entry.name}</code>
                {entry.count > 1 && <span className="text-dark-500"> × {entry.count}</span>}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-dark-600">
            Comptés en espérance, arrondis au supérieur : mieux vaut un nom de trop qu&apos;en
            manquer un devant l&apos;enclos.
          </p>
        </div>
      )}

      {clonings.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-dark-700/40">
          <div className="flex flex-wrap items-center gap-2">
            <Dna size={14} className="text-kamas" />
            <span className="text-xs font-semibold text-dark-200">Clonages à faire</span>
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
                <span className="text-dark-200">
                  {option.keep.sex === 'M' ? '♂' : '♀'} {nameOf(option.keep.colorId)}
                </span>
                <span className="text-dark-600">+</span>
                <span className="text-dark-400">
                  {option.partner.sex === 'M' ? '♂' : '♀'} {nameOf(option.partner.colorId)}
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
                >
                  {(option.keepChance * 100).toFixed(0)} % de la garder
                </span>
                <span
                  className={`text-[10px] ${option.certainSex ? 'text-profit' : 'text-amber-400/70'}`}
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
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-dark-600">
        Un accouplement occupe deux places. Les taux supposent les niveaux enregistrés — une
        monture du vrac est comptée au niveau 1, faute d&apos;en suivre le niveau, et monter
        les parents est le levier le moins cher de la fournée.
      </p>
    </div>
  );
};

export default BreedingNextMove;
