'use client';

import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { ELEMENT_LABELS, ELEMENT_COLORS } from '@/lib/constants/elements';
import { ELEMENTS, type Element } from '@/lib/supabase/types';

export type FarmFilterState = {
  minLevel: string;
  maxLevel: string;
  areaId: string;
  prospecting: string;
  minPercent: string;
  elements: Element[];
  maxResistance: string;
  excludeBoss: boolean;
  excludeMiniBoss: boolean;
  excludeQuest: boolean;
  excludeHidden: boolean;
  pricedOnly: boolean;
  craftedOnly: boolean;
  /** Les défauts SQL correspondants sont true / false : voir la migration 20260802210000. */
  excludeQuestDrops: boolean;
  unconditionalOnly: boolean;
};

/**
 * Reprend les valeurs par défaut de `farm_targets`.
 *
 * Dupliquer les défauts SQL ici est un compromis assumé : l'écran doit pouvoir
 * afficher l'état des cases avant tout aller-retour réseau. `DEFAULT_FILTERS`
 * est la seule copie côté client, et la route n'envoie que ce qui s'en écarte.
 */
export const DEFAULT_FILTERS: FarmFilterState = {
  minLevel: '',
  maxLevel: '',
  areaId: '',
  prospecting: '100',
  minPercent: '',
  elements: [],
  maxResistance: '',
  excludeBoss: true,
  excludeMiniBoss: false,
  excludeQuest: false,
  excludeHidden: true,
  pricedOnly: false,
  craftedOnly: false,
  excludeQuestDrops: true,
  unconditionalOnly: false,
};

/** Nombre de réglages qui s'écartent du défaut, pour la pastille du bouton. */
export const countAdvanced = (filters: FarmFilterState) => {
  const advanced: (keyof FarmFilterState)[] = [
    'minPercent', 'maxResistance', 'excludeBoss', 'excludeMiniBoss', 'excludeQuest',
    'excludeHidden', 'pricedOnly', 'craftedOnly', 'excludeQuestDrops', 'unconditionalOnly',
  ];
  const changed = advanced.filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
  return changed + (filters.elements.length > 0 ? 1 : 0);
};

const field =
  'w-full px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50 text-dark-100 ' +
  'text-sm placeholder:text-dark-500 transition-all duration-200 hover:border-dark-500 ' +
  'focus:border-kamas/50 focus:bg-dark-800 focus:outline-none';

