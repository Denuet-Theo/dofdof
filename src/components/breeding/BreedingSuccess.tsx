'use client';

import { useMemo, useState } from 'react';
import { Check, Shuffle, Trophy } from 'lucide-react';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorCoder } from '@/lib/dofus/breeding/naming';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ladderOf } from '@/lib/dofus/breeding/ladder';
import {
  collectionCrossings,
  collectionProgress,
  missingColors,
  redirectionFor,
  type SuccessContext,
  type SuccessMode,
} from '@/lib/dofus/breeding/success';
import type { Stable } from '@/lib/dofus/breeding/stable';
import type { DEFAULT_SETTINGS } from '@/lib/hooks/useBreeding';

type Settings = typeof DEFAULT_SETTINGS;

/**
 * L'onglet Succès : chaque couleur de la famille, née au moins une fois.
 *
 * ## Le choix était bloqué, il ne l'est plus
 *
 * Les trois modes sont arrivés grisés, parce que la politique ne les lisait pas :
 * un sélecteur actif aurait été un réglage sans effet, la panne que #181 et #216
 * ont corrigée. `stablePlan` applique maintenant la passe — voir `applySuccess` —
 * donc le choix a un effet et peut être rendu.
 *
 * Ce que l'écran garde de cette prudence : chaque mode porte **ce qu'il coûte** sur
 * la ligne d'en dessous, pas dans une bulle d'aide qu'on va chercher.
 *
 * ## Ce que l'écran doit dire avant tout
 *
 * Que le succès est **hors plan**. L'échelle ne planifie que 30 couleurs sur 120
 * en muldo, donc les 90 autres ne sont sur aucune route et il n'existe pas de
 * chemin gratuit vers le succès — voir `success.ts`. Un écran qui afficherait un
 * compteur et trois boutons sans le dire laisserait croire que le mode `priorisé`
 * est une option d'affichage.
 *
 * D'où la forme : le sélecteur porte, sous chaque choix, **ce qu'il coûte**. Pas
 * une aide contextuelle qu'on va chercher, la ligne d'à côté.
 *
 * ## La collection ne se coche pas à la main
 *
 * Elle se remplit à la saisie d'une naissance, et par rien d'autre. L'éleveur
 * achète aussi des montures qui portent une généalogie, donc « parents
 * renseignés » ne prouve pas qu'il l'a fait naître, et déduire la collection de
 * l'écurie la remplirait de faux. Le compteur part donc de zéro et ignore ce qui a
 * été élevé avant que la table existe : c'est le compromis retenu, et l'écran le
 * dit plutôt que de laisser chercher le bouton qui n'existe pas.
 */

const MODES: { id: SuccessMode; label: string; what: string; cost: string }[] = [
  {
    id: 'ignore',
    label: 'Ignoré',
    what: 'La politique ne tient aucun compte du succès.',
    cost: 'Aucun coût. C’est le défaut.',
  },
  {
    id: 'free',
    label: 'Priorisé sans surcoût',
    what:
      'Dans un croisement déjà prévu, remplace un partenaire par un autre de même génération pour viser une couleur jamais obtenue.',
    cost:
      'Même nombre de croisements, mêmes places, même rang atteint. Mais la couleur qui sort n’est plus celle que l’échelle demandait, et le partenaire s’achète s’il manque — 4 à 6 000 kamas pour une gen 1.',
  },
  {
    id: 'priority',
    label: 'Priorisé',
    what:
      'Monte en plus des croisements dédiés, quitte à dépenser des montures que l’échelle réclamait — une gen 3 avec une gen 5 donne une gen 6 qu’on n’obtiendrait jamais en montant.',
    cost:
      'Un vrai sacrifice : un croisement stérilise ses deux parents définitivement, même sur une place libre. La montée vers la gen 10 sera plus lente.',
  },
];

