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

/**
 * Les plafonds de carburant, qui sont aussi les paliers de transfert : tenir
 * une jauge au-dessus de 90 000 débite 4 pt/s, sous 40 000 seulement 1 pt/s.
 * L'Élixir est le seul sans plafond, donc le seul à atteindre le débit maximal.
 */
const GAUGE_TIERS = [
  { cap: 40_000, label: 'Extrait — jusqu’à 40 000', rate: 1 },
  { cap: 70_000, label: 'Philtre — jusqu’à 70 000', rate: 2 },
  { cap: 90_000, label: 'Potion — jusqu’à 90 000', rate: 3 },
  { cap: 100_000, label: 'Élixir — sans plafond', rate: 4 },
];

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
          {settings.never_sell_mounts && ' · sans revente'}
          {/* Un réglage qui déplace tous les coûts mérite d'être lisible sans
              déplier le panneau. */}
          {!settings.credit_off_target && ' · ratés non crédités'}
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

          {/* Le palier décide du débit, donc de la durée de chaque cycle. Les
              plafonds des carburants tombent sur les paliers de transfert. */}
          <div>
            <label className="text-xs text-dark-400 mb-1 block">
              Remplissage des jauges
            </label>
            <select
              value={draft.gauge_cap === null ? 'auto' : String(draft.gauge_cap)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  gauge_cap: event.target.value === 'auto' ? null : Number(event.target.value),
                }))
              }
              className="px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm transition-all hover:border-dark-500
                focus:border-kamas/50 cursor-pointer"
            >
              <option value="auto">Au meilleur rapport (selon kamas/heure)</option>
              {GAUGE_TIERS.map(({ cap, label, rate }) => (
                <option key={cap} value={cap}>
                  {label} — {rate} pt/s
                </option>
              ))}
            </select>
            <p className="text-[10px] text-dark-600 mt-1">
              Un palier haut transfère jusqu&apos;à 4× plus vite, mais son carburant coûte
              plus cher au point.
            </p>
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

          <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={draft.never_sell_mounts}
              onChange={(event) =>
                setDraft((current) => ({ ...current, never_sell_mounts: event.target.checked }))
              }
              className="accent-kamas cursor-pointer"
            />
            Ne jamais vendre les montures — ne valoriser que l&apos;extraction et les génétons
          </label>
          {draft.never_sell_mounts && (
            <p className="text-[10px] text-dark-600 -mt-2 ml-6">
              Le marché des certificats est peu liquide : un prix saisi ne garantit pas un
              acheteur. Les prix restent utilisés pour <em>acheter</em> une couleur plutôt que
              l&apos;élever, mais plus pour la revendre.
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={!draft.count_net_cost}
              onChange={(event) =>
                setDraft((current) => ({ ...current, count_net_cost: !event.target.checked }))
              }
              className="accent-kamas cursor-pointer"
            />
            Ne pas compter le prix des filets — je récolte mes matériaux
          </label>
          {!draft.count_net_cost && (
            <p className="text-[10px] text-dark-600 -mt-2 ml-6">
              Une capture ne coûte plus que le temps de combat. Les filets sans prix
              redeviennent utilisables, et le choix bascule sur le plus gros disponible —
              un filet vaut un combat, quel que soit son palier.
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={!draft.credit_off_target}
              onChange={(event) =>
                setDraft((current) => ({ ...current, credit_off_target: !event.target.checked }))
              }
              className="accent-kamas cursor-pointer"
            />
            Ne pas créditer les bébés hors cible — chaque tentative se paie plein pot
          </label>
          {!draft.credit_off_target && (
            <p className="text-[10px] text-dark-600 -mt-2 ml-6">
              Un croisement raté rend bel et bien une monture, et elle vaut quelque chose. Mais
              elle est tirée dans l&apos;ascendance, pas choisie : sur une route vers la
              génération 10, on accumule des couleurs basses dont on ne fera rien. Sans le
              crédit, les coûts montent et l&apos;optimiseur cesse de préférer les croisements
              qui ratent souvent.
            </p>
          )}

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
