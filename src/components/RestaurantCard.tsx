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
        <div className="relative aspect-[3/2] overflow-hidden">
          <img
            src={image}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          
          {isMichelin && (
            <div className="absolute top-2 left-2 glass px-2 py-0.5 rounded-full flex items-center gap-1">
              <Star size={10} className="fill-primary text-primary" />
              <span className="text-[8px] font-bold uppercase tracking-widest text-primary">Michelin</span>
            </div>
          )}

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="absolute top-2 right-2 p-1.5 glass rounded-full text-on-surface/60 hover:text-primary transition-colors z-10"
          >
            <Heart size={14} />
          </button>
        </div>

        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-serif text-sm font-bold leading-tight line-clamp-2 min-h-[2.5rem]">{name}</h3>
            <div className="flex items-center gap-1 text-primary flex-shrink-0">
              <Star size={12} className="fill-primary" />
              <span className="text-xs font-bold">{rating}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-on-surface/40 font-medium uppercase tracking-wider truncate">
            <span className="truncate">{cuisine}</span>
            <span>•</span>
            <span>{price}</span>
          </div>

          <div className="mt-2 flex items-center gap-1 text-[10px] text-on-surface/60">
            <MapPin size={10} />
            <span>{distance}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};