const BreedingSuccess = ({
  colors,
  hatched,
  stable,
  settings,
  onSaveSettings,
  nameOf,
}: {
  colors: BreedingColor[];
  hatched: ReadonlySet<string>;
  stable: Stable;
  settings: Settings;
  onSaveSettings: (next: Settings) => Promise<boolean>;
  nameOf: (colorId: string) => string;
}) => {
  const [saved, setSaved] = useState(false);

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

  const context = useMemo<SuccessContext>(
    () => ({
      colors,
      generations: new Map(colors.map((color) => [color.id, color.generation])),
      hatched,
    }),
    [colors, hatched]
  );

  const progress = useMemo(() => collectionProgress(colors, hatched), [colors, hatched]);
  const missing = useMemo(() => missingColors(colors, hatched), [colors, hatched]);

  /** Les pas de l'échelle qu'on pourrait détourner, sans changer de rang. */
  const redirections = useMemo(() => {
    if (colors.length === 0) return [];
    const plan = ladderOf(colors);
    return [...plan.recipeOf]
      .map(([colorId, recipe]) => redirectionFor({ colorId, recipe }, stable, context))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [colors, stable, context]);

  const crossings = useMemo(
    () => (progress.missing > 0 ? collectionCrossings(stable, context, 6) : []),
    [stable, context, progress.missing]
  );

  const mode = settings.success_mode;
  const choose = async (next: SuccessMode) => {
    if (next === mode) return;
    const ok = await onSaveSettings({ ...settings, success_mode: next });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

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
        {saved && (
          <span className="flex items-center gap-1 text-xs text-gain">
            <Check size={13} /> Enregistré
          </span>
        )}
      </div>

      <p className="text-[11px] text-dark-500 max-w-[70ch]">
        Le succès est <strong>hors plan</strong> : l’échelle ne planifie que{' '}
        {ladderOf(colors).recipeOf.size} couleurs sur {progress.total}, donc les autres ne sont sur
        aucune route. Il n’y a pas de chemin gratuit vers lui — les deux modes ci-dessous coûtent,
        chacun à sa façon.
      </p>

      <div className="space-y-2">
        {MODES.map((entry) => {
          const active = entry.id === mode;
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`success-mode-${entry.id}`}
              data-active={active}
              onClick={() => choose(entry.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                active
                  ? 'bg-kamas/10 border-kamas/40'
                  : 'bg-dark-900/40 border-dark-700/40 hover:border-kamas/30'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full border ${
                    active ? 'bg-kamas border-kamas' : 'border-dark-500'
                  }`}
                />
                <span
                  className={`text-sm font-medium ${active ? 'text-kamas' : 'text-dark-200'}`}
                >
                  {entry.label}
                </span>
              </span>
              <span className="block text-[11px] text-dark-400 mt-1 ml-5">{entry.what}</span>
              <span className="block text-[11px] text-dark-600 mt-0.5 ml-5">{entry.cost}</span>
            </button>
          );
        })}
      </div>

      {mode !== 'ignore' && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Shuffle size={13} className="text-gain" />
            <span className="text-xs font-semibold text-dark-300">
              Ce que ce mode ferait sur ton écurie
            </span>
          </div>

          <div
            data-testid="success-redirections"
            data-count={redirections.length}
            className="space-y-1.5"
          >
            {redirections.length === 0 ? (
              <p className="text-[11px] text-dark-500">
                Aucun pas de l’échelle ne peut être détourné vers une couleur manquante en ce
                moment.
              </p>
            ) : (
              redirections.slice(0, 6).map((entry) => (
                <div
                  key={`${entry.from}-${entry.to}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                    bg-dark-900/40 border border-dark-700/40 text-[11px]"
                >
                  <ColorChip {...chip(entry.from)} size="sm" />
                  <span className="text-dark-400">{nameOf(entry.from)}</span>
                  <span className="text-dark-600">→</span>
                  <ColorChip {...chip(entry.to)} size="sm" />
                  <span className="text-dark-100">{nameOf(entry.to)}</span>
                  <GenBadge generation={byId.get(entry.to)?.generation ?? 1} />
                  <span className="text-dark-500 ml-auto">
                    en remplaçant {nameOf(entry.swap[0])} par {nameOf(entry.swap[1])}
                    {entry.buy ? ' — à acheter' : ' — en écurie'}
                  </span>
                </div>
              ))
            )}
            {redirections.length > 6 && (
              <p className="text-[10px] text-dark-600">
                et {redirections.length - 6} autres détournements possibles.
              </p>
            )}
          </div>

          {mode === 'priority' && (
            <div data-testid="success-crossings" data-count={crossings.length} className="space-y-1.5">
              <p className="text-[11px] text-dark-500 mt-2">
                Croisements dédiés que l’écurie permet, du plus probable au moins :
              </p>
              {crossings.length === 0 ? (
                <p className="text-[11px] text-dark-500">
                  Aucun : l’écurie ne porte pas deux montures dont le croisement rendrait une
                  couleur manquante.
                </p>
              ) : (
                crossings.map((entry) => (
                  <div
                    key={`${entry.female.colorId}-${entry.male.colorId}-${entry.wanted.join('+')}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                      bg-dark-900/40 border border-dark-700/40 text-[11px]"
                  >
                    <span className="text-dark-300">
                      ♀ {nameOf(entry.female.colorId)}
                      {entry.female.parents && (
                        <span className="text-dark-600">
                          {' '}
                          [{entry.female.parents.map(nameOf).join(' + ')}]
                        </span>
                      )}
                    </span>
                    <span className="text-dark-600">×</span>
                    <span className="text-dark-300">
                      ♂ {nameOf(entry.male.colorId)}
                      {entry.male.parents && (
                        <span className="text-dark-600">
                          {' '}
                          [{entry.male.parents.map(nameOf).join(' + ')}]
                        </span>
                      )}
                    </span>
                    <span className="ml-auto text-gain tabular-nums">
                      {(entry.chance * 100).toFixed(1)} %
                    </span>
                    <span className="basis-full text-dark-500">
                      rendrait {entry.wanted.map(nameOf).join(', ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-dark-700/40">
        <p className="text-xs font-semibold text-dark-300">
          Ce qu’il reste à faire naître
          <span className="text-[11px] font-normal text-dark-500 ml-2">
            se coche à la saisie d’une naissance, et nulle part ailleurs
          </span>
        </p>
        {byGeneration.length === 0 ? (
          <p className="text-[11px] text-gain">Le succès est complet sur cette famille.</p>
        ) : (
          <div className="space-y-2 max-h-[22rem] overflow-y-auto pr-1">
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

      {progress.done === 0 && (
        <p className="text-[10px] text-dark-600 max-w-[70ch]">
          Le compteur part de zéro : il ne connaît que les naissances saisies dans « Ce qui est
          né », donc il ignore ce que tu as élevé avant. Une monture achetée peut porter une
          généalogie, donc l’écurie ne pouvait pas servir de preuve.
        </p>
      )}
    </div>
  );
};

export default BreedingSuccess;
