'use client';

import { RotateCcw } from 'lucide-react';
import {
  facetCounts,
  facetLabel,
  gameGenerationOrder,
  isPristine,
  LEVEL_MAX,
  LEVEL_MIN,
  matches,
  countOf,
  unranked,
  NO_FILTERS,
  type ValueFacet,
  type RosterEntry,
  type RosterFilters,
} from '@/lib/dofus/breeding/roster';
import { type MountStatus, type Sex } from '@/lib/dofus/breeding/stable';

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
  /** Non nul pendant un rapprochement — voir `Review`. */
  review?: Review | null;
};

/**
 * Ce sur quoi une question peut porter.
 *
 * `'total'` n'est pas une facette : rien ne se coche, et l'effectif est celui
 * que le jeu montre à l'ouverture, sans un seul filtre posé. Il a pourtant une
 * ligne dans le panneau — celle du **Type** — et c'est là que le chiffre se
 * lit. Sans lui dans cette liste, la première question annonçait « les chiffres
 * en jaune ci-dessous » et n'en teintait aucun : l'éleveur avait à comparer un
 * nombre qu'on ne lui montrait pas.
 */
export type ReviewFacet = ValueFacet | 'total';

/**
 * Ce que le panneau devient pendant un rapprochement.
 *
 * On ne fabrique pas un second écran : celui-ci est **déjà** la copie du panneau
 * du jeu, aux mêmes intitulés et dans le même ordre, et c'est très exactement ce
 * qu'on veut mettre en vis-à-vis. Il change de rôle, pas de forme — les valeurs
 * du croisement en cours passent en bleu, les effectifs à confronter en jaune.
 */
export type Review = {
  /** Vrai pour une valeur figée par le croisement — bleu. */
  fixed: (facet: ReviewFacet, value: string | number) => boolean;
  /** Vrai pour une valeur dont l'effectif est demandé — jaune. */
  asked: (facet: ReviewFacet, value: string | number) => boolean;
  /** Non nul quand l'éleveur saisit : rend ce qu'il a tapé pour cette case. */
  typed: ((facet: ReviewFacet, value: string | number) => string) | null;
  onType: (facet: ReviewFacet, value: string | number, next: string) => void;
};

/** La valeur qui désigne la ligne du total : il n'en a aucune à lui. */
export const TOTAL_VALUE = 'total';

const SECTION = 'text-[10px] uppercase tracking-wider text-dark-500 mb-1.5';

/**
 * Le rôle d'une ligne pendant un rapprochement.
 *
 * `fixed` — **bleu** — la valeur est figée par le croisement en cours : c'est le
 * filtre que l'éleveur vient de poser dans le jeu, pas une question.
 *
 * `asked` — **jaune** — son effectif est celui qu'on demande de confronter.
 *
 * `plain` — le reste, qui n'est ni posé ni demandé et se lit en gris.
 */
export type RowTone = 'plain' | 'fixed' | 'asked';

const TONE: Record<RowTone, string> = {
  plain: 'text-dark-300 hover:bg-dark-800/60',
  fixed: 'bg-info/15 text-info',
  asked: 'bg-kamas/10 text-kamas',
};

const BOX: Record<RowTone, string> = {
  plain: 'border-dark-600',
  fixed: 'bg-info/70 border-info',
  asked: 'border-kamas/60',
};

/** Ce qu'une ligne demande de recopier : le compte du jeu, à côté du nôtre. */
type Typed = { value: string; onChange: (next: string) => void };

/**
 * La case où l'éleveur recopie ce que le jeu montre.
 *
 * Partagée entre les lignes à cocher et la ligne du Type, qui n'en est pas une :
 * deux champs séparés auraient dérivé, et c'est le même geste.
 */
