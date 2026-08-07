'use client';

import { Compass, Dna, Flag, ShoppingCart, Sparkles } from 'lucide-react';
import type { Loadout } from '@/lib/dofus/breeding/loadout';
import type { DriftSignal } from '@/lib/dofus/breeding/drift';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';

/**
 * La fournée à charger, dans l'ordre où on s'en sert devant l'enclos.
 *
 * Quatre blocs, et l'ordre n'est pas décoratif : **où j'en suis**, **ce que je
 * lance**, **ce qui bloque**, **ce que je sors de l'écurie**. C'est la séquence
 * dans laquelle la question se pose en jeu.
 *
 * Ce que la liste montre n'est plus un classement d'appariements libres mais les
 * **étapes du plan** que l'écurie permet de lancer. La route se calcule sur
 * l'arbre des recettes une bonne fois — parents avant enfants, multiplicités
 * comprises — au lieu de se redeviner à chaque coup. L'écran n'a donc plus de
 * critère propre : il n'y a plus qu'une route, celle du plan suivi, et plus
 * d'objectif à afficher ici puisque c'est le choix de la couleur qui le porte.
 *
 * Le seul endroit où l'écurie peut battre le plan est le raccourci de #59, que
 * l'arbre ne saura jamais exprimer. On le **signale** au lieu de le planifier :
 * c'est de l'opportunisme, et l'éleveur en décide.
 */

type Props = {
  loadout: Loadout;
  /** Les occasions hors recette que l'écurie porte. Voir `drift.ts`. */
  drift: DriftSignal[];
  clonings: CloneOption[];
  nameOf: (colorId: string) => string;
};

/** Les identifiants courts des montures désignées, pour les retrouver en jeu. */
const shortIds = (ids: string[]) => ids.map((id) => id.slice(0, 6)).join(' · ');

const BreedingNextMove = ({ loadout, drift, clonings, nameOf }: Props) => {
  if (
    loadout.lines.length === 0 &&
    loadout.blocked.length === 0 &&
    clonings.length === 0 &&
    drift.length === 0
  ) {
    return null;
  }

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Compass size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">La fournée à charger</span>
        <span className="text-xs text-dark-500">
          les étapes du plan {nameOf(loadout.targetColorId)}
          {' que l’écurie permet de lancer'}
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
              ? ' — toutes les étapes réalisables sont chargées'
              : ` — ${loadout.blocked.length} étape${loadout.blocked.length > 1 ? 's' : ''} du plan attend${loadout.blocked.length > 1 ? 'ent' : ''} ses parents`}
          </span>
        </div>
      )}

      {/* Ce que je lance. */}
      {loadout.lines.length > 0 && (
        <div className="space-y-1">
          {loadout.lines.map((line, index) => (
            <div
              key={`${line.step.colorId}-${line.male.colorId}-${line.female.colorId}-${index}`}
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
                className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
                title={`Étape du plan : produire ${nameOf(line.step.colorId)}, de génération ${line.step.generation}.`}
              >
                GEN. {line.step.generation}
              </span>
              <span
                className="text-[10px] text-dark-500 tabular-nums"
                title={`Taux de la génération cible, parents montés au niveau ${line.step.parentLevel}.`}
              >
                {(line.step.successRate * 100).toFixed(0)} %
              </span>
              <span className="text-[10px] text-dark-600 truncate">
                → {nameOf(line.step.colorId)}
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
            Étapes en attente de leurs parents — c&apos;est là que la route s&apos;arrête
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

      {/* La dérive : ce que l'arbre ne peut pas voir. Une monture dont
          l'ascendance porte plus haut que sa couleur n'est dans aucune recette,
          donc aucun plan ne la proposera jamais. On le dit, on ne le planifie
          pas. */}
      {drift.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-dark-700/40">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles size={13} className="text-profit" />
            <span className="text-xs font-semibold text-dark-200">Hors recette</span>
            <span className="text-[11px] text-dark-500">
              l&apos;arbre ne sait pas les voir : à vous de décider
            </span>
          </div>
          {drift.map((signal) => (
            <div
              key={signal.mount.id}
              className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                bg-profit/10 text-xs"
            >
              <span className="text-dark-200">
                {signal.mount.sex === 'M' ? '♂' : '♀'} {nameOf(signal.mount.colorId)}
                <span className="text-dark-500"> · {signal.mount.id.slice(0, 6)}</span>
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
                className="px-1.5 py-0.5 rounded-lg bg-profit/20 text-profit text-[10px] font-semibold"
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
        Un accouplement occupe deux places. Les taux sont ceux du plan, qui suppose les parents
        montés au niveau qu&apos;il annonce — monter les parents est le levier le moins cher de
        la fournée.
      </p>
    </div>
  );
};

export default BreedingNextMove;
