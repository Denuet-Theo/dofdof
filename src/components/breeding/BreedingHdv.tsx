'use client';

import { useMemo, useState } from 'react';
import { Store, TrendingDown, TrendingUp } from 'lucide-react';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import BreedingMountName from '@/components/breeding/BreedingMountName';
import { borneName, colorCoder } from '@/lib/dofus/breeding/naming';
import {
  BUY_DISCOUNT,
  SELL_MARKUP,
  buyQuote,
  type HdvContext,
  type HdvQuote,
  type SellLine,
} from '@/lib/dofus/breeding/hdv';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import type { Stable } from '@/lib/dofus/breeding/stable';

/**
 * L'onglet HDV : à combien je vends les miennes, jusqu'à combien je paie celle
 * qui passe.
 *
 * ## Pourquoi ici et pas dans un classement
 *
 * `computeBreedingCosts` chiffre depuis toujours le moins cher entre acheter,
 * capturer et élever, et **rien ne l'affichait** depuis que #178 a débranché
 * `ColorRow` — quatre PR d'affilée ont déplacé ces chiffres sans que l'écran
 * bouge d'un caractère. Le classement complet par couleur, lui, ne revient pas :
 * il devinait un plan que la politique joue mieux trois onglets plus haut, et
 * c'est la contradiction que #104 pointait.
 *
 * Ce que cet onglet montre n'a pas ce problème : un prix de vente et un plafond
 * d'achat ne parlent d'aucun plan. Ils répondent à la question qu'on se pose
 * **devant l'hôtel de vente**, la fenêtre du jeu ouverte, et c'est pour ça que
 * c'est un geste de plus dans le ruban plutôt qu'un tableau de bord.
 *
 * ## Deux listes, parce que deux natures
 *
 * Les couleurs se groupent — le revient est une propriété de la recette, donc
 * deux Doré-Amande se valent. Les montures qui portent un **raccourci** ne se
 * groupent pas : leur ascendance vaut plus que leur couleur, et les noyer dans la
 * ligne de leur couleur ferait vendre une gen 1 à 104 551 kamas de valeur au prix
 * de 4 000. Voir `hdv.ts`.
 *
 * ## Ce que le formulaire ne demande pas
 *
 * Ni le sexe, ni le niveau, ni l'état. Aucun des trois n'entre dans le coût de
 * revient — le niveau se rattrape en montant la monture, ce qui est une dépense à
 * part. Les demander donnerait quatre champs dont deux sans effet sur un écran de
 * prix, ce qui est exactement la panne que #181 et #216 ont passé deux PR à
 * retirer.
 */

const STRATEGY = {
  buy: { label: 'Acheter', className: 'bg-dark-700/60 text-dark-300' },
  capture: { label: 'Capturer', className: 'bg-info/15 text-info' },
  breed: { label: 'Élever', className: 'bg-kamas/15 text-kamas' },
} as const;

const pct = (rate: number) => `${(rate * 100).toFixed(1)} %`;

/** Le prix, ou la raison de ne pas en donner. */
const Price = ({ amount }: { amount: number | null }) =>
  amount === null ? (
    <span className="text-dark-600">—</span>
  ) : (
    <KamasDisplay amount={amount} size="sm" />
  );

