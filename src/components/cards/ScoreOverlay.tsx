import React from 'react';
import { cn } from '../../lib/utils';
import { ScoreBadge } from '../ScoreBadge';

/**
 * Positions a ScoreBadge over a photo on tile variants. Bottom-left by default
 * (matching the immersive reference), with a soft drop shadow for legibility
 * over any image. Renders nothing when there's no score. For rows, use
 * ScoreBadge directly in the right-hand control cluster.
 */
type Position = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

const positionClass: Record<Position, string> = {
  'bottom-left': 'bottom-2 left-2',
  'bottom-right': 'bottom-2 right-2',
  'top-left': 'top-2 left-2',
  'top-right': 'top-2 right-2',
};

export const ScoreOverlay: React.FC<{
  rating?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  position?: Position;
  className?: string;
}> = ({ rating, size = 'sm', position = 'bottom-left', className }) => {
  if (!rating || rating <= 0) return null;
  return (
    <div className={cn('absolute z-10', positionClass[position], className)}>
      <ScoreBadge rating={rating} size={size} className="shadow-md shadow-black/20" />
    </div>
  );
};
