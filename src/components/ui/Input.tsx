import { InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

/**
 * Le champ de saisie de l'app, étiquette et message d'erreur compris.
 *
 * ## L'étiquette doit être reliée, pas seulement posée à côté
 *
 * Le `<label>` n'avait ni `htmlFor` ni `id` en face : visuellement identique,
 * fonctionnellement muet. Cliquer « Prix (kamas) » ne focalisait pas le champ, un
 * lecteur d'écran annonçait un champ sans nom, et une requête par étiquette — ce
 * que fait n'importe quel pilote de test — ne le trouvait pas.
 *
 * `useId` plutôt qu'un compteur : il est stable entre le rendu serveur et le
 * rendu client, ce qui est exactement la propriété qu'un identifiant tiré au sort
 * n'a pas. Un `id` passé explicitement gagne, pour les appelants qui pointent
 * déjà dessus.
 *
 * ## L'erreur aussi
 *
 * Un message d'erreur non relié se voit et ne s'entend pas. `aria-describedby` le
 * rattache et `aria-invalid` dit l'état, ce qui est le même défaut que
 * l'étiquette et se corrige au même endroit.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', id, ...props }, ref) => {
    const generated = useId();
    const inputId = id ?? generated;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-dark-300">
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
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
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
          <p id={errorId} className="text-xs text-loss">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
