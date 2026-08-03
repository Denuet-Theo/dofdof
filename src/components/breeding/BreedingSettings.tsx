'use client';

import { useState } from 'react';
import { Settings2, Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { DEFAULT_SETTINGS } from '@/lib/hooks/useBreeding';

type Settings = typeof DEFAULT_SETTINGS;

type Props = {
  settings: Settings;
  onSave: (next: Settings) => Promise<boolean>;
};

/** Niveaux d'Éleveur qui débloquent un enclos supplémentaire. */
const ENCLOS_UNLOCKS = [1, 40, 80, 120, 160, 200];

const enclosAllowedBy = (breederLevel: number) =>
  ENCLOS_UNLOCKS.filter((level) => breederLevel >= level).length;

const BreedingSettings = ({ settings, onSave }: Props) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);

  // Le brouillon se cale sur les réglages **à l'ouverture** plutôt que par un
  // effet de synchronisation : les réglages arrivent du réseau après le premier
  // rendu, et les recopier à chaque changement écraserait une saisie en cours.
  const toggle = () => {
    setOpen((value) => {
      if (!value) setDraft(settings);
      return !value;
    });
  };

  const maxEnclos = enclosAllowedBy(draft.breeder_level);

  const field = (
    label: string,
    key: keyof Settings,
    hint: string,
    props: { min?: number; max?: number; step?: number } = {}
  ) => (
    <div>
      <label className="text-xs text-dark-400 mb-1 block">{label}</label>
      <input
        type="number"
        value={String(draft[key])}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))
        }
        {...props}
        className="w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
          text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
      />
      <p className="text-[10px] text-dark-600 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="glass rounded-2xl">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-5 py-4 cursor-pointer"
      >
        <Settings2 size={16} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Mon élevage</span>
        <span className="text-xs text-dark-500 ml-2">
          niveau {settings.breeder_level} · {settings.enclos_count} enclos ·{' '}
          {settings.kamas_per_hour > 0
            ? `${settings.kamas_per_hour.toLocaleString('fr-FR')} k/h`
            : 'temps non valorisé'}
        </span>
        <span className="ml-auto text-xs text-dark-500">{open ? 'Fermer' : 'Modifier'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-dark-700/40 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {field('Niveau Éleveur', 'breeder_level', `débloque ${maxEnclos} enclos`, {
              min: 1,
              max: 200,
            })}
            {field('Enclos possédés', 'enclos_count', '10 places, 2 jauges chacun', {
              min: 0,
              max: maxEnclos,
            })}
            {field('Kamas par heure', 'kamas_per_hour', 'ce que vaut ton temps de jeu', {
              min: 0,
              step: 10_000,
            })}
            {field('Minutes par combat', 'minutes_per_fight', 'capture : trajet compris', {
              min: 1,
            })}
          </div>

          <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={draft.recycle_steriles}
              onChange={(event) =>
                setDraft((current) => ({ ...current, recycle_steriles: event.target.checked }))
              }
              className="accent-kamas cursor-pointer"
            />
            Recycler les parents stériles par clonage — deux stériles de même génération
            rendent une monture fertile
          </label>

          {/* Le niveau peut avoir baissé sous le nombre d'enclos déjà saisi ;
              le dire vaut mieux que de corriger en silence. */}
          {draft.enclos_count > maxEnclos && (
            <p className="text-[11px] text-amber-400/80">
              Un éleveur niveau {draft.breeder_level} ne débloque que {maxEnclos} enclos.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={draft.enclos_count > maxEnclos}
              onClick={async () => {
                if (await onSave(draft)) {
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                }
              }}
            >
              Enregistrer
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-profit">
                <Check size={13} /> Enregistré
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BreedingSettings;