const BreedingHdv = ({
  sheet,
  context,
  stable,
  colors,
  nameOf,
}: {
  /**
   * La feuille de vente, calculée par le panneau.
   *
   * Pas ici, et c'est le badge de l'onglet qui l'impose : il compte les montures
   * à ne pas vendre au prix de leur couleur, donc le ruban a besoin du même
   * résultat. Le calculer deux fois le ferait diverger le jour où l'un des deux
   * changerait de critère.
   */
  sheet: { colors: SellLine[]; named: SellLine[] };
  context: HdvContext;
  stable: Stable;
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
}) => {
  const [colorId, setColorId] = useState('');
  const [parentA, setParentA] = useState('');
  const [parentB, setParentB] = useState('');

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  /** Le codeur se construit sur le catalogue entier : c'est ce qui garantit qu'un
      code ne désigne pas deux couleurs. */
  const code = useMemo(() => colorCoder(colors), [colors]);
  const chip = (colorId: string) => {
    const color = byId.get(colorId);
    return {
      name: nameOf(colorId),
      code: code(nameOf(colorId)),
      icon: color ? colorIconUrl(color) : null,
    };
  };

  /**
   * Le devis, recalculé à la saisie.
   *
   * Les deux parents comptent ensemble ou pas du tout : une ascendance à moitié
   * lue n'ouvre aucun raccourci, et en deviner la seconde moitié serait inventer
   * la réponse.
   */
  const quote = useMemo<HdvQuote | null>(() => {
    if (!colorId) return null;
    const parents: [string, string] | null = parentA && parentB ? [parentA, parentB] : null;
    return buyQuote(colorId, parents, stable, context);
  }, [colorId, parentA, parentB, stable, context]);

  const ordered = useMemo(
    () => [...colors].sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'fr')),
    [colors]
  );

  const picker = (
    value: string,
    onChange: (next: string) => void,
    empty: string,
    testId: string
  ) => (
    <select
      value={value}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
        text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
    >
      <option value="">{empty}</option>
      {ordered.map((color) => (
        <option key={color.id} value={color.id}>
          gen {color.generation} · {color.name}
        </option>
      ))}
    </select>
  );

  const line = (entry: SellLine) => (
    <div
      key={entry.mount ? entry.mount.id : entry.colorId}
      data-testid={entry.mount ? 'hdv-named' : 'hdv-color'}
      data-color={entry.colorId}
      // Les chiffres exacts, pour que le test de bout en bout puisse vérifier
      // l'arithmétique des marges sans lire une abréviation « 600.1M ».
      data-base={entry.base ?? ''}
      data-gain={entry.shortcut ? Math.round(entry.shortcut.gain) : ''}
      data-revient={entry.revient === null ? '' : Math.round(entry.revient)}
      data-sell={entry.sell ?? ''}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-xl
        bg-dark-900/40 border border-dark-700/40"
    >
      <div className="flex items-center gap-2 min-w-[13rem]">
        <ColorChip {...chip(entry.colorId)} size="sm" />
        <span className="text-sm text-dark-100">{nameOf(entry.colorId)}</span>
        <GenBadge generation={byId.get(entry.colorId)?.generation ?? 1} />
        {entry.count > 1 && <span className="text-[11px] text-dark-500">×{entry.count}</span>}
      </div>

      {entry.mount && (
        <div className="flex items-center gap-2 text-[11px] text-dark-400">
          <BreedingMountName name={borneName(entry.mount)} />
          <span>
            niv. {entry.mount.level} · né de {nameOf(entry.mount.parents![0])} +{' '}
            {nameOf(entry.mount.parents![1])}
          </span>
        </div>
      )}

      {entry.strategy && !entry.mount && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-md ${STRATEGY[entry.strategy].className}`}
        >
          {STRATEGY[entry.strategy].label}
        </span>
      )}

      <div className="ml-auto flex items-center gap-5">
        <div className="text-right">
          <p className="text-[10px] text-dark-500">revient</p>
          <Price amount={entry.revient === null ? null : Math.round(entry.revient)} />
        </div>
        <div className="text-right">
          <p className="text-[10px] text-dark-500">vendre au-dessus de</p>
          <Price amount={entry.sell} />
          {entry.sellNet !== null && (
            <p className="text-[10px] text-dark-600">net {entry.sellNet.toLocaleString('fr-FR')}</p>
          )}
        </div>
      </div>

      {entry.shortcut && (
        <p className="basis-full text-[11px] text-gain">
          Raccourci : vise la <strong>gen {entry.shortcut.targetGeneration}</strong> à{' '}
          {pct(entry.shortcut.successRate)} avec {nameOf(entry.shortcut.partner.colorId)} — sa
          couleur seule vaut {Math.round(entry.base ?? 0).toLocaleString('fr-FR')}, son ascendance
          en ajoute {Math.round(entry.shortcut.gain).toLocaleString('fr-FR')}.
        </p>
      )}

      {entry.revient !== null && entry.revient <= 0 && (
        <p className="basis-full text-[11px] text-dark-500">
          Elle se paie toute seule — génétons et extraction dépassent la dépense. Tout prix de
          vente est un gain, et il n&apos;y a aucune raison de l&apos;acheter.
        </p>
      )}

      {entry.revient === null && (
        <p className="basis-full text-[11px] text-dark-500">
          Pas de prix : il manque une cotation sur sa route. Saisis-la dans « Mes stocks ».
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Store size={14} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Ce que tu peux mettre en vente</span>
        <span className="text-[11px] text-dark-500">
          revient +{Math.round((SELL_MARKUP - 1) * 100)} %, taxe de l&apos;hôtel déduite du net
        </span>
      </div>

      {sheet.named.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp size={13} className="text-gain" />
            <span className="text-xs font-semibold text-dark-300">
              À ne pas vendre au prix de leur couleur
            </span>
            <span className="text-[11px] text-dark-500">
              leur ascendance porte plus haut qu&apos;elles
            </span>
          </div>
          <div className="space-y-1.5">{sheet.named.map(line)}</div>
        </div>
      )}

      {sheet.colors.length === 0 ? (
        <p className="text-[11px] text-dark-500">
          L&apos;écurie est vide — rien à mettre en vente.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
          {sheet.colors.map(line)}
        </div>
      )}

      <div className="space-y-3 pt-2 border-t border-dark-700/40">
        <div className="flex flex-wrap items-center gap-2">
          <TrendingDown size={14} className="text-kamas" />
          <span className="text-sm font-semibold text-dark-200">Chercher un prix d&apos;achat</span>
          <span className="text-[11px] text-dark-500">
            revient −{Math.round((1 - BUY_DISCOUNT) * 100)} % — au-dessus, mieux vaut la produire
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="block text-xs text-dark-400">Couleur</span>
            {picker(colorId, setColorId, 'Choisir une couleur', 'hdv-color-pick')}
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs text-dark-400">Premier parent</span>
            {picker(parentA, setParentA, 'Aucun — capturée', 'hdv-parent-a')}
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs text-dark-400">Second parent</span>
            {picker(parentB, setParentB, 'Aucun — capturée', 'hdv-parent-b')}
          </label>
        </div>
        <p className="text-[10px] text-dark-600">
          Les deux parents comptent ensemble : c&apos;est leur génération la plus haute qui décide
          de ce que la monture peut viser. Ni le sexe ni le niveau n&apos;entrent dans le revient.
        </p>

        {quote && (
          <div
            data-testid="hdv-quote"
            data-color={quote.colorId}
            data-base={quote.base ?? ''}
            data-gain={quote.shortcut ? Math.round(quote.shortcut.gain) : ''}
            data-revient={quote.revient === null ? '' : Math.round(quote.revient)}
            data-buy={quote.buy ?? ''}
            className="px-3 py-3 rounded-xl bg-dark-900/40 border border-dark-700/40 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <ColorChip {...chip(quote.colorId)} size="sm" />
                <span className="text-sm text-dark-100">{nameOf(quote.colorId)}</span>
                <GenBadge generation={byId.get(quote.colorId)?.generation ?? 1} />
              </div>
              <div className="text-right">
                <p className="text-[10px] text-dark-500">revient</p>
                <Price amount={quote.revient === null ? null : Math.round(quote.revient)} />
              </div>
              <div className="text-right">
                <p className="text-[10px] text-dark-500">payer jusqu&apos;à</p>
                <Price amount={quote.buy} />
              </div>
            </div>

            {quote.shortcut && (
              <p className="text-[11px] text-gain">
                Raccourci : vise la <strong>gen {quote.shortcut.targetGeneration}</strong> à{' '}
                {pct(quote.shortcut.successRate)} avec{' '}
                {nameOf(quote.shortcut.partner.colorId)} de ton écurie — sa couleur seule vaut{' '}
                {Math.round(quote.base ?? 0).toLocaleString('fr-FR')}, son ascendance en ajoute{' '}
                {Math.round(quote.shortcut.gain).toLocaleString('fr-FR')}.
              </p>
            )}

            {!quote.shortcut && parentA && parentB && (
              <p className="text-[11px] text-dark-500">
                Cette ascendance n&apos;ouvre rien de plus que la couleur — soit elle ne dépasse
                pas la monture, soit aucune recombinaison n&apos;en tire une génération de plus
                avec ce que ton écurie porte.
              </p>
            )}

            {quote.revient !== null && quote.revient <= 0 && (
              <p className="text-[11px] text-dark-500">
                Elle se paie toute seule : aucun prix d&apos;achat ne se justifie.
              </p>
            )}

            {quote.revient === null && (
              <p className="text-[11px] text-dark-500">
                Pas de prix : il manque une cotation sur sa route.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BreedingHdv;
