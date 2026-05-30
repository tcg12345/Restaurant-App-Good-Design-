import { Star, Leaf } from 'lucide-react';
import type { MichelinInfo } from '../lib/michelin';

interface MichelinBadgeProps {
  michelin: MichelinInfo;
  /** sm = compact inline (mobile header), md = roomier (desktop header). */
  size?: 'sm' | 'md';
  className?: string;
}

// Michelin red — the brand "Michelin Red" used on the Guide.
const MICHELIN_RED = '#a2191f';

/**
 * Star-rating badge for a Michelin-recognised restaurant: one filled star per
 * Michelin star, the "MICHELIN" wordmark, and a green-star leaf when awarded.
 * Rendered only on the detail page when a restaurant matches the Guide dataset.
 */
export function MichelinBadge({ michelin, size = 'sm', className = '' }: MichelinBadgeProps) {
  const starPx = size === 'sm' ? 13 : 15;
  const labelCls = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  const gapCls = size === 'sm' ? 'gap-1.5' : 'gap-2';
  const starCount = michelin.stars;
  const starLabel = `${starCount} Michelin ${starCount === 1 ? 'Star' : 'Stars'}`;

  return (
    <div
      className={`inline-flex items-center ${gapCls} rounded-full border px-2.5 py-1 ${className}`}
      style={{ borderColor: `${MICHELIN_RED}33`, backgroundColor: `${MICHELIN_RED}0d` }}
      role="img"
      aria-label={starLabel + (michelin.greenStar ? ', Michelin Green Star' : '')}
      title={starLabel}
    >
      <span className="inline-flex items-center" aria-hidden="true">
        {Array.from({ length: starCount }).map((_, i) => (
          <Star key={i} size={starPx} fill={MICHELIN_RED} color={MICHELIN_RED} strokeWidth={0} />
        ))}
      </span>
      <span
        className={`${labelCls} font-semibold uppercase tracking-[0.12em]`}
        style={{ color: MICHELIN_RED }}
      >
        Michelin
      </span>
      {michelin.greenStar && (
        <Leaf
          size={starPx}
          className="shrink-0"
          color="#2f7d32"
          fill="#2f7d32"
          strokeWidth={0}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
