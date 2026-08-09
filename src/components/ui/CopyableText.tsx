'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Un texte qu'on ne lit pas : on le recopie ailleurs.
 *
 * Le nom d'un poulain se saisit **dans le jeu**, à la main, dans un champ de
 * vingt caractères. Le lire à l'écran puis le retaper est exactement l'endroit
 * où l'on se trompe d'une lettre — et un nom faux ne vaut pas mieux qu'un nom
 * absent, puisque toute son utilité tient au tri alphabétique de l'écurie.
 *
 * Frère de `CopyableIcon`, qui fait la même chose sur une icône d'item. Ici il
 * n'y a pas d'icône à cliquer, seulement le texte lui-même.
 */

type Props = {
  value: string;
  /** Ce que l'infobulle dit, quand « Copier … » ne suffit pas. */
  title?: string;
  className?: string;
  /**
   * Averti quand la copie a réellement abouti.
   *
   * L'ajout d'une monture s'en sert comme d'un verrou : tant que le nom n'est
   * pas dans le presse-papier, il n'a pas pu être collé dans le jeu, et
   * enregistrer la monture reviendrait à noter une ascendance que rien ne
   * permettra plus de retrouver en écurie.
   */
  onCopy?: () => void;
};

const CopyableText = ({ value, title, className = '', onCopy }: Props) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error('Clipboard copy failed:', error);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? `Copier « ${value} » dans le presse-papier`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-dark-900/60
        border border-dark-700/50 transition-all cursor-pointer hover:border-kamas/40 ${className}`}
    >
      <code className="text-[10px] text-dark-200">{value}</code>
      {copied ? (
        <Check size={10} className="text-gain shrink-0" />
      ) : (
        <Copy size={10} className="text-dark-500 shrink-0" />
      )}
    </button>
  );
};

export default CopyableText;
