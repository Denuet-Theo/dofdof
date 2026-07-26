import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-dark-300">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full px-4 py-2.5 rounded-xl
              bg-dark-800/80 border border-dark-600/50
              text-dark-100 placeholder:text-dark-500
              transition-all duration-200
              hover:border-dark-500
              focus:border-kamas/50 focus:bg-dark-800
              ${icon ? 'pl-10' : ''}
              ${error ? 'border-loss/50 focus:border-loss' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <p className="text-xs text-loss">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
