/**
 * PostSlide — full-screen vertical slot for a multi-item post.
 *
 * Renders:
 *   • Horizontal swipeable carousel (scroll-snap) of the post's items.
 *   • Page dots near the top tracking the active item.
 *   • Author chip, caption (per-item with post-level fallback), location
 *     label below the caption, and an attached restaurant or recipe card
 *     pinned to the bottom.
 *
 * Action rail (mobile) + side actions (desktop) operate on the WHOLE post
 * (one set of like / comment / save / share counts) — those live in the
 * page-level Reels component, not here, and toggle via the prop callbacks.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Heart, MessageCircle, Bookmark, Share2, ChefHat, ChevronRight, Star, Trash2, MapPin, PlayCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Post, PostItemRow } from '../contexts/PostsContext';

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

function formatRecipeMeta(prepTime: number, cookTime: number, servings: number, difficulty: 'Easy' | 'Medium' | 'Hard'): string {
  const total = (prepTime || 0) + (cookTime || 0);
  const time = total > 0 ? `${total} min` : '';
  const serv = servings > 0 ? `${servings} servings` : '';
  return [time, serv, difficulty].filter(Boolean).join(' · ');
}

/* ── In-reel action rail (mobile only — desktop uses page-level rail) ── */

const ActionRail: React.FC<{
  post: Post;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
}> = ({ post, onLike, onSave, onComment, onShare }) => (
  <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-5 select-none">
    <button type="button" onClick={onLike} className="flex flex-col items-center gap-1 group" aria-label="Like">
      <motion.span whileTap={{ scale: 0.8 }} className={cn('w-11 h-11 rounded-full flex items-center justify-center transition-colors', post.liked ? 'text-rose-500' : 'text-white group-hover:text-white/80')}>
        <Heart size={30} strokeWidth={2.2} className={cn(post.liked && 'fill-rose-500')} />
      </motion.span>
      <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(post.likesCount)}</span>
    </button>
    <button type="button" onClick={onComment} className="flex flex-col items-center gap-1 group" aria-label="Comments">
      <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80">
        <MessageCircle size={28} strokeWidth={2.2} />
      </span>
      <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(post.commentsCount)}</span>
    </button>
    <button type="button" onClick={onSave} className="flex flex-col items-center gap-1 group" aria-label="Save">
      <motion.span whileTap={{ scale: 0.8 }} className={cn('w-11 h-11 rounded-full flex items-center justify-center transition-colors', post.saved ? 'text-amber-300' : 'text-white group-hover:text-white/80')}>
        <Bookmark size={28} strokeWidth={2.2} className={cn(post.saved && 'fill-amber-300')} />
      </motion.span>
      <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(post.savesCount)}</span>
    </button>
    <button type="button" onClick={onShare} className="flex flex-col items-center gap-1 group" aria-label="Share">
      <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80">
        <Share2 size={26} strokeWidth={2.2} />
      </span>
      <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">Share</span>
    </button>
  </div>
);

/* ── Bottom card (per-item attachment) ─────────────────────────────── */

