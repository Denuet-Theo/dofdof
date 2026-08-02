import { ReactNode } from 'react';
import CopyableIcon from '@/components/ui/CopyableIcon';
import HdvBadge from '@/components/items/HdvBadge';

interface ItemPreviewProps {
  name: string;
  iconUrl?: string | null;
  subtitle?: ReactNode;
  /** Extra control pinned to the right, e.g. the "Achat HDV" toggle. */
  action?: ReactNode;
  /** Optionnel : tous les appelants ne connaissent pas le super-type de l'item. */
  superTypeId?: number | null;
}

/**
 * The item header shown at the top of the price / sell modals.
 *
 * The icon copies the name like everywhere else in the app: these modals are
 * exactly where you are about to look the item up in the in-game HDV, so having
 * to close the popin to copy it from a card behind was the wrong way round.
 */
const ItemPreview = ({ name, iconUrl, subtitle, action, superTypeId }: ItemPreviewProps) => (
  <div className="flex items-center gap-4 p-4 rounded-xl bg-dark-800/50">
    <CopyableIcon src={iconUrl} name={name} size="md" scaleOnHover={false} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <p className="font-semibold text-dark-100 truncate">{name}</p>
        <HdvBadge superTypeId={superTypeId} className="flex-shrink-0" />
      </div>
      {subtitle ? <div className="text-sm text-dark-500">{subtitle}</div> : null}
    </div>
    {action}
  </div>
);

export default ItemPreview;
