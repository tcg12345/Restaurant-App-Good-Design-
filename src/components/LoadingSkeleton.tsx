import React from 'react';
import { cn } from '../lib/utils';

/**
 * Shared loading skeleton. Replaces the assorted `<Loader2 animate-spin />`,
 * custom spinner divs, and "Loading…" text strings scattered through the app
 * so every pending state looks identical: a subtle on-surface pulse at the
 * same tint everywhere.
 *
 * Variants:
 *  - 'card': image + two text bars. Matches a RestaurantCard placeholder.
 *  - 'list-item': thumbnail / text / trailing circle. Matches the list-item
 *    variant of RestaurantCard for feeds and search results.
 *  - 'avatar': standalone circle.
 *  - 'text': 3-line paragraph with staggered widths.
 *
 * Render a single item per call. When you need N placeholders, map over an
 * array — keeping the primitive single-use makes it easier to compose.
 */
export type LoadingSkeletonVariant = 'card' | 'list-item' | 'avatar' | 'text';

interface LoadingSkeletonProps {
  variant?: LoadingSkeletonVariant;
  className?: string;
}

// Base pulse tint reused everywhere so dividers and skeletons share one
// color. Exported because screens with their own row geometry (the
// messages list, the circle's activity feed) build bespoke placeholders
// that still have to pulse at exactly this tint.
export const SKELETON_PULSE = 'animate-pulse bg-on-surface/[0.06]';
const PULSE = SKELETON_PULSE;

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant = 'card',
  className,
}) => {
  switch (variant) {
    case 'avatar':
      return (
        <div
          className={cn(PULSE, 'rounded-full w-10 h-10 flex-shrink-0', className)}
          aria-hidden="true"
        />
      );

    case 'list-item':
      return (
        <div
          className={cn('flex items-center gap-3 py-3', className)}
          aria-hidden="true"
        >
          <div className={cn(PULSE, 'rounded-lg w-16 h-16 flex-shrink-0')} />
          <div className="flex-1 space-y-2 min-w-0">
            <div className={cn(PULSE, 'rounded h-4 w-3/5')} />
            <div className={cn(PULSE, 'rounded h-3 w-2/5')} />
          </div>
          <div className={cn(PULSE, 'rounded-full w-9 h-9 flex-shrink-0')} />
        </div>
      );

    case 'text':
      return (
        <div className={cn('space-y-2', className)} aria-hidden="true">
          <div className={cn(PULSE, 'rounded h-3 w-full')} />
          <div className={cn(PULSE, 'rounded h-3 w-5/6')} />
          <div className={cn(PULSE, 'rounded h-3 w-3/5')} />
        </div>
      );

    case 'card':
    default:
      return (
        <div className={cn('space-y-2.5', className)} aria-hidden="true">
          <div className={cn(PULSE, 'aspect-[4/3] w-full rounded-2xl')} />
          <div className={cn(PULSE, 'rounded h-4 w-4/5')} />
          <div className={cn(PULSE, 'rounded h-3 w-3/5')} />
        </div>
      );
  }
};

/**
 * Convenience wrapper for the common "show N placeholders" case. Lets
 * callers write `<LoadingSkeletonList count={5} variant="list-item" />`
 * instead of mapping an array inline.
 */
export const LoadingSkeletonList: React.FC<{
  count: number;
  variant?: LoadingSkeletonVariant;
  className?: string;
  itemClassName?: string;
}> = ({ count, variant = 'list-item', className, itemClassName }) => {
  return (
    <div className={cn(variant === 'card' ? 'grid grid-cols-2 gap-3' : '', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <LoadingSkeleton key={i} variant={variant} className={itemClassName} />
      ))}
    </div>
  );
};
