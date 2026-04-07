import React from 'react';
import { motion } from 'motion/react';

interface ExpertCardProps {
  name: string;
  role: string;
  image: string;
  stats: string;
}

export const ExpertCard: React.FC<ExpertCardProps> = ({ name, role, image, stats }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="relative aspect-square rounded-3xl overflow-hidden group cursor-pointer"
    >
      <img
        src={image}
        alt={name}
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      
      <div className="absolute bottom-6 left-6 right-6 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 mb-1">{role}</p>
        <h3 className="font-serif text-2xl font-bold leading-tight mb-2">{name}</h3>
        <p className="text-xs font-medium text-white/80">{stats}</p>
      </div>
    </motion.div>
  );
};
