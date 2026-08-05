'use client';

import { useMemo, useState } from 'react';
import { Check, Layers, TriangleAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { Batch } from '@/lib/dofus/breeding/batches';
import type { Sex } from '@/lib/dofus/breeding/stable';
import type { BirthEntry } from '@/lib/hooks/useBreeding';

/**
 * Les montures à charger dans l'enclos, nommément — puis ce qui en est né.
 *
 * Le plan dit combien d'accouplements ; devant l'enclos la question est « je
 * mets lesquelles ». C'est tout l'écart que ce panneau comble.
 *
 * Deux fournées et non une, parce que c'est ce qui permet de **relancer sans
 * avoir fait les accouplements** : un cycle de fécondité dure des heures, et si
 * la liste suivante n'apparaît qu'une fois les naissances saisies, l'enclos
 * reste vide le temps qu'on revienne. La seconde est provisoire et le dit — elle
 * suppose des naissances qui n'ont pas eu lieu.
 *
 * La saisie porte sur la **couleur née**, pas sur « réussi / raté » : un
 * accouplement rend toujours un bébé, et un raté est une couleur comme une
 * autre. Proposer une case à cocher laisserait croire qu'une tentative peut ne
 * rien donner, et perdrait la monture réellement obtenue.
 */

type Props = {
  batches: Batch[];
  nameOf: (colorId: string) => string;
  /** Les couleurs saisissables comme résultat, triées pour la liste déroulante. */
  colors: { colorId: string; name: string; generation: number }[];
  onRecord: (entries: BirthEntry[]) => Promise<void>;
};

/** Ce que l'éleveur déclare pour un couple donné, avant enregistrement. */
type Draft = { colorId: string; sex: Sex };

const BreedingBatches = ({ batches, nameOf, colors, onRecord }: Props) => {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const first = batches[0] ?? null;

  /** Le résultat par défaut d'un couple : la couleur que le plan vise. */
  const draftFor = (index: number): Draft => {
    const couple = first?.couples[index];
    return drafts[index] ?? { colorId: couple?.targetColorId ?? '', sex: 'M' };
  };

  const sorted = useMemo(
    () => [...colors].sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name)),
    [colors]
  );

  if (batches.length === 0) {
    return (
      <p className="text-[11px] text-dark-500">
        Aucune fournée possible : il manque des parents fertiles pour la première étape du
        plan. Complète l&apos;écurie dans « Mes stocks ».
      </p>
    );
  }

  const label = (side: { colorId: string; mountId: string | null }, sex: Sex) =>
    `${sex === 'M' ? '♂' : '♀'} ${nameOf(side.colorId)}${
      // Les gen 1-2 sont interchangeables et n'ont pas d'identifiant : les
      // nommer n'apporterait rien, il suffit d'en prendre une du tas.
      side.mountId ? ` · ${side.mountId.slice(0, 6)}` : ''
    }`;

  return (
    <div className="space-y-5">
      {batches.map((batch) => (
        <div key={batch.index} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Layers size={14} className="text-kamas" />
            <span className="text-xs font-semibold text-dark-200">
              Fournée {batch.index}
            </span>
            <span className="text-[11px] text-dark-500">
              {batch.couples.length} accouplement{batch.couples.length > 1 ? 's' : ''} ·{' '}
              {batch.used}/{batch.capacity} places
            </span>
            {batch.provisional && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400/80">
                <TriangleAlert size={11} />
                provisoire — suppose les naissances de la fournée {batch.index - 1}
              </span>
            )}
          </div>

          {batch.clonings.length > 0 && (
            <p className="text-[11px] text-dark-500 pl-5">
              À cloner avant :{' '}
              {batch.clonings
                .map((cloning) => `${cloning.count} × ${nameOf(cloning.colorId)}`)
                .join(', ')}
            </p>
          )}

          <div className="space-y-1 pl-5">
            {batch.couples.map((couple, index) => (
              <div
                key={`${batch.index}-${index}`}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                  bg-dark-800/40 text-xs"
              >
                <span className="text-dark-200 tabular-nums w-6 shrink-0 text-dark-500">
                  {index + 1}.
                </span>
                <span className="text-dark-200">{label(couple.male, 'M')}</span>
                <span className="text-dark-600">×</span>
                <span className="text-dark-200">{label(couple.female, 'F')}</span>
                <span className="text-[10px] text-dark-500 ml-1">
                  → vise {nameOf(couple.targetColorId)}
                </span>

                {/* La saisie ne s'ouvre que sur la première : les suivantes
                    supposent des naissances qui n'ont pas eu lieu, donc il n'y a
                    rien à y déclarer. */}
                {!batch.provisional && (
                  <span className="flex items-center gap-1.5 ml-auto">
                    <select
                      value={draftFor(index).colorId}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [index]: { ...draftFor(index), colorId: event.target.value },
                        }))
                      }
                      className="px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
                        text-dark-200 text-[11px] hover:border-dark-500 focus:border-kamas/50
                        cursor-pointer max-w-[170px]"
                    >
                      {sorted.map((color) => (
                        <option key={color.colorId} value={color.colorId}>
                          {color.name} (gen {color.generation})
                        </option>
                      ))}
                    </select>
                    {(['M', 'F'] as const).map((sex) => (
                      <button
                        key={sex}
                        type="button"
                        onClick={() =>
                          setDrafts((current) => ({
                            ...current,
                            [index]: { ...draftFor(index), sex },
                          }))
                        }
                        className={`px-2 py-1 rounded-lg text-[11px] border transition-all
                          cursor-pointer ${
                            draftFor(index).sex === sex
                              ? 'bg-kamas/15 border-kamas/40 text-kamas'
                              : 'bg-dark-800/80 border-dark-600/50 text-dark-400 hover:border-dark-500'
                          }`}
                      >
                        {sex === 'M' ? '♂' : '♀'}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {first && (
        <div className="flex flex-wrap items-center gap-3 pl-5">
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onRecord(
                first.couples.map((couple, index) => ({
                  male: couple.male,
                  female: couple.female,
                  ...draftFor(index),
                }))
              );
              setDrafts({});
              setSaving(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            }}
          >
            {saving ? 'Enregistrement…' : `Saisir les ${first.couples.length} naissances`}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-profit">
              <Check size={13} /> Écurie à jour — la fournée suivante est prête
            </span>
          )}
          <span className="text-[10px] text-dark-600">
            Les deux parents passent stériles, les bébés entrent en écurie.
          </span>
        </div>
      )}
    </div>
  );
};

export default BreedingBatches;