const RestaurantCard: React.FC<{ item: PostItemRow; onClick: () => void }> = ({ item, onClick }) => {
  const r = item.restaurant!;
  const score = r.score ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur pl-2 pr-3 py-2 text-left shadow-lg hover:bg-white"
    >
      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-rose-700 to-orange-700 flex items-center justify-center">
        {r.image ? (
          <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-white text-[10px] font-bold uppercase tracking-widest text-center px-1">{r.cuisine}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Featured place</p>
        <p className="text-[15px] font-bold leading-tight text-stone-900 truncate">{r.name}</p>
        <p className="text-[11px] text-stone-500 truncate mt-0.5">
          {[r.cuisine, r.price].filter(Boolean).join(' · ')}
        </p>
      </div>
      {score > 0 && (
        <span className="inline-flex items-center justify-center min-w-[40px] h-9 px-2.5 rounded-xl text-sm font-bold tabular-nums bg-emerald-700 text-white">
          {score.toFixed(1)}
        </span>
      )}
      <ChevronRight size={16} className="text-stone-400 flex-shrink-0" />
    </button>
  );
};

const RecipeCard: React.FC<{ item: PostItemRow; onClick: () => void }> = ({ item, onClick }) => {
  const r = item.recipe!;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur pl-2 pr-2 py-2 text-left shadow-lg hover:bg-white"
    >
      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-blue-50 flex items-center justify-center">
        {r.image ? (
          <img src={r.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <ChefHat size={26} className="text-blue-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Recipe</p>
        <p className="text-[15px] font-bold leading-tight text-stone-900 truncate">{r.title}</p>
        <p className="text-[11px] text-stone-500 truncate mt-0.5">{formatRecipeMeta(r.prepTime, r.cookTime, r.servings, r.difficulty)}</p>
      </div>
      <span className="px-3.5 h-9 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">View</span>
    </button>
  );
};

/* ── Single media frame (image or muted-loop video) ────────────────── */

interface MediaFrameProps {
  item: PostItemRow;
  /** True when the parent post is the active feed item. Drives which
   *  carousel items get heavy media DOM versus a cheap gradient. */
  postActive: boolean;
  /** True when this is the currently-focused item in the carousel. */
  itemActive: boolean;
  /** Render real media when within this distance of the active item. */
  shouldRenderMedia: boolean;
  muted: boolean;
}

const MediaFrame: React.FC<MediaFrameProps> = ({ item, postActive, itemActive, shouldRenderMedia, muted }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (postActive && itemActive && item.mediaType === 'video') {
      el.muted = muted;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [postActive, itemActive, muted, item.mediaType]);

  // Default fallback — gradient placeholder. Used for any item far from
  // the active one, or when the signed URL isn't ready yet.
  const placeholder = (
    <div className={cn('absolute inset-0 bg-gradient-to-b', item.bgGradient || 'from-stone-800 to-stone-900')}>
      {item.mediaType === 'video' && !item.mediaUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PlayCircle size={48} className="text-white/40" />
        </div>
      )}
    </div>
  );

  if (!shouldRenderMedia || !item.mediaUrl) return placeholder;

  if (item.mediaType === 'video') {
    return (
      <video
        ref={videoRef}
        src={item.mediaUrl}
        playsInline
        loop
        muted={muted}
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      />
    );
  }
  return (
    <img
      src={item.mediaUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
};

/* ── Slide ─────────────────────────────────────────────────────────── */

interface PostSlideProps {
  post: Post;
  active: boolean;
  muted: boolean;
  isMine: boolean;
  /** Hide the in-slide action rail (desktop renders one beside the slide). */
  hideActionRail?: boolean;
  hideOwnerDelete?: boolean;
  /** Reports the active sub-item index to the parent so it can update side
   *  cards / labels (desktop) — purely informational. */
  onActiveItemChange?: (idx: number) => void;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onItemAttachmentClick: (item: PostItemRow) => void;
  onDelete: () => void;
}

export const PostSlide: React.FC<PostSlideProps> = ({
  post, active, muted, isMine, hideActionRail = false, hideOwnerDelete = false,
  onActiveItemChange, onLike, onSave, onComment, onShare, onItemAttachmentClick, onDelete,
}) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  // Track which item is most-visible in the horizontal carousel via scroll
  // position. Cheap math instead of an IntersectionObserver per item.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (w <= 0) return;
        const idx = Math.round(el.scrollLeft / w);
        const clamped = Math.max(0, Math.min(post.items.length - 1, idx));
        setActiveIdx((prev) => (prev === clamped ? prev : clamped));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [post.items.length]);

  useEffect(() => { onActiveItemChange?.(activeIdx); }, [activeIdx, onActiveItemChange]);

  // Active sub-item drives caption + attached card.
  const item = post.items[activeIdx] || post.items[0];
  const captionForItem = item?.caption?.trim() || post.caption;

  // Arrow buttons for desktop / no-touch — hidden when only 1 item.
  const goTo = (idx: number) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* Horizontal carousel of items.
          touch-action: pan-x makes the browser pass vertical swipes
          through to the parent feed instead of capturing them here.
          (overscroll-behavior was previously set to none on the y axis,
          which silently swallowed vertical scroll attempts inside a
          post — making the feed look stuck.) */}
      <div
        ref={stripRef}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none', touchAction: 'pan-x' }}
      >
        {post.items.map((it, idx) => {
          const itemActive = active && idx === activeIdx;
          // Only mount real media for the active item ± 1 of the active
          // post. Everything else stays a cheap gradient until it's
          // actually about to be shown — keeps the feed snappy when
          // scrolling past lots of multi-item posts.
          const shouldRenderMedia = active && Math.abs(idx - activeIdx) <= 1;
          return (
            <div key={it.id} className="relative flex-shrink-0 w-full h-full snap-start snap-always">
              <MediaFrame
                item={it}
                postActive={active}
                itemActive={itemActive}
                shouldRenderMedia={shouldRenderMedia}
                muted={muted}
              />
            </div>
          );
        })}
      </div>

      {/* Top + bottom gradient wash for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/80 via-black/35 to-transparent z-10" />

      {/* Page dots (only when more than one item) */}
      {post.items.length > 1 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          {post.items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-label={`Go to item ${idx + 1}`}
              className={cn(
                'h-1 rounded-full transition-all',
                idx === activeIdx ? 'w-6 bg-white' : 'w-1.5 bg-white/45',
              )}
            />
          ))}
        </div>
      )}

      {/* Owner delete chip */}
      {isMine && !hideOwnerDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-16 right-3 z-20 w-9 h-9 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white/85 hover:text-rose-300 hover:bg-black/60"
          aria-label="Delete post"
        >
          <Trash2 size={16} />
        </button>
      )}

      {!hideActionRail && (
        <ActionRail post={post} onLike={onLike} onSave={onSave} onComment={onComment} onShare={onShare} />
      )}

      {/* Bottom info: author + caption + location + per-item attached card */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-5 pt-10">
        <div className="flex items-center gap-3 mb-2">
          <Link
            to={`/user/${encodeURIComponent(post.author?.username || post.userId)}`}
            className="flex items-center gap-3 min-w-0 flex-1 group"
          >
            <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-white/30 transition-transform group-hover:scale-[1.04]', post.author?.avatarColor || 'bg-stone-700')}>
              {post.author?.initials || post.userId.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-[15px] truncate group-hover:underline underline-offset-2">@{post.author?.username || post.userId.slice(0, 8)}</span>
                {post.author?.isExpert && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-300/95 text-stone-900 text-[10px] font-bold">
                    <Star size={9} className="fill-stone-900" />
                    EXPERT
                  </span>
                )}
              </div>
              <p className="text-white/85 text-[12px] truncate font-mono">♪ {post.audioLabel}</p>
            </div>
          </Link>
        </div>

        {captionForItem && (
          <p className="text-white text-[15px] font-serif italic leading-snug mb-1 line-clamp-3 max-w-[78%]">
            {captionForItem}
          </p>
        )}

        {post.locationLabel && (
          <div className="flex items-center gap-1 mb-3 text-white/85 text-[12px] font-medium">
            <MapPin size={11} />
            <span className="truncate max-w-[78%]">{post.locationLabel}</span>
          </div>
        )}

        {item?.attachedKind === 'restaurant' && item.restaurant && (
          <RestaurantCard item={item} onClick={() => onItemAttachmentClick(item)} />
        )}
        {item?.attachedKind === 'recipe' && item.recipe && (
          <RecipeCard item={item} onClick={() => onItemAttachmentClick(item)} />
        )}
      </div>
    </div>
  );
};

