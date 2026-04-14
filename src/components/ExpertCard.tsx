import React from 'react';
import { motion } from 'motion/react';
import { Check, Crown } from 'lucide-react';

interface ExpertCardProps {
  name: string;
  role: string;
  image: string;
  stats: string;
  isFollowed?: boolean;
  onFollow?: (e: React.MouseEvent) => void;
}

export const ExpertCard: React.FC<ExpertCardProps> = ({
  name,
  role,
  image,
  stats,
  isFollowed = false,
  onFollow,
}) => {
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

      {/* Bottom content: name + stats on left, follow pill on right */}
      <div className="absolute inset-x-5 bottom-5 text-white flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Crown size={11} className="text-amber-400" />
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">{role}</p>
          </div>
          <h3 className="font-serif text-xl font-bold leading-tight mb-1 truncate">{name}</h3>
          <p className="text-[12px] font-medium text-white/80 truncate">{stats}</p>
        </div>
        {onFollow && (
          isFollowed ? (
            <div className="flex-shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-full bg-white/15 backdrop-blur-md border border-white/25">
              <Check size={12} className="text-white/90" />
              <span className="text-[11px] font-bold text-white/90">Following</span>
            </div>
          ) : (
            <button
              onClick={onFollow}
              className="flex-shrink-0 px-3.5 h-8 rounded-full bg-white text-on-surface text-[11px] font-bold shadow-sm hover:bg-white/95 active:scale-[0.97] transition-all"
            >
              Follow
            </button>
          )
        )}
      </div>
    </motion.div>
  );
};
