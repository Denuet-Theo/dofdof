'use client';

import { useState } from 'react';
import { DofusDBItem, ItemPrice } from '@/lib/supabase/types';
import ItemCard from '@/components/ui/ItemCard';
import Badge from '@/components/ui/Badge';
import CopyableIcon from '@/components/ui/CopyableIcon';
import ItemPriceInput from '@/components/items/ItemPriceInput';
import RecipeModal from '@/components/recipes/RecipeModal';
import { Eye } from 'lucide-react';
import { formatTimeAgo } from '@/lib/utils/date';

interface ItemPriceCardProps {
  item: DofusDBItem;
  prices: Map<number, ItemPrice>;
  currentPrice?: number;
  updatedAt?: string;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
}

const ItemPriceCard = ({
  item,
  prices,
  currentPrice,
  updatedAt,
  onPriceSaved,
}: ItemPriceCardProps) => {
  const [showRecipe, setShowRecipe] = useState(false);
  const name = item.name?.fr || `Item #${item.id}`;

  return (
    <>
      <ItemCard layout="grid">
        <CopyableIcon src={item.img} name={name} size="lg" />

        <ItemCard.Body>
          <ItemCard.Title>{name}</ItemCard.Title>

          <ItemCard.Badges>
            <Badge variant="warning">Niv. {item.level}</Badge>
            {item.type?.name?.fr && <Badge>{item.type.name.fr}</Badge>}
            {item.hasRecipe && (
              // Used to be a link to /recipes?search=, which threw away the search and
              // the tab on the way out. The popin keeps the page exactly where it is.
              <button type="button" onClick={() => setShowRecipe(true)}>
                <Badge
                  variant="info"
                  className="gap-1 hover:bg-info/20 cursor-pointer transition-colors"
                >
                  <Eye size={10} />
                  Voir la recette
                </Badge>
              </button>
            )}
            {updatedAt && (
              <span className="text-[10px] text-dark-500">MAJ : {formatTimeAgo(updatedAt)}</span>
            )}
          </ItemCard.Badges>

          <ItemPriceInput
            className="mt-3"
            itemId={item.id}
            itemName={name}
            iconUrl={item.img}
            currentPrice={currentPrice}
            onPriceSaved={onPriceSaved}
          />
        </ItemCard.Body>
      </ItemCard>

      {/* /items never loads recipes, so the popin fetches this one the first time it opens. */}
      <RecipeModal
        isOpen={showRecipe}
        onClose={() => setShowRecipe(false)}
        itemId={item.id}
        prices={prices}
        onPriceSaved={onPriceSaved}
      />
    </>
  );
};

export default ItemPriceCard;
