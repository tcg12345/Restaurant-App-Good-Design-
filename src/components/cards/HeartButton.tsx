import React from 'react';
import { Heart, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Stop a nested control from triggering the card's <Link>/onClick. */
const stop = (e: React.MouseEvent, fn?: () => void) => {
  e.preventDefault();
  e.stopPropagation();
  fn?.();
};

/**
 * Circular wishlist toggle, overlaid on a photo. Frosted white pill so it reads
 * over any image; fills with the brand color when saved. Lifted verbatim from
 * the old RestaurantCard so every surface gets the same control.
 */
export const HeartButton: React.FC<{
  filled?: boolean;
  onClick?: () => void;
  className?: string;
}> = ({ filled = false, onClick, className }) => (
  <button
    type="button"
    onClick={(e) => stop(e, onClick)}
    className={cn(
      'flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur-sm transition-transform duration-150 hover:scale-105 active:scale-95',
      filled ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
      className,
    )}
    aria-label={filled ? 'Remove from wishlist' : 'Add to wishlist'}
  >
    <Heart size={16} className={cn(filled && 'fill-primary')} />
  </button>
);

/** Circular "add to list" control, sibling to the heart on photo tiles. */
export const AddButton: React.FC<{
  onClick?: () => void;
  className?: string;
}> = ({ onClick, className }) => (
  <button
    type="button"
    onClick={(e) => stop(e, onClick)}
    className={cn(
      'flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm backdrop-blur-sm transition-transform duration-150 hover:scale-105 active:scale-95',
      className,
    )}
    aria-label="Add to list"
  >
    <Plus size={16} />
  </button>
);
