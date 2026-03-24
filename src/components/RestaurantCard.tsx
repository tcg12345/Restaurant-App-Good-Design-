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
  isMichelin?: boolean;
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
  isMichelin,
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
        <div className="relative aspect-[4/3] md:aspect-[3/2] overflow-hidden">
          <img
            src={image}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

          {isMichelin && (
            <div className="absolute top-3 left-3 md:top-2 md:left-2 glass px-3 md:px-2 py-1 md:py-0.5 rounded-full flex items-center gap-1.5 md:gap-1">
              <Star size={12} className="fill-primary text-primary md:w-2.5 md:h-2.5" />
              <span className="text-[10px] md:text-[8px] font-bold uppercase tracking-widest text-primary">Michelin</span>
            </div>
          )}

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="absolute top-3 right-3 md:top-2 md:right-2 p-2 md:p-1.5 glass rounded-full text-on-surface/60 hover:text-primary transition-colors z-10"
          >
            <Heart size={18} className="md:w-3.5 md:h-3.5" />
          </button>
        </div>

        <div className="p-4 md:p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-serif text-base md:text-sm font-bold leading-tight line-clamp-2 min-h-[2.75rem] md:min-h-[2.5rem]">{name}</h3>
            <div className="flex items-center gap-1 text-primary flex-shrink-0">
              <Star size={14} className="fill-primary md:w-3 md:h-3" />
              <span className="text-sm md:text-xs font-bold">{rating}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs md:text-[10px] text-on-surface/40 font-medium uppercase tracking-wider truncate">
            <span className="truncate">{cuisine}</span>
            <span>•</span>
            <span>{price}</span>
          </div>

          <div className="mt-2 flex items-center gap-1 text-xs md:text-[10px] text-on-surface/60">
            <MapPin size={12} className="md:w-2.5 md:h-2.5" />
            <span>{distance}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};
