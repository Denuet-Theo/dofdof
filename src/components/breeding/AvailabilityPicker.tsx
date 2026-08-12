'use client';

import { useState } from 'react';
import { CalendarClock, Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import {
  MAX_WINDOWS,
  formatMinutes,
  normaliseWindows,
  parseMinutes,
  presetHours,
  type AvailabilityPreset,
  type AvailabilityWindow,
} from '@/lib/dofus/breeding/availability';

type Props = {
  presets: AvailabilityPreset[];
  /** Le préréglage posé pour aujourd'hui, ou `null` s'il reste à choisir. */
  active: AvailabilityPreset | null;
  onChoose: (presetId: string) => void;
  onSave: (preset: AvailabilityPreset) => void;
  onRemove: (presetId: string) => void;
};

/** Un identifiant stable sans dépendance : le nom réduit, plus un suffixe. */
const idFor = (name: string, taken: string[]): string => {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'preset';
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

/**
 * Le préréglage de disponibilité du jour, et l'édition de la liste.
 *
 * ## Pourquoi ça se choisit le matin
 *
 * Le geste de l'éleveur est : récupérer la fournée passée féconde dans la nuit,
 * faire les bébés et les clonages, **puis** dire quelle journée s'annonce. Le
 * choix porte donc sur la journée et pas sur le compte : il se redemande chaque
 * jour, et c'est `chosen.date` qui le garantit côté modèle.
 *
 * ## Pourquoi une liste et non deux boutons
 *
 * « Travail » et « repos » ne suffisent pas. Un télétravail n'a pas les horaires
 * d'un bureau, et deux joueurs n'ont pas les mêmes — donc les formes appartiennent
 * au compte, nommées et modifiables, pas au code.
 */
const AvailabilityPicker = ({ presets, active, onChoose, onSave, onRemove }: Props) => {
  const [editing, setEditing] = useState<AvailabilityPreset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startNew = () =>
    setEditing({
      id: '',
      name: '',
      // Un créneau d'exemple : un éditeur vide ne dit pas ce qu'on attend.
      windows: [{ from: 20 * 60, to: 26 * 60 }],
    });

  const commit = () => {
    if (editing === null) return;
    const name = editing.name.trim();
    if (name === '') {
      setError('Il faut un nom pour retrouver le préréglage.');
      return;
    }
    const windows = normaliseWindows(editing.windows);
    if (windows.length === 0) {
      setError('Il faut au moins un créneau, et sa fin doit suivre son début.');
      return;
    }
    const taken = presets.filter((p) => p.id !== editing.id).map((p) => p.id);
    onSave({ id: editing.id || idFor(name, taken), name, windows });
    setEditing(null);
    setError(null);
  };

  const patch = (at: number, field: keyof AvailabilityWindow, raw: string) => {
    if (editing === null) return;
    const value = parseMinutes(raw);
    if (value === null) return;
    setEditing({
      ...editing,
      windows: editing.windows.map((slot, index) =>
        index === at ? { ...slot, [field]: value } : slot
      ),
    });
  };

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-kamas" />
        <h2 className="text-sm font-medium text-dark-100">Ma journée</h2>
        {active === null ? (
          <span className="text-[11px] text-craft">à choisir</span>
        ) : (
          <span className="text-[11px] text-dark-500">
            {active.name} — {presetHours(active).toFixed(1)} h devant le jeu
          </span>
        )}
      </div>

      {/* Le choix du jour. Des boutons plutôt qu'un menu : ils sont peu nombreux
          et le geste est quotidien, donc il doit tenir en un clic. */}
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => {
          const chosen = active?.id === preset.id;
          return (
            <div key={preset.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onChoose(preset.id)}
                aria-pressed={chosen}
                className={`flex flex-col items-start px-3 py-1.5 rounded-l-lg text-xs
                  transition-colors cursor-pointer border ${
                    chosen
                      ? 'bg-kamas/10 border-kamas/40 text-kamas'
                      : 'border-dark-700/50 text-dark-300 hover:text-dark-100 hover:bg-dark-800/40'
                  }`}
              >
                <span className="font-medium">{preset.name}</span>
                <span className="text-[10px] opacity-70">
                  {normaliseWindows(preset.windows)
                    .map((slot) => `${formatMinutes(slot.from)}–${formatMinutes(slot.to)}`)
                    .join('  ')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(preset);
                  setError(null);
                }}
                aria-label={`Modifier ${preset.name}`}
                className="px-1.5 py-1.5 rounded-r-lg border border-l-0 border-dark-700/50
                  text-dark-500 hover:text-kamas transition-colors cursor-pointer self-stretch"
              >
                <Pencil size={11} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={startNew}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed
            border-dark-700/50 text-xs text-dark-400 hover:text-kamas hover:border-kamas/40
            transition-colors cursor-pointer"
        >
          <Plus size={12} />
          Nouveau
        </button>
      </div>

      {editing !== null && (
        <div className="rounded-xl border border-dark-700/50 bg-dark-800/30 p-3 space-y-3">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="Nom — « Télétravail », « Au bureau »…"
            aria-label="Nom du préréglage"
            className="w-full px-3 py-1.5 rounded-lg bg-dark-800/80 border border-dark-600/50
              text-sm text-dark-100 placeholder:text-dark-500 focus:border-kamas/50"
          />

          <div className="space-y-2">
            {editing.windows.map((slot, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  defaultValue={formatMinutes(slot.from)}
                  onBlur={(e) => patch(index, 'from', e.target.value)}
                  aria-label={`Début du créneau ${index + 1}`}
                  className="w-20 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
                    text-xs text-dark-100 text-center focus:border-kamas/50"
                />
                <span className="text-dark-500 text-xs">→</span>
                <input
                  defaultValue={formatMinutes(slot.to)}
                  onBlur={(e) => patch(index, 'to', e.target.value)}
                  aria-label={`Fin du créneau ${index + 1}`}
                  className="w-20 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
                    text-xs text-dark-100 text-center focus:border-kamas/50"
                />
                {/* Un créneau qui déborde sur le lendemain se dit `26:00`, et le
                    signaler évite de croire à une faute de saisie. */}
                {slot.to > 24 * 60 && (
                  <span className="text-[10px] text-dark-500">le lendemain</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      windows: editing.windows.filter((_, at) => at !== index),
                    })
                  }
                  aria-label={`Retirer le créneau ${index + 1}`}
                  className="p-1 rounded text-dark-500 hover:text-loss transition-colors cursor-pointer"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {editing.windows.length < MAX_WINDOWS && (
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    windows: [...editing.windows, { from: 13 * 60, to: 14 * 60 }],
                  })
                }
                className="flex items-center gap-1 text-[11px] text-dark-400
                  hover:text-kamas transition-colors cursor-pointer"
              >
                <Plus size={11} />
                Ajouter un créneau
              </button>
            )}
          </div>

          {error !== null && <p className="text-[11px] text-loss">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={commit}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-kamas/10
                border border-kamas/40 text-xs text-kamas hover:bg-kamas/20
                transition-colors cursor-pointer"
            >
              <Check size={12} />
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border
                border-dark-700/50 text-xs text-dark-400 hover:text-dark-100
                transition-colors cursor-pointer"
            >
              <X size={12} />
              Annuler
            </button>
            {editing.id !== '' && (
              <button
                type="button"
                onClick={() => {
                  onRemove(editing.id);
                  setEditing(null);
                  setError(null);
                }}
                className="ml-auto flex items-center gap-1 text-[11px] text-dark-500
                  hover:text-loss transition-colors cursor-pointer"
              >
                <Trash2 size={11} />
                Supprimer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AvailabilityPicker;
