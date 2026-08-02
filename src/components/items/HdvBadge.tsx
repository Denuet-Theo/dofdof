import Badge from '@/components/ui/Badge';
import { getHdvLabel } from '@/lib/dofus/hdv';

/**
 * L'hôtel de vente d'un item. Ne rend rien pour un super-type inconnu : mieux
 * vaut pas d'étiquette qu'une mauvaise (cf. `lib/dofus/hdv.ts`).
 */
const HdvBadge = ({
  superTypeId,
  className = '',
}: {
  superTypeId?: number | null;
  className?: string;
}) => {
  const label = getHdvLabel(superTypeId);
  if (!label) return null;

  return (
    <Badge variant="craft" className={className} title={`HDV : ${label}`}>
      {label}
    </Badge>
  );
};

export default HdvBadge;
