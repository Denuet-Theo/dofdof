'use client';

import { useCallback, useMemo, useState } from 'react';
import { Boxes, Check, Coins, Plus, Search, Trash2, Warehouse } from 'lucide-react';
import Button from '@/components/ui/Button';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import BreedingAddMount from '@/components/breeding/BreedingAddMount';
import { parseGaugeInfo } from '@/lib/utils/gauges';
import {
  MOUNT_STATUS_LABEL,
  mountStatus,
  statusFlags,
  type BulkStock,
  type Individual,
  type MountStatus,
  type Sex,
} from '@/lib/dofus/breeding/stable';
import { lineageDistribution, lineagePurity } from '@/lib/dofus/breeding/lineage';
import {
  ANONYMOUS_NAME,
  carriedGeneration,
  colorCoder,
  mountName,
} from '@/lib/dofus/breeding/naming';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import type { DofusDBItem } from '@/lib/supabase/types';
import type { DEFAULT_SETTINGS } from '@/lib/hooks/useBreeding';

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
 *
 * ## L'écurie ne se saisit plus par la liste des couleurs
 *
 * Cet écran affichait les 120 couleurs de la famille, chacune avec ses deux
 * compteurs ou ses boutons `+♂` / `+♀`. C'était une liste pour **corriger un
 * chiffre**, pas pour charger une écurie : ni niveau, ni état, ni ascendance à
 * l'ajout, et rien qui dise laquelle des trois Amande on vient d'incrémenter.
 *
 * Elle ne montre donc plus que ce qu'on **possède**, et l'ajout passe par
 * `BreedingAddMount`, qui demande dans l'ordre ce que porte la fiche du jeu.
 */

type Settings = typeof DEFAULT_SETTINGS;

