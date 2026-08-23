'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Boxes, Check, Coins, Gauge, Plus, Search, Trash2, Upload, Warehouse } from 'lucide-react';
import Button from '@/components/ui/Button';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import BreedingAddMount from '@/components/breeding/BreedingAddMount';
import BreedingImportMounts from '@/components/breeding/BreedingImportMounts';
import CopyableIcon from '@/components/ui/CopyableIcon';
import { parseGaugeInfo, type GaugeInfo } from '@/lib/utils/gauges';
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
import type { DriftSignal } from '@/lib/dofus/breeding/drift';
import {
  ANONYMOUS_NAME,
  borneName,
  colorCoder,
  dictatedNameFor,
} from '@/lib/dofus/breeding/naming';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { GAUGE_BANDS, transferRatePerSecond } from '@/lib/dofus/breeding/enclos';
import type { DofusDBItem } from '@/lib/supabase/types';
import type {
  AddResult,
  BreedingRow,
  DEFAULT_SETTINGS,
  FuelPriceResult,
  WriteResult,
} from '@/lib/hooks/useBreeding';
import PriceEntry from '@/components/breeding/PriceEntry';
import useCensusBar from '@/components/breeding/useCensusBar';
import BreedingDriftSignals from '@/components/breeding/BreedingDriftSignals';
import BreedingStockFilters from '@/components/breeding/BreedingStockFilters';
import {
  matches,
  NO_FILTERS,
  rosterOf,
  type RosterFilters,
} from '@/lib/dofus/breeding/roster';

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
  /** Le nom de la famille, pour la ligne « Type » des filtres du jeu. */
  familyLabel: string;
  itemStock: Map<number, number>;
  /** Prix unitaire des carburants, pour les afficher et les comparer au point. */
  itemPrices: Map<number, number>;
  onSaveFuelPrice: (itemId: number, itemName: string, price: number) => Promise<FuelPriceResult>;
  ownedGaugePoints: Map<string, number>;
  settings: Settings;
  onSaveBulk: (colorId: string, males: number, females: number) => Promise<void>;
  onAddIndividual: (mount: {
    colorId: string;
    sex: Sex;
    level?: number;
    parents?: [string, string] | null;
    status?: MountStatus;
  }) => Promise<AddResult>;
  /**
   * Corrige un lot de montures d'un coup.
   *
   * Absente, la sélection ne s'affiche pas : l'écran reste celui d'avant. C'est
   * ce qui permet de tester la liste sans monter tout le parcours.
   */
  onUpdateIndividuals?: (
    ids: string[],
    patch: { level?: number; fertile?: boolean; cycled?: boolean }
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onUpdateIndividual: (
    id: string,
    patch: Partial<Pick<Individual, 'sex' | 'level' | 'fertile' | 'cycled' | 'name'>>
  ) => Promise<WriteResult>;
  onRemoveIndividual: (id: string) => Promise<void>;
  /** Retire un lot en une écriture — le purge des anonymes stériles s'en sert. */
  onRemoveIndividuals?: (ids: string[]) => Promise<void>;
  onSaveItem: (itemId: number, quantity: number) => Promise<void>;
  onSaveSettings: (next: Settings) => Promise<boolean>;
  /**
   * Les lignes de couleurs, pour la saisie des prix.
   *
   * Elles vivaient sous « Couleur visée », qui a été masqué — et avec lui le seul
   * chemin vers `PriceEntry`. Or sans prix de couleurs `computeBreedingCosts` n'a
   * rien à calculer et tout l'écran s'éteint : les prix déjà en base continuaient
   * de servir, mais aucun ne pouvait plus être corrigé. Voir #102.
   *
   * Ici plutôt qu'ailleurs parce que c'est déjà le toit des prix de carburants, et
   * qu'on y vient justement quand on veut corriger un chiffre.
   */
  rows: BreedingRow[];
  onSavePrice: (colorId: string, mountLevel: 0 | 200, price: number) => Promise<boolean>;
  /**
   * Combien d'exemplaires de la couleur visée on veut.
   *
   * Il dimensionne le plan et les fournées — à trente exemplaires les fournées se
   * remplissent et le coût par monture s'effondre — donc il n'a rien d'un détail
   * d'affichage. Il descendait aussi de « Couleur visée ».
   */
  targetCount: number;
  onSetTargetCount: (count: number) => void;
  /**
   * La gen 10 poursuivie, et de quoi en changer.
   *
   * `null` veut dire « laisse le marché décider » : la couronne se choisit alors
   * sur la valeur, et comme un marché sans prix de gen 10 les rend toutes égales,
   * c'est le partenaire qui tranche. Voir `crownedLadderOf`.
   *
   * Les candidates sont les gen 10 **couronnables** — celles dont la recette marie
   * une gen 9 à une gen 1 rattachée à un bloc. Les autres seraient ignorées.
   */
  targetColorId: string | null;
  crownable: BreedingColor[];
  onSelectTarget: (colorId: string | null) => void;
  /**
   * Combien de fournées au minimum avant d'espérer tenir la monture.
   *
   * En **espérance** : le découpage suppose les taux de réussite annoncés et les
   * sexes moitié-moitié, ce qui est tout ce qu'on sache avant le tirage. C'est
   * donc un plancher, pas une promesse.
   *
   * Il tient compte de ce que l'écurie porte déjà et du parc dont on dispose, et
   * il ne se comprime pas en dessous du nombre de barreaux : on ne peut pas
   * accoupler une génération avant que la précédente soit née.
   *
   * `null` quand la couleur visée ne s'élève pas — il vaut alors mieux l'acheter,
   * et il n'y a pas de fournée à compter.
   */
  minBatches: number | null;
  /**
   * Les occasions hors recette que l'écurie porte. Voir `drift.ts`.
   *
   * Ici parce que ça se lit sur l'écurie **seule** : pas sur un plan, pas sur un
   * marché. C'est en regardant ses montures qu'on se demande laquelle vaut plus
   * qu'elle n'en a l'air.
   */
  drift: DriftSignal[];
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

/** Un bouton de filtre : sélectionné ou non, et rien d'autre à dire. */
const chip = (label: string, active: boolean, onClick: () => void, title?: string) => (
  <button
    key={label}
    type="button"
    onClick={onClick}
    title={title}
    className={`px-2 py-0.5 rounded-lg border text-[10px] transition-all cursor-pointer ${
      active
        ? 'bg-kamas/15 border-kamas/40 text-kamas'
        : 'bg-dark-800/60 border-dark-700/50 text-dark-400 hover:border-dark-500'
    }`}
  >
    {label}
  </button>
);

/** Ce que chaque état interdit — la même phrase qu'à la saisie, en infobulle. */
const STATUS_HINT: Record<MountStatus, string> = {
  fertile: 'Disponible, mais son cycle de jauges reste à faire avant de l’accoupler.',
  feconde: 'Prête : son cycle est fait, elle s’accouple telle quelle.',
  sterile: 'Épuisée : il ne lui reste que le clonage et l’extraction.',
};

/**
 * Le rang d'un carburant : Extrait, Philtre, Potion, Élixir.
 *
 * Il ne se lit pas sur le nom, qui varie d'une jauge à l'autre, mais sur le
 * **plafond** que la description annonce — « sans dépasser 70 000 ». C'est le
 * même chiffre qui décide du débit de transfert (voir `TRANSFER_TIERS`), donc le
 * rang n'est pas une étiquette : c'est ce qui dit à quelle vitesse la jauge
 * montera, et pourquoi le point coûte plus cher en haut.
 *
 * L'Élixir se reconnaît à l'absence de clause : il n'a pas de plafond, donc
 * `parseGaugeInfo` recopie la recharge dans `capAmount`. On teste ce cas
 * d'abord — un plafond égal à la recharge ne peut pas être un vrai plafond.
 */
type FuelRank = 'extrait' | 'philtre' | 'potion' | 'elixir';

const FUEL_RANKS: { id: FuelRank; label: string; hint: string }[] = [
  { id: 'extrait', label: 'Extrait', hint: 'jusqu’à 40 000 — 1 pt/s' },
  { id: 'philtre', label: 'Philtre', hint: 'jusqu’à 70 000 — 2 pt/s' },
  { id: 'potion', label: 'Potion', hint: 'jusqu’à 90 000 — 3 pt/s' },
  { id: 'elixir', label: 'Élixir', hint: 'sans plafond — 4 pt/s' },
];

const RANK_OF_CAP = new Map<number, FuelRank>([
  [40_000, 'extrait'],
  [70_000, 'philtre'],
  [90_000, 'potion'],
]);

const fuelRank = (info: GaugeInfo): FuelRank =>
  info.capAmount === info.rechargeAmount
    ? 'elixir'
    : (RANK_OF_CAP.get(info.capAmount) ?? 'elixir');

/**
 * Le jaune dit « c'est celui-ci », pour les trois états sans distinction.
 *
 * Le bouton doit **d'abord** se lire comme choisi, et seulement ensuite dire
 * lequel : le libellé le dit déjà, et on lit cette liste en diagonale sur
 * cinquante lignes. Teinter chaque état de sa propre couleur revenait à faire
 * porter deux messages à un seul repère — et la stérile y perdait le premier,
 * son gris tombant à un cran du non-sélectionné (`dark-700/dark-600` contre
 * `dark-800/dark-700`) : assez pour un écart de teinte, pas pour un état. Une
 * écurie entière de stériles se lisait donc comme une écurie sans état du tout.
 */
const STATUS_TONE = 'bg-kamas/15 border-kamas/40 text-kamas';

const BreedingStocks = ({
  colors,
  fuelItems,
  individuals,
  bulk,
  familyLabel,
  itemStock,
  itemPrices,
  onSaveFuelPrice,
  ownedGaugePoints,
  settings,
  onSaveBulk,
  onAddIndividual,
  onUpdateIndividual,
  onUpdateIndividuals,
  onRemoveIndividual,
  onRemoveIndividuals,
  onSaveItem,
  onSaveSettings,
  rows,
  onSavePrice,
  targetCount,
  onSetTargetCount,
  targetColorId,
  crownable,
  onSelectTarget,
  minBatches,
  drift,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  /**
   * Les filtres de l'écurie, calqués sur ceux du jeu.
   *
   * La recherche par nom y est entrée avec le reste : elle était déjà là, et deux
   * champs de recherche sur le même écran auraient laissé se contredire ce que la
   * liste montre et ce que les compteurs annoncent.
   */
  const [filters, setFilters] = useState<RosterFilters>(NO_FILTERS);
  const [fuelQuery, setFuelQuery] = useState('');
  /** La saisie en masse des prix de couleurs, repliée : cent vingt lignes. */
  const [pricesOpen, setPricesOpen] = useState(false);
  const [fuelError, setFuelError] = useState('');
  /** Les deux axes sur lesquels on cherche un carburant : sa jauge et son rang. */
  const [gaugeFilter, setGaugeFilter] = useState<string | null>(null);
  const [rankFilter, setRankFilter] = useState<FuelRank | null>(null);
  const [budget, setBudget] = useState(String(settings.kamas_available));
  const [enclos, setEnclos] = useState(String(settings.enclos_count));
  /**
   * La bande de jauge tenue, en brouillon.
   *
   * Une chaîne et non un nombre, parce que `''` porte l'option « le moins cher »
   * — le `null` de la colonne — et qu'un `<select>` ne sait transporter que du
   * texte. La conversion se fait à l'enregistrement, une fois.
   */
  const [band, setBand] = useState(settings.gauge_cap === null ? '' : String(settings.gauge_cap));
  const [netCost, setNetCost] = useState(settings.count_net_cost);
  const [savedBudget, setSavedBudget] = useState(false);

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  /** Ce dont les poids de lignée ont besoin : la génération dit si une case est composée. */
  const generations = useMemo(
    () => new Map(colors.map((color) => [color.id, color.generation])),
    [colors]
  );
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
    mount.parents
      ? lineagePurity(lineageDistribution(mount.colorId, mount.parents, generations))
      : null;

  /**
   * Le nom que cette monture devrait porter en jeu, d'après sa généalogie.
   *
   * Les montures saisies avant que l'outil dicte les noms n'en ont aucun ; c'est
   * ce calcul qui permet de les rattraper une par une, au rythme où on y passe.
   *
   * Il vit dans `naming.ts` et non ici : c'est l'inverse exact de `mountName`, et
   * le garder en fermeture locale le mettait hors de portée de tout autre
   * lecteur — le nom dérivant de la couleur, du sexe et de l'ascendance, l'écart
   * entre le nom porté et le nom dû est une preuve locale qui a vocation à
   * servir ailleurs.
   */
  const nameForIndividual = (mount: Individual): string | null =>
    dictatedNameFor(mount, colors);

  /**
   * L'écurie sous la forme que le jeu compte : suivies et vrac ensemble.
   *
   * Elle alimente les compteurs des filtres, et elle seule — un total qui
   * n'additionnerait que les montures suivies ne serait comparable à rien, les
   * gen 1 étant justement dans le vrac.
   */
  const roster = useMemo(
    () => rosterOf({ bulk, individuals }, generationOfColor),
    [bulk, individuals, generationOfColor]
  );

  /**
   * Le rapprochement avec le jeu.
   *
   * Appelé ici et pas plus bas parce qu'il rend deux choses qui vivent à deux
   * endroits : la barre de question, et la teinture du panneau de filtres.
   * « Voir ces N montures » pose les filtres de la cellule sur la liste — c'est
   * là qu'on finit, nom par nom, et c'est gratuit puisqu'une cellule **est** un
   * jeu de filtres.
   */
  /**
   * La liste nominative, pour pouvoir l'amener sous les yeux.
   *
   * « Voir ces N montures » posait ses filtres et s'arrêtait là. Ça se voyait
   * tant qu'il n'y avait qu'une cellule pointée ; à onze — le cas réel du
   * 22/08 — la barre de résultats mesure trois cents pixels, la liste passe
   * sous la ligne de flottaison, et le bouton ne montre les montures qu'à qui
   * pense à faire défiler. Un bouton qui promet de montrer doit montrer.
   */
  const list = useRef<HTMLDivElement>(null);

  const census = useCensusBar({
    entries: roster,
    nameOf,
    onFocus: setFilters,
    onReveal: (cell) => {
      setFilters(cell);
      list.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  });

  /**
   * Les anonymes stériles, un état que le jeu ne rend pas.
   *
   * Sans nom il n'y a pas d'ascendance : achetée ou capturée, donc gen 1. Or une
   * gen 1 fertile sans ascendance appartient au compteur de vrac — il ne reste
   * donc, parmi les anonymes individuelles, que la féconde. La stérile, elle, ne
   * peut rien : le jeu n'extrait pas les gen 1, et le clonage ne prend pas les
   * anonymes, qui ne se désignent pas dans l'écurie du jeu.
   *
   * Ce ne sont pas des montures, ce sont des restes. L'écurie en a porté
   * cinquante-sept d'un coup — 255 annoncées là où le jeu en comptait 198.
   */
  const phantoms = useMemo(
    () => individuals.filter((mount) => mount.name === null && !mount.fertile),
    [individuals]
  );

  /**
   * L'écurie affichée, **dans l'ordre du jeu** : par nom, comme l'ETABLE.
   *
   * Elle sortait les fécondes devant, puis par génération décroissante, par
   * couleur, par niveau — et, à égalité, **par uuid**. Sur une cellule pointée
   * les cinq premiers critères sont justement ceux que les filtres viennent de
   * figer, si bien que l'ordre effectif était celui des identifiants : six
   * Amande gen 3 mâles fertiles s'affichaient dans un ordre qui ne correspond à
   * rien de lisible, et surtout pas à la liste du jeu posée à côté. Or c'est le
   * seul geste qui ferme un écart — descendre les deux listes ligne à ligne.
   *
   * Trier par nom n'y perd rien : le nom dicté porte la génération, la couleur,
   * le sexe et l'ascendance, donc il regroupe déjà ce que les anciens critères
   * regroupaient. Les non renommées se rangent ensemble sous « Anonyme », qui
   * est le nom que le jeu leur donne. L'uuid reste en dernier départage, pour
   * que deux homonymes ne dansent pas d'un rendu à l'autre.
   */
  /**
   * Les montures cochées, par identifiant.
   *
   * Un `Set` et non un drapeau par ligne : la liste se refiltre en permanence,
   * et une sélection portée par les lignes disparaîtrait au premier changement
   * de filtre. Or c'est précisément l'usage — filtrer sur « Doré », tout cocher,
   * filtrer autrement, continuer. La sélection survit donc au filtre, et le
   * bandeau dit combien de cochées sont hors de vue.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkLevel, setBulkLevel] = useState('');
  const [bulkStatus, setBulkStatus] = useState<MountStatus | ''>('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkError, setBulkError] = useState('');

  /**
   * La sélection, ramenée à ce qui existe encore.
   *
   * Une monture retirée de l'écurie pendant qu'elle est cochée laisserait un
   * identifiant fantôme dans le lot, et l'écriture porterait sur une ligne
   * absente — le silence que `touchedRows` attrape, mais qu'il vaut mieux ne pas
   * fabriquer.
   */
  const selectedIds = useMemo(
    () => individuals.filter((mount) => selected.has(mount.id)).map((mount) => mount.id),
    [individuals, selected]
  );
  const selectedCount = selectedIds.length;

  /**
   * Ce que le bouton écrira, ou `null` s'il n'y a rien à écrire.
   *
   * Les deux champs sont facultatifs et indépendants : sortir un lot d'enclos
   * demande les deux, corriger un niveau mal saisi n'en demande qu'un. Un patch
   * vide désactive le bouton plutôt que d'envoyer une écriture qui ne changerait
   * rien — laquelle passerait pour un succès et ne dirait rien de faux, mais
   * ferait croire à un geste accompli.
   */
  const bulkPatch = useMemo(() => {
    const level = Number(bulkLevel);
    const patch: { level?: number; fertile?: boolean; cycled?: boolean } = {};
    if (bulkLevel !== '' && Number.isFinite(level) && level >= 1 && level <= 200) {
      patch.level = Math.round(level);
    }
    if (bulkStatus !== '') Object.assign(patch, statusFlags(bulkStatus));
    return Object.keys(patch).length > 0 ? patch : null;
  }, [bulkLevel, bulkStatus]);

  const owned = useMemo(() => {
    return individuals
      .filter((mount) =>
        matches(
          {
            colorId: mount.colorId,
            generation: generationOfColor(mount.colorId),
            sex: mount.sex,
            status: mountStatus(mount),
            level: mount.level,
            name: mount.name,
            mount,
            count: 1,
          },
          filters,
          nameOf
        )
      )
      .sort(
        (a, b) =>
          borneName(a).localeCompare(borneName(b), 'fr') ||
          a.id.localeCompare(b.id)
      );
  }, [individuals, filters, nameOf, generationOfColor]);

  /** Cochées mais hors du filtre courant : on applique à ce qu'on ne voit pas. */
  const hiddenCount = useMemo(() => {
    const shown = new Set(owned.map((mount) => mount.id));
    return selectedIds.filter((id) => !shown.has(id)).length;
  }, [owned, selectedIds]);

  /**
   * Le vrac restant, couleurs vides exclues et filtres appliqués.
   *
   * Filtré par les mêmes facettes que la liste du dessus : le laisser entier
   * pendant que les suivies se réduisent ferait lire un écran à moitié filtré,
   * et c'est un écran de comparaison. Une couleur dont il ne reste aucune ligne
   * retenue disparaît.
   */
  const legacyBulk = useMemo(
    () =>
      [...bulk]
        .filter(([, counts]) => counts.males > 0 || counts.females > 0)
        .filter(([colorId]) =>
          roster.some(
            (entry) =>
              entry.mount === null &&
              entry.colorId === colorId &&
              matches(entry, filters, nameOf)
          )
        )
        .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b))),
    [bulk, roster, filters, nameOf]
  );

  /** Tous les carburants lisibles, avec leur jauge et leur rang, avant filtrage. */
  const allFuels = useMemo(
    () =>
      fuelItems.flatMap((item) => {
        const info = parseGaugeInfo(item);
        if (!info || info.rechargeAmount <= 0) return [];
        return [{ item, info, rank: fuelRank(info) }];
      }),
    [fuelItems]
  );

  /** Les jauges et les rangs réellement présents, pour ne proposer que du vivant. */
  const gaugesPresent = useMemo(
    () =>
      [...new Set(allFuels.map((fuel) => fuel.info.gaugeName))].sort((a, b) =>
        a.localeCompare(b, 'fr')
      ),
    [allFuels]
  );
  const ranksPresent = useMemo(
    () =>
      FUEL_RANKS.filter((rank) => allFuels.some((fuel) => fuel.rank === rank.id)),
    [allFuels]
  );

  /** Les carburants retenus, groupés par jauge et ordonnés par palier. */
  const fuelsByGauge = useMemo(() => {
    const needle = fuelQuery.trim().toLowerCase();
    const groups = new Map<string, typeof allFuels>();

    for (const fuel of allFuels) {
      if (gaugeFilter && fuel.info.gaugeName !== gaugeFilter) continue;
      if (rankFilter && fuel.rank !== rankFilter) continue;

      const name = fuel.item.name?.fr ?? '';
      if (
        needle &&
        !name.toLowerCase().includes(needle) &&
        !fuel.info.gaugeName.toLowerCase().includes(needle)
      ) {
        continue;
      }

      const group = groups.get(fuel.info.gaugeName) ?? [];
      group.push(fuel);
      groups.set(fuel.info.gaugeName, group);
    }

    for (const group of groups.values()) {
      group.sort((a, b) => a.info.rechargeAmount - b.info.rechargeAmount);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [allFuels, fuelQuery, gaugeFilter, rankFilter]);

  /**
   * Le meilleur prix au point de chaque jauge, pour signaler le carburant que
   * l'arbitrage retiendra à temps non valorisé.
   */
  const bestPerPoint = useMemo(() => {
    const best = new Map<string, number>();
    for (const [gauge, fuels] of fuelsByGauge) {
      for (const { item, info } of fuels) {
        const price = itemPrices.get(item.id) ?? 0;
        const recharge = info.rechargeAmount;
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
              setBand(settings.gauge_cap === null ? '' : String(settings.gauge_cap));
              setNetCost(settings.count_net_cost);
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
          {/* Les quatre faits sur la façon dont on joue — le parc, la caisse, la
              bande qu'on tient, les filets qu'on paie ou pas. Le panneau « Mon
              élevage » qui les portait avec cinq réglages de politique a disparu
              avec #94, à raison : ce que le modèle décide, il ne sert à rien de
              le paramétrer. Ces quatre-là ne se décident pas, ils se constatent,
              et c'est ce qui leur vaut de rester ici. */}
          <div className="space-y-3">
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

              {/* La bande décide du **débit** des jauges, donc de toutes les
                  durées de l'écran, donc de la largeur d'une fournée. Elle était
                  encore lue sans être réglable depuis #94 : une ligne posée
                  avant gardait sa bande à vie. Voir #181. */}
              <div>
                <label
                  htmlFor="gauge-band"
                  className="flex items-center gap-2 text-xs text-dark-400 mb-1.5"
                >
                  <Gauge size={13} className="text-kamas" />
                  Bande de jauge tenue
                </label>
                <select
                  id="gauge-band"
                  data-testid="setting-gauge-band"
                  value={band}
                  onChange={(event) => setBand(event.target.value)}
                  className="w-56 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                    text-dark-100 text-sm transition-all hover:border-dark-500 focus:border-kamas/50"
                >
                  {GAUGE_BANDS.map((cap, index) => (
                    <option key={cap} value={cap}>
                      Bande {index + 1} — {cap.toLocaleString('fr-FR')} ·{' '}
                      {transferRatePerSecond(cap)} pt/s
                    </option>
                  ))}
                  <option value="">Le moins cher, sans regarder la vitesse</option>
                </select>
                <p className="text-[10px] text-dark-600 mt-1">
                  Le rang de carburant que tu rachètes.
                </p>
              </div>
            </div>

            {/* Le prix des filets : le seul des réglages rendus qui puisse mettre
                un coût à zéro, ce qui se lit « Capture : 0 kamas » sans rien pour
                l'expliquer. D'où la case, et non un défaut. */}
            <label className="flex items-start gap-2.5 text-xs text-dark-300 cursor-pointer w-fit">
              <input
                type="checkbox"
                data-testid="setting-net-cost"
                checked={netCost}
                onChange={(event) => setNetCost(event.target.checked)}
                className="mt-0.5 accent-kamas cursor-pointer"
              />
              <span>
                Compter le prix des filets dans une capture
                <span className="block text-[10px] text-dark-600">
                  Décoche si tu récoltes tes matériaux : la capture ne coûte alors que le
                  combat.
                </span>
              </span>
            </label>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                data-testid="save-settings"
                onClick={async () => {
                  // Les quatre partent ensemble : ils vivent dans la même ligne
                  // de réglages, et quatre boutons côte à côte laisseraient
                  // croire qu'oublier l'un annule les autres.
                  const saved = await onSaveSettings({
                    ...settings,
                    kamas_available: Math.max(0, Number(budget) || 0),
                    enclos_count: Math.max(0, Math.min(20, Number(enclos) || 0)),
                    // `''` est l'option « le moins cher », que la colonne écrit
                    // `null`. Un `Number('')` vaudrait zéro, soit « plafond nul ».
                    gauge_cap: band === '' ? null : Number(band),
                    count_net_cost: netCost,
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
                <span className="flex items-center gap-1 text-xs text-gain">
                  <Check size={13} /> Enregistré
                </span>
              )}
            </div>

            <p className="text-[10px] text-dark-600">
              Les plans qui dépassent le budget sont signalés, avec l&apos;étape où
              l&apos;argent manque. Le nombre d&apos;enclos traduit les heures d&apos;enclos
              d&apos;un plan en délai réel — c&apos;est lui qui décide de la largeur d&apos;une
              fournée.
            </p>
          </div>

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
                  value={filters.query}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, query: event.target.value }))
                  }
                  // « Anonyme » est nommé parce que c'est le seul terme de
                  // recherche qu'on ne devinerait pas : il ne figure sur aucune
                  // ligne comme un nom saisi, et c'est pourtant lui qui sépare
                  // les montures interchangeables de celles qui portent leur
                  // généalogie dans leur nom.
                  placeholder="Rechercher une monture — « Anonyme » pour les non renommées"
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-dark-800/80 border
                    border-dark-600/50 text-dark-100 text-xs placeholder:text-dark-500
                    transition-all hover:border-dark-500 focus:border-kamas/50"
                />
              </div>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={13} />
                Ajouter une monture
              </Button>
              {/* L'import passe en second : c'est le geste des gros volumes, pas
                  celui du quotidien. Il reste visible parce qu'un rechargement
                  d'écurie ne se devine pas derrière un bouton « ajouter ». */}
              <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                <Upload size={13} />
                Importer une liste
              </Button>
            </div>
            <p className="text-[10px] text-dark-600 mb-2">
              <strong>Fertiles et fécondes</strong> entrent toutes les deux dans les fournées :
              ce qui les sépare est le cycle de jauges, que la féconde a déjà payé. Seule la
              stérile est hors jeu — il ne lui reste que le clonage.
            </p>

            {/* Les restes, comptés et retirables d'un geste. Voir `phantoms` :
                une anonyme stérile n'est pas une monture qu'on aurait oublié de
                nommer, c'est un état que le jeu ne rend pas.

                Elle a été absorbée un temps dans un relevé de défauts locaux qui
                comptait des lignes là où il fallait compter des décisions : sur
                l'écurie réelle il annonçait « 113 à corriger », dont plus de la
                moitié étaient ces anonymes-ci — un seul geste, un seul bouton.
                Un compteur de cette taille ne se lit plus, il se replie. La
                bannière est donc revenue seule, à sa place et à son échelle. */}
            {phantoms.length > 0 && onRemoveIndividuals && (
              <div
                data-testid="phantom-notice"
                className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-xl
                  bg-loss/10 border border-loss/30"
              >
                <span className="text-[11px] text-dark-300">
                  <strong className="text-loss-light">{phantoms.length}</strong> anonyme
                  {phantoms.length > 1 ? 's' : ''} stérile{phantoms.length > 1 ? 's' : ''}
                  {' — '}un état que le jeu ne rend pas. Sans nom il n&apos;y a pas d&apos;ascendance,
                  donc c&apos;est une gen 1 : elle ne s&apos;extrait pas, et le clonage ne
                  prend pas ce qu&apos;on ne sait pas désigner en jeu.
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => onRemoveIndividuals(phantoms.map((mount) => mount.id))}
                  title="Suppression définitive, en une écriture. Le compte de l’écurie baisse d’autant — c’est le but : il ne compte plus ce que le jeu n’a pas."
                >
                  <Trash2 size={13} />
                  Retirer {phantoms.length === 1 ? 'la' : 'les'} {phantoms.length}
                </Button>
              </div>
            )}

            {/* Le rapprochement avec le jeu : la barre pose la question, le
                panneal du dessous la porte en couleurs. Voir `useCensusBar`. */}
            {census.bar}

            {/* Les mêmes facettes que dans le jeu, aux mêmes intitulés et dans le
                même ordre : c'est ce qui permet de poser les deux écrans côte à
                côte et de voir **où** un écart se loge. Voir `roster.ts`. */}
            <BreedingStockFilters
              entries={roster}
              filters={filters}
              onChange={setFilters}
              nameOf={nameOf}
              familyLabel={familyLabel}
              review={census.review}
            />

            {/* La correction en lot.
                L'app sait mettre soixante montures en enclos en quelques clics ;
                elle n'avait aucun geste pour les en ramener quand la fournée est
                perdue. Cinquante montures à repasser fécondes **et** à reniveler
                une par une font cent gestes, c'est-à-dire un travail qu'on ne
                fait pas — donc une écurie qui reste fausse et une politique qui
                planifie dessus. Voir `updateIndividuals`.

                Le bandeau n'existe que quand quelque chose est coché : un écran
                d'écurie sert d'abord à lire, et une barre d'outils permanente
                ferait payer à la lecture le prix d'un geste rare. */}
            {onUpdateIndividuals && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button
                  type="button"
                  data-testid="bulk-select-all"
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      const all = owned.every((mount) => next.has(mount.id));
                      for (const mount of owned) {
                        if (all) next.delete(mount.id);
                        else next.add(mount.id);
                      }
                      return next;
                    })
                  }
                  className="px-2 py-1 rounded-lg border border-dark-600/50 bg-dark-800/60
                    text-dark-300 hover:text-dark-100 transition-colors cursor-pointer"
                >
                  {owned.length > 0 && owned.every((mount) => selected.has(mount.id))
                    ? `Décocher les ${owned.length} affichées`
                    : `Cocher les ${owned.length} affichées`}
                </button>
                {selected.size > 0 && (
                  <span data-testid="bulk-count" data-count={selectedCount} className="text-dark-400">
                    <strong className="text-kamas tabular-nums">{selectedCount}</strong>{' '}
                    sélectionnée{selectedCount > 1 ? 's' : ''}
                    {/* Cochées mais hors du filtre courant : sans ce compte, on
                        applique à des montures qu'on ne voit pas. */}
                    {hiddenCount > 0 && (
                      <span className="text-loss-light">
                        {' '}
                        dont {hiddenCount} hors filtre
                      </span>
                    )}
                  </span>
                )}
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-dark-500 hover:text-dark-300 transition-colors cursor-pointer"
                  >
                    tout décocher
                  </button>
                )}
              </div>
            )}

            {onUpdateIndividuals && selected.size > 0 && (
              <div
                data-testid="bulk-bar"
                className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
                  bg-kamas/5 border border-kamas/30"
              >
                <span className="text-[11px] text-dark-300">Appliquer à la sélection</span>

                <span className="flex items-center gap-1">
                  {(['fertile', 'feconde', 'sterile'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      data-testid={`bulk-status-${value}`}
                      onClick={() => setBulkStatus((current) => (current === value ? '' : value))}
                      title={STATUS_HINT[value]}
                      className={`px-1.5 py-0.5 rounded-lg border text-[10px] transition-all
                        cursor-pointer ${
                          bulkStatus === value
                            ? STATUS_TONE
                            : 'bg-dark-800/60 border-dark-700/50 text-dark-500 hover:text-dark-300'
                        }`}
                    >
                      {MOUNT_STATUS_LABEL[value]}
                    </button>
                  ))}
                </span>

                <label className="flex items-center gap-1 text-[10px] text-dark-500">
                  niv
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={bulkLevel}
                    data-testid="bulk-level"
                    placeholder="—"
                    onChange={(event) => setBulkLevel(event.target.value)}
                    className="w-16 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                      border-dark-600/50 text-dark-100 text-[11px] text-right
                      transition-all hover:border-dark-500 focus:border-kamas/50"
                  />
                </label>

                <Button
                  size="sm"
                  data-testid="bulk-apply"
                  disabled={bulkRunning || !bulkPatch}
                  onClick={async () => {
                    if (!bulkPatch) return;
                    setBulkRunning(true);
                    setBulkError('');
                    const result = await onUpdateIndividuals([...selected], bulkPatch);
                    setBulkRunning(false);
                    if (!result.ok) {
                      setBulkError(result.message);
                      return;
                    }
                    // Écrit : la sélection se vide et les champs se remettent à
                    // zéro. Les garder ferait recliquer sur un lot déjà corrigé.
                    setSelected(new Set());
                    setBulkLevel('');
                    setBulkStatus('');
                  }}
                >
                  <Check size={13} />
                  {bulkRunning
                    ? 'Enregistrement…'
                    : `Corriger ${selectedCount} monture${selectedCount > 1 ? 's' : ''}`}
                </Button>

                {!bulkPatch && (
                  <span className="text-[10px] text-dark-600">
                    choisis un état, un niveau, ou les deux
                  </span>
                )}
                {bulkError && (
                  <span data-testid="bulk-error" className="text-[11px] text-loss-light">
                    {bulkError}
                  </span>
                )}
              </div>
            )}

            <div
              ref={list}
              data-testid="stock-list"
              className="space-y-1 max-h-96 overflow-y-auto pr-1 custom-scrollbar"
            >
              {owned.map((mount) => {
                const status = mountStatus(mount);
                const carried = mount.parents ? nameForIndividual(mount) : null;
                const current = borneName(mount);
                const purity = purityOf(mount);

                return (
                  <div
                    key={mount.id}
                    data-testid="stock-mount"
                    /* Le nom porté, celui qui range la liste et par lequel on la
                       confronte à celle du jeu. */
                    data-name={current}
                    /* Sans nom, pas d'ascendance — donc les états possibles ne
                       sont pas les mêmes, et ça se vérifie. Voir `phantoms`. */
                    data-anonymous={mount.name === null}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
                      bg-dark-800/40 hover:bg-dark-800/60 transition-colors"
                  >
                    {onUpdateIndividuals && (
                      <input
                        type="checkbox"
                        data-testid="stock-select"
                        checked={selected.has(mount.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(mount.id)) next.delete(mount.id);
                            else next.add(mount.id);
                            return next;
                          })
                        }
                        title={`Sélectionner ${current}`}
                        className="accent-kamas cursor-pointer shrink-0"
                      />
                    )}
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
                      {(['fertile', 'feconde', 'sterile'] as const).map((value) => {
                        /* Une anonyme ne peut pas être stérile, et le bouton le
                           dit plutôt que de laisser fabriquer l'état qu'on vient
                           de purger. Sans nom il n'y a pas d'ascendance, donc
                           c'est une gen 1 : ni extractible, ni clonable, et
                           l'écurie du jeu n'en porte pas. Voir `phantoms`. */
                        const impossible = value === 'sterile' && mount.name === null;

                        return (
                          <button
                            key={value}
                            type="button"
                            disabled={impossible}
                            onClick={() =>
                              !impossible && onUpdateIndividual(mount.id, statusFlags(value))
                            }
                            title={
                              impossible
                                ? 'Une anonyme ne peut pas être stérile : sans ascendance c’est une gen 1, que le jeu n’extrait pas et que le clonage ne sait pas désigner. Nomme-la, ou retire-la.'
                                : STATUS_HINT[value]
                            }
                            className={`px-1.5 py-0.5 rounded-lg border text-[10px] transition-all
                              ${impossible ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${
                                status === value
                                  ? STATUS_TONE
                                  : 'bg-dark-800/60 border-dark-700/50 text-dark-500 hover:text-dark-300'
                              }`}
                          >
                            {MOUNT_STATUS_LABEL[value]}
                          </button>
                        );
                      })}
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
                                ? 'text-gain'
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

          <BreedingDriftSignals drift={drift} nameOf={nameOf} individuals={individuals} />

          {/* Prix des couleurs, et ce qu'on veut en produire.
              Ils vivaient sous « Couleur visée » et sont partis avec elle ; sans
              eux `computeBreedingCosts` n'a rien à calculer et tout l'écran
              s'éteint. Voir #102. Ici parce que c'est déjà le toit des prix de
              carburants, et qu'on y vient pour corriger un chiffre. */}
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-2">
              <p className="text-xs text-dark-400">Prix des couleurs</p>
              <label className="flex items-center gap-1.5 text-[11px] text-dark-500">
                je vise
                <select
                  value={targetColorId ?? ''}
                  onChange={(event) => onSelectTarget(event.target.value || null)}
                  className="px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
                    text-dark-100 text-[11px] transition-all hover:border-dark-500
                    focus:border-kamas/50 cursor-pointer"
                >
                  <option value="">la mieux payée du moment</option>
                  {crownable.map((color) => (
                    <option key={color.id} value={color.id}>
                      {color.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-dark-500">
                j&apos;en veux
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={String(targetCount)}
                  onChange={(event) =>
                    onSetTargetCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
                  }
                  className="w-16 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
                    text-dark-100 text-[11px] text-right transition-all hover:border-dark-500
                    focus:border-kamas/50"
                />
                monture{targetCount > 1 ? 's' : ''} de la couleur visée
              </label>
              {targetColorId && minBatches !== null && (
                <span
                  className="text-[11px] text-dark-400"
                  title="En espérance : taux de réussite annoncés, sexes moitié-moitié, sur ton écurie et ton parc actuels. Un plancher, pas une promesse."
                >
                  <strong className="text-kamas">{minBatches}</strong> fournée
                  {minBatches > 1 ? 's' : ''} au minimum
                </span>
              )}
              <button
                type="button"
                onClick={() => setPricesOpen((value) => !value)}
                className={`ml-auto px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer
                  transition-all ${
                    pricesOpen
                      ? 'bg-kamas/15 text-kamas border-kamas/40'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
              >
                <Coins size={12} className="inline mr-1" />
                {pricesOpen ? 'Fermer la saisie' : 'Saisir les prix'}
              </button>
            </div>

            {/* Cinq prix de couleurs sauvages suffisent à rendre les 120 muldos
                chiffrables — le reste ne fait qu'affiner. Et c'est **le prix des
                gen 10 qui décide de la couronne** quand aucune cible n'est
                choisie : sans eux, elles valent toutes leur extraction en ambre et
                c'est le partenaire qui tranche. Voir `crownedLadderOf`. */}
            {pricesOpen && <PriceEntry rows={rows} onSavePrice={onSavePrice} />}
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

            {/* Deux axes, parce qu'on cherche de deux façons : « je remplis le
                Foudroyeur » et « je ne prends que des Élixirs ». Les cent vingt
                carburants sont le produit des deux, et une seule zone de texte
                obligeait à connaître le nom exact de ce qu'on cherchait. */}
            <div className="space-y-1.5 mb-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-dark-500 w-10">Jauge</span>
                {chip('Toutes', gaugeFilter === null, () => setGaugeFilter(null))}
                {gaugesPresent.map((gauge) =>
                  chip(gauge, gaugeFilter === gauge, () =>
                    setGaugeFilter(gaugeFilter === gauge ? null : gauge)
                  )
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-dark-500 w-10">Rang</span>
                {chip('Tous', rankFilter === null, () => setRankFilter(null))}
                {ranksPresent.map((rank) =>
                  chip(
                    rank.label,
                    rankFilter === rank.id,
                    () => setRankFilter(rankFilter === rank.id ? null : rank.id),
                    rank.hint
                  )
                )}
              </div>
            </div>

            {/* Une bannière pour toute la liste, et non un message par ligne :
                la ligne fait une trentaine de pixels de haut et le champ
                s'enregistre à chaque frappe. Le nom de l'item est donc dans le
                message, pas dans sa position. */}
            {fuelError && (
              <p
                role="alert"
                className="mb-2 px-3 py-2 rounded-xl bg-loss/10 border border-loss/30
                  text-[11px] leading-snug text-loss-light"
              >
                {fuelError}
              </p>
            )}

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
                    {fuels.map(({ item, info, rank }) => {
                      const name = item.name?.fr ?? String(item.id);
                      const price = itemPrices.get(item.id) ?? 0;
                      const recharge = info.rechargeAmount;
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
                          {/* L'icône se clique et copie le nom : c'est avec lui
                              qu'on cherche l'item en HDV, comme partout
                              ailleurs dans l'app. */}
                          <CopyableIcon src={item.img} name={name} size="sm" toast={false} />
                          <span className="text-xs text-dark-200 flex-1 truncate">{name}</span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-700/60
                              text-dark-400 shrink-0"
                            title={FUEL_RANKS.find((entry) => entry.id === rank)?.hint}
                          >
                            {FUEL_RANKS.find((entry) => entry.id === rank)?.label}
                          </span>
                          <span className="text-[10px] text-dark-500 shrink-0">
                            {recharge.toLocaleString('fr-FR')} pts / unité
                          </span>
                          <span
                            className={`text-[10px] shrink-0 w-24 text-right tabular-nums ${
                              cheapest ? 'text-gain' : 'text-dark-500'
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
                              async (next) => {
                                const result = await onSaveFuelPrice(item.id, name, next);
                                setFuelError(
                                  result.ok
                                    ? ''
                                    : `${result.itemName} non enregistré — ${result.message}`
                                );
                              },
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

      <BreedingImportMounts
        isOpen={importing}
        onClose={() => setImporting(false)}
        colors={colors}
        onAdd={onAddIndividual}
      />
    </div>
  );
};

export default BreedingStocks;