/* ── Compact action column (desktop) ──────────────────────────────── */
// Re-uses the same visual language as DesktopSideActions in Reels.tsx
// but is parameterized to the post engagement model. Exported so the
// Reels page can render it next to the post slide on desktop.

interface DesktopPostSideActionsProps {
  post: Post;
  isMine: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onDelete: () => void;
}

export const DesktopPostSideActions: React.FC<DesktopPostSideActionsProps> = ({ post, isMine, onLike, onSave, onComment, onShare, onDelete }) => {
  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <button type="button" onClick={onLike} className="flex flex-col items-center gap-1 group" aria-label="Like">
        <motion.span whileTap={{ scale: 0.85 }} className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-on-surface/[0.06] group-hover:bg-on-surface/10',
          post.liked && 'text-rose-500 bg-rose-50 group-hover:bg-rose-100',
        )}>
          <Heart size={26} strokeWidth={2.2} className={cn(post.liked && 'fill-rose-500')} />
        </motion.span>
        {post.likesCount > 0 && (
          <span className="text-[12px] font-semibold tabular-nums text-on-surface/70">{formatCount(post.likesCount)}</span>
        )}
      </button>
      <button type="button" onClick={onComment} className="flex flex-col items-center gap-1 group" aria-label="Comments">
        <span className="w-12 h-12 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 text-on-surface flex items-center justify-center">
          <MessageCircle size={24} strokeWidth={2.2} />
        </span>
        {post.commentsCount > 0 && (
          <span className="text-[12px] font-semibold tabular-nums text-on-surface/70">{formatCount(post.commentsCount)}</span>
        )}
      </button>
      <button type="button" onClick={onSave} className="flex flex-col items-center gap-1 group" aria-label="Save">
        <motion.span whileTap={{ scale: 0.85 }} className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-on-surface/[0.06] group-hover:bg-on-surface/10',
          post.saved && 'text-amber-600 bg-amber-50 group-hover:bg-amber-100',
        )}>
          <Bookmark size={24} strokeWidth={2.2} className={cn(post.saved && 'fill-amber-500')} />
        </motion.span>
        {post.savesCount > 0 && (
          <span className="text-[12px] font-semibold tabular-nums text-on-surface/70">{formatCount(post.savesCount)}</span>
        )}
      </button>
      <button type="button" onClick={onShare} className="flex flex-col items-center gap-1 group" aria-label="Share">
        <span className="w-12 h-12 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 text-on-surface flex items-center justify-center">
          <Share2 size={22} strokeWidth={2.2} />
        </span>
      </button>
      {isMine && (
        <button type="button" onClick={onDelete} className="flex flex-col items-center gap-1 group" aria-label="Delete post">
          <span className="w-12 h-12 rounded-full bg-on-surface/[0.06] hover:bg-rose-100 text-on-surface hover:text-rose-600 flex items-center justify-center transition-colors">
            <Trash2 size={20} strokeWidth={2.2} />
          </span>
        </button>
      )}
    </div>
  );
};
