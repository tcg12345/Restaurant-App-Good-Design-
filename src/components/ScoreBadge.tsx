import React from 'react';
import { cn } from '../lib/utils';
import { scoreBadgeBg, scoreColor } from '../lib/score';

/**
 * Single source of truth for how a numeric rating renders on a card or row
 * anywhere in the app. A soft pastel circle: light tinted background,
 * matching darker text, thin matching border. Color-coded by score band
 * (green ≥8, amber 5–7, red <5).
 *
 * Returns null when the rating is missing/zero so callers can drop it in
 * unconditionally without an empty placeholder.
 */
export const ScoreBadge: React.FC<{
  rating: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({ rating, size = 'md', className }) => {
  if (!rating || rating <= 0) return null;
  const dims =
    size === 'xs' ? 'w-7 h-7 text-[11px]'
    : size === 'sm' ? 'w-9 h-9 text-sm'
    : size === 'lg' ? 'w-12 h-12 text-base'
    : size === 'xl' ? 'w-14 h-14 text-lg'
    : 'w-10 h-10 text-sm';
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold tabular-nums border flex-shrink-0',
        dims,
        scoreBadgeBg(rating),
        scoreColor(rating),
        className,
      )}
      aria-label={`Score ${rating.toFixed(1)}`}
    >
      {rating.toFixed(1)}
    </div>
  );
};
