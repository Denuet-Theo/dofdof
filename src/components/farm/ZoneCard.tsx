'use client';

import { MapPin, Swords, ChevronRight } from 'lucide-react';
import KamasDisplay from '@/components/ui/KamasDisplay';
import type { FarmZone } from '@/lib/supabase/types';

type Props = {
  zone: FarmZone;
  /** Voir ce que la zone contient : bascule en mode monstre, filtré sur elle. */
  onDrillDown: (zone: FarmZone) => void;
};

/**
 * Une sous-zone du classement.
 *
 * ## Ce que la carte montre, et pourquoi ces trois chiffres
 *
 * La **moyenne** porte le tri : c'est ce que rapporte un combat quelconque de la
 * zone, donc la réponse à « où est-ce que je me pose ». Elle est trompeuse seule,
 * d'où les deux autres.
 *
 * L'**effectif** est le dénominateur. Une moyenne sur deux monstres et une
 * moyenne sur trente ne se lisent pas pareil, et sans le compte on ne peut pas
 * savoir laquelle on regarde.
 *
 * Le **meilleur monstre** dit si la moyenne cache une seule bonne proie. Une zone
 * à 300 de moyenne dont le meilleur fait 3 000 se joue en ciblant ; une zone à
 * 300 dont le meilleur fait 350 se joue au hasard. Les deux se ressemblent au
 * classement et ne se jouent pas du tout de la même façon.
 */
const ZoneCard = ({ zone, onDrillDown }: Props) => {
  const average = Number(zone.avg_kamas_per_fight) || 0;
  const best = Number(zone.best_kamas_per_fight) || 0;
  const count = Number(zone.monster_count) || 0;

  const level =
    zone.level_min === zone.level_max
      ? `niv ${zone.level_min}`
      : `niv ${zone.level_min}-${zone.level_max}`;

  // Une zone dont le meilleur écrase la moyenne se joue en ciblant. Le seuil est
  // arbitraire et ne sert qu'à décider d'un mot affiché — pas d'un calcul.
  const lopsided = average > 0 && best >= average * 2;

  return (
    <button
      type="button"
      onClick={() => onDrillDown(zone)}
      className="w-full glass rounded-2xl p-4 flex items-center gap-4 text-left
        cursor-pointer transition-all duration-200
        hover:border-kamas/20 hover:bg-dark-800/30"
    >
      <div className="w-10 h-10 rounded-xl bg-dark-800/60 flex items-center justify-center shrink-0">
        <MapPin size={18} className="text-dark-400" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-dark-100 truncate">{zone.subarea_name}</span>
          <span className="text-xs text-dark-500 shrink-0">{level}</span>
        </div>

        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {zone.area_name ? (
            <span className="text-xs text-dark-400 truncate">{zone.area_name}</span>
          ) : null}
          <span className="text-xs text-dark-500 flex items-center gap-1">
            <Swords size={11} />
            {count} monstre{count > 1 ? 's' : ''}
          </span>
          <span className="text-[11px] text-dark-500">
            meilleur : {zone.best_monster_name} (
            {best.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k)
            {lopsided ? <span className="text-craft"> — à cibler</span> : null}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[10px] text-dark-500">moyenne / combat</p>
        {/* Pas de `colored` : il préfixe un « + » et vire au vert, ce qui est le
            vocabulaire des marges. Une espérance de gain n'est pas une marge. */}
        <KamasDisplay amount={average} size="sm" />
      </div>

      <ChevronRight size={16} className="text-dark-600 shrink-0" />
    </button>
  );
};

export default ZoneCard;
