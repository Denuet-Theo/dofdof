'use client';

import { useMemo, useState } from 'react';
import { Boxes, Check, Coins, Plus, Search, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { parseGaugeInfo } from '@/lib/utils/gauges';
import {
  INDIVIDUAL_TRACKING_FROM,
  type BulkStock,
  type Individual,
  type Sex,
} from '@/lib/dofus/breeding/stable';
import { lineageDistribution, lineagePurity } from '@/lib/dofus/breeding/lineage';
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
  /** Effectifs par couleur et par sexe, vrac et individus confondus. */
  stockBySex: Map<string, BulkStock>;
  /** Les montures de génération 3 et plus, suivies une par une. */
  individuals: Individual[];
  itemStock: Map<number, number>;
  /** Prix unitaire des carburants, pour les afficher et les comparer au point. */
  itemPrices: Map<number, number>;
  onSaveFuelPrice: (itemId: number, itemName: string, price: number) => Promise<void>;
  ownedGaugePoints: Map<string, number>;
  settings: Settings;
  onSaveBulk: (colorId: string, males: number, females: number) => Promise<void>;
  onAddIndividual: (mount: {
    colorId: string;
    sex: Sex;
    level?: number;
  }) => Promise<Individual | null>;
  onUpdateIndividual: (
    id: string,
    patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile'>>
  ) => Promise<void>;
  onRemoveIndividual: (id: string) => Promise<void>;
  onSaveItem: (itemId: number, quantity: number) => Promise<void>;
  onSaveSettings: (next: Settings) => Promise<boolean>;
};

