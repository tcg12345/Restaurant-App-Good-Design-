import React from 'react';
import { Heart, Plus, Building2, ImageOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { ScoreBadge } from './ScoreBadge';

export { ScoreBadge } from './ScoreBadge';

/**
 * Cover image or "no photos added yet" placeholder. The app has intentionally
 * stopped requesting photos from Google Places (every Photo URL fetch is a
 * separately-billed API call); only user-uploaded photos survive. When a
 * restaurant has none yet, render a tidy placeholder instead of a broken img.
 */
const CoverImage: React.FC<{
  src?: string | null;
  alt: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ src, alt, className, size = 'md' }) => {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1 text-on-surface/30', className)}>
      <ImageOff size={size === 'sm' ? 14 : size === 'lg' ? 22 : 18} />
      {size !== 'sm' && (
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-on-surface/40 text-center px-1 leading-tight">
          No photos yet
        </span>
      )}
    </div>
  );
};

/**
 * Visual variant.
 *  - 'card' (default): bordered vertical card with image on top, metadata
 *    below. Used in grids and search results.
 *  - 'list-item': borderless horizontal row — thumbnail / text / score.
 *    Parents control dividers between items (`divide-y` etc.).
 *  - 'hero': large image with title overlaid on a dark gradient. For
 *    horizontal scrolls (Home top-rated, Profile top-rated, etc.).
 */
export type RestaurantCardVariant = 'card' | 'list-item' | 'hero';

interface RestaurantCardProps {
  id: string;
  name: string;
  image: string;
  rating: number;
  price: string;
  cuisine: string;
  distance?: string;
  friendReviews?: number;
  expertReviews?: number;
  onAdd?: () => void;
  onHeart?: () => void;
  isWishlisted?: boolean;
  isHotel?: boolean;
  variant?: RestaurantCardVariant;
  className?: string;
}

/* ── Component ────────────────────────────────────────────────────────────── */
export const RestaurantCard: React.FC<RestaurantCardProps> = ({
  id,
  name,
  image,
  rating,
  price,
  cuisine,
  onAdd,
  onHeart,
  isWishlisted = false,
  isHotel = false,
  variant = 'card',
  className,
}) => {
  // Shared click-stopper for in-card buttons so they don't trigger the Link.
  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    fn?.();
  };

  const heartButton = onHeart ? (
    <button
      type="button"
      onClick={(e) => stop(e, onHeart)}
      className={cn(
        'w-9 h-9 rounded-full flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
        isWishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
      )}
      aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <Heart size={16} className={cn(isWishlisted && 'fill-primary')} />
    </button>
  ) : null;

  const addButton = onAdd ? (
    <button
      type="button"
      onClick={(e) => stop(e, onAdd)}
      className="w-9 h-9 rounded-full flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
      aria-label="Add to list"
    >
      <Plus size={16} />
    </button>
  ) : null;

  const hotelPill = (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md">
      <Building2 size={9} className="text-white" />
      <span className="text-[9px] font-bold text-white uppercase tracking-wider">Hotel</span>
    </div>
  );

  /* ── List-item variant ─────────────────────────────────────────────────
     Borderless horizontal row. The parent renders dividers between items.
     Thumbnail is 64px square so the food still feels appetizing in a list.
     ──────────────────────────────────────────────────────────────────── */
  if (variant === 'list-item') {
    return (
      <Link
        to={`/restaurant/${id}`}
        className={cn(
          'group flex items-center gap-3 py-3 transition-colors hover:bg-on-surface/[0.03] rounded-lg',
          className,
        )}
      >
        <div className="relative w-16 h-16 flex-shrink-0 overflow-hidden rounded-lg bg-on-surface/5">
          <CoverImage
            src={image}
            alt={name}
            size="sm"
            className="h-full w-full object-cover"
          />
          {isHotel && (
            <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/45 backdrop-blur-sm flex items-center justify-center gap-0.5">
              <Building2 size={8} className="text-white" />
              <span className="text-[8px] font-bold text-white uppercase tracking-wider">Hotel</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[15px] font-bold text-on-surface line-clamp-1 leading-snug">
            {name}
          </h3>
          <p className="mt-0.5 text-xs text-on-surface/55 font-medium uppercase tracking-wider truncate">
            {cuisine}
            {price && <span className="text-on-surface/25 mx-1.5">·</span>}
            {price}
          </p>
        </div>

        <ScoreBadge rating={rating} size="sm" />
      </Link>
    );
  }

  /* ── Hero variant ──────────────────────────────────────────────────────
     Full-bleed image with the title overlaid on a bottom gradient. Image
     dominates; text is secondary. Score badge sits in the gradient next to
     the title so it's immediately legible.
     ──────────────────────────────────────────────────────────────────── */
  if (variant === 'hero') {
    return (
      <Link
        to={`/restaurant/${id}`}
        className={cn(
          'group block relative aspect-[4/3] overflow-hidden rounded-2xl bg-on-surface/5',
          className,
        )}
      >
        <CoverImage
          src={image}
          alt={name}
          size="lg"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />

        {/* Bottom gradient for legibility under the title */}
        <div
          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.1) 80%, transparent 100%)',
          }}
        />

        {/* Top action row */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 z-10">
          <div>{isHotel && hotelPill}</div>
          <div className="flex items-center gap-2">
            {heartButton}
            {addButton}
          </div>
        </div>

        {/* Bottom title + score row */}
        <div className="absolute inset-x-0 bottom-0 p-4 z-10 flex items-end justify-between gap-3">
          <div className="min-w-0 pointer-events-none">
            <h3 className="font-serif text-lg font-bold text-white leading-tight drop-shadow-md line-clamp-2">
              {name}
            </h3>
            <p className="mt-1 text-xs text-white/85 font-medium uppercase tracking-wider truncate">
              {cuisine}
              {price && <span className="text-white/55 mx-1.5">·</span>}
              {price}
            </p>
          </div>
          <ScoreBadge rating={rating} size="lg" className="shadow-md shadow-black/20" />
        </div>
      </Link>
    );
  }

  /* ── Default card variant ──────────────────────────────────────────────
     Vertical bordered card. Uses the shared card-interactive utility so it
     matches every other tappable card surface in the app. Score badge sits
     at the bottom-right of the image where it's instantly visible.
     ──────────────────────────────────────────────────────────────────── */
  return (
    <Link
      to={`/restaurant/${id}`}
      className={cn('group block card-interactive overflow-hidden', className)}
    >
      <div className="relative aspect-[4/5] sm:aspect-[4/3] overflow-hidden bg-on-surface/5">
        <CoverImage
          src={image}
          alt={name}
          size="md"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />

        {/* Top action row — hotel pill on the left, rate/wishlist on the right */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-2 z-10">
          <div>{isHotel && hotelPill}</div>
          <div className="flex items-center gap-1.5">
            {heartButton}
            {addButton}
          </div>
        </div>

        {/* Bottom-right score badge */}
        <div className="absolute bottom-2.5 right-2.5 z-10">
          <ScoreBadge rating={rating} size="sm" className="shadow-md shadow-black/20" />
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-3">
        <h3 className="font-serif text-[15px] sm:text-base font-bold leading-snug text-on-surface line-clamp-2">
          {name}
        </h3>
        <p className="mt-1 text-xs text-on-surface/55 font-medium uppercase tracking-wider truncate">
          {cuisine}
          {price && <span className="text-on-surface/25 mx-1.5">·</span>}
          {price}
        </p>
      </div>
    </Link>
  );
};
