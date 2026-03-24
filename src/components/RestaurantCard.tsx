import React from 'react';
import { Star, MapPin, Heart } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

interface RestaurantCardProps {
  id: string;
  name: string;
  image: string;
  rating: number;
  price: string;
  cuisine: string;
  distance: string;

  className?: string;
}

export const RestaurantCard: React.FC<RestaurantCardProps> = ({
  id,
  name,
  image,
  rating,
  price,
  cuisine,
  distance,

  className,
}) => {
  return (
    <Link to={`/restaurant/${id}`}>
      <motion.div
        whileHover={{ y: -5 }}
        className={cn(
          "group relative overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-500 hover:shadow-xl",
          className
        )}
      >
        <div className="relative aspect-[3/4] sm:aspect-[4/3] lg:aspect-[3/2] overflow-hidden">
          <img
            src={image}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="absolute top-2.5 right-2.5 sm:top-2 sm:right-2 p-2 sm:p-2 lg:p-1.5 glass rounded-full text-on-surface/60 hover:text-primary transition-colors z-10"
          >
            <Heart size={18} className="sm:w-4.5 sm:h-4.5 lg:w-3.5 lg:h-3.5" />
          </button>
        </div>

        <div className="p-3 sm:p-3">
          <div className="flex items-start justify-between gap-1.5 mb-0.5">
            <h3 className="font-serif text-sm sm:text-base lg:text-sm font-bold leading-tight line-clamp-2 min-h-[2.25rem] lg:min-h-[2.5rem]">{name}</h3>
            <div className="flex items-center gap-0.5 text-primary flex-shrink-0">
              <Star size={13} className="fill-primary sm:w-3.5 sm:h-3.5 lg:w-3 lg:h-3" />
              <span className="text-xs sm:text-sm lg:text-xs font-bold">{rating}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs lg:text-[10px] text-on-surface/40 font-medium uppercase tracking-wider truncate">
            <span className="truncate">{cuisine}</span>
            <span>•</span>
            <span>{price}</span>
          </div>

          <div className="mt-1.5 flex items-center gap-1 text-[11px] sm:text-xs lg:text-[10px] text-on-surface/60">
            <MapPin size={12} className="sm:w-3 sm:h-3 lg:w-2.5 lg:h-2.5" />
            <span>{distance}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};
