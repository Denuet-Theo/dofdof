'use client';

import { useMemo } from 'react';
import { Lock, Trophy } from 'lucide-react';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorCoder } from '@/lib/dofus/breeding/naming';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ladderOf } from '@/lib/dofus/breeding/ladder';
import { collectionProgress, missingColors } from '@/lib/dofus/breeding/success';

/**
 * L'onglet Succès : où en est la collection, et ce qu'il reste à faire naître.
 *
 * ## Ce que l'écran doit dire avant tout
 *
 * Que le succès est **hors plan**. L'échelle ne planifie que 30 couleurs sur 120
 * en muldo, donc les 90 autres ne sont sur aucune route et il n'existe pas de
 * chemin gratuit vers le succès — voir `success.ts`, qui porte les deux mesures
 * qui l'établissent.
 *
 * ## Pourquoi la stratégie est montrée mais bloquée
 *
 * Les trois modes sont là, et aucun n'est cliquable. C'est délibéré, et c'est le
 * contraire d'un oubli : la politique ne les lit pas encore, donc un sélecteur
 * actif serait un réglage sans effet. C'est exactement ce que #181 et #216 ont
 * passé deux PR à retirer de cet écran, et ce que `check:settings` interdit
 * maintenant par construction — un champ n'entre dans `BreedingSettings`
 * qu'accompagné du contrôle qui l'écrit, donc `success_mode` n'existe pas encore.
 *
 * Les montrer bloqués plutôt que les cacher répond à la seule question qu'on se
 * pose devant un compteur qui n'avance pas tout seul : « et l'outil, il m'aide,
 * ou pas ? ». La réponse est « pas encore, et voilà ce qui vient ».
 *
 * ## La collection ne se coche pas à la main
 *
 * Elle se remplit à la saisie d'une naissance, et par rien d'autre. L'éleveur
 * achète aussi des montures qui portent une généalogie, donc « parents
 * renseignés » ne prouve pas qu'il l'a fait naître, et déduire la collection de
 * l'écurie la remplirait de faux. Le compteur part donc de zéro : l'écran le dit
 * plutôt que de laisser chercher le bouton qui n'existe pas.
 */

const MODES: { label: string; what: string }[] = [
  { label: 'Ignoré', what: 'La politique ne tient aucun compte du succès. C’est ce qu’elle fait aujourd’hui.' },
  {
    label: 'Priorisé sans surcoût',
    what:
      'Dans un croisement déjà prévu, remplacer un partenaire par un autre de même génération pour viser une couleur jamais obtenue. Même nombre de croisements, même rang atteint — mais la couleur qui sort n’est plus celle que l’échelle demandait.',
  },
  {
    label: 'Priorisé',
    what:
      'Monter en plus des croisements dédiés, quitte à dépenser des montures que l’échelle réclamait — une gen 3 avec une gen 5 donne une gen 6 qu’on n’obtiendrait jamais en montant. Un croisement stérilise ses deux parents définitivement, donc la montée vers la gen 10 serait plus lente.',
  },
];

const BreedingSuccess = ({
  colors,
  hatched,
  nameOf,
}: {
  colors: BreedingColor[];
  hatched: ReadonlySet<string>;
  nameOf: (colorId: string) => string;
}) => {
  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const code = useMemo(() => colorCoder(colors), [colors]);
  const chip = (colorId: string) => {
    const color = byId.get(colorId);
    return {
      name: nameOf(colorId),
      code: code(nameOf(colorId)),
      icon: color ? colorIconUrl(color) : null,
    };
  };

  const progress = useMemo(() => collectionProgress(colors, hatched), [colors, hatched]);
  const missing = useMemo(() => missingColors(colors, hatched), [colors, hatched]);
  const planned = useMemo(
    () => (colors.length > 0 ? ladderOf(colors).recipeOf.size : 0),
    [colors]
  );

  /** Les manquantes, repliées par génération : 90 puces d'affilée ne se lisent pas. */
  const byGeneration = useMemo(() => {
    const groups = new Map<number, BreedingColor[]>();
    for (const color of missing) {
      const list = groups.get(color.generation);
      if (list) list.push(color);
      else groups.set(color.generation, [color]);
    }
    return [...groups].sort((a, b) => a[0] - b[0]);
  }, [missing]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Trophy size={14} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Faire naître chaque couleur</span>
        <span
          data-testid="success-progress"
          data-done={progress.done}
          data-total={progress.total}
          className="text-[11px] text-dark-400 tabular-nums"
        >
          {progress.done}/{progress.total} obtenues · {progress.missing} à faire naître
        </span>
      </div>

      <p className="text-[11px] text-dark-500 max-w-[70ch]">
        Le succès est <strong>hors plan</strong> : l’échelle ne planifie que {planned} couleurs sur{' '}
        {progress.total}, donc les autres ne sont sur aucune route. La collection se remplit
        toute seule à chaque naissance saisie dans « Ce qui est né », et par nulle part ailleurs —
        une monture achetée peut porter une généalogie, donc l’écurie ne peut pas servir de preuve.
      </p>

      <div className="space-y-2" data-testid="success-strategy">
        <div className="flex flex-wrap items-center gap-2">
          <Lock size={13} className="text-dark-500" />
          <span className="text-xs font-semibold text-dark-300">
            Ce que la politique pourra en faire
          </span>
          <span className="text-[11px] text-dark-500">pas encore réglable</span>
        </div>
        {MODES.map((entry) => (
          <div
            key={entry.label}
            data-testid="success-mode"
            aria-disabled="true"
            className="px-3 py-2.5 rounded-xl border border-dark-700/40 bg-dark-900/30 opacity-60"
          >
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border border-dark-600" />
              <span className="text-sm font-medium text-dark-300">{entry.label}</span>
            </span>
            <span className="block text-[11px] text-dark-500 mt-1 ml-5">{entry.what}</span>
          </div>
        ))}
        <p className="text-[10px] text-dark-600 max-w-[70ch]">
          Le choix est bloqué tant que la politique ne le lit pas : un réglage sans effet déplace
          les chiffres de l’écran sans que rien ne le dise, et c’est la panne que #181 et #216 ont
          corrigée. Les deux modes actifs coûtent tous les deux des montures que l’échelle
          réclamait, et ce coût doit être chiffré avant d’être proposé.
        </p>
      </div>

      <div className="space-y-2 pt-2 border-t border-dark-700/40">
        <p className="text-xs font-semibold text-dark-300">Ce qu’il reste à faire naître</p>
        {byGeneration.length === 0 ? (
          <p className="text-[11px] text-gain">Le succès est complet sur cette famille.</p>
        ) : (
          <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
            {byGeneration.map(([generation, list]) => (
              <div key={generation} className="flex flex-wrap items-center gap-1.5">
                <GenBadge generation={generation} />
                <span className="text-[10px] text-dark-600 w-8 tabular-nums">{list.length}</span>
                {list.map((color) => (
                  <span
                    key={color.id}
                    data-testid="success-missing"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
                      bg-dark-900/60 text-[10px] text-dark-400"
                  >
                    <ColorChip {...chip(color.id)} size="sm" />
                    {nameOf(color.id)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BreedingSuccess;