type Props = {
  /** Les couleurs de la famille : générations, noms d'affichage et icônes. */
  colors: BreedingColor[];
  fuelItems: DofusDBItem[];
  /** Les montures suivies une par une — depuis l'assistant, toutes le sont. */
  individuals: Individual[];
  /**
   * Le vrac hérité : les effectifs saisis au compteur avant l'assistant.
   *
   * Ils ne s'ajoutent plus, mais ils comptent encore dans tous les plans. Les
   * masquer les rendrait invisibles **et** indécrémentables, donc ils restent
   * affichés — le temps qu'on les remplace par des montures nommées.
   */
  bulk: Map<string, BulkStock>;
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
    parents?: [string, string] | null;
    status?: MountStatus;
  }) => Promise<Individual | null>;
  onUpdateIndividual: (
    id: string,
    patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'pregnant' | 'name'>>
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

/** Ce que chaque état interdit — la même phrase qu'à la saisie, en infobulle. */
const STATUS_HINT: Record<MountStatus, string> = {
  fertile: 'Disponible : elle peut être chargée dans une fournée.',
  feconde: 'Accouplée, elle porte. Indisponible, mais un poulain arrive — et elle ne se clone pas.',
  sterile: 'Épuisée : il ne lui reste que le clonage et l’extraction.',
};

const STATUS_TONE: Record<MountStatus, string> = {
  fertile: 'bg-profit/15 border-profit/40 text-profit',
  feconde: 'bg-kamas/15 border-kamas/40 text-kamas',
  sterile: 'bg-dark-700/60 border-dark-600/50 text-dark-300',
};

const BreedingStocks = ({
  colors,
  fuelItems,
  individuals,
  bulk,
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
  const [adding, setAdding] = useState(false);
  const [mountQuery, setMountQuery] = useState('');
  const [fuelQuery, setFuelQuery] = useState('');
  const [budget, setBudget] = useState(String(settings.kamas_available));
  const [enclos, setEnclos] = useState(String(settings.enclos_count));
  const [savedBudget, setSavedBudget] = useState(false);

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  /** Les ascendances ne portent que des identifiants ; le catalogue a les noms. */
  const nameOf = useCallback(
    (colorId: string) => byId.get(colorId)?.name ?? colorId,
    [byId]
  );
  const generationOfColor = useCallback(
    (colorId: string) => byId.get(colorId)?.generation ?? 1,
    [byId]
  );
  const iconOf = (colorId: string) => {
    const color = byId.get(colorId);
    return color ? colorIconUrl(color) : null;
  };

  /**
   * Le codeur de la famille, construit sur le catalogue : il porte toutes les
   * couleurs, ce dont `colorCoder` a besoin pour garantir qu'aucun code n'en
   * désigne deux.
   */
  const code = useMemo(() => colorCoder(colors), [colors]);
  const codeOf = (colorId: string) => code(nameOf(colorId));

  /**
   * À quel point la lignée d'une monture est concentrée sur une seule couleur.
   *
   * `null` quand une génération manque au catalogue — mieux vaut ne rien dire
   * qu'afficher un chiffre bâti sur une ascendance à moitié connue.
   */
  const purityOf = (mount: Individual): number | null =>
    mount.parents ? lineagePurity(lineageDistribution(mount.colorId, mount.parents)) : null;

  /**
   * Le nom que cette monture devrait porter en jeu, d'après sa généalogie.
   *
   * Les montures saisies avant que l'outil dicte les noms n'en ont aucun ; c'est
   * ce calcul qui permet de les rattraper une par une, au rythme où on y passe.
   */
  const nameForIndividual = (mount: Individual): string | null =>
    mount.parents
      ? mountName({
          carriedGeneration: carriedGeneration(generationOfColor(mount.colorId), [
            generationOfColor(mount.parents[0]),
            generationOfColor(mount.parents[1]),
          ]),
          colorName: nameOf(mount.colorId),
          sex: mount.sex,
          parentNames: [nameOf(mount.parents[0]), nameOf(mount.parents[1])],
          code,
        })
      : null;

  /**
   * L'écurie affichée : les fertiles devant, puis par couleur et par niveau.
   *
   * Les fertiles remontent parce que ce sont les seules qui décident de quelque
   * chose — les autres attendent une naissance ou un clonage.
   */
  const owned = useMemo(() => {
    const needle = mountQuery.trim().toLowerCase();
    return individuals
      .filter((mount) => {
        if (!needle) return true;
        return (
          nameOf(mount.colorId).toLowerCase().includes(needle) ||
          (mount.name ?? '').toLowerCase().includes(needle)
        );
      })
      .sort(
        (a, b) =>
          Number(b.fertile) - Number(a.fertile) ||
          generationOfColor(b.colorId) - generationOfColor(a.colorId) ||
          nameOf(a.colorId).localeCompare(nameOf(b.colorId)) ||
          a.level - b.level ||
          a.id.localeCompare(b.id)
      );
  }, [individuals, mountQuery, nameOf, generationOfColor]);

  /** Le vrac restant, couleurs vides exclues. */
  const legacyBulk = useMemo(
    () =>
      [...bulk]
        .filter(([, counts]) => counts.males > 0 || counts.females > 0)
        .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b))),
    [bulk, nameOf]
  );

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

  const ownedBulk = [...bulk.values()].reduce(
    (total, { males, females }) => total + males + females,
    0
  );
  const ownedMounts = individuals.length + ownedBulk;
  const ownedFuels = [...itemStock.values()].reduce((total, quantity) => total + quantity, 0);

  return (
    <div className="glass rounded-2xl">
      <button
        type="button"
        onClick={() =>
          setOpen((value) => {
            // Les brouillons se calent sur les réglages **à l'ouverture** plutôt
            // que par un effet : les réglages arrivent du réseau après le
            // premier rendu, et les recopier à chaque changement écraserait une
            // saisie en cours.
            if (!value) {
              setBudget(String(settings.kamas_available));
              setEnclos(String(settings.enclos_count));
            }
            return !value;
          })
        }
        className="w-full flex items-center gap-2 px-5 py-4 cursor-pointer text-left"
      >
        <Boxes size={16} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Mes stocks</span>
        <span className="text-xs text-dark-500 ml-2 truncate">
          {ownedMounts} monture{ownedMounts > 1 ? 's' : ''} · {ownedFuels} carburant
          {ownedFuels > 1 ? 's' : ''} · {settings.enclos_count} enclos ·{' '}
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
          {/* Le parc et la caisse : les deux seules choses qu'on possède sans
              qu'elles soient une monture ou un carburant, et les deux qui
              bornent ce qu'un plan peut proposer. Le panneau « Mon élevage » qui
              les portait avec cinq autres réglages a disparu : ce que le modèle
              décide maintenant, il ne sert plus à rien de le paramétrer. */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="flex items-center gap-2 text-xs text-dark-400 mb-1.5">
                <Warehouse size={13} className="text-kamas" />
                Enclos possédés
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={enclos}
                onChange={(event) => setEnclos(event.target.value)}
                className="w-28 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                  text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
              />
              <p className="text-[10px] text-dark-600 mt-1">10 places, 2 jauges chacun</p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs text-dark-400 mb-1.5">
                <Coins size={13} className="text-kamas" />
                Kamas engageables
              </label>
              <input
                type="number"
                min={0}
                step={100_000}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                className="w-48 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                  text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
              />
              <p className="text-[10px] text-dark-600 mt-1">
                À 0, aucune contrainte n&apos;est appliquée.
              </p>
            </div>

            <div className="flex items-center gap-3 pb-6">
              <Button
                size="sm"
                onClick={async () => {
                  // Les deux partent ensemble : ils vivent dans la même ligne de
                  // réglages, et deux boutons côte à côte laisseraient croire
                  // qu'oublier l'un annule l'autre.
                  const saved = await onSaveSettings({
                    ...settings,
                    kamas_available: Math.max(0, Number(budget) || 0),
                    enclos_count: Math.max(0, Math.min(20, Number(enclos) || 0)),
                  });
                  if (saved) {
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
          </div>
          <p className="text-[10px] text-dark-600 -mt-4">
            Les plans qui dépassent le budget sont signalés, avec l&apos;étape où l&apos;argent
            manque. Le nombre d&apos;enclos traduit les heures d&apos;enclos d&apos;un plan en
            délai réel — c&apos;est lui qui décide de la largeur d&apos;une fournée.
          </p>

          {/* Montures */}
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <p className="text-xs text-dark-400">Mon écurie</p>
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
                />
                <input
                  type="text"
                  value={mountQuery}
                  onChange={(event) => setMountQuery(event.target.value)}
                  placeholder="Filtrer par couleur ou par nom en jeu"
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-dark-800/80 border
                    border-dark-600/50 text-dark-100 text-xs placeholder:text-dark-500
                    transition-all hover:border-dark-500 focus:border-kamas/50"
                />
              </div>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={13} />
                Ajouter une monture
              </Button>
            </div>
            <p className="text-[10px] text-dark-600 mb-2">
              Seules les <strong>fertiles</strong> entrent dans les fournées. Une féconde porte
              — elle revient quand la naissance est saisie ; une stérile ne vaut plus que par le
              clonage.
            </p>

            <div className="space-y-1 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
              {owned.map((mount) => {
                const status = mountStatus(mount);
                const carried = mount.parents ? nameForIndividual(mount) : null;
                const current = mount.name ?? ANONYMOUS_NAME;
                const purity = purityOf(mount);

                return (
                  <div
                    key={mount.id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
                      bg-dark-800/40 hover:bg-dark-800/60 transition-colors"
                  >
                    <ColorChip
                      name={nameOf(mount.colorId)}
                      code={codeOf(mount.colorId)}
                      icon={iconOf(mount.colorId)}
                      size="sm"
                    />
                    <span className="text-xs text-dark-200 truncate max-w-[9rem]">
                      {nameOf(mount.colorId)}
                    </span>
                    <GenBadge generation={generationOfColor(mount.colorId)} />
                    <span
                      className={`text-xs ${mount.sex === 'M' ? 'text-info' : 'text-loss-light'}`}
                      title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
                    >
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
                            level: Math.max(1, Math.min(200, Number(event.target.value) || 1)),
                          })
                        }
                        className="w-14 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                          border-dark-600/50 text-dark-100 text-[11px] text-right
                          transition-all hover:border-dark-500 focus:border-kamas/50"
                      />
                    </label>

                    {/* Trois états, et non plus une case « fertile » : cocher ou
                        décocher ne pouvait pas dire qu'une monture porte, or
                        c'est exactement ce qui interdit de la cloner. */}
                    <span className="flex items-center gap-1">
                      {(['fertile', 'feconde', 'sterile'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onUpdateIndividual(mount.id, statusFlags(value))}
                          title={STATUS_HINT[value]}
                          className={`px-1.5 py-0.5 rounded-lg border text-[10px] transition-all
                            cursor-pointer ${
                              status === value
                                ? STATUS_TONE[value]
                                : 'bg-dark-800/60 border-dark-700/50 text-dark-500 hover:text-dark-300'
                            }`}
                        >
                          {MOUNT_STATUS_LABEL[value]}
                        </button>
                      ))}
                    </span>

                    {/* Le nom porté en jeu, et le nom attendu quand ils
                        divergent. C'est la seule chose qui permette de retrouver
                        cette monture-là dans une écurie où tout s'appelle
                        « Anonyme » — donc un écart se signale, et se corrige
                        d'un clic. */}
                    <code
                      className={`text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 shrink-0 ${
                        current === ANONYMOUS_NAME ? 'text-dark-500' : 'text-kamas'
                      }`}
                      title="Le nom que porte cette monture dans le jeu."
                    >
                      {current}
                    </code>
                    {carried && carried !== current && (
                      <button
                        type="button"
                        onClick={() => onUpdateIndividual(mount.id, { name: carried })}
                        title={`Renomme-la « ${carried} » dans le jeu, puis clique ici pour le noter.`}
                        className="text-[10px] text-amber-400/80 hover:text-amber-300
                          transition-colors cursor-pointer shrink-0"
                      >
                        → {carried}
                      </button>
                    )}

                    {mount.parents && (
                      <>
                        <span
                          className="flex items-center gap-1 text-[10px] text-dark-600"
                          title={`Née de ${nameOf(mount.parents[0])} et ${nameOf(mount.parents[1])}`}
                        >
                          ←
                          {mount.parents.map((parentId, index) => (
                            <ColorChip
                              key={`${parentId}-${index}`}
                              name={nameOf(parentId)}
                              code={codeOf(parentId)}
                              icon={iconOf(parentId)}
                              size="sm"
                            />
                          ))}
                        </span>
                        {/* La concentration de la lignée décide de l'éventail
                            des couleurs que cette monture peut transmettre :
                            plus elle est haute, plus le résultat d'un croisement
                            est prévisible. */}
                        {purity !== null && (
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
                        )}
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
                );
              })}

              {owned.length === 0 && (
                <p className="text-xs text-dark-500 text-center py-6">
                  {individuals.length === 0
                    ? 'Aucune monture saisie — « Ajouter une monture » demande sa génération, sa couleur, son niveau et son ascendance.'
                    : 'Aucune monture ne correspond à ce filtre.'}
                </p>
              )}
            </div>

            {/* Le vrac hérité. Il ne s'ajoute plus, mais il compte encore dans
                tous les plans : le masquer le rendrait invisible et
                indécrémentable à la fois. */}
            {legacyBulk.length > 0 && (
              <div className="mt-3 pt-3 border-t border-dark-700/40 space-y-1">
                <p className="text-[11px] text-dark-400">
                  Vrac hérité — saisi au compteur avant l&apos;assistant
                </p>
                <p className="text-[10px] text-dark-600">
                  Ces effectifs comptent dans les plans mais n&apos;ont ni niveau ni ascendance :
                  une monture de vrac ne fait jamais viser plus haut que sa couleur. Remplace-les
                  par des montures nommées au fil de l&apos;eau, et ramène le compteur à zéro.
                </p>
                {legacyBulk.map(([colorId, counts]) => (
                  <div key={colorId} className="flex items-center gap-2 px-3 py-1.5">
                    <ColorChip
                      name={nameOf(colorId)}
                      code={codeOf(colorId)}
                      icon={iconOf(colorId)}
                      size="sm"
                    />
                    <span className="text-xs text-dark-300 flex-1 truncate">
                      {nameOf(colorId)}
                    </span>
                    <GenBadge generation={generationOfColor(colorId)} />
                    <span className="text-[10px] text-dark-500">♂</span>
                    {countInput(
                      counts.males,
                      (next) => onSaveBulk(colorId, next, counts.females),
                      9999,
                      `Mâles ${nameOf(colorId)} en vrac`
                    )}
                    <span className="text-[10px] text-dark-500">♀</span>
                    {countInput(
                      counts.females,
                      (next) => onSaveBulk(colorId, counts.males, next),
                      9999,
                      `Femelles ${nameOf(colorId)} en vrac`
                    )}
                  </div>
                ))}
              </div>
            )}
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

      <BreedingAddMount
        isOpen={adding}
        onClose={() => setAdding(false)}
        colors={colors}
        onAdd={onAddIndividual}
      />
    </div>
  );
};

export default BreedingStocks;
