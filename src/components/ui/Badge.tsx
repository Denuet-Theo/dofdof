import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'craft';
  className?: string;
  /** Native tooltip, for badges that stand in for a longer explanation. */
  title?: string;
}

const Badge = ({ children, variant = 'default', className = '', title }: BadgeProps) => {
  const variants = {
    default: 'bg-dark-700/60 text-dark-300 border-dark-600/30',
    success: 'bg-gain/10 text-gain border-gain/20',
    danger: 'bg-loss/10 text-loss border-loss/20',
    warning: 'bg-kamas/10 text-kamas border-kamas/20',
    info: 'bg-info/10 text-info-light border-info/20',
    craft: 'bg-craft/10 text-craft border-craft/20',
  };

  return (
    <span
      title={title}
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full
        text-xs font-medium border
        ${variants[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
};

export default Badge;
