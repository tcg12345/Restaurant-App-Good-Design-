import React from 'react';
import { Star, Heart, Plus, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

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

  className?: string;
}

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

  className,
}) => {
  return (
    <Link to={`/restaurant/${id}`} className={cn('group block', className)}>
      <div className="relative aspect-[4/5] sm:aspect-[4/3] overflow-hidden rounded-2xl bg-on-surface/5">
        <img
          src={image}
          alt={name}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          referrerPolicy="no-referrer"
        />

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onHeart?.();
          }}
          className={cn(
            'absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center bg-black/25 backdrop-blur-md transition-colors z-10',
            isWishlisted ? 'text-red-400' : 'text-white hover:text-red-300',
          )}
          aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart size={15} className={cn(isWishlisted && 'fill-red-400')} />
        </button>

        {onAdd && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAdd();
            }}
            className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full flex items-center justify-center bg-black/25 backdrop-blur-md text-white hover:text-primary transition-colors z-10"
            aria-label="Add to list"
          >
            <Plus size={15} />
          </button>
        )}

        {isHotel && (
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md z-10">
            <Building2 size={9} className="text-white" />
            <span className="text-[9px] font-bold text-white uppercase tracking-wider">Hotel</span>
          </div>
        )}
      </div>

      <div className="pt-2.5 pb-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-[15px] sm:text-base font-bold leading-snug text-on-surface line-clamp-2 flex-1">
            {name}
          </h3>
          <div
            className={cn(
              'flex items-center gap-0.5 flex-shrink-0 pt-0.5',
              isHotel ? 'text-teal-600' : 'text-primary',
            )}
          >
            <Star
              size={12}
              className={cn(isHotel ? 'fill-teal-600' : 'fill-primary')}
            />
            <span className="text-xs font-bold">{rating}</span>
          </div>
        </div>
        <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
          {cuisine}
          {price && <span className="text-on-surface/25 mx-1.5">·</span>}
          {price}
        </p>
      </div>
    </Link>
  );
};