const countInput = (
  value: number,
  onChange: (next: number) => void,
  max = 9999,
  title?: string
) => (
  <input
    type="number"
    min={0}
    max={max}
    title={title}
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
  stockBySex,
  individuals,
  itemStock,
  itemPrices,
  onSaveFuelPrice,
  ownedGaugePoints,
  settings,
  onSaveBulk,
  onAddIndividual,
  onUpdateIndividual,
  onRemoveIndividual,
  onSaveItem,
  onSaveSettings,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [mountQuery, setMountQuery] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [fuelQuery, setFuelQuery] = useState('');
  const [budget, setBudget] = useState(String(settings.kamas_available));
  const [savedBudget, setSavedBudget] = useState(false);

  /** Les ascendances ne portent que des identifiants ; les lignes ont les noms. */
  const nameOf = useMemo(() => {
    const names = new Map(rows.map((row) => [row.colorId, row.name]));
    return (colorId: string) => names.get(colorId) ?? colorId;
  }, [rows]);

  const mounts = useMemo(() => {
    const needle = mountQuery.trim().toLowerCase();
    const total = (colorId: string) => {
      const counts = stockBySex.get(colorId);
      return (counts?.males ?? 0) + (counts?.females ?? 0);
    };
    return rows
      .filter((row) => {
        if (ownedOnly && !total(row.colorId)) return false;
        return !needle || row.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        // Ce qu'on possède remonte : c'est ce qu'on vient corriger.
        const owned = total(b.colorId) - total(a.colorId);
        return owned || a.generation - b.generation || a.name.localeCompare(b.name);
      });
  }, [rows, mountQuery, ownedOnly, stockBySex]);

  /**
   * À quel point la lignée d'une monture est concentrée sur une seule couleur.
   *
   * `null` quand une génération manque au catalogue — mieux vaut ne rien dire
   * qu'afficher un chiffre bâti sur une ascendance à moitié connue.
   */
  const purityOf = (mount: Individual): number | null =>
    mount.parents ? lineagePurity(lineageDistribution(mount.colorId, mount.parents)) : null;

  /** Les individus d'une couleur, les fertiles devant puis par niveau. */
  const individualsOf = useMemo(() => {
    const byColor = new Map<string, Individual[]>();
    for (const mount of individuals) {
      const group = byColor.get(mount.colorId) ?? [];
      group.push(mount);
      byColor.set(mount.colorId, group);
    }
    for (const group of byColor.values()) {
      group.sort(
        (a, b) => Number(b.fertile) - Number(a.fertile) || a.level - b.level || a.id.localeCompare(b.id)
      );
    }
    return byColor;
  }, [individuals]);

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

  /**
   * Le meilleur prix au point de chaque jauge, pour signaler le carburant que
   * l'arbitrage retiendra à temps non valorisé.
   */
  const bestPerPoint = useMemo(() => {
    const best = new Map<string, number>();
    for (const [gauge, fuels] of fuelsByGauge) {
      for (const { item, recharge } of fuels) {
        const price = itemPrices.get(item.id) ?? 0;
        if (price <= 0 || recharge <= 0) continue;
        const perPoint = price / recharge;
        const current = best.get(gauge);
        if (current === undefined || perPoint < current) best.set(gauge, perPoint);
      }
    }
    return best;
  }, [fuelsByGauge, itemPrices]);

  const ownedMounts = [...stockBySex.values()].reduce(
    (total, { males, females }) => total + males + females,
    0
  );
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
              {mounts.map((row) => {
                const counts = stockBySex.get(row.colorId) ?? { males: 0, females: 0 };
                const owned = individualsOf.get(row.colorId) ?? [];
                // Le compteur cède la place au suivi individuel dès la
                // génération 3. En deçà, il reste — une gen 1 ou 2 s'achète en
                // volume — mais la liste des individus s'affiche quand même :
                // une basse génération née d'un croisement haut est suivie une
                // par une, parce que son ascendance relève la cible de ses
                // propres accouplements. Voir `tracksIndividually`.
                const tracked = row.generation >= INDIVIDUAL_TRACKING_FROM;

                return (
                  <div key={row.colorId} className="px-3 py-1.5 rounded-xl hover:bg-dark-800/40">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-dark-200 flex-1 truncate">{row.name}</span>
                      <span className="text-[10px] text-dark-500 shrink-0">
                        gen {row.generation}
                      </span>

                      {tracked ? (
                        // Rien à compter : on ajoute des montures une par une, et
                        // le sexe se choisit à l'ajout puisqu'il ne se corrige
                        // presque jamais.
                        <span className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-dark-500 tabular-nums mr-1">
                            {counts.males}♂ {counts.females}♀
                          </span>
                          {(['M', 'F'] as const).map((sex) => (
                            <button
                              key={sex}
                              type="button"
                              onClick={() => onAddIndividual({ colorId: row.colorId, sex })}
                              title={`Ajouter ${sex === 'M' ? 'un mâle' : 'une femelle'} ${row.name}`}
                              className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg
                                bg-dark-800/80 border border-dark-600/50 text-[10px] text-dark-300
                                transition-all hover:border-dark-500 hover:text-dark-100
                                cursor-pointer"
                            >
                              <Plus size={10} />
                              {sex === 'M' ? '♂' : '♀'}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-dark-500">♂</span>
                          {countInput(
                            counts.males,
                            (next) => onSaveBulk(row.colorId, next, counts.females),
                            9999,
                            `Mâles ${row.name} fertiles en écurie`
                          )}
                          <span className="text-[10px] text-dark-500">♀</span>
                          {countInput(
                            counts.females,
                            (next) => onSaveBulk(row.colorId, counts.males, next),
                            9999,
                            `Femelles ${row.name} fertiles en écurie`
                          )}
                        </span>
                      )}
                    </div>

                    {/* Le détail des individus : leur niveau décide du taux de
                        réussite de leurs accouplements, et leur fertilité de leur
                        disponibilité tout court. */}
                    {owned.length > 0 && (
                      <div className="mt-1.5 ml-3 pl-3 border-l border-dark-700/40 space-y-1">
                        {owned.map((mount) => (
                          <div key={mount.id} className="flex items-center gap-2">
                            <span className="text-[11px] text-dark-400 w-4 shrink-0">
                              {mount.sex === 'M' ? '♂' : '♀'}
                            </span>
                            <label className="flex items-center gap-1 text-[10px] text-dark-500">
                              niv
                              <input
                                type="number"
                                min={1}
                                max={200}
                                value={String(mount.level)}
                                onChange={(event) =>
                                  onUpdateIndividual(mount.id, {
                                    level: Math.max(
                                      1,
                                      Math.min(200, Number(event.target.value) || 1)
                                    ),
                                  })
                                }
                                className="w-14 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                                  border-dark-600/50 text-dark-100 text-[11px] text-right
                                  transition-all hover:border-dark-500 focus:border-kamas/50"
                              />
                            </label>
                            <label className="flex items-center gap-1 text-[10px] text-dark-500 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={mount.fertile}
                                onChange={(event) =>
                                  onUpdateIndividual(mount.id, { fertile: event.target.checked })
                                }
                                className="accent-kamas cursor-pointer"
                              />
                              fertile
                            </label>
                            {mount.parents && (
                              <>
                                <span
                                  className="text-[10px] text-dark-600 truncate"
                                  title={`Née de ${nameOf(mount.parents[0])} et ${nameOf(mount.parents[1])}`}
                                >
                                  ← {mount.parents.map((id) => nameOf(id)).join(' × ')}
                                </span>
                                {/* La concentration de la lignée décide de
                                    l'éventail des couleurs que cette monture
                                    peut transmettre : plus elle est haute, plus
                                    le résultat d'un croisement est prévisible. */}
                                {(() => {
                                  const purity = purityOf(mount);
                                  if (purity === null) return null;
                                  return (
                                    <span
                                      className={`text-[10px] shrink-0 ${
                                        purity >= 0.99
                                          ? 'text-profit'
                                          : purity >= 0.75
                                            ? 'text-dark-400'
                                            : 'text-amber-400/70'
                                      }`}
                                      title={`Lignée concentrée à ${(purity * 100).toFixed(0)} % sur une seule couleur. Croiser cette couleur avec elle-même monte ce chiffre, et rend le résultat des croisements suivants plus sûr.`}
                                    >
                                      lignée {(purity * 100).toFixed(0)}%
                                    </span>
                                  );
                                })()}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => onRemoveIndividual(mount.id)}
                              title="Retirer de l'écurie"
                              className="ml-auto text-dark-600 hover:text-loss transition-colors
                                cursor-pointer shrink-0"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
                    {fuels.map(({ item, recharge }) => {
                      const name = item.name?.fr ?? String(item.id);
                      const price = itemPrices.get(item.id) ?? 0;
                      // Le prix au point est la seule mesure qui compare deux
                      // paliers : un Élixir verse huit fois plus qu'un Extrait,
                      // donc leurs prix bruts ne se comparent pas.
                      const perPoint = price > 0 && recharge > 0 ? price / recharge : null;
                      const cheapest = perPoint !== null && perPoint === bestPerPoint.get(gauge);

                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-3 py-1.5 rounded-xl hover:bg-dark-800/40"
                        >
                          <span className="text-xs text-dark-200 flex-1 truncate">{name}</span>
                          <span className="text-[10px] text-dark-500 shrink-0">
                            {recharge.toLocaleString('fr-FR')} pts / unité
                          </span>
                          <span
                            className={`text-[10px] shrink-0 w-24 text-right tabular-nums ${
                              cheapest ? 'text-profit' : 'text-dark-500'
                            }`}
                            title={
                              perPoint === null
                                ? 'Sans prix, ce carburant est écarté de tous les arbitrages — il n’est pas réputé gratuit, il est réputé indisponible.'
                                : `${perPoint.toFixed(3)} kamas par point${cheapest ? ' — le moins cher de cette jauge' : ''}`
                            }
                          >
                            {perPoint === null ? 'sans prix' : `${perPoint.toFixed(2)} k/pt`}
                          </span>
                          <label className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-dark-500">prix</span>
                            {countInput(
                              price,
                              (next) => onSaveFuelPrice(item.id, name, next),
                              99_999_999,
                              `Prix d'achat d'une unité de ${name}`
                            )}
                          </label>
                          <label className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-dark-500">j&apos;en ai</span>
                            {countInput(
                              itemStock.get(item.id) ?? 0,
                              (next) => onSaveItem(item.id, next),
                              9999,
                              `Unités de ${name} en réserve`
                            )}
                          </label>
                        </div>
                      );
                    })}
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
