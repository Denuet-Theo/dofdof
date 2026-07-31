'use client';

import { DofusDBItem } from '@/lib/supabase/types';
import ItemCard from '@/components/ui/ItemCard';
import Badge from '@/components/ui/Badge';
import ItemPriceInput from '@/components/items/ItemPriceInput';
import { formatTimeAgo } from '@/lib/utils/date';

interface ItemPriceCardProps {
  item: DofusDBItem;
  currentPrice?: number;
  updatedAt?: string;
  onPriceSaved?: (itemId: number, price: number, updatedAt: string) => void;
}

const ItemPriceCard = ({ item, currentPrice, updatedAt, onPriceSaved }: ItemPriceCardProps) => {
  const name = item.name?.fr || `Item #${item.id}`;

  return (
    <ItemCard layout="grid">
      <ItemCard.Icon src={item.img} alt={name} size="lg" />

      <ItemCard.Body>
        <ItemCard.Title>{name}</ItemCard.Title>

        <ItemCard.Badges>
          <Badge variant="warning">Niv. {item.level}</Badge>
          {item.type?.name?.fr && <Badge>{item.type.name.fr}</Badge>}
          {item.hasRecipe && (
            <a href={`/recipes?search=${encodeURIComponent(item.name?.fr || '')}`} className="inline-flex">
              <Badge variant="info" className="hover:bg-info/20 cursor-pointer transition-colors">
                Voir la recette →
              </Badge>
            </a>
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
  );
};

export default ItemPriceCard;
