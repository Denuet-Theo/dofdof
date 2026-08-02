'use client';

import { useCallback, useState, useTransition } from 'react';
import ItemCard from '@/components/ui/ItemCard';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import CopyableIcon from '@/components/ui/CopyableIcon';
import HdvBadge from '@/components/items/HdvBadge';
import KamasDisplay from '@/components/ui/KamasDisplay';
import Skeleton from '@/components/ui/Skeleton';
import PriceModal from '@/components/recipes/PriceModal';
import { PriceTarget } from '@/components/recipes/RecipeDetails';
import UnlockedRecipes from '@/components/dashboard/UnlockedRecipes';
import {
  DofusDBRecipe,
  DofusDBResponse,
  ItemPrice,
  PriceSuggestion,
  PriceSuggestionBucket,
} from '@/lib/supabase/types';
import { findNewlyProfitable, ProfitableRecipe } from '@/lib/utils/recipes';
import { mergePrice } from '@/lib/hooks/useItemPrices';
import {
  usePriceSuggestions,
  STALE_PRICE_DAYS,
  SUGGESTIONS_PER_BUCKET,
} from '@/lib/hooks/usePriceSuggestions';
import { formatTimeAgo } from '@/lib/utils/date';
import { JOBS } from '@/lib/constants/jobs';
import {
  Check,
  ClipboardList,
  Layers,
  PackageCheck,
  RefreshCw,
  Scale,
  Scroll,
  Shuffle,
  type LucideIcon,
} from 'lucide-react';

/** Une recette ne peut pas avoir plus d'ingrédients que ça — borne large pour un seul item. */
const MAX_IMPACTED_RECIPES = 100;

const BUCKETS: {
  key: PriceSuggestionBucket;
  title: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  {
    key: 'most_used',
    title: 'Utilisées partout',
    hint: 'Les ingrédients présents dans le plus de recettes',
    icon: Layers,
  },
  {
    key: 'ready_recipe',
    title: 'Plus que le prix de vente',
    hint: 'Tous leurs ingrédients sont déjà tarifés',
    icon: PackageCheck,
  },
  {
    key: 'cost_driver',
    title: 'Gros poids dans un craft',
    hint: `Prix vieux de plus de ${STALE_PRICE_DAYS} jours`,
    icon: Scale,
  },
  {
    key: 'random',
    title: 'Au hasard',
    hint: 'Pour sortir des angles morts',
    icon: Shuffle,
  },
];

/** La colonne de droite d'une ligne : chaque bloc justifie sa présence à sa façon. */
const Metric = ({ suggestion }: { suggestion: PriceSuggestion }) => {
  switch (suggestion.bucket) {
    case 'most_used':
      return (
        <span className="text-xs text-dark-300 whitespace-nowrap">
          {suggestion.recipe_count} recettes
        </span>
      );
    case 'ready_recipe':
      return (
        <span className="text-xs text-dark-300 whitespace-nowrap">
          <KamasDisplay amount={suggestion.craft_cost ?? 0} size="sm" />
        </span>
      );
    case 'cost_driver':
      return (
        <span
          className="text-xs text-kamas whitespace-nowrap"
          title={`du coût de « ${suggestion.context_name} »`}
        >
          {Math.round((suggestion.cost_share ?? 0) * 100)} %
        </span>
      );
    default:
      return null;
  }
};

interface PriceSuggestionsProps {
  prices: Map<number, ItemPrice>;
  onPriceSaved: (itemId: number, price: number, updatedAt: string) => void;
}

/**
 * Les 16 items dont le prix manque le plus à l'app, sous le graphe des ventes.
 *
 * Sans cette grille, un item jamais tarifé est invisible partout : le dashboard
 * comme /recipes construisent leurs requêtes à partir des items *déjà* tarifés,
 * donc le catalogue non rempli est un angle mort qui s'auto-entretient.
 */
