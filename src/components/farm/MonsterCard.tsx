'use client';

import { useState } from 'react';
import { ChevronDown, Swords, MapPin, AlertTriangle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import CopyableIcon from '@/components/ui/CopyableIcon';
import KamasDisplay from '@/components/ui/KamasDisplay';
import ItemPriceInput from '@/components/items/ItemPriceInput';
import { ELEMENT_LABELS, ELEMENT_COLORS } from '@/lib/constants/elements';
import { ELEMENTS, type Element, type FarmTarget } from '@/lib/supabase/types';

/**
 * L'élément le plus tendre du monstre, sur la borne haute de résistance.
 *
 * La borne haute et non la basse : c'est le pire cas sur l'ensemble des grades,
 * donc la seule qui vaille quel que soit le grade rencontré. Annoncer « faible
 * feu » sur un minimum atteint par un seul grade sur onze serait un mensonge.
 */
const weakestElement = (resistances: FarmTarget['resistances']): { element: Element; value: number } | null => {
  let best: { element: Element; value: number } | null = null;

  for (const element of ELEMENTS) {
    const pair = resistances?.[element];
    if (!Array.isArray(pair)) continue;
    const max = Number(pair[1]);
    if (!Number.isFinite(max)) continue;
    if (best === null || max < best.value) best = { element, value: max };
  }

  return best;
};

type Props = {
  target: FarmTarget;
  /** Un prix de drop vient d'être écrit : à l'écran de répercuter le classement. */
  onPriceSaved: (itemId: number, price: number) => void;
};

const MonsterCard = ({ target, onPriceSaved }: Props) => {
  const [expanded, setExpanded] = useState(false);

  const weak = weakestElement(target.resistances);
  const kamas = Number(target.kamas_per_fight) || 0;
  const level =
    target.level_min === target.level_max
      ? `niv ${target.level_min}`
      : `niv ${target.level_min}-${target.level_max}`;

  return (
    <div className="glass rounded-2xl overflow-hidden transition-all duration-200 hover:border-kamas/20">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="w-full flex items-center gap-4 p-4 text-left cursor-pointer hover:bg-dark-800/30 transition-colors"
        aria-expanded={expanded}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- même choix que ItemCard : images DofusDB distantes, non optimisables. */}
        <img
          src={target.img}
          alt=""
          className="w-12 h-12 rounded-xl bg-dark-800/60 object-contain shrink-0"
          loading="lazy"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-dark-100 truncate">{target.monster_name}</span>
            <span className="text-xs text-dark-500 shrink-0">{level}</span>
            {target.is_boss ? <Badge variant="danger">Boss</Badge> : null}
            {target.is_mini_boss ? <Badge variant="warning">Mini-boss</Badge> : null}
          </div>

          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {/* Pas de `colored` : il préfixe un « + » et vire au vert, ce qui est
                le vocabulaire des marges. Une espérance de gain par combat est une
                valeur absolue, jamais négative — le signe n'y voudrait rien dire. */}
            <KamasDisplay amount={kamas} size="sm" className="text-kamas" />
            <span className="text-xs text-dark-500">/ combat</span>

            {weak ? (
              <span
                className={`inline-flex items-center gap-1 text-xs ${ELEMENT_COLORS[weak.element]}`}
                title={`Résistance ${ELEMENT_LABELS[weak.element].toLowerCase()} la plus basse : ${weak.value} % au pire grade`}
              >
                <Swords size={12} />
                faible {ELEMENT_LABELS[weak.element].toLowerCase()} ({weak.value} %)
              </span>
            ) : null}
          </div>

          {target.subarea_names.length > 0 ? (
            <div className="flex items-center gap-1 mt-1 text-xs text-dark-500">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{target.subarea_names.slice(0, 3).join(', ')}</span>
              {target.subarea_names.length > 3 ? (
                <span className="shrink-0">+{target.subarea_names.length - 3}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0 text-dark-500">
          <span className="text-xs">{target.drop_count} drops</span>
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-dark-700/50 px-4 py-3 space-y-2">
          {/* Les cinq résistances en clair : le badge de l'en-tête n'en montre qu'une. */}
          <div className="flex flex-wrap gap-2 pb-2">
            {ELEMENTS.map((element) => {
              const pair = target.resistances?.[element];
              if (!Array.isArray(pair)) return null;
              const [min, max] = pair.map(Number);
              return (
                <span
                  key={element}
                  className={`text-xs ${ELEMENT_COLORS[element]}`}
                  title="Bornes sur l'ensemble des grades"
                >
                  {ELEMENT_LABELS[element]} {min === max ? `${min} %` : `${min}…${max} %`}
                </span>
              );
            })}
          </div>

          {target.top_drops.length === 0 ? (
            <p className="text-xs text-dark-500">Aucun drop ne passe les filtres courants.</p>
          ) : (
            target.top_drops.map((drop) => {
              const price = Number(drop.price) || 0;

              // Le champ de prix ajoute 160 px incompressibles à la ligne. Sans
              // `flex-wrap`, c'est le nom qui payait : sous ~800 px il tombait à
              // zéro et on se retrouvait à tarifer une ressource qu'on ne
              // pouvait plus lire. Le `min-w-24` fixe le seuil — dès que le nom
              // n'obtient plus ses 96 px, le prix passe à la ligne suivante.
              return (
                <div
                  key={`${drop.objectId}-${drop.criterions}`}
                  className="flex items-center gap-x-3 gap-y-2 text-sm flex-wrap"
                >
                  {/* `toast={false}` : la carte a `overflow-hidden`, la pastille
                      flottante y serait coupée. La coche sur l'icône suffit. */}
                  <CopyableIcon src={drop.img} name={drop.name} size="sm" toast={false} />

                  <span className="flex-1 min-w-24 truncate text-dark-200">{drop.name}</span>

                  {drop.hasCriterions ? (
                    <AlertTriangle
                      size={12}
                      className="text-kamas/70 shrink-0"
                      aria-label="Drop conditionnel"
                    />
                  ) : null}

                  <span className="text-xs text-dark-400 tabular-nums shrink-0 w-16 text-right">
                    {Number(drop.percent).toFixed(2)} %
                  </span>

                  {/* Un prix à 0 est un trou de saisie, pas un prix : passer
                      `undefined` laisse le champ vide et son invite visible,
                      plutôt que de faire corriger un « 0 » qui n'a jamais été
                      saisi. */}
                  <ItemPriceInput
                    itemId={drop.objectId}
                    itemName={drop.name}
                    iconUrl={drop.img}
                    currentPrice={price > 0 ? price : undefined}
                    onPriceSaved={(itemId, saved) => onPriceSaved(itemId, saved)}
                    className="w-40 shrink-0 ml-auto"
                  />
                </div>
              );
            })
          )}

          {target.drop_count > target.top_drops.length ? (
            <p className="text-xs text-dark-500 pt-1">
              {target.drop_count - target.top_drops.length} autre(s) drop(s) non affiché(s).
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default MonsterCard;