const SeenField = ({ typed }: { typed: Typed }) => (
  <>
    <span className="text-dark-600">→</span>
    <input
      data-testid="filter-seen"
      value={typed.value}
      onChange={(event) => typed.onChange(event.target.value)}
      inputMode="numeric"
      placeholder="?"
      className="w-14 px-1.5 py-0.5 rounded-md bg-dark-900/70 border border-kamas/40
        text-[11px] text-right text-kamas tabular-nums"
    />
  </>
);

/** L'effectif d'une ligne, mis en avant quand c'est lui qu'on vient comparer. */
const countClass = (tone: RowTone, count: number) =>
  tone === 'asked'
    ? 'text-kamas font-semibold tabular-nums'
    : count === 0
      ? 'text-dark-600'
      : 'text-dark-500';

/** Une ligne à cocher : intitulé à gauche, effectif à droite, comme en jeu. */
const CheckRow = ({
  label,
  count,
  checked,
  onToggle,
  title,
  tone = 'plain',
  typed,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
  title?: string;
  /** Pendant un rapprochement : ce que cette ligne est pour la question posée. */
  tone?: RowTone;
  /** Non nul quand l'éleveur saisit ce que le jeu montre sur cette ligne. */
  typed?: Typed | null;
}) => {
  const shade = checked && tone === 'plain' ? 'asked' : tone;
  const body = (
    <>
      <span
        className={`w-3 h-3 shrink-0 rounded border ${
          checked && tone === 'plain' ? 'bg-kamas/70 border-kamas' : BOX[shade]
        }`}
      />
      <span className="flex-1 text-left truncate">{label}</span>
    </>
  );

  // Un champ de saisie ne peut pas vivre dans un bouton — HTML invalide, et le
  // clic du bouton volerait le focus au champ. La ligne cesse donc d'être
  // cliquable le temps qu'on y tape : de toute façon, on ne filtre pas pendant
  // qu'on répond à une question sur le filtre.
  if (typed) {
    return (
      <div
        data-testid="filter-row"
        data-tone={shade}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] ${TONE[shade]}`}
      >
        {body}
        {/* Le compte de l'app reste lisible pendant la saisie : c'est l'autre
            moitié de la comparaison, et l'éteindre revenait à demander de
            recopier un chiffre en face de rien. */}
        <span className={countClass(shade, count)}>{count}</span>
        <SeenField typed={typed} />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="filter-row"
      data-tone={shade}
      onClick={onToggle}
      title={title}
      // Les effectifs à zéro restent visibles et cliquables : leur disparition
      // ferait croire à une couleur absente du catalogue là où elle n'est
      // qu'absente de l'écurie — et c'est justement ce qu'on vient vérifier.
      className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-[11px]
        transition-colors cursor-pointer ${TONE[shade]}`}
    >
      {body}
      <span className={countClass(tone, count)}>{count}</span>
    </button>
  );
};

/** Ajoute ou retire une valeur d'une liste de facette. */
const toggled = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

const STATUS_ORDER: MountStatus[] = ['fertile', 'feconde', 'sterile'];

