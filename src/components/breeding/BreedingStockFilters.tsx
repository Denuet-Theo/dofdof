'use client';

import { RotateCcw } from 'lucide-react';
import {
  facetCounts,
  gameGenerationOrder,
  isPristine,
  LEVEL_MAX,
  LEVEL_MIN,
  matches,
  countOf,
  unranked,
  NO_FILTERS,
  type RosterEntry,
  type RosterFilters,
} from '@/lib/dofus/breeding/roster';
import { MOUNT_STATUS_LABEL, type MountStatus, type Sex } from '@/lib/dofus/breeding/stable';

/**
 * Les filtres du jeu, dans l'ordre du jeu, avec les comptes du jeu.
 *
 * ## Ce qu'il sert, et qui n'est pas de filtrer
 *
 * L'éleveur a constaté des écarts entre ce qu'il voit en jeu et ce que le site
 * affiche. Sans facettes chiffrées des deux côtés, un écart se constate sur le
 * total et ne se localise nulle part : 145 contre 143 ne dit pas si ce sont deux
 * stériles, deux gen 1 ou deux femelles qui manquent.
 *
 * Cet écran est donc d'abord un **instrument de comparaison**. D'où trois choix
 * qui seraient discutables ailleurs :
 *
 * - les sections, leurs intitulés et leur ordre sont ceux du jeu ;
 * - les générations se rangent dans l'ordre des **chaînes** — 1, 10, 2, 3, 4 —
 *   parce que c'est celui du jeu et que les deux listes se lisent ligne à ligne ;
 * - le vrac est compté avec les montures suivies, sans quoi aucun total ne
 *   serait comparable.
 *
 * ## Les comptes sont des facettes, pas des totaux figés
 *
 * Le nombre à droite d'une case dit **ce que la cocher donnerait** : il se calcule
 * avec tous les autres filtres appliqués et pas le sien. Filtres vierges, ils
 * valent donc les totaux — ce que le jeu montre à l'ouverture — et une fois
 * « Féconde » coché, la colonne des générations dit combien de fécondes chacune
 * porte. Voir `facetCounts`.
 *
 * ## Les deux écarts attendus, annoncés plutôt que subis
 *
 * Le vrac n'enregistre ni niveau ni stérilité — voir l'en-tête de `roster.ts`.
 * Plutôt que de laisser ces deux trous produire un écart inexpliqué, l'écran les
 * dit là où ils se produisent : sous la plage de niveaux, et sous l'état stérile.
 */

type Props = {
  entries: RosterEntry[];
  filters: RosterFilters;
  onChange: (next: RosterFilters) => void;
  nameOf: (colorId: string) => string;
  /** Le nom de la famille, pour la ligne « Type » que le jeu affiche. */
  familyLabel: string;
};

const SECTION = 'text-[10px] uppercase tracking-wider text-dark-500 mb-1.5';

