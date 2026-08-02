'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import CopyableIcon from '@/components/ui/CopyableIcon';
import HdvBadge from '@/components/items/HdvBadge';
import RecipeDetails, { PriceTarget, SellTarget } from '@/components/recipes/RecipeDetails';
import PriceModal from '@/components/recipes/PriceModal';
import SellModal from '@/components/recipes/SellModal';
import { DofusDBRecipe, DofusDBResponse, ItemPrice } from '@/lib/supabase/types';
import { Edit2 } from 'lucide-react';

interface RecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  prices: Map<number, ItemPrice>;
  /** Pass the recipe when the host already holds it, otherwise `itemId` and it is fetched. */
  recipe?: DofusDBRecipe;
  itemId?: number;
  /**
   * Hosts that already own a price/sell modal pass these and keep handling the edits, so
   * the two modals are not instantiated twice. Left out, the popin owns them itself and
   * drops into any page with no wiring beyond `prices`.
   */
  onEditPrice?: (item: PriceTarget) => void;
  onSell?: (item: SellTarget) => void;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
  onSold?: () => void;
}

/**
 * The recipe as a popin, for the surfaces too narrow to expand it in place: the /items
 * and /gauges grid cards, the dashboard Top 10, and /recipes below `lg`. Same panel,
 * same gestures as the inline version — and it opens without leaving the page, so a
 * search or a set of filters is never lost to a round trip through /recipes.
 */
const RecipeModal = ({
  isOpen,
  onClose,
  prices,
  recipe,
  itemId,
  onEditPrice,
  onSell,
  onPriceSaved,
  onSold,
}: RecipeModalProps) => {
  // Keyed by the item it was fetched for, which is what lets `loading` below be derived
  // rather than held in a second state the effect would have to keep in step.
  const [fetched, setFetched] = useState<{ itemId: number; recipe: DofusDBRecipe | null } | null>(
    null
  );
  const [priceTarget, setPriceTarget] = useState<PriceTarget | null>(null);
  const [sellTarget, setSellTarget] = useState<SellTarget | null>(null);

  useEffect(() => {
    if (!isOpen || recipe || itemId === undefined) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dofusdb/recipes?resultIds=${itemId}&limit=1`);
        const data: DofusDBResponse<DofusDBRecipe> = await res.json();
        if (!cancelled) setFetched({ itemId, recipe: data.data?.[0] ?? null });
      } catch (err) {
        console.error('Recipe fetch error:', err);
        if (!cancelled) setFetched({ itemId, recipe: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, recipe, itemId]);

  const active = recipe ?? (fetched && fetched.itemId === itemId ? fetched.recipe : null);
  const loading = !recipe && itemId !== undefined && fetched?.itemId !== itemId;

  const handleEditPrice = onEditPrice ?? setPriceTarget;
  const handleSell = onSell ?? setSellTarget;

  const name = active?.resultName?.fr || `Item #${active?.resultId ?? ''}`;
  const iconUrl = active?.result?.img || '';
  const resultPrice = active ? prices.get(active.resultId)?.price || 0 : 0;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Recette" size="lg">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-12" count={3} />
          </div>
        ) : active ? (
          <>
            <div className="flex items-center gap-4 mb-5">
              <CopyableIcon src={iconUrl} name={name} size="lg" />

              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    handleEditPrice({
                      id: active.resultId,
                      name,
                      iconUrl,
                      price: resultPrice,
                      superTypeId: active.result?.superTypeId,
                    })
                  }
                  className="group/name flex items-center gap-2 max-w-full cursor-pointer"
                  title="Modifier le prix de vente"
                >
                  <h3 className="text-sm font-semibold text-dark-100 truncate group-hover/name:text-kamas transition-colors">
                    {name}
                  </h3>
                  <Edit2
                    size={12}
                    className="text-dark-500 flex-shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity"
                  />
                </button>

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="warning">Niv. {active.resultLevel}</Badge>
                  {active.job?.name?.fr && <Badge>{active.job.name.fr}</Badge>}
                  <HdvBadge superTypeId={active.result?.superTypeId} />
                </div>
              </div>
            </div>

            <RecipeDetails
              recipe={active}
              prices={prices}
              resultPrice={resultPrice}
              onEditPrice={handleEditPrice}
              onSell={handleSell}
              showSummary
            />
          </>
        ) : (
          <p className="text-sm text-dark-500 py-4 text-center">
            Aucune recette trouvée pour cet item.
          </p>
        )}
      </Modal>

      {/* Only when the host did not claim them — see `onEditPrice` / `onSell` above. */}
      {!onEditPrice && (
        <PriceModal
          isOpen={priceTarget !== null}
          onClose={() => setPriceTarget(null)}
          item={priceTarget}
          onPriceSaved={onPriceSaved}
        />
      )}
      {!onSell && (
        <SellModal
          isOpen={sellTarget !== null}
          onClose={() => setSellTarget(null)}
          item={sellTarget}
          onSold={onSold}
        />
      )}
    </>
  );
};

export default RecipeModal;
