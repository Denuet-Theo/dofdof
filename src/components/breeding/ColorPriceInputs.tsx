'use client';

import { useState } from 'react';
import { Save, Check } from 'lucide-react';
import Button from '@/components/ui/Button';

type Props = {
  colorId: string;
  level0: number | null;
  level200: number | null;
  onSave: (colorId: string, mountLevel: 0 | 200, price: number) => Promise<boolean>;
  /** `true` en mode saisie de masse : plus compact, sans libellés répétés. */
  compact?: boolean;
};

/**
 * Les deux prix d'une couleur, saisis en ligne — même geste que
 * `ItemPriceInput` sur les pages Items et Jauges.
 *
 * Deux champs et non un seul : un poulain naît niveau 1, donc l'élevage produit
 * du niveau 0, et le prix niveau 200 ne s'atteint qu'en payant la montée. Les
 * confondre ferait passer une monture montée pour ce que l'élevage rapporte.
 */
const ColorPriceInputs = ({ colorId, level0, level200, onSave, compact = false }: Props) => {
  const [values, setValues] = useState({
    0: level0?.toString() ?? '',
    200: level200?.toString() ?? '',
  });
  const [saving, setSaving] = useState<0 | 200 | null>(null);
  const [saved, setSaved] = useState<0 | 200 | null>(null);

  const save = async (mountLevel: 0 | 200) => {
    const parsed = parseInt(values[mountLevel], 10);
    if (Number.isNaN(parsed) || parsed < 0 || saving !== null) return;

    setSaving(mountLevel);
    if (await onSave(colorId, mountLevel, parsed)) {
      setSaved(mountLevel);
      setTimeout(() => setSaved(null), 2000);
    }
    setSaving(null);
  };

  const input = (mountLevel: 0 | 200) => (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <label className="text-[10px] text-dark-500 w-14 shrink-0">niv {mountLevel}</label>
      )}
      <div className="relative flex-1 min-w-0">
        <input
          type="number"
          min="0"
          value={values[mountLevel]}
          onChange={(event) =>
            setValues((current) => ({ ...current, [mountLevel]: event.target.value }))
          }
          onKeyDown={(event) => event.key === 'Enter' && save(mountLevel)}
          placeholder={compact ? `niv ${mountLevel}` : 'Prix moyen...'}
          className="w-full px-3 py-1.5 pr-7 rounded-lg text-sm
            bg-dark-800/80 border border-dark-600/50 text-dark-100
            placeholder:text-dark-500 transition-all
            hover:border-dark-500 focus:border-kamas/50"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/kamas.svg"
          alt="Kamas"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
        />
      </div>
      <Button
        size="sm"
        onClick={() => save(mountLevel)}
        loading={saving === mountLevel}
        variant={saved === mountLevel ? 'secondary' : 'primary'}
        disabled={!values[mountLevel] || saving !== null}
      >
        {saved === mountLevel ? <Check size={13} /> : <Save size={13} />}
      </Button>
    </div>
  );

  return (
    <div className={compact ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
      {input(0)}
      {input(200)}
    </div>
  );
};

export default ColorPriceInputs;