const Checkbox = ({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) => (
  <label className="flex items-start gap-2 cursor-pointer group" title={hint}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-0.5 accent-kamas cursor-pointer"
    />
    <span className="text-sm text-dark-300 group-hover:text-dark-200 transition-colors">
      {label}
    </span>
  </label>
);

type Props = {
  filters: FarmFilterState;
  onChange: (next: FarmFilterState) => void;
  areas: { id: number; name_fr: string }[];
  open: boolean;
  onToggle: () => void;
};

const FarmFilters = ({ filters, onChange, areas, open, onToggle }: Props) => {
  const set = <K extends keyof FarmFilterState>(key: K, value: FarmFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const toggleElement = (element: Element) =>
    set(
      'elements',
      filters.elements.includes(element)
        ? filters.elements.filter((item) => item !== element)
        : [...filters.elements, element]
    );

  const advancedCount = countAdvanced(filters);

  /**
   * Les éléments par intitulé, et non dans l'ordre de la constante.
   *
   * `ELEMENTS` existe pour dériver les noms de colonnes — `res_earth_min` — et
   * son ordre est celui de l'écriture, pas celui d'une convention du jeu : ni
   * l'ordre des caractéristiques, ni l'alphabet. Il n'y a donc rien à préserver,
   * et un filtre qui liste des noms les liste dans l'ordre où on les cherche.
   */
  const elements = [...ELEMENTS].sort((a, b) =>
    ELEMENT_LABELS[a].localeCompare(ELEMENT_LABELS[b], 'fr')
  );

  /**
   * Les zones arrivent déjà triées par la route, mais par la **collation de la
   * base** : ce qu'elle fait des accents dépend de l'instance, et « Île de Grobe
   * » n'a pas de raison de se ranger ailleurs qu'à I. Le tri français est refait
   * ici, où il est vérifiable.
   */
  const zones = [...areas].sort((a, b) => a.name_fr.localeCompare(b.name_fr, 'fr'));

  return (
    <div className="glass rounded-2xl p-4 space-y-4">
      {/* Les trois réglages du farm quotidien, toujours visibles. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div className="w-24">
            <label className="text-xs text-dark-400 mb-1 block">Niveau min</label>
            <input
              type="number"
              min={1}
              value={filters.minLevel}
              onChange={(event) => set('minLevel', event.target.value)}
              placeholder="1"
              className={field}
            />
          </div>
          <div className="w-24">
            <label className="text-xs text-dark-400 mb-1 block">Niveau max</label>
            <input
              type="number"
              min={1}
              value={filters.maxLevel}
              onChange={(event) => set('maxLevel', event.target.value)}
              placeholder="640"
              className={field}
            />
          </div>
        </div>

        <div className="min-w-52 flex-1 max-w-72">
          <label className="text-xs text-dark-400 mb-1 block">Zone</label>
          <select
            value={filters.areaId}
            onChange={(event) => set('areaId', event.target.value)}
            className={`${field} cursor-pointer`}
          >
            <option value="">Toutes les zones</option>
            {zones.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name_fr}
              </option>
            ))}
          </select>
        </div>

        <div className="w-32">
          <label className="text-xs text-dark-400 mb-1 block">Prospection</label>
          <input
            type="number"
            min={0}
            value={filters.prospecting}
            onChange={(event) => set('prospecting', event.target.value)}
            placeholder="100"
            className={field}
          />
        </div>

        <Button variant="secondary" size="md" onClick={onToggle} className="shrink-0">
          <SlidersHorizontal size={14} />
          Filtres
          {advancedCount > 0 ? <Badge variant="warning">{advancedCount}</Badge> : null}
        </Button>

        <Button
          variant="ghost"
          size="md"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="shrink-0"
          title="Revenir aux réglages par défaut"
        >
          <RotateCcw size={14} />
        </Button>
      </div>

      {open ? (
        <div className="border-t border-dark-700/50 pt-4 grid gap-6 md:grid-cols-3">
          <div className="space-y-3">
            <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">Drops</p>

            <div>
              <label className="text-xs text-dark-400 mb-1 block">Taux minimum (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={filters.minPercent}
                onChange={(event) => set('minPercent', event.target.value)}
                placeholder="0"
                className={field}
              />
            </div>

            <Checkbox
              checked={filters.pricedOnly}
              onChange={(value) => set('pricedOnly', value)}
              label="Seulement les drops tarifés"
              hint="Écarte les ressources dont le prix HDV n'est pas renseigné."
            />
            <Checkbox
              checked={filters.craftedOnly}
              onChange={(value) => set('craftedOnly', value)}
              label="Seulement les ingrédients de craft"
            />
            <Checkbox
              checked={filters.excludeQuestDrops}
              onChange={(value) => set('excludeQuestDrops', value)}
              label="Exclure les drops de quête"
              hint="Actif par défaut : ces drops sortent à 100 % et faussent le classement sans être farmables en boucle."
            />
            <Checkbox
              checked={filters.unconditionalOnly}
              onChange={(value) => set('unconditionalOnly', value)}
              label="Seulement les drops sans condition"
              hint="Filtre brut : écarte aussi les conditions anodines (niveau du joueur, plafond d'exemplaires). Réduit fortement les résultats."
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">
              Résistances
            </p>
            <p className="text-xs text-dark-500">
              Garde les monstres tendres dans <em>au moins un</em> des éléments cochés.
            </p>

            <div className="flex flex-wrap gap-2">
              {elements.map((element) => (
                <button
                  key={element}
                  type="button"
                  onClick={() => toggleElement(element)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
                    filters.elements.includes(element)
                      ? `border-kamas/40 bg-kamas/10 ${ELEMENT_COLORS[element]}`
                      : 'border-dark-600/50 text-dark-400 hover:border-dark-500'
                  }`}
                >
                  {ELEMENT_LABELS[element]}
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs text-dark-400 mb-1 block">
                Résistance maximale (%)
              </label>
              <input
                type="number"
                value={filters.maxResistance}
                onChange={(event) => set('maxResistance', event.target.value)}
                placeholder="ex. 0 pour les vulnérabilités"
                className={field}
                disabled={filters.elements.length === 0}
              />
              <p className="text-xs text-dark-500 mt-1">
                Une valeur négative cible les vulnérabilités.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">
              Monstres exclus
            </p>
            <Checkbox
              checked={filters.excludeBoss}
              onChange={(value) => set('excludeBoss', value)}
              label="Boss"
            />
            <Checkbox
              checked={filters.excludeMiniBoss}
              onChange={(value) => set('excludeMiniBoss', value)}
              label="Mini-boss"
            />
            <Checkbox
              checked={filters.excludeHidden}
              onChange={(value) => set('excludeHidden', value)}
              label="Masqués du bestiaire"
            />
            <Checkbox
              checked={filters.excludeQuest}
              onChange={(value) => set('excludeQuest', value)}
              label="Monstres de quête"
              hint="Le drapeau couvre 2 839 monstres sur 5 134 : bien plus large que « exclusif aux quêtes »."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FarmFilters;
