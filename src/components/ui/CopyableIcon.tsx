'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import ItemCard from '@/components/ui/ItemCard';

type IconSize = 'sm' | 'md' | 'lg';

/** The overlay glyph has to shrink with the icon well, or it fills the whole `sm` square. */
const GLYPH_SIZES: Record<IconSize, number> = { sm: 12, md: 14, lg: 16 };

interface CopyableIconProps {
  src?: string | null;
  /** Written to the clipboard on click — the in-game name, ready to paste into the HDV search. */
  name: string;
  size?: IconSize;
  /**
   * Floating "Copié !" badge. Turn it off inside cards that clip their content — any
   * `ItemCard` given an `expanded` panel does — where the badge would be cut in half.
   * The check mark drawn over the icon carries the confirmation on its own there.
   */
  toast?: boolean;
  scaleOnHover?: boolean;
}

/**
 * The item icon, everywhere: click it and the item's name lands in the clipboard.
 * Swallows the click so it never also triggers whatever the surrounding row does.
 */
const CopyableIcon = ({
  src,
  name,
  size = 'md',
  toast = true,
  scaleOnHover = true,
}: CopyableIconProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  const glyph = GLYPH_SIZES[size];

  return (
    <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <ItemCard.Icon
        src={src}
        alt={name}
        size={size}
        scaleOnHover={scaleOnHover}
        onClick={handleCopy}
        title={`Copier « ${name} » dans le presse-papier`}
        overlayVisible={copied}
        overlay={
          copied ? (
            <Check size={glyph} className="text-gain" />
          ) : (
            <Copy size={glyph} className="text-dark-100" />
          )
        }
      />
      {copied && toast && (
        <span className="absolute -top-2 -right-2 z-10 whitespace-nowrap px-2 py-0.5 rounded-full bg-gain text-dark-950 text-[10px] font-semibold shadow-lg animate-fade-in">
          Copié !
        </span>
      )}
    </div>
  );
};

export default CopyableIcon;
