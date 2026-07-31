import { ReactNode } from 'react';
import ItemCard from '@/components/ui/ItemCard';

interface ItemPreviewProps {
  name: string;
  iconUrl?: string | null;
  subtitle?: ReactNode;
  /** Extra control pinned to the right, e.g. the "Achat HDV" toggle. */
  action?: ReactNode;
}

/** The item header shown at the top of the price / sell modals. */
const ItemPreview = ({ name, iconUrl, subtitle, action }: ItemPreviewProps) => (
  <div className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50">
    <ItemCard.Icon src={iconUrl} alt={name} size="md" />
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-dark-100 truncate">{name}</p>
      {subtitle ? <div className="text-sm text-dark-500">{subtitle}</div> : null}
    </div>
    {action}
  </div>
);

export default ItemPreview;
