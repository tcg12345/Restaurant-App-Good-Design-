import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Heart, MessageCircle, Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Reel } from '../../contexts/ReelsContext';

function timeAgo(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

export const ProfileReelCard: React.FC<{ reel: Reel }> = ({ reel }) => {
  const navigate = useNavigate();
  const kindLabel = reel.kind === 'recipe' ? 'RECIPE' : 'PLACE';
  const title = reel.recipe?.title || reel.restaurant?.name || reel.caption || 'Reel';

  return (
    <article
      onClick={() => navigate(`/r/reel-${reel.id}`)}
      className="group cursor-pointer rounded-2xl overflow-hidden hover:-translate-y-0.5 transition-transform"
    >
      <div className="relative aspect-[9/14] overflow-hidden">
        {reel.posterUrl ? (
          <img src={reel.posterUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
        ) : reel.videoUrl ? (
          <video src={reel.videoUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className={cn('absolute inset-0 bg-gradient-to-br', reel.bgGradient || 'from-stone-700 via-amber-900 to-stone-900')} />
        )}

        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 h-[22px] rounded-md bg-black/45 backdrop-blur-md text-white text-[10px] font-bold tracking-[0.08em]">
          <Film size={11} />
          {kindLabel}
        </span>

        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/92 backdrop-blur grid place-items-center text-on-surface group-hover:scale-110 transition-transform shadow-lg">
          <Play size={20} className="fill-current ml-0.5" />
        </span>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-9">
          <h4 className="font-serif font-semibold text-white text-[15px] leading-tight line-clamp-2 mb-1.5 drop-shadow">
            {title}
          </h4>
          <div className="flex items-center gap-2.5 text-[11px] font-semibold text-white/90">
            <span className="inline-flex items-center gap-1">
              <Heart size={11} className="fill-white" />
              {reel.likes}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={11} />
              {reel.comments}
            </span>
            <span className="ml-auto font-medium opacity-85">{timeAgo(reel.createdAt)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};
