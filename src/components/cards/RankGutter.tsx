import React from 'react';
import { cn } from '../../lib/utils';

/**
 * The "#1 / #2 / #3" leaderboard number column shown to the left of ranked
 * rows (LocationPage top-rated, numbered profile recipe lists). Muted serif so
 * the name still leads.
 */
export const RankGutter: React.FC<{ rank: number; className?: string }> = ({ rank, className }) => (
  <span
    className={cn(
      'flex-shrink-0 font-serif text-[15px] font-medium tabular-nums text-on-surface/40',
      className,
    )}
  >
    <span className="mr-0.5 text-on-surface/25">#</span>
    {rank}
  </span>
);
