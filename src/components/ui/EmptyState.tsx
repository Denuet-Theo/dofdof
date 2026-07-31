import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
}

const EmptyState = ({ icon: Icon, title, description }: EmptyStateProps) => (
  <div className="text-center py-16">
    <Icon size={48} className="mx-auto text-dark-600 mb-4" />
    <p className="text-dark-400 text-lg font-medium">{title}</p>
    {description ? <p className="text-dark-500 text-sm mt-1">{description}</p> : null}
  </div>
);

export default EmptyState;
