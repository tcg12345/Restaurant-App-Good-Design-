/**
 * RestaurantFeaturedReels — horizontal strip of real reel cards that
 * feature a specific restaurant. Used in:
 *   • RestaurantPanel (in-feed side panel)
 *   • RestaurantDetailMobile / Desktop (full detail page)
 *
 * It fetches the reels tagged to this restaurant (`reels.restaurant_id`)
 * and renders their real posters, captions, authors and like counts.
 * Tapping a card opens the focused reel viewer at `/r/reel-<id>`.
 *
 * There is no placeholder content: while loading it renders nothing, and
 * if the restaurant has no reels yet the whole section hides itself
 * (returns null) so the page never shows invented cards.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Play, Heart } from 'lucide-react';
import { cn, firstFrameSrc } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { listReelsForRestaurant, type ReelRow } from '../lib/supabase-reels';

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

const DEFAULT_BG = 'from-stone-800 via-stone-900 to-black';

interface CardProps {
  reel: ReelRow;
  size: 'sm' | 'md';
  onOpen: () => void;
}

const ReelCard: React.FC<CardProps> = ({ reel, size, onOpen }) => {
  const widthCls = size === 'sm' ? 'w-[120px]' : 'w-[150px]';
  const heightCls = size === 'sm' ? 'h-[214px]' : 'h-[267px]';
  const title = reel.caption?.trim() || reel.restaurant?.name || 'Reel';
  const handle = reel.author?.username || reel.userId.slice(0, 8);
  const initials = reel.author?.initials || handle.slice(0, 2).toUpperCase();
  const likes = reel.likesCount;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className={cn(
        widthCls,
        heightCls,
        'relative flex-shrink-0 rounded-[18px] overflow-hidden text-left',
        'ring-1 ring-on-surface/[0.08] shadow-sm hover:shadow-md transition-shadow',
        'bg-gradient-to-br',
        reel.bgGradient || DEFAULT_BG,
      )}
      aria-label={`${title} by @${handle}`}
    >
      {/* Real poster frame (Mux thumbnail or signed storage poster). Falls
          back to the reel's own gradient while it decodes / if absent. */}
      {reel.posterUrl ? (
        <img
          src={reel.posterUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 w-full h-full object-cover"
        />
      ) : reel.videoUrl ? (
        <video
          src={firstFrameSrc(reel.videoUrl)}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 w-full h-full object-cover"
        />
      ) : null}

      {/* Top-right play indicator */}
      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/35 backdrop-blur flex items-center justify-center">
        <Play size={12} className="text-white fill-white ml-0.5" />
      </div>

      {/* Bottom legibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {/* Content overlay */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 flex flex-col gap-1.5">
        <p className="font-serif italic text-white text-[13px] leading-tight line-clamp-2 drop-shadow">
          {title}
        </p>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold ring-1 ring-white/30 flex-shrink-0',
              reel.author?.avatarColor || 'bg-stone-600',
            )}>
              {initials}
            </span>
            <span className="text-white/85 text-[10px] font-mono truncate">@{handle}</span>
          </div>
          {likes > 0 && (
            <span className="inline-flex items-center gap-0.5 text-white/80 text-[10px] tabular-nums">
              <Heart size={9} className="fill-white/85" />
              {formatCount(likes)}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
};

interface RestaurantFeaturedReelsProps {
  restaurantId: string;
  restaurantName: string;
  /** Visual size of each card. `sm` is used inside the narrow side panel,
   *  `md` is used on the full restaurant detail page. */
  size?: 'sm' | 'md';
  /** When true (default) the heading/eyebrow are rendered. The panel can
   *  set this to false and supply its own section chrome to match the
   *  surrounding cards. */
  withHeader?: boolean;
  className?: string;
}

export const RestaurantFeaturedReels: React.FC<RestaurantFeaturedReelsProps> = ({
  restaurantId,
  restaurantName,
  size = 'md',
  withHeader = true,
  className,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [reels, setReels] = useState<ReelRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setReels([]);
    if (!restaurantId) { setLoaded(true); return; }
    (async () => {
      const rows = await listReelsForRestaurant(restaurantId, {
        viewerId: user?.id ?? null,
      }).catch(() => null);
      if (cancelled) return;
      setReels(rows || []);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [restaurantId, user?.id]);

  // No filler: hide entirely until we've confirmed there are real reels.
  if (!loaded || reels.length === 0) return null;

  const gapCls = size === 'sm' ? 'gap-2.5' : 'gap-3';
  const padCls = size === 'sm' ? 'px-0.5 py-0.5' : 'px-0.5 py-1';
  const fadeFromCls = size === 'sm' ? 'bg-gradient-to-r from-surface' : '';

  return (
    <section className={className}>
      {withHeader && (
        <h2 className={cn('section-title mb-3', size === 'sm' && 'text-[18px]')}>
          More from {restaurantName}
        </h2>
      )}

      <div className="relative">
        <div
          className={cn(
            'flex overflow-x-auto scrollbar-hide snap-x snap-mandatory',
            gapCls,
            padCls,
            '-mx-0.5',
          )}
          style={{ scrollbarWidth: 'none' }}
        >
          {reels.map((reel) => (
            <div key={reel.id} className="snap-start">
              <ReelCard
                reel={reel}
                size={size}
                onOpen={() => navigate(`/r/reel-${reel.id}`)}
              />
            </div>
          ))}
        </div>
        {/* Right-edge fade hint that there's more content — only useful
            in the narrow panel where the strip is more obviously cut off. */}
        {fadeFromCls && reels.length > 2 && (
          <div className={cn('pointer-events-none absolute inset-y-0 right-0 w-6', fadeFromCls)} />
        )}
      </div>
    </section>
  );
};
