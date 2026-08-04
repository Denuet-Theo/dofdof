'use client';

import { useMemo, useState } from 'react';
import { Boxes, Check, Coins, Search } from 'lucide-react';
import Button from '@/components/ui/Button';
import { parseGaugeInfo } from '@/lib/utils/gauges';
import type { DofusDBItem } from '@/lib/supabase/types';
import type { BreedingRow, DEFAULT_SETTINGS } from '@/lib/hooks/useBreeding';

/**
 * Ce que l'éleveur a déjà : en écurie, en réserve et en caisse.
 *
 * Les trois servent la même chose — savoir ce qu'un plan demande **en plus** —
 * mais par des chemins différents, et c'est pourquoi ils sont saisis ensemble :
 *
 * - les **montures** se déduisent du plan lui-même : une couleur possédée n'est
 *   plus à produire, et toute son ascendance disparaît avec elle ;
 * - les **carburants** ne changent pas le plan mais ce qu'il faut débourser :
 *   les points sont déjà payés ;
 * - les **kamas** ne changent rien du tout, ils décident de ce qui est
 *   réalisable.
 */

type Settings = typeof DEFAULT_SETTINGS;

type Props = {
  rows: BreedingRow[];
  fuelItems: DofusDBItem[];
  mountStock: Map<string, number>;
  itemStock: Map<number, number>;
  ownedGaugePoints: Map<string, number>;
  settings: Settings;
  onSaveMount: (colorId: string, count: number) => Promise<void>;
  onSaveItem: (itemId: number, quantity: number) => Promise<void>;
  onSaveSettings: (next: Settings) => Promise<boolean>;
};

const countInput = (
  value: number,
  onChange: (next: number) => void,
  max = 9999
) => (
  <input
    type="number"
    min={0}
    max={max}
    value={String(value)}
    onChange={(event) => onChange(Math.max(0, Math.min(max, Number(event.target.value) || 0)))}
    className="w-20 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
      text-dark-100 text-xs text-right transition-all hover:border-dark-500
      focus:border-kamas/50"
  />
);

