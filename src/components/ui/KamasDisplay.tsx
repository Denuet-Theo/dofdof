interface KamasDisplayProps {
  amount: number;
  size?: 'sm' | 'md' | 'lg';
  colored?: boolean;
  className?: string;
}

const KamasDisplay = ({
  amount,
  size = 'md',
  colored = false,
  className = '',
}: KamasDisplayProps) => {
  const formatKamas = (value: number): string => {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString('fr-FR');
  };

  const sizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg font-bold',
  };

  const colorClass = colored
    ? amount > 0
      ? 'text-gain'
      : amount < 0
        ? 'text-loss'
        : 'text-dark-300'
    : '';

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-mono tabular-nums
        ${sizes[size]}
        ${colorClass}
        ${className}
      `}
    >
      {colored && amount > 0 && '+'}
      {formatKamas(amount)}
      <img src="/kamas.svg" alt="Kamas" className="w-[1.2em] h-[1.2em] inline-block -mt-0.5" />
    </span>
  );
};

export default KamasDisplay;
