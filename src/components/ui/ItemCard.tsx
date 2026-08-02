import { ReactNode } from 'react';

/**
 * The single shell every item/product card in the app is built from.
 *
 * Two layouts, one visual language:
 *  - `grid` — icon left, stacked info right. Used in the results grids (/items, /gauges).
 *  - `row`  — icon, info, then right-aligned metric columns. Used in the full-width
 *             lists (/recipes, /inventory) and the dashboard Top 10.
 *
 * Presentational only — no state, no data access, so it stays a server component.
 */

type Layout = 'grid' | 'row';
type IconSize = 'sm' | 'md' | 'lg';

const ICON_SIZES: Record<IconSize, { well: string; img: string }> = {
  sm: { well: 'w-8 h-8 rounded-lg', img: 'w-6 h-6' },
  md: { well: 'w-12 h-12 rounded-xl', img: 'w-10 h-10' },
  lg: { well: 'w-16 h-16 rounded-xl', img: 'w-12 h-12' },
};

/**
 * `glass` is the standalone card sitting on the page background.
 * `flat` is the same card nested inside another panel (Top 10 rows, ingredient rows),
 * where a second layer of glass would muddy the one underneath.
 */
type Variant = 'glass' | 'flat';

/**
 * Each variant carries its own group name. Tailwind's `group-hover/name:` compiles to a
 * plain descendant selector, so a shared name would let an outer card's hover fire the
 * hover styles of every card nested inside it.
 */
const VARIANTS: Record<Variant, { shell: string; inner: string; group: string }> = {
  glass: {
    shell: 'glass rounded-2xl hover:shadow-lg hover:shadow-kamas/5',
    inner: 'gap-4 p-4',
    group: 'group/card',
  },
  flat: {
    shell: 'bg-dark-800/30 rounded-xl hover:bg-dark-800/60',
    inner: 'gap-3 p-3',
    group: 'group/row',
  },
};

interface ItemCardProps {
  children: ReactNode;
  layout?: Layout;
  variant?: Variant;
  /** Draws the gold ring used to mark a stand-out card (best ratio, etc.). */
  highlight?: boolean;
  /** Fades the card back, for items that are done (sold). */
  dimmed?: boolean;
  /**
   * Full-width panel rendered under the main line, inside the card's border.
   * Passing it also clips the card, so cards with floating decorations
   * (badges bleeding outside the border) should nest their panel in the body instead.
   */
  expanded?: ReactNode;
  onClick?: () => void;
  className?: string;
}

const ItemCard = ({
  children,
  layout = 'grid',
  variant = 'glass',
  highlight = false,
  dimmed = false,
  expanded,
  onClick,
  className = '',
}: ItemCardProps) => {
  const expandable = expanded !== undefined;
  const styles = VARIANTS[variant];

  return (
    <div
      className={`
        ${styles.shell} ${styles.group} transition-all duration-300
        ${expandable ? 'overflow-hidden' : ''}
        ${highlight ? 'ring-1 ring-kamas/40' : ''}
        ${dimmed ? 'opacity-75' : ''}
        ${className}
      `}
    >
      <div
        onClick={onClick}
        className={`
          flex ${styles.inner}
          ${layout === 'row' ? 'items-center' : 'items-start'}
          ${onClick ? 'cursor-pointer hover:bg-dark-800/30 transition-colors' : ''}
        `}
      >
        {children}
      </div>

      {expanded ? (
        <div className="border-t border-dark-700/30 p-4 animate-fade-in">{expanded}</div>
      ) : null}
    </div>
  );
};

interface IconProps {
  src?: string | null;
  alt: string;
  size?: IconSize;
  /** Shown centred over the image on hover — turns the icon into a button. */
  overlay?: ReactNode;
  /** Keeps the overlay up without hover, for confirming an action that just happened. */
  overlayVisible?: boolean;
  onClick?: () => void;
  title?: string;
  /**
   * Grow slightly when the surrounding card is hovered. Turn it off for icons in rows
   * nested inside another card, which would otherwise also react to the outer card.
   */
  scaleOnHover?: boolean;
  className?: string;
}

const Icon = ({
  src,
  alt,
  size = 'md',
  overlay,
  overlayVisible = false,
  onClick,
  title,
  scaleOnHover = true,
  className = '',
}: IconProps) => {
  const { well, img } = ICON_SIZES[size];

  const shell = `
    relative ${well} bg-dark-700/50 flex items-center justify-center
    flex-shrink-0 overflow-hidden transition-transform
    ${scaleOnHover ? 'group-hover/card:scale-105' : ''}
    ${className}
  `;

  const content = (
    <>
      {src ? (
        <img src={src} alt={alt} className={`${img} object-contain`} loading="lazy" />
      ) : (
        <div className={`${img} rounded-lg bg-dark-600`} />
      )}
      {overlay ? (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-dark-950/70 transition-opacity ${
            overlayVisible ? 'opacity-100' : 'opacity-0 hover:opacity-100'
          }`}
        >
          {overlay}
        </div>
      ) : null}
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${shell} cursor-pointer`}>
      {content}
    </button>
  ) : (
    <div className={shell}>{content}</div>
  );
};

interface BodyProps {
  children: ReactNode;
  className?: string;
  /** Set when the info column is separately clickable from the card itself. */
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

const Body = ({ children, className = '', onClick }: BodyProps) => (
  <div className={`flex-1 min-w-0 ${className}`} onClick={onClick}>
    {children}
  </div>
);

const Title = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <h3 className={`text-sm font-semibold text-dark-100 truncate ${className}`}>{children}</h3>
);

const Badges = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex items-center gap-2 mt-1 flex-wrap ${className}`}>{children}</div>
);

const Metrics = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex items-center gap-6 flex-shrink-0 ${className}`}>{children}</div>
);

interface MetricProps {
  label: ReactNode;
  children: ReactNode;
  /** Drops the column on narrow screens, for secondary figures. */
  hideOnMobile?: boolean;
  className?: string;
}

const Metric = ({ label, children, hideOnMobile = false, className = '' }: MetricProps) => (
  <div
    className={`text-right flex-shrink-0 ${hideOnMobile ? 'hidden sm:block' : ''} ${className}`}
  >
    <p className="text-[10px] text-dark-500">{label}</p>
    {children}
  </div>
);

const Actions = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex items-center gap-2 flex-shrink-0 ${className}`}>{children}</div>
);

ItemCard.Icon = Icon;
ItemCard.Body = Body;
ItemCard.Title = Title;
ItemCard.Badges = Badges;
ItemCard.Metrics = Metrics;
ItemCard.Metric = Metric;
ItemCard.Actions = Actions;

export default ItemCard;
