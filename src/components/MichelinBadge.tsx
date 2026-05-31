import { Star, Leaf, ExternalLink, Soup, Utensils } from 'lucide-react';
import type { MichelinInfo } from '../lib/michelin';

interface MichelinBadgeProps {
  michelin: MichelinInfo;
  /** sm = compact inline (mobile header), md = roomier (desktop header). */
  size?: 'sm' | 'md';
  /**
   * When provided, the badge renders as a link to this URL (the Michelin Guide
   * page) and shows an external-link affordance. Without it, it's a static
   * label (used on cards where the whole card is already a link).
   */
  href?: string;
  className?: string;
}

// Michelin red — the brand "Michelin Red" used on the Guide.
const MICHELIN_RED = '#a2191f';

/**
 * Distinction badge for a Michelin-recognised restaurant. Starred restaurants
 * show one filled star per award plus the "MICHELIN" wordmark; Bib Gourmand
 * shows a bib/soup glyph plus "BIB GOURMAND"; Selected (in the Guide, no
 * star/bib) shows a utensils glyph plus "MICHELIN SELECTED". A green-star leaf
 * is appended when awarded. When `href` is set it becomes a tappable link to
 * the restaurant's Michelin Guide page (with an external-link glyph); otherwise
 * it's a static pill.
 */
export function MichelinBadge({ michelin, size = 'sm', href, className = '' }: MichelinBadgeProps) {
  const iconPx = size === 'sm' ? 13 : 15;
  const labelCls = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  const gapCls = size === 'sm' ? 'gap-1.5' : 'gap-2';
  const isBib = michelin.bibGourmand;
  const isSelected = michelin.selected;
  const distinction = isBib
    ? 'Bib Gourmand'
    : isSelected
      ? 'Michelin Selected'
      : `${michelin.stars} Michelin ${michelin.stars === 1 ? 'Star' : 'Stars'}`;
  const ariaLabel = distinction + (michelin.greenStar ? ', Michelin Green Star' : '');

  const inner = (
    <>
      <span className="inline-flex items-center" aria-hidden="true">
        {isBib ? (
          <Soup size={iconPx} color={MICHELIN_RED} strokeWidth={2.2} />
        ) : isSelected ? (
          <Utensils size={iconPx} color={MICHELIN_RED} strokeWidth={2.2} />
        ) : (
          Array.from({ length: michelin.stars }).map((_, i) => (
            <Star key={i} size={iconPx} fill={MICHELIN_RED} color={MICHELIN_RED} strokeWidth={0} />
          ))
        )}
      </span>
      <span
        className={`${labelCls} font-semibold uppercase tracking-[0.12em]`}
        style={{ color: MICHELIN_RED }}
      >
        {isBib ? 'Bib Gourmand' : isSelected ? 'Michelin Selected' : 'Michelin'}
      </span>
      {michelin.greenStar && (
        <Leaf
          size={iconPx}
          className="shrink-0"
          color="#2f7d32"
          fill="#2f7d32"
          strokeWidth={0}
          aria-hidden="true"
        />
      )}
      {href && (
        <ExternalLink
          size={size === 'sm' ? 11 : 12}
          className="shrink-0"
          style={{ color: `${MICHELIN_RED}99` }}
          aria-hidden="true"
        />
      )}
    </>
  );

  const baseCls = `inline-flex items-center ${gapCls} rounded-full border px-2.5 py-1 ${className}`;
  const style = { borderColor: `${MICHELIN_RED}33`, backgroundColor: `${MICHELIN_RED}0d` };

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${baseCls} transition-colors hover:brightness-95 active:opacity-80`}
        style={style}
        aria-label={`${ariaLabel} — view on the Michelin Guide`}
        title="View on the Michelin Guide"
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={baseCls} style={style} role="img" aria-label={ariaLabel} title={distinction}>
      {inner}
    </div>
  );
}
