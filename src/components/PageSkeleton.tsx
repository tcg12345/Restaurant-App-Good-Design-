import React from 'react';
import { LoadingSkeletonList, SKELETON_PULSE } from './LoadingSkeleton';
import { cn } from '../lib/utils';

export type PageSkeletonVariant = 'list' | 'detail' | 'profile' | 'calendar';

/** Content-shaped, theme-aware fallback. Keep navigation outside this surface. */
export function PageSkeleton({ variant = 'list', compact = false }: { variant?: PageSkeletonVariant; compact?: boolean }) {
  return <div role="status" aria-label="Loading content" aria-busy="true" data-page-skeleton={variant}
    className={cn('bg-surface text-on-surface w-full', !compact && 'min-h-[80dvh] pb-28')}>
    <span className="sr-only">Loading content…</span>
    <div aria-hidden="true" className={cn('mx-auto max-w-4xl px-5', compact ? 'py-4' : 'pt-safe-5')}>
      {variant === 'detail' && <div className={cn(SKELETON_PULSE, 'h-[32dvh] rounded-2xl mb-6')} />}
      <div className="flex items-center gap-4 mb-7">
        {variant === 'profile' && <div className={cn(SKELETON_PULSE, 'size-20 rounded-full shrink-0')} />}
        <div className="flex-1 space-y-3">
          <div className={cn(SKELETON_PULSE, 'h-7 w-2/5 rounded-lg')} />
          <div className={cn(SKELETON_PULSE, 'h-3 w-3/5 rounded')} />
        </div>
        <div className={cn(SKELETON_PULSE, 'size-10 rounded-full')} />
      </div>
      {variant === 'calendar' ? <div className="grid grid-cols-7 gap-3 mb-7">
        {Array.from({ length: 35 }, (_, i) => <div key={i} className={cn(SKELETON_PULSE, 'aspect-square rounded-lg')} />)}
      </div> : <div className="flex gap-3 mb-5">
        {[24, 20, 16].map(w => <div key={w} className={cn(SKELETON_PULSE, 'h-9 rounded-full')} style={{ width: `${w}%` }} />)}
      </div>}
      <LoadingSkeletonList count={compact ? 3 : 5} variant="list-item" />
    </div>
  </div>;
}
