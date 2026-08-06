'use client';

import { Rabbit } from 'lucide-react';
import type { Mate, Shortcut } from '@/lib/dofus/breeding/pairing';

/**
 * Ce que l'écurie permet de sauter — et que le plan ne voit pas.
 *
 * Le graphe de recettes raisonne sur des **couleurs**, alors que le jeu vise
 * « génération maximale de toute la généalogie + 1 », ce qui est une propriété
 * du **couple**. Deux gen 2 nées d'une Amande gen 3 visent la gen 4 sans
 * qu'aucune recette ne porte ce croisement. Voir `pairing.ts`.
 *
 * D'où un panneau à part et non une colonne du plan : ce n'est pas une variante
 * d'une étape existante, c'est un croisement que le plan ne propose pas. Il se
 * lit avant de charger l'enclos, comme une occasion à saisir — les montures qui
 * le portent sont souvent celles qu'on allait sacrifier.
 */

type Props = {
  shortcuts: Shortcut[];
  nameOf: (colorId: string) => string;
};

/** Une monture nommée : sa couleur, et son identifiant court si elle est suivie. */
const label = (mate: Mate, sex: '♂' | '♀', nameOf: (colorId: string) => string) =>
  `${sex} ${nameOf(mate.colorId)}${mate.id ? ` · ${mate.id.slice(0, 6)}` : ''}`;

const BreedingShortcuts = ({ shortcuts, nameOf }: Props) => {
  if (shortcuts.length === 0) return null;

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Rabbit size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Raccourcis de génération</span>
        <span className="text-xs text-dark-500">
          des couples qui visent plus haut que leur propre génération
        </span>
      </div>

      <p className="text-[11px] text-dark-500">
        Un croisement vise <strong>la génération la plus haute de toute la généalogie, plus
        un</strong> — et non celle de ses deux parents. Une monture basse née d&apos;un
        croisement haut traîne donc son ascendance avec elle. Ces couples-là ne sont dans
        aucune recette : les plans chiffrés ailleurs sur cette page ne les proposeront jamais.
      </p>

      <div className="space-y-1">
        {shortcuts.map((shortcut, index) => (
          <div
            key={`${shortcut.male.id ?? shortcut.male.colorId}-${
              shortcut.female.id ?? shortcut.female.colorId
            }-${index}`}
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
              bg-dark-800/40 text-xs"
          >
            <span className="text-dark-200">{label(shortcut.male, '♂', nameOf)}</span>
            <span className="text-dark-600">×</span>
            <span className="text-dark-200">{label(shortcut.female, '♀', nameOf)}</span>

            <span
              className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
              title={`La recette annoncerait la génération ${
                shortcut.targetGeneration - shortcut.leap
              } ; l'ascendance porte la cible à ${shortcut.targetGeneration}.`}
            >
              GEN. {shortcut.targetGeneration}
            </span>
            <span className="text-[10px] text-profit">
              +{shortcut.leap} génération{shortcut.leap > 1 ? 's' : ''}
            </span>

            <span className="text-[10px] text-dark-500 tabular-nums">
              {(shortcut.successRate * 100).toFixed(1)} %
            </span>
            <span className="text-[10px] text-dark-500 tabular-nums">
              {shortcut.genetons} génétons
            </span>

            {shortcut.targetColors.length > 0 && (
              <span
                className="text-[10px] text-dark-600 truncate"
                title={
                  shortcut.targetColors.length > 1
                    ? `Couleurs possibles, la plus probable en premier : ${shortcut.targetColors
                        .map((color) => nameOf(color.colorId))
                        .join(', ')}`
                    : 'La recombinaison des deux lignées ne nomme qu’une couleur à cette génération.'
                }
              >
                → {nameOf(shortcut.targetColors[0].colorId)}
                {shortcut.targetColors.length > 1 && ` (+${shortcut.targetColors.length - 1})`}
              </span>
            )}

            {shortcut.available > 1 && (
              <span
                className="ml-auto text-[10px] text-dark-600"
                title="Montures de même couleur et de même ascendance : elles sont interchangeables."
              >
                {shortcut.available} couples possibles
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-dark-600">
        Le taux suit la formule habituelle, niveaux des deux parents compris — un saut de
        génération ne coûte rien en probabilité. Les génétons suivent la génération des
        parents, pas celle visée. Une monture du vrac est comptée au niveau 1, faute d&apos;en
        suivre le niveau.
      </p>
    </div>
  );
};

export default BreedingShortcuts;