/** Une ligne à cocher : intitulé à gauche, effectif à droite, comme en jeu. */
const CheckRow = ({
  label,
  count,
  checked,
  onToggle,
  title,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onToggle}
    title={title}
    // Les effectifs à zéro restent visibles et cliquables : leur disparition
    // ferait croire à une couleur absente du catalogue là où elle n'est
    // qu'absente de l'écurie — et c'est justement ce qu'on vient vérifier.
    className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-[11px]
      transition-colors cursor-pointer ${
        checked ? 'bg-kamas/10 text-kamas' : 'text-dark-300 hover:bg-dark-800/60'
      }`}
  >
    <span
      className={`w-3 h-3 shrink-0 rounded border ${
        checked ? 'bg-kamas/70 border-kamas' : 'border-dark-600'
      }`}
    />
    <span className="flex-1 text-left truncate">{label}</span>
    <span className={count === 0 ? 'text-dark-600' : 'text-dark-500'}>{count}</span>
  </button>
);

/** Ajoute ou retire une valeur d'une liste de facette. */
const toggled = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

const STATUS_ORDER: MountStatus[] = ['fertile', 'feconde', 'sterile'];
const SEX_LABEL: Record<Sex, string> = { F: 'Monture femelle', M: 'Monture mâle' };

const BreedingStockFilters = ({ entries, filters, onChange, nameOf, familyLabel }: Props) => {
  const patch = (next: Partial<RosterFilters>) => onChange({ ...filters, ...next });

  const generations = facetCounts(entries, filters, nameOf, 'generation', (entry) => entry.generation);
  const statuses = facetCounts(entries, filters, nameOf, 'status', (entry) => entry.status);
  const sexes = facetCounts(entries, filters, nameOf, 'sex', (entry) => entry.sex);
  const colors = facetCounts(entries, filters, nameOf, 'color', (entry) => entry.colorId);

  /** Le total de la famille, tous filtres appliqués : la ligne « Type » du jeu. */
  const shown = countOf(entries.filter((entry) => matches(entry, filters, nameOf)));

  /** Les montures que la plage de niveaux ne peut pas classer. */
  const noLevel = unranked(entries, filters, nameOf);

  /** Ce que le vrac ne peut pas porter : voir l'en-tête de `roster.ts`. */
  const bulkCount = countOf(entries.filter((entry) => entry.level === null));

  // Énumérées sur l'écurie **entière** et non sur les comptes : une couleur que
  // les autres filtres ramènent à zéro doit rester dans la liste, à zéro. La
  // faire disparaître ferait lire « je n'en ai pas » là où il faut lire « pas de
  // celles-là ».
  const colorRows = [...new Set(entries.map((entry) => entry.colorId))]
    .map((colorId) => ({ colorId, count: colors.get(colorId) ?? 0, label: nameOf(colorId) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const level = (value: number, key: 'levelMin' | 'levelMax') => (
    <input
      type="number"
      min={LEVEL_MIN}
      max={LEVEL_MAX}
      value={String(value)}
      onChange={(event) =>
        patch({
          [key]: Math.max(
            LEVEL_MIN,
            Math.min(LEVEL_MAX, Number(event.target.value) || LEVEL_MIN)
          ),
        })
      }
      className="w-16 px-2 py-1 rounded-lg bg-dark-800/80 border border-dark-600/50
        text-dark-100 text-[11px] text-right transition-all hover:border-dark-500
        focus:border-kamas/50"
    />
  );

  return (
    <div className="px-3 py-3 rounded-xl bg-dark-800/30 border border-dark-700/40 mb-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-dark-400">
          Filtres du jeu — <span className="text-dark-200">{shown}</span> monture
          {shown > 1 ? 's' : ''} retenue{shown > 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          disabled={isPristine(filters)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider
            text-dark-500 hover:text-dark-300 disabled:opacity-40
            disabled:cursor-default cursor-pointer transition-colors"
        >
          <RotateCcw size={11} />
          Réinitialiser
        </button>
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className={SECTION}>Niveaux</p>
          <div className="flex items-center gap-2 text-[11px] text-dark-400">
            de {level(filters.levelMin, 'levelMin')} à {level(filters.levelMax, 'levelMax')}
          </div>
          {/* Le trou annoncé plutôt que subi : à plage resserrée, l'app écarte
              exactement ces montures-là et le jeu, lui, les classe. */}
          {noLevel > 0 && (
            <p className="text-[10px] text-dark-600 mt-1.5 leading-snug">
              {noLevel} monture{noLevel > 1 ? 's' : ''} de vrac sans niveau enregistré —
              écartée{noLevel > 1 ? 's' : ''} dès que la plage bouge.
            </p>
          )}
        </div>

        <div>
          <p className={SECTION}>Type</p>
          {/* Une seule famille à l'écran, choisie par l'onglet du dessus : la case
              n'aurait rien à décocher. On garde le chiffre, qui est ce qu'on vient
              comparer. */}
          <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-dark-300">
            <span className="flex-1 text-left">{familyLabel}</span>
            <span className="text-dark-500">{shown}</span>
          </div>
        </div>

        <div>
          <p className={SECTION}>Génération</p>
          <div className="space-y-0.5">
            {gameGenerationOrder(entries.map((entry) => entry.generation)).map((generation) => (
              <CheckRow
                key={generation}
                label={`Génération ${generation}`}
                count={generations.get(generation) ?? 0}
                checked={filters.generations.includes(generation)}
                onToggle={() => patch({ generations: toggled(filters.generations, generation) })}
              />
            ))}
          </div>
        </div>

        <div>
          <p className={SECTION}>Fertilité</p>
          <div className="space-y-0.5">
            {STATUS_ORDER.map((status) => (
              <CheckRow
                key={status}
                label={MOUNT_STATUS_LABEL[status]}
                count={statuses.get(status) ?? 0}
                checked={filters.statuses.includes(status)}
                onToggle={() => patch({ statuses: toggled(filters.statuses, status) })}
                title={
                  status === 'sterile'
                    ? 'Le vrac ne peut pas porter de stérile : ce compte est celui des seules montures suivies.'
                    : undefined
                }
              />
            ))}
          </div>
          {/* L'autre trou du vrac, dit là où il fausse le compte. */}
          {bulkCount > 0 && (
            <p className="text-[10px] text-dark-600 mt-1.5 leading-snug">
              Les {bulkCount} montures de vrac sont toutes fertiles ou fécondes : une gen 1
              stérilisée n&apos;a nulle part où être dite. Attends ce compte en deçà du jeu.
            </p>
          )}
        </div>

        <div>
          <p className={SECTION}>Sexe</p>
          <div className="space-y-0.5">
            {(['F', 'M'] as Sex[]).map((sex) => (
              <CheckRow
                key={sex}
                label={SEX_LABEL[sex]}
                count={sexes.get(sex) ?? 0}
                checked={filters.sexes.includes(sex)}
                onToggle={() => patch({ sexes: toggled(filters.sexes, sex) })}
              />
            ))}
          </div>
        </div>

        <div>
          <p className={SECTION}>Couleurs</p>
          <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
            {colorRows.length === 0 ? (
              <p className="text-[10px] text-dark-600 px-2 py-1">Aucune monture à classer.</p>
            ) : (
              colorRows.map((row) => (
                <CheckRow
                  key={row.colorId}
                  label={row.label}
                  count={row.count}
                  checked={filters.colorIds.includes(row.colorId)}
                  onToggle={() => patch({ colorIds: toggled(filters.colorIds, row.colorId) })}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BreedingStockFilters;
