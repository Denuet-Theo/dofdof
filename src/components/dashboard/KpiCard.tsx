import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: ReactNode;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  accentColor?: string;
}

const KpiCard = ({
  title,
  value,
  icon: Icon,
  trend,
  accentColor = 'kamas',
}: KpiCardProps) => {
  return (
    <div className="glass rounded-2xl p-6 hover:shadow-lg hover:shadow-kamas/5 transition-all duration-300 group">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-dark-400 font-medium">{title}</p>
          <div className="text-2xl font-bold text-dark-100">{value}</div>
          {trend && (
            <div
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                trend.value >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              <span>{trend.value >= 0 ? '↑' : '↓'}</span>
              <span>
                {Math.abs(trend.value)}% {trend.label}
              </span>
            </div>
          )}
        </div>
        <div
          className={`w-12 h-12 rounded-xl bg-${accentColor}/10 flex items-center justify-center
            group-hover:scale-110 transition-transform duration-300`}
        >
          <Icon size={22} className={`text-${accentColor}`} />
        </div>
      </div>
    </div>
  );
};

export default KpiCard;