const BreedingStockFilters = ({
  entries,
  filters,
  onChange,
  nameOf,
  familyLabel,
  review = null,
}: Props) => {
  /** Le rôle d'une ligne : bleu si le croisement la fixe, jaune si on la demande. */
  const toneOf = (facet: ReviewFacet, value: string | number): RowTone => {
    if (!review) return 'plain';
    if (review.fixed(facet, value)) return 'fixed';
    return review.asked(facet, value) ? 'asked' : 'plain';
  };

  /** Le champ de saisie d'une ligne, ou `null` tant qu'on n'a pas répondu KO. */
  const typedOf = (facet: ReviewFacet, value: string | number): Typed | null =>
    review?.typed && review.asked(facet, value)
      ? {
          value: review.typed(facet, value),
          onChange: (next: string) => review.onType(facet, value, next),
        }
      : null;

  const patch = (next: Partial<RosterFilters>) => onChange({ ...filters, ...next });

  const generations = facetCounts(entries, filters, nameOf, 'generation', (entry) => entry.generation);
  const statuses = facetCounts(entries, filters, nameOf, 'status', (entry) => entry.status);
  const sexes = facetCounts(entries, filters, nameOf, 'sex', (entry) => entry.sex);
  const colors = facetCounts(entries, filters, nameOf, 'color', (entry) => entry.colorId);

  /** Le total de la famille, tous filtres appliqués : la ligne « Type » du jeu. */
  const shown = countOf(entries.filter((entry) => matches(entry, filters, nameOf)));

  /** La ligne du Type porte la question du total : voir `ReviewFacet`. */
  const totalTone = toneOf('total', TOTAL_VALUE);
  const totalTyped = typedOf('total', TOTAL_VALUE);

  /** Les montures que la plage de niveaux ne peut pas classer. */
  const noLevel = unranked(entries, filters, nameOf);

  /** Ce que le vrac ne peut pas porter : voir l'en-tête de `roster.ts`. */
  const bulkCount = countOf(entries.filter((entry) => entry.level === null));

  // Énumérées sur l'écurie **entière** et non sur les comptes : une couleur que
  // les autres filtres ramènent à zéro doit rester dans la liste, à zéro. La
  // faire disparaître ferait lire « je n'en ai pas » là où il faut lire « pas de
  // celles-là ».
  const colorRows = [...new Set(entries.map((entry) => entry.colorId))]
    .map((colorId) => ({
      colorId,
      count: colors.get(colorId) ?? 0,
      label: facetLabel('color', colorId, nameOf),
    }))
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
              {noLevel}&nbsp;monture{noLevel > 1 ? 's' : ''} de vrac sans niveau enregistré —
              écartée{noLevel > 1 ? 's' : ''} dès que la plage bouge.
            </p>
          )}
        </div>

        <div>
          <p className={SECTION}>Type</p>
          {/* Une seule famille à l'écran, choisie par l'onglet du dessus : la case
              n'aurait rien à décocher. On garde le chiffre, qui est ce qu'on vient
              comparer — et c'est lui que la première question du rapprochement
              teinte, puisque le total n'a pas d'autre ligne où se lire. */}
          <div
            data-testid="filter-row"
            data-tone={totalTone}
            className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] ${
              totalTone === 'plain' ? 'text-dark-300' : TONE[totalTone]
            }`}
          >
            <span className="flex-1 text-left">{familyLabel}</span>
            <span className={countClass(totalTone, shown)}>{shown}</span>
            {totalTyped && <SeenField typed={totalTyped} />}
          </div>
        </div>

        <div>
          <p className={SECTION}>Génération</p>
          <div className="space-y-0.5">
            {gameGenerationOrder(entries.map((entry) => entry.generation)).map((generation) => (
              <CheckRow
                key={generation}
                label={facetLabel('generation', generation, nameOf)}
                count={generations.get(generation) ?? 0}
                checked={filters.generations.includes(generation)}
                tone={toneOf('generation', generation)}
                typed={typedOf('generation', generation)}
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
                label={facetLabel('status', status, nameOf)}
                count={statuses.get(status) ?? 0}
                checked={filters.statuses.includes(status)}
                tone={toneOf('status', status)}
                typed={typedOf('status', status)}
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
              Les {bulkCount}&nbsp;montures de vrac sont toutes fertiles ou fécondes : une
              gen&nbsp;1 stérilisée n&apos;a nulle part où être dite. Attends ce compte en deçà
              du jeu.
            </p>
          )}
        </div>

        <div>
          <p className={SECTION}>Sexe</p>
          <div className="space-y-0.5">
            {(['F', 'M'] as Sex[]).map((sex) => (
              <CheckRow
                key={sex}
                label={facetLabel('sex', sex, nameOf)}
                count={sexes.get(sex) ?? 0}
                checked={filters.sexes.includes(sex)}
                tone={toneOf('sex', sex)}
                typed={typedOf('sex', sex)}
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
                  tone={toneOf('color', row.colorId)}
                  typed={typedOf('color', row.colorId)}
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
