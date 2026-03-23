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
        <div className="relative aspect-[4/5] overflow-hidden">
          <img
            src={image}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          
          {isMichelin && (
            <div className="absolute top-4 left-4 glass px-3 py-1 rounded-full flex items-center gap-1.5">
              <Star size={12} className="fill-primary text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Michelin</span>
            </div>
          )}
          
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="absolute top-4 right-4 p-2 glass rounded-full text-on-surface/60 hover:text-primary transition-colors z-10"
          >
            <Heart size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between mb-1">
            <h3 className="font-serif text-lg font-bold leading-tight">{name}</h3>
            <div className="flex items-center gap-1 text-primary">
              <Star size={14} className="fill-primary" />
              <span className="text-sm font-bold">{rating}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-on-surface/40 font-medium uppercase tracking-wider">
            <span>{cuisine}</span>
            <span>•</span>
            <span>{price}</span>
          </div>
          
          <div className="mt-3 flex items-center gap-1 text-xs text-on-surface/60">
            <MapPin size={12} />
            <span>{distance}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};