const PriceSuggestions = ({ prices, onPriceSaved }: PriceSuggestionsProps) => {
  // Les objets de quête sont exclus par défaut : ils ne se revendent pas, donc
  // une suggestion de prix sur l'un d'eux est toujours du bruit. Le bouton les
  // fait revenir pour qui tient quand même à les tarifer.
  const [jobId, setJobId] = useState<number | null>(null);
  const [includeQuest, setIncludeQuest] = useState(false);
  const { suggestions, loading, reload } = usePriceSuggestions({ jobId, includeQuest });
  const [priceTarget, setPriceTarget] = useState<PriceTarget | null>(null);
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [unlocked, setUnlocked] = useState<ProfitableRecipe[]>([]);
  const [, startUnlocking] = useTransition();

  const handlePriceSaved = useCallback(
    (itemId: number, price: number, updatedAt: string) => {
      // `prices` est encore la carte d'avant la saisie : le parent ne la met à
      // jour qu'au rendu suivant. C'est exactement le « avant » qu'il faut pour
      // savoir ce que cette saisie a changé.
      const before = prices;
      const after = mergePrice(before, itemId, price, updatedAt);

      onPriceSaved(itemId, price, updatedAt);
      setFilled((prev) => new Set(prev).add(itemId));

      startUnlocking(async () => {
        try {
          const res = await fetch(
            `/api/dofusdb/recipes?limit=${MAX_IMPACTED_RECIPES}&involvesId=${itemId}`
          );
          if (!res.ok) throw new Error('Failed to fetch impacted recipes');
          const data: DofusDBResponse<DofusDBRecipe> = await res.json();

          const newly = findNewlyProfitable(data.data ?? [], before, after);
          if (newly.length === 0) return;

          setUnlocked((prev) => {
            // Le panneau se cumule sur la session : on garde la version la plus
            // récente de chaque recette, en tête.
            const seen = new Set(newly.map((entry) => entry.recipe.resultId));
            return [...newly, ...prev.filter((entry) => !seen.has(entry.recipe.resultId))];
          });
        } catch (err) {
          console.error('Error computing unlocked recipes:', err);
        }
      });
    },
    [prices, onPriceSaved]
  );

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList size={20} className="text-kamas" />
            <h3 className="text-lg font-bold text-dark-100">Prix à remplir</h3>
          </div>
          <p className="text-dark-500 text-sm">
            Les ressources et recettes qui manquent le plus à tes calculs de marge
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Le métier filtre le graphe des recettes en base, pas les 16 lignes
              rendues : les blocs sont reclassés à l'intérieur du métier, donc
              « utilisées partout » veut bien dire « partout en bijouterie ». */}
          <select
            aria-label="Métier du craft"
            value={jobId ?? ''}
            onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-1.5 rounded-lg bg-dark-800/80 border border-dark-600/50
              text-dark-200 text-xs transition-all hover:border-dark-500 focus:border-kamas/50
              cursor-pointer"
          >
            <option value="">Tous les métiers</option>
            {JOBS.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            aria-pressed={includeQuest}
            onClick={() => setIncludeQuest((v) => !v)}
            title={
              includeQuest
                ? 'Les objets de quête sont proposés'
                : 'Les objets de quête sont écartés'
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs
              transition-all cursor-pointer ${
                includeQuest
                  ? 'bg-kamas/10 border-kamas/40 text-kamas'
                  : 'bg-dark-800/80 border-dark-600/50 text-dark-400 hover:border-dark-500'
              }`}
          >
            <Scroll size={14} />
            Objets de quête
          </button>

          <Button variant="ghost" size="sm" onClick={reload} loading={loading}>
            <RefreshCw size={14} />
            Actualiser
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
        {BUCKETS.map(({ key, title, hint, icon: Icon }) => {
          const rows = (suggestions ?? []).filter((row) => row.bucket === key);

          return (
            <div key={key} className="space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon size={14} className="text-dark-400 flex-shrink-0" />
                  <h4 className="text-sm font-semibold text-dark-200">{title}</h4>
                </div>
                <p className="text-[11px] text-dark-500 mt-0.5">{hint}</p>
              </div>

              {suggestions === null ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" count={SUGGESTIONS_PER_BUCKET} />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-xs text-dark-500 py-3">Rien à proposer ici.</p>
              ) : (
                rows.map((row) => {
                  const done = filled.has(row.item_id);
                  // Pas de ligne en base, ou un prix à 0 : l'app ne sait pas les
                  // distinguer et les traite tous deux comme jamais renseignés.
                  const never = (row.current_price ?? 0) <= 0;

                  return (
                    <ItemCard
                      key={row.item_id}
                      layout="row"
                      variant="flat"
                      dimmed={done}
                      onClick={() =>
                        setPriceTarget({
                          id: row.item_id,
                          name: row.item_name,
                          iconUrl: row.img,
                          price: row.current_price ?? 0,
                          superTypeId: row.super_type_id,
                        })
                      }
                    >
                      <CopyableIcon
                        src={row.img}
                        name={row.item_name}
                        size="sm"
                        toast={false}
                        scaleOnHover={false}
                      />

                      <ItemCard.Body>
                        <ItemCard.Title>{row.item_name}</ItemCard.Title>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <HdvBadge superTypeId={row.super_type_id} />
                          {done ? (
                            <Badge variant="success">
                              <Check size={10} className="mr-1" />
                              Rempli
                            </Badge>
                          ) : (
                            <Badge variant={never ? 'warning' : 'default'}>
                              {never ? 'Jamais rempli' : formatTimeAgo(row.updated_at)}
                            </Badge>
                          )}
                        </div>
                      </ItemCard.Body>

                      <ItemCard.Metrics>
                        <Metric suggestion={row} />
                      </ItemCard.Metrics>
                    </ItemCard>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      <UnlockedRecipes recipes={unlocked} prices={prices} onPriceSaved={onPriceSaved} />

      {/* La carte saisie reste en place, juste grisée : recharger la grille à
          chaque prix ferait bouger le bloc aléatoire sous le curseur. C'est le
          bouton « Actualiser » qui en tire seize nouveaux. */}
      <PriceModal
        isOpen={priceTarget !== null}
        onClose={() => setPriceTarget(null)}
        item={priceTarget}
        onPriceSaved={handlePriceSaved}
      />
    </div>
  );
};

export default PriceSuggestions;
