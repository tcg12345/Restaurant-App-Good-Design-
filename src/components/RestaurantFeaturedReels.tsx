/**
 * RestaurantFeaturedReels — horizontal strip of reel / post cards that
 * feature a specific restaurant. Used in:
 *   • RestaurantPanel (in-feed side panel)
 *   • RestaurantDetailMobile / Desktop (full detail page)
 *
 * Until reels are actually populated against a restaurant we render a
 * deterministic set of filler cards whose titles adapt to the restaurant
 * name so the section reads as content, not chrome. Order is stable
 * per-restaurant-id so different views of the same place show the same
 * cards in the same order.
 */
import React from 'react';
import { motion } from 'motion/react';
import { Play, Heart } from 'lucide-react';
import { cn } from '../lib/utils';

interface FillerCardSpec {
  titleTemplate: (name: string) => string;
  gradient: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  likes: number;
  kind: 'reel' | 'post';
}

const FILLER_DECK: FillerCardSpec[] = [
  {
    titleTemplate: (n) => `Inside ${n}`,
    gradient: 'from-stone-800 via-stone-900 to-black',
    authorHandle: 'clara.eats',
    authorInitials: 'CE',
    authorColor: 'bg-amber-500',
    likes: 1247,
    kind: 'reel',
  },
  {
    titleTemplate: (n) => `What's good at ${n}`,
    gradient: 'from-rose-900 via-stone-900 to-stone-900',
    authorHandle: 'lukewalsh',
    authorInitials: 'LW',
    authorColor: 'bg-violet-600',
    likes: 832,
    kind: 'reel',
  },
  {
    titleTemplate: (n) => `First bite: ${n}`,
    gradient: 'from-emerald-900 via-stone-900 to-stone-900',
    authorHandle: 'amir.food',
    authorInitials: 'AF',
    authorColor: 'bg-olive',
    likes: 4783,
    kind: 'post',
  },
  {
    titleTemplate: (n) => `Late night at ${n}`,
    gradient: 'from-violet-900 via-indigo-950 to-stone-900',
    authorHandle: 'nadia.bites',
    authorInitials: 'NB',
    authorColor: 'bg-clay',
    likes: 612,
    kind: 'reel',
  },
  {
    titleTemplate: (n) => `Dessert at ${n}`,
    gradient: 'from-orange-800 via-rose-900 to-stone-900',
    authorHandle: 'evan.tastes',
    authorInitials: 'ET',
    authorColor: 'bg-teal-600',
    likes: 2104,
    kind: 'post',
  },
  {
    titleTemplate: (n) => `Why everyone loves ${n}`,
    gradient: 'from-amber-800 via-stone-900 to-stone-900',
    authorHandle: 'remi.dines',
    authorInitials: 'RD',
    authorColor: 'bg-rose-500',
    likes: 928,
    kind: 'reel',
  },
];

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

/** Pick a deterministic offset into FILLER_DECK from a restaurant id so the
 *  same place always renders the same starting card. */
function offsetForRestaurant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % FILLER_DECK.length;
}

interface CardProps {
  spec: FillerCardSpec;
  restaurantName: string;
  size: 'sm' | 'md';
}

const FillerCard: React.FC<CardProps> = ({ spec, restaurantName, size }) => {
  const widthCls = size === 'sm' ? 'w-[120px]' : 'w-[150px]';
  const heightCls = size === 'sm' ? 'h-[214px]' : 'h-[267px]';
  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className={cn(
        widthCls,
        heightCls,
        'relative flex-shrink-0 rounded-[18px] overflow-hidden text-left',
        'ring-1 ring-on-surface/[0.08] shadow-sm hover:shadow-md transition-shadow',
        'bg-gradient-to-br',
        spec.gradient,
      )}
      aria-label={`${spec.titleTemplate(restaurantName)} by @${spec.authorHandle}`}
    >
      {/* Subtle inner texture for visual interest on filler thumbs */}
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.12),transparent_60%)]" />
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_85%,rgba(255,255,255,0.06),transparent_55%)]" />

      {/* Top-right play indicator (reels) or stack hint (posts) */}
      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
        {spec.kind === 'reel' ? (
          <Play size={12} className="text-white fill-white ml-0.5" />
        ) : (
          <span className="block w-3 h-3 rounded-[3px] ring-1 ring-white/80" />
        )}
      </div>

      {/* Bottom legibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/75 via-black/30 to-transparent" />

      {/* Content overlay */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 flex flex-col gap-1.5">
        <p className="font-serif italic text-white text-[13px] leading-tight line-clamp-2 drop-shadow">
          {spec.titleTemplate(restaurantName)}
        </p>
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold ring-1 ring-white/30 flex-shrink-0',
              spec.authorColor,
            )}>
              {spec.authorInitials}
            </span>
            <span className="text-white/85 text-[10px] font-mono truncate">@{spec.authorHandle}</span>
          </div>
          <span className="inline-flex items-center gap-0.5 text-white/80 text-[10px] tabular-nums">
            <Heart size={9} className="fill-white/85" />
            {formatCount(spec.likes)}
          </span>
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
  const offset = offsetForRestaurant(restaurantId);
  const deck = [...FILLER_DECK.slice(offset), ...FILLER_DECK.slice(0, offset)];
  const gapCls = size === 'sm' ? 'gap-2.5' : 'gap-3';
  const padCls = size === 'sm' ? 'px-0.5 py-0.5' : 'px-0.5 py-1';
  const fadeFromCls = size === 'sm' ? 'bg-gradient-to-r from-surface' : '';

  return (
    <section className={className}>
      {withHeader && (
        <>
          <p className="section-eyebrow mb-1">
            Featured In
          </p>
          <h2 className={cn('section-title mb-1', size === 'sm' && 'text-[18px]')}>
            More from {restaurantName}
          </h2>
          <p className={cn('text-on-surface/55 mb-4', size === 'sm' ? 'text-[12px]' : 'text-[13px]')}>
            Reels and posts featuring this place
          </p>
        </>
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
          {deck.map((spec, idx) => (
            <div key={`${spec.authorHandle}-${idx}`} className="snap-start">
              <FillerCard spec={spec} restaurantName={restaurantName} size={size} />
            </div>
          ))}
        </div>
        {/* Right-edge fade hint that there's more content — only useful
            in the narrow panel where the strip is more obviously cut off. */}
        {fadeFromCls && (
          <div className={cn('pointer-events-none absolute inset-y-0 right-0 w-6', fadeFromCls)} />
        )}
      </div>
    </section>
  );
};
