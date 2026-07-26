import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

const Card = ({ children, className = '', hover = false, glow = false }: CardProps) => {
  return (
    <div
      className={`
        glass rounded-2xl p-6
        ${hover ? 'glass-hover cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-kamas/5' : ''}
        ${glow ? 'animate-pulse-glow' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
};

export default Card;
