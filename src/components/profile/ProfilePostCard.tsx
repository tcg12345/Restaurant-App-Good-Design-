import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Heart, MessageCircle, Layers } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Post } from '../../contexts/PostsContext';

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

export const ProfilePostCard: React.FC<{ post: Post }> = ({ post }) => {
  const navigate = useNavigate();
  const cover = post.items[0];
  const photoCount = post.items.length;
  const place = post.locationLabel || post.items[0]?.restaurant?.name || '';

  return (
    <article
      onClick={() => navigate(`/r/post-${post.id}`)}
      className={cn(
        'group cursor-pointer rounded-2xl overflow-hidden',
        'bg-[var(--color-paper)] border border-[var(--color-line)]',
        'shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {cover?.mediaType === 'video' && cover.mediaUrl ? (
          <video src={cover.mediaUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
        ) : cover?.mediaUrl ? (
          <img src={cover.mediaUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className={cn('absolute inset-0 bg-gradient-to-br', cover?.bgGradient || 'from-stone-700 to-stone-900')} />
        )}

        <span className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-black/35 backdrop-blur-md grid place-items-center text-white">
          <Camera size={13} />
        </span>

        {photoCount > 1 && (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-black/45 backdrop-blur-md text-white text-[11px] font-bold tabular-nums">
            <Layers size={11} />
            {photoCount}
          </span>
        )}

        {post.caption && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-3.5 pb-3 pt-7">
              <p className="font-serif italic text-white text-[14px] leading-snug line-clamp-2 drop-shadow">
                {post.caption}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="px-3.5 py-3 flex items-center justify-between gap-2.5">
        <div className="min-w-0 flex items-center gap-1.5 text-[12px] text-[var(--color-ink-3)]">
          {place && <span className="text-[var(--color-ink-2)] font-medium truncate">{place}</span>}
          {place && <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-ink-4)] flex-shrink-0" />}
          <span className="whitespace-nowrap">{timeAgo(post.createdAt)}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px] font-semibold text-[var(--color-ink-2)] flex-shrink-0">
          <span className="inline-flex items-center gap-1">
            <Heart size={12} className="fill-primary text-primary" />
            {post.likesCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle size={12} className="text-primary" />
            {post.commentsCount}
          </span>
        </div>
      </div>
    </article>
  );
};
