'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type Props = {
  name: string;
  mountLevel: 0 | 200;
  current: number | null;
  onClose: () => void;
  onSave: (price: number) => Promise<void>;
};

const PriceEditor = ({ name, mountLevel, current, onClose, onSave }: Props) => {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [saving, setSaving] = useState(false);

  const parsed = Number(value.replace(/[\s ]/g, ''));
  const valid = value !== '' && Number.isFinite(parsed) && parsed >= 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    await onSave(parsed);
    setSaving(false);
  };

  return (
    <Modal isOpen onClose={onClose} title={`${name} — niveau ${mountLevel}`} size="sm">
      <div className="space-y-4">
        <p className="text-xs text-dark-400">
          {mountLevel === 0
            ? 'Prix du poulain tel qu’il naît. C’est ce que l’élevage produit, et donc le prix auquel se compare le coût de revient.'
            : 'Prix une fois la monture montée au niveau 200. La montée se paie en Mangeoire, déduite de la marge.'}
        </p>

        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          placeholder="0"
          className="w-full px-4 py-3 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-100 transition-all hover:border-dark-500 focus:border-kamas/50"
        />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" onClick={submit} loading={saving} disabled={!valid}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default PriceEditor;