const BreedingStocks = ({
  rows,
  fuelItems,
  mountStock,
  itemStock,
  ownedGaugePoints,
  settings,
  onSaveMount,
  onSaveItem,
  onSaveSettings,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [mountQuery, setMountQuery] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [fuelQuery, setFuelQuery] = useState('');
  const [budget, setBudget] = useState(String(settings.kamas_available));
  const [savedBudget, setSavedBudget] = useState(false);

  const mounts = useMemo(() => {
    const needle = mountQuery.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (ownedOnly && !(mountStock.get(row.colorId) ?? 0)) return false;
        return !needle || row.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        // Ce qu'on possède remonte : c'est ce qu'on vient corriger.
        const owned = (mountStock.get(b.colorId) ?? 0) - (mountStock.get(a.colorId) ?? 0);
        return owned || a.generation - b.generation || a.name.localeCompare(b.name);
      });
  }, [rows, mountQuery, ownedOnly, mountStock]);

  /** Les carburants d'enclos, groupés par jauge et ordonnés par palier. */
  const fuelsByGauge = useMemo(() => {
    const needle = fuelQuery.trim().toLowerCase();
    const groups = new Map<string, { item: DofusDBItem; recharge: number }[]>();

    for (const item of fuelItems) {
      const info = parseGaugeInfo(item);
      if (!info || info.rechargeAmount <= 0) continue;

      const name = item.name?.fr ?? '';
      if (needle && !name.toLowerCase().includes(needle) && !info.gaugeName.toLowerCase().includes(needle)) {
        continue;
      }

      const group = groups.get(info.gaugeName) ?? [];
      group.push({ item, recharge: info.rechargeAmount });
      groups.set(info.gaugeName, group);
    }

    for (const group of groups.values()) group.sort((a, b) => a.recharge - b.recharge);
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [fuelItems, fuelQuery]);

  const ownedMounts = [...mountStock.values()].reduce((total, count) => total + count, 0);
  const ownedFuels = [...itemStock.values()].reduce((total, quantity) => total + quantity, 0);

  return (
    <div className="glass rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 px-5 py-4 cursor-pointer text-left"
      >
        <Boxes size={16} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Mes stocks</span>
        <span className="text-xs text-dark-500 ml-2 truncate">
          {ownedMounts} monture{ownedMounts > 1 ? 's' : ''} · {ownedFuels} carburant
          {ownedFuels > 1 ? 's' : ''} ·{' '}
          {settings.kamas_available > 0
            ? `${settings.kamas_available.toLocaleString('fr-FR')} kamas`
            : 'budget non renseigné'}
        </span>
        <span className="ml-auto text-xs text-dark-500 shrink-0">
          {open ? 'Fermer' : 'Modifier'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-6 border-t border-dark-700/40 pt-4">
          {/* Kamas */}
          <div>
            <label className="flex items-center gap-2 text-xs text-dark-400 mb-1.5">
              <Coins size={13} className="text-kamas" />
              Kamas engageables
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                step={100_000}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                className="w-48 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                  text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
              />
              <Button
                size="sm"
                onClick={async () => {
                  const value = Math.max(0, Number(budget) || 0);
                  if (await onSaveSettings({ ...settings, kamas_available: value })) {
                    setSavedBudget(true);
                    setTimeout(() => setSavedBudget(false), 2000);
                  }
                }}
              >
                Enregistrer
              </Button>
              {savedBudget && (
                <span className="flex items-center gap-1 text-xs text-profit">
                  <Check size={13} /> Enregistré
                </span>
              )}
            </div>
            <p className="text-[10px] text-dark-600 mt-1">
              Les plans qui dépassent ce budget sont signalés, avec l&apos;étape où
              l&apos;argent manque. À 0, aucune contrainte n&apos;est appliquée.
            </p>
          </div>

          {/* Montures */}
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-2">
              <p className="text-xs text-dark-400">Montures fertiles en écurie</p>
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
                />
                <input
                  type="text"
                  value={mountQuery}
                  onChange={(event) => setMountQuery(event.target.value)}
                  placeholder="Filtrer par nom"
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-dark-800/80 border
                    border-dark-600/50 text-dark-100 text-xs placeholder:text-dark-500
                    transition-all hover:border-dark-500 focus:border-kamas/50"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ownedOnly}
                  onChange={(event) => setOwnedOnly(event.target.checked)}
                  className="accent-kamas cursor-pointer"
                />
                Seulement celles que je possède
              </label>
            </div>
            <p className="text-[10px] text-dark-600 mb-2">
              Ne compte que les montures <strong>fertiles</strong> : une monture déjà
              accouplée est stérile, et son recyclage par clonage est déjà pris en compte
              dans les plans.
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {mounts.map((row) => (
                <div
                  key={row.colorId}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-xl hover:bg-dark-800/40"
                >
                  <span className="text-xs text-dark-200 flex-1 truncate">{row.name}</span>
                  <span className="text-[10px] text-dark-500 shrink-0">gen {row.generation}</span>
                  {countInput(mountStock.get(row.colorId) ?? 0, (next) =>
                    onSaveMount(row.colorId, next)
                  )}
                </div>
              ))}
              {mounts.length === 0 && (
                <p className="text-xs text-dark-500 text-center py-4">
                  Aucune couleur ne correspond.
                </p>
              )}
            </div>
          </div>

          {/* Carburants */}
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-2">
              <p className="text-xs text-dark-400">Carburants d&apos;enclos en réserve</p>
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
                />
                <input
                  type="text"
                  value={fuelQuery}
                  onChange={(event) => setFuelQuery(event.target.value)}
                  placeholder="Filtrer par jauge ou par carburant"
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-dark-800/80 border
                    border-dark-600/50 text-dark-100 text-xs placeholder:text-dark-500
                    transition-all hover:border-dark-500 focus:border-kamas/50"
                />
              </div>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {fuelsByGauge.map(([gauge, fuels]) => (
                <div key={gauge}>
                  <p className="text-[11px] text-dark-500 mb-1">
                    {gauge}
                    {(ownedGaugePoints.get(gauge) ?? 0) > 0 && (
                      <span className="text-dark-400">
                        {' '}
                        · {Math.round(ownedGaugePoints.get(gauge)!).toLocaleString('fr-FR')} points
                        en réserve
                      </span>
                    )}
                  </p>
                  <div className="space-y-1">
                    {fuels.map(({ item, recharge }) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-3 py-1.5 rounded-xl hover:bg-dark-800/40"
                      >
                        <span className="text-xs text-dark-200 flex-1 truncate">
                          {item.name?.fr ?? item.id}
                        </span>
                        <span className="text-[10px] text-dark-500 shrink-0">
                          {recharge.toLocaleString('fr-FR')} pts / unité
                        </span>
                        {countInput(itemStock.get(item.id) ?? 0, (next) =>
                          onSaveItem(item.id, next)
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {fuelsByGauge.length === 0 && (
                <p className="text-xs text-dark-500 text-center py-4">
                  Aucun carburant ne correspond.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BreedingStocks;
