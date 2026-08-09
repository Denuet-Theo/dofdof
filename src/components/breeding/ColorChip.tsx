import ItemCard from '@/components/ui/ItemCard';

/**
 * La vignette d'une couleur, et son badge de génération.
 *
 * Extraits de `BreedingMatingPanel`, qui les a introduits pour reproduire la
 * fenêtre d'accouplement du jeu. Ils en sortent parce que la même paire sert
 * désormais partout où l'on désigne une couleur — l'écurie, l'ajout d'une
 * monture — et qu'une seconde vignette dessinée autrement obligerait à traduire
 * d'un écran à l'autre. C'est justement ce que la vignette évite : devant
 * 120 couleurs, on reconnaît un certificat, on ne lit pas un nom.
 *
 * Présentationnel, sans état : ni l'un ni l'autre n'a besoin d'être client.
 */

/**
 * Repli sur le code deux lettres quand l'icône manque — le même code que celui
 * des noms de montures, donc rien à apprendre de plus. Ne se produit que si
 * `trees.json` n'a pas rattaché le certificat à la couleur.
 */
const ColorChip = ({
  name,
  code,
  icon,
  size = 'md',
}: {
  name: string;
  code: string;
  icon: string | null;
  size?: 'sm' | 'md' | 'lg';
}) => {
  if (icon) {
    return (
      <ItemCard.Icon
        src={icon}
        alt={name}
        size={size === 'lg' ? 'md' : 'sm'}
        scaleOnHover={false}
        className="rounded-lg"
      />
    );
  }

  const boxes = { sm: 'w-8 h-8 text-[8px]', md: 'w-8 h-8 text-[9px]', lg: 'w-12 h-12 text-[10px]' };
  return (
    <span
      className={`${boxes[size]} shrink-0 rounded-lg bg-gradient-to-br from-dark-700 to-dark-900
        border border-dark-600/50 flex items-center justify-center font-bold tracking-tight
        text-kamas/80`}
      title={name}
    >
      {code}
    </span>
  );
};

export const GenBadge = ({
  generation,
  target = false,
}: {
  generation: number;
  target?: boolean;
}) => (
  <span
    className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-tight ${
      target ? 'bg-kamas/20 text-kamas' : 'bg-dark-700/70 text-dark-300'
    }`}
  >
    GEN. {generation}
  </span>
);

export default ColorChip;
