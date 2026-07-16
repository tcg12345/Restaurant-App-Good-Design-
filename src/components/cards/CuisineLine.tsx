import React from 'react';
import { cn } from '../../lib/utils';
import { MichelinMark } from '../MichelinBadge';
import type { MichelinInfo } from '../../lib/michelin';

/**
 * The "Cuisine · $$" line under a card name. Muted gray, **normal case** (the
 * old uppercase + letter-spacing is intentionally gone), with the same dotted
 * separator everywhere. Optional trailing Michelin mark (only passed where a
 * Michelin filter is active).
 */
interface CuisineLineProps {
  cuisine?: string;
  price?: string;
  /** Render the distinction mark after the price. Caller decides when. */
  michelin?: MichelinInfo | null;
  className?: string;
}

export const CuisineLine: React.FC<CuisineLineProps> = ({ cuisine, price, michelin, className }) => {
  const label = cuisine;
  const showPrice = !!price;
  if (!label && !showPrice && !michelin) return null;
  return (
    <p className={cn('truncate text-[12.5px] font-medium text-on-surface/55', className)}>
      {label}
      {label && showPrice ? <span className="mx-1.5 text-on-surface/25">·</span> : null}
      {showPrice ? price : null}
      {michelin && (
        <span className="ml-1.5 inline-flex items-center align-middle">
          <MichelinMark michelin={michelin} size={12} />
        </span>
      )}
    </p>
  );
};
