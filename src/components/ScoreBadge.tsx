import React from 'react';
import { cn } from '../lib/utils';
import { scoreBadgeBg, scoreColor, SCORE_TIER_HEX } from '../lib/score';
import { tierOfScore } from '../lib/settleScores';

/** Sentiment-tier dot color for a score (loved/fine/disliked bands). */
const tierDotHex = (score: number): string => {
  const t = tierOfScore(score);
  return t === 'loved' ? SCORE_TIER_HEX.high : t === 'fine' ? SCORE_TIER_HEX.mid : SCORE_TIER_HEX.low;
};

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

/**
 * The user's OWN score, honoring the Beli-style score lock: renders the
 * normal numeric ScoreBadge once scores are unlocked, and a sentiment
 * badge (tier emoji, no digits) while they're still locked. Callers pass
 * `unlocked` from useLists().scoresUnlocked. Community/other-user scores
 * keep using ScoreBadge directly — the lock only hides YOUR numbers.
 */
export const OwnScoreBadge: React.FC<{
  rating: number;
  unlocked: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({ rating, unlocked, size = 'md', className }) => {
  if (!rating || rating <= 0) return null;
  if (unlocked) return <ScoreBadge rating={rating} size={size} className={className} />;
  const dims =
    size === 'xs' ? 'w-7 h-7'
    : size === 'sm' ? 'w-9 h-9'
    : size === 'lg' ? 'w-12 h-12'
    : size === 'xl' ? 'w-14 h-14'
    : 'w-10 h-10';
  const dot =
    size === 'xs' ? 'w-1.5 h-1.5'
    : size === 'sm' ? 'w-2 h-2'
    : size === 'lg' || size === 'xl' ? 'w-2.5 h-2.5'
    : 'w-2 h-2';
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center border border-on-surface/10 bg-on-surface/[0.04] flex-shrink-0',
        dims,
        className,
      )}
      aria-label="Score hidden until you rate more places"
    >
      <span className={cn('rounded-full', dot)} style={{ background: tierDotHex(rating) }} />
    </div>
  );
};
