'use client';

import { Compass, Dna, Flag, ShoppingCart } from 'lucide-react';
import type { Loadout } from '@/lib/dofus/breeding/loadout';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';

/**
 * La fournée à charger, dans l'ordre où on s'en sert devant l'enclos.
 *
 * Quatre blocs, et l'ordre n'est pas décoratif : **où j'en suis**, **ce que je
 * lance**, **ce qui bloque**, **ce que je sors de l'écurie**. C'est la séquence
 * dans laquelle la question se pose en jeu.
 *
 * Ce que la liste montre est le **classement des croisements que l'écurie
 * permet**, et non les étapes du plan : mesuré, l'arbre coûte 2,6 fois plus cher
 * et met 2,5 fois plus de fournées pour atteindre la gen 10. Voir `loadout.ts`
 * pour le tableau complet.
 *
 * Il n'y a donc plus de panneau « hors recette » séparé. Il existait parce que
 * l'arbre ne sait pas voir le raccourci de #59 — le classement, lui, le voit :
 * `pairOutlook` lit l'ascendance. Les croisements qui en profitent sont dans la
 * liste, marqués en vert. Les afficher deux fois reviendrait à conseiller de
 * garder une monture et de la charger dans la même fournée.
 */

type Props = {
  loadout: Loadout;
  clonings: CloneOption[];
  nameOf: (colorId: string) => string;
};

/** Les identifiants courts des montures désignées, pour les retrouver en jeu. */
const shortIds = (ids: string[]) => ids.map((id) => id.slice(0, 6)).join(' · ');

const BreedingNextMove = ({ loadout, clonings, nameOf }: Props) => {
  if (loadout.lines.length === 0 && loadout.blocked.length === 0 && clonings.length === 0) {
    return null;
  }

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Compass size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">La fournée à charger</span>
        <span className="text-xs text-dark-500">
          {'ce que l’écurie permet de mieux lancer vers '}
          {nameOf(loadout.targetColorId)}
        </span>
        <span className="ml-auto text-[11px] text-dark-500 tabular-nums">
          {loadout.crossings} accouplements · {loadout.used}/{loadout.slots} places
        </span>
      </div>

      {/* Où j'en suis : la frontière, telle que l'écurie la porte réellement —
          ascendance comprise, donc pas forcément ce que le plan croit tenir. */}
      {loadout.frontier > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <Flag size={13} className="text-kamas self-center" />
          <span className="text-dark-300">
            Frontière : <strong className="text-dark-100">génération {loadout.frontier}</strong>
          </span>
          <span className="text-dark-500">
            {loadout.blocked.length === 0
              ? ' — le plan ne réclame plus rien qui manque'
              : ` — ${loadout.blocked.length} étape${loadout.blocked.length > 1 ? 's' : ''} du plan attend${loadout.blocked.length > 1 ? 'ent' : ''} ses parents`}
          </span>
        </div>
      )}

      {/* Ce que je lance. */}
      {loadout.lines.length > 0 && (
        <div className="space-y-1">
          {loadout.lines.map((line, index) => (
            <div
              key={`${line.move.targetGeneration}-${line.male.colorId}-${line.female.colorId}-${index}`}
              className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
                ${index === 0 ? 'bg-kamas/10' : 'bg-dark-800/40'}`}
            >
              <span className="text-dark-300 font-semibold tabular-nums w-8 shrink-0">
                {line.count} ×
              </span>
              <span className="text-dark-200">
                ♂ {nameOf(line.male.colorId)}
                {line.male.mountIds.length > 0 && (
                  <span className="text-dark-500"> · {shortIds(line.male.mountIds)}</span>
                )}
              </span>
              <span className="text-dark-600">+</span>
              <span className="text-dark-200">
                ♀ {nameOf(line.female.colorId)}
                {line.female.mountIds.length > 0 && (
                  <span className="text-dark-500"> · {shortIds(line.female.mountIds)}</span>
                )}
              </span>

              <span
                className={`px-1.5 py-0.5 rounded-lg text-[10px] font-semibold ${
                  line.move.leap > 0 ? 'bg-profit/20 text-profit' : 'bg-kamas/15 text-kamas'
                }`}
                title={
                  line.move.leap > 0
                    ? `Raccourci : l'ascendance de ces deux-là vise la génération ${line.move.targetGeneration}, quand la recette n'annoncerait que ${line.move.targetGeneration - line.move.leap}.`
                    : `Ce croisement vise la génération ${line.move.targetGeneration}.`
                }
              >
                GEN. {line.move.targetGeneration}
              </span>
              <span
                className="text-[10px] text-dark-500 tabular-nums"
                title={`Taux de la génération cible, aux niveaux réels des deux parents (${line.move.male.level} et ${line.move.female.level}).`}
              >
                {(line.move.successRate * 100).toFixed(0)} %
              </span>
              <span className="text-[10px] text-dark-600 truncate">
                {line.move.targetColors.length > 0
                  ? `→ ${line.move.targetColors.map((target) => nameOf(target.colorId)).slice(0, 2).join(' ou ')}`
                  : '→ purification'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Ce qui bloque : les étapes que le plan réclame et dont les parents
          manquent. Elles ne se contournent pas — les nommer est ce qui permet
          d'aller les chercher, plutôt que de laisser la fournée à moitié vide
          sans dire pourquoi. */}
      {loadout.blocked.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-dark-700/40">
          <p className="text-[11px] text-dark-400">
            Ce que le plan réclame encore et que l&apos;écurie ne fournit pas — à aller
            chercher, la fournée ci-dessus n&apos;y mène pas
          </p>
          <div className="space-y-1">
            {loadout.blocked.slice(0, 4).map(({ step, missing }) => (
              <div key={step.colorId} className="text-xs text-dark-300">
                <span className="text-dark-200">{nameOf(step.colorId)}</span>{' '}
                <span className="text-dark-600 tabular-nums">
                  (gen. {step.generation}, {step.attempts} accouplement
                  {step.attempts > 1 ? 's' : ''})
                </span>
                {missing.length > 0 && (
                  <span className="text-dark-500">
                    {' — il manque '}
                    <span className="text-amber-400/90">{missing.map(nameOf).join(' ou ')}</span>
                  </span>
                )}
              </div>
            ))}
            {loadout.blocked.length > 4 && (
              <p className="text-[10px] text-dark-600">
                +{loadout.blocked.length - 4} autre{loadout.blocked.length - 4 > 1 ? 's' : ''}
              </p>
            )}
          </div>

          {loadout.purchases.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <ShoppingCart size={12} className="text-dark-500" />
              <span className="text-[11px] text-dark-400">Ce que le plan achète plutôt qu&apos;élever :</span>
              {loadout.purchases.slice(0, 6).map((purchase) => (
                <span key={purchase.colorId} className="text-xs text-dark-300">
                  {nameOf(purchase.colorId)}{' '}
                  <span className="text-dark-100 tabular-nums font-semibold">
                    × {purchase.count}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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
        Un accouplement occupe deux places. Les taux sont ceux des montures désignées, à leur
        niveau réel — monter les parents reste le levier le moins cher de la fournée.
      </p>
    </div>
  );
};

export default BreedingNextMove;
