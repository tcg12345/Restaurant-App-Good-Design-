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
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, Bookmark, Share2, ChefHat, ChevronRight, Trash2, MapPin, PlayCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { ScoreBadge } from './RestaurantCard';
import { usePosts, type Post, type PostItemRow } from '../contexts/PostsContext';
import { useReels } from '../contexts/ReelsContext';
import { useSettings } from '../contexts/SettingsContext';
import { followPublicAccount, removeFriend } from '../lib/supabase-community';
import { getCachedImage, loadCachedImage } from '../lib/image-cache';
import { MuxReelMedia } from './MuxReelMedia';
import { addScrollSettleListener } from '../lib/scroll-settle';

/**
 * Render a feed photo through the in-memory blob cache: instant + whole-image
 * (no progressive banding) on every revisit, with zero network after the first
 * load. Returns the cached object URL once ready, or undefined while it loads
 * (caller shows the gradient placeholder meanwhile). `url` is only passed when
 * the photo is actually near, so far-off items don't pre-fetch.
 */
function useCachedPhoto(path: string, url: string | undefined): string | undefined {
  const [src, setSrc] = useState<string | undefined>(() => (path ? getCachedImage(path) ?? undefined : undefined));
  useEffect(() => {
    if (!path || !url) { setSrc(undefined); return; }
    const cached = getCachedImage(path);
    if (cached) { setSrc(cached); return; }
    let alive = true;
    setSrc(undefined); // hold the placeholder until the whole image is ready
    loadCachedImage(path, url).then((resolved) => { if (alive) setSrc(resolved); });
    return () => { alive = false; };
  }, [path, url]);
  return src;
}

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
  <div className="absolute right-3 bottom-[calc(100px+env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-5 select-none">
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
  const { phoneMode } = useSettings();
  const score = r.score ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl pl-2 pr-3 py-2 text-left transition-colors',
        phoneMode
          ? 'bg-black/40 backdrop-blur-md border border-white/15 shadow-[0_4px_12px_rgba(0,0,0,0.25)] hover:bg-black/50'
          : 'bg-white/95 backdrop-blur shadow-lg hover:bg-white',
      )}
    >
      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-rose-700 to-orange-700 flex items-center justify-center">
        {r.image ? (
          <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-white text-[10px] font-bold uppercase tracking-widest text-center px-1">{r.cuisine}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[10px] font-bold uppercase tracking-widest', phoneMode ? 'text-white/65' : 'text-on-surface/55')}>Featured place</p>
        <p className={cn('text-[15px] font-bold leading-tight truncate', phoneMode ? 'text-white' : 'text-on-surface')}>{r.name}</p>
        <p className={cn('text-[11px] truncate mt-0.5', phoneMode ? 'text-white/65' : 'text-on-surface/55')}>
          {[r.cuisine, r.price].filter(Boolean).join(' · ')}
        </p>
      </div>
      <ScoreBadge rating={score} size="sm" />
      <ChevronRight size={16} className={cn('flex-shrink-0', phoneMode ? 'text-white/45' : 'text-on-surface/40')} />
    </button>
  );
};

const RecipeCard: React.FC<{ item: PostItemRow; onClick: () => void }> = ({ item, onClick }) => {
  const r = item.recipe!;
  const { phoneMode } = useSettings();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl pl-2 pr-2 py-2 text-left transition-colors',
        phoneMode
          ? 'bg-black/40 backdrop-blur-md border border-white/15 shadow-[0_4px_12px_rgba(0,0,0,0.25)] hover:bg-black/50'
          : 'bg-white/95 backdrop-blur shadow-lg hover:bg-white',
      )}
    >
      <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-blue-50 flex items-center justify-center">
        {r.image ? (
          <img src={r.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <ChefHat size={26} className="text-blue-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-[10px] font-bold uppercase tracking-widest', phoneMode ? 'text-white/65' : 'text-on-surface/55')}>Recipe</p>
        <p className={cn('text-[15px] font-bold leading-tight truncate', phoneMode ? 'text-white' : 'text-on-surface')}>{r.title}</p>
        <p className={cn('text-[11px] truncate mt-0.5', phoneMode ? 'text-white/65' : 'text-on-surface/55')}>{formatRecipeMeta(r.prepTime, r.cookTime, r.servings, r.difficulty)}</p>
      </div>
      <span className={cn(
        'px-3.5 h-9 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0',
        // media-white/-ink: the phone pill sits on glass over the photo, so it
        // stays literal white with fixed dark text (the bg-white → paper remap
        // would turn it near-black under hardcoded dark text in dark mode).
        phoneMode ? 'bg-media-white text-media-ink' : 'bg-on-surface text-surface',
      )}>View</span>
    </button>
  );
};

/* ── Single media frame (image or muted-loop video) ────────────────── */

// How many photos on either side of the focused carousel item to keep
// mounted on the ACTIVE post. Wide enough that ordinary swiping always
// lands on an already-decoded frame (instead of one that only started
// loading the moment you swiped onto it); bounded so a 15-photo post
// doesn't fetch everything at once. Videos use a tighter ±1 — they're
// far heavier to buffer, so we only warm the immediate neighbours.
const PHOTO_PRELOAD_RADIUS = 3;

// Transient media-load failures (a flaky network or a momentary storage
// blip) get this many silent retries before we fall back to the gradient
// placeholder — never the browser's broken-image icon.
const MEDIA_MAX_RETRIES = 2;

interface MediaFrameProps {
  item: PostItemRow;
  /** True when the parent post is the active feed item. Drives which
   *  carousel items get heavy media DOM versus a cheap gradient. */
  postActive: boolean;
  /** True when this is the currently-focused item in the carousel. */
  itemActive: boolean;
  /** Render real media when within this distance of the active item. */
  shouldRenderMedia: boolean;
  /** True for the active sub-item of the active post — drives loading
   *  hints so the cover frame paints as fast as the browser allows. */
  highPriority?: boolean;
  /** Full ("auto") video preload vs. lighter "metadata" — true for the
   *  active post and the immediate next so their video is buffered ahead. */
  preloadFull?: boolean;
  muted: boolean;
}

const MediaFrameInner: React.FC<MediaFrameProps> = ({ item, postActive, itemActive, shouldRenderMedia, highPriority, preloadFull, muted }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Photos render through the blob cache so revisits are instant and pop in
  // whole. Only fetch when the photo is actually meant to render (near).
  const isPhoto = item.mediaType === 'photo';
  const photoSrc = useCachedPhoto(
    isPhoto ? item.mediaPath : '',
    isPhoto && shouldRenderMedia ? item.mediaUrl : undefined,
  );

  // Media-load resilience. A signed-URL fetch can fail transiently
  // (network hiccup, storage 5xx) — without handling, the <img> is left
  // showing the browser's broken-image icon on a black slide and never
  // refetches, which is exactly the "photo reel got lost" symptom.
  // Photos get a few retries (bumping `attempt` remounts the element and
  // forces a fresh request); videos fail straight to the placeholder.
  // Reset whenever the signed URL changes — e.g. a feed refresh re-signs
  // the storage path, which should clear a prior failure.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setAttempt(0); }, [item.mediaUrl]);
  const onImgError = useCallback(() => setAttempt((n) => n + 1), []);
  const onVideoError = useCallback(() => setAttempt(MEDIA_MAX_RETRIES + 1), []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (postActive && itemActive && item.mediaType === 'video') {
      el.muted = muted;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
    // `muted` intentionally excluded — a separate effect mirrors it
    // without restarting playback, which is what users expect when
    // toggling the speaker on a paused reel/post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postActive, itemActive, item.mediaType]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted]);

  // Default fallback — a flat neutral backing (no colored gradient). Used for
  // any item far from the active one, when the signed URL isn't ready yet, or
  // when the media failed to load after its retries. Photos/videos paint on
  // top once ready; solid black matches the slide's letterbox frame.
  const placeholder = (
    <div className="absolute inset-0 bg-black">
      {item.mediaType === 'video' && !item.mediaUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PlayCircle size={48} className="text-white/40" />
        </div>
      )}
    </div>
  );

  // Mux video item — adaptive HLS via Mux Player, object-contain like the
  // legacy <video>. MuxReelMedia shows its Mux poster until the slide is near.
  if (item.mediaType === 'video' && item.muxPlaybackId) {
    return (
      <MuxReelMedia
        playbackId={item.muxPlaybackId}
        tokens={item.muxTokens || undefined}
        poster={item.posterUrl || undefined}
        active={postActive && itemActive}
        near={shouldRenderMedia}
        muted={muted}
        phoneMode={false}
        objectFit="contain"
      />
    );
  }
  // Mux video item still transcoding — captured poster under a spinner.
  if (item.mediaType === 'video' && item.muxStatus && item.muxStatus !== 'ready') {
    return (
      <div className="absolute inset-0 bg-black">
        {item.posterUrl && (
          <img src={item.posterUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30">
          <div className="w-9 h-9 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          <span className="text-white/80 text-xs font-medium tracking-wide">Processing video…</span>
        </div>
      </div>
    );
  }

  if (!shouldRenderMedia || !item.mediaUrl || attempt > MEDIA_MAX_RETRIES) return placeholder;

  // Photos and videos on posts show in their native aspect ratio
  // (object-contain) — letterboxed against the slide's black background
  // when they don't match 9:16. Cropping lost the top/bottom of square
  // and landscape shots, which is the main format people upload.
  if (item.mediaType === 'video') {
    return (
      <video
        ref={videoRef}
        src={item.mediaUrl}
        // Stored poster (when present) paints the instant the element mounts,
        // so a cold first-view shows a frame immediately instead of buffering.
        poster={item.posterUrl || undefined}
        playsInline
        loop
        muted={muted}
        // The parent already gates mounting (shouldRenderMedia: post is
        // active in the feed AND sub-item is within ±1 of activeIdx, OR
        // this is the cover of a vertical neighbour). Inside that window
        // we want the buffer warm enough to start playback instantly, so
        // "auto" only for the active post + immediate next (preloadFull);
        // other mounted neighbours stay "metadata" so they don't steal
        // bandwidth from the video about to play.
        preload={preloadFull ? 'auto' : 'metadata'}
        onError={onVideoError}
        className="absolute inset-0 w-full h-full object-contain"
      />
    );
  }
  // Hold the gradient placeholder until the blob is cached, so the photo
  // appears whole on first paint instead of streaming in band-by-band.
  if (!photoSrc) return placeholder;
  return (
    <img
      // Remount on each retry so the browser re-requests the same URL
      // rather than reusing the failed image entry from its cache.
      key={attempt}
      src={photoSrc}
      alt=""
      decoding="async"
      onError={onImgError}
      {...(highPriority ? { fetchPriority: 'high' as const } : {})}
      className="absolute inset-0 w-full h-full object-contain"
    />
  );
};

// Memoized so a carousel scroll (which bumps the parent's activeIdx every
// frame) only re-renders the frames whose own props actually changed —
// the previously- and newly-focused items — instead of every item in the
// post. That's what keeps swiping smooth on multi-item posts.
const MediaFrame = React.memo(MediaFrameInner);

/* ── Slide ─────────────────────────────────────────────────────────── */

interface PostSlideProps {
  post: Post;
  active: boolean;
  /** True when the post is the active feed item OR within ±1 of it.
   *  Drives cover-frame preloading so the first paint is already in
   *  the browser cache by the time the user swipes onto it — matches
   *  the strategy ReelSlide uses for adjacent reel videos. */
  near?: boolean;
  /** Give this slide's video(s) a full ("auto") preload rather than just
   *  "metadata" — reserved for the active post + the immediate next so the
   *  next post's video starts playing right away when swiped to. */
  preloadFull?: boolean;
  muted: boolean;
  isMine: boolean;
  currentUserId: string | null;
  /** Hide the in-slide action rail (desktop renders one beside the slide). */
  hideActionRail?: boolean;
  hideOwnerDelete?: boolean;
  /** Hide the in-slide bottom info overlay (author chip / caption /
   *  location / featured card). Desktop moves that content into a
   *  dedicated side panel to the left of the slide, so leaving the
   *  in-slide overlay rendered would duplicate everything. */
  hideDetailsOverlay?: boolean;
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

const PostSlideInner: React.FC<PostSlideProps> = ({
  post, active, near = false, preloadFull = false, muted, isMine, currentUserId, hideActionRail = false, hideOwnerDelete = false, hideDetailsOverlay = false,
  onActiveItemChange, onLike, onSave, onComment, onShare, onItemAttachmentClick, onDelete,
}) => {
  const { getPostItemIndex, setPostItemIndex } = usePosts();
  const { phoneMode } = useSettings();
  const [activeIdx, setActiveIdx] = useState(() => getPostItemIndex(post.id));
  const [infoOpen, setInfoOpen] = useState(true);

  // Follow state for the post's author — read from the SHARED per-author
  // map in ReelsContext (reels and posts share the same author graph), so
  // following on one slide updates the author's other slides and each
  // author is looked up at most once.
  const { followingByUser, ensureFollowState, setFollowState } = useReels();
  const isFollowing = followingByUser[post.userId] ?? false;
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
    // Only resolve follow state for slides in the active window — firing
    // for every slide at mount was a DB round trip per slide.
    if (!near || !currentUserId || !post.userId || isMine) return;
    ensureFollowState(post.userId);
  }, [near, currentUserId, post.userId, isMine, ensureFollowState]);

  const onToggleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || isMine || followBusy) return;
    setFollowBusy(true);
    const wasFollowing = isFollowing;
    setFollowState(post.userId, !wasFollowing);
    const ok = wasFollowing
      ? await removeFriend(currentUserId, post.userId)
      : await followPublicAccount(currentUserId, post.userId);
    if (!ok) setFollowState(post.userId, wasFollowing);
    setFollowBusy(false);
  };
  const stripRef = useRef<HTMLDivElement>(null);

  // On mount, snap the carousel to the saved item index. This is what
  // restores the user's position after they tap a featured card on slide
  // N, navigate to the detail page, then click back. useLayoutEffect so
  // the scroll happens before paint and there's no flash of slide 0.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const savedIdx = getPostItemIndex(post.id);
    if (savedIdx <= 0) return;
    // clientWidth can be 0 right after mount on some browsers; defer one
    // animation frame in that case.
    if (el.clientWidth > 0) {
      el.scrollLeft = el.clientWidth * savedIdx;
    } else {
      requestAnimationFrame(() => {
        if (stripRef.current && stripRef.current.clientWidth > 0) {
          stripRef.current.scrollLeft = stripRef.current.clientWidth * savedIdx;
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  // Persist activeIdx so the next mount can restore it.
  useEffect(() => {
    setPostItemIndex(post.id, activeIdx);
  }, [post.id, activeIdx, setPostItemIndex]);

  // Track which item is most-visible in the horizontal carousel via scroll
  // position. Cheap math instead of an IntersectionObserver per item.
  // Committed at scroll REST (scrollend / idle fallback) — flipping the
  // index mid-swipe swapped caption/attachment content and shifted the
  // media-mount window while the snap glide was still animating, which
  // made the landing visibly re-correct (same disease as the vertical
  // feed; see src/lib/scroll-settle.ts).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const commit = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const idx = Math.round(el.scrollLeft / w);
      const clamped = Math.max(0, Math.min(post.items.length - 1, idx));
      setActiveIdx((prev) => (prev === clamped ? prev : clamped));
    };
    return addScrollSettleListener(el, commit, {
      idleMs: 140,
      isAligned: (s) => {
        const w = s.clientWidth;
        return w > 0 && Math.abs(s.scrollLeft - Math.round(s.scrollLeft / w) * w) <= 2;
      },
    });
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
    <div className={cn(
      'relative h-full w-full overflow-hidden',
      // Phone: letterbox blank space picks up the app's surface color
      // so it reads as part of the page in either light or dark mode,
      // rather than a hard black backdrop. Desktop keeps black since
      // the post sits inside a centred column with side panels.
      phoneMode ? 'bg-surface' : 'bg-black',
    )}>
      {/* Horizontal carousel of items.
          Default `touch-action: auto` lets the browser scroll the
          right axis: horizontal pans scroll this carousel (which has
          overflow-x-auto), vertical pans bubble up to the snap-y feed.
          Explicit `pan-x` actually *blocks* vertical pans entirely
          per the touch-action spec, which made the feed feel stuck
          when swiping on a post's media. */}
      <div
        ref={stripRef}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain scrollbar-hide"
        style={{ scrollbarWidth: 'none' }}
      >
        {post.items.map((it, idx) => {
          const itemActive = active && idx === activeIdx;
          const dist = Math.abs(idx - activeIdx);
          // Decide which carousel items mount real media versus a cheap
          // gradient. Active post: keep a wide buffer of PHOTOS mounted
          // (they're cheap, and pre-decoding them is what makes a swipe
          // land on a ready frame instead of one that only began loading
          // the moment you swiped onto it) plus videos within ±1
          // (expensive — only the immediate neighbours pre-buffer).
          // Neighbour ("near") posts only mount their cover (idx 0) and
          // the ±1 window; keeping that window across the active→near
          // hand-off is what stops vertical scroll from flashing to a
          // gradient as the previous post slides out.
          const shouldRenderMedia =
            (active && (it.mediaType === 'video' ? dist <= 1 : dist <= PHOTO_PRELOAD_RADIUS))
            || (near && (idx === 0 || dist <= 1));
          return (
            <div key={it.id} className="relative flex-shrink-0 w-full h-full snap-start snap-always">
              <MediaFrame
                item={it}
                postActive={active}
                itemActive={itemActive}
                shouldRenderMedia={shouldRenderMedia}
                highPriority={itemActive}
                preloadFull={preloadFull}
                muted={muted}
              />
            </div>
          );
        })}
      </div>

      {/* Top + bottom gradient wash for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/80 via-black/35 to-transparent z-10" />

      {/* Page dots (only when more than one item).
          Phone: pushed below the TopBar which itself sits inside the
          safe area. Without this the dots get covered by the status
          bar + tabs on iPhone. */}
      {post.items.length > 1 && (
        <div
          className={cn(
            'absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5',
            phoneMode ? 'top-[calc(env(safe-area-inset-top)+56px)]' : 'top-16',
          )}
        >
          {post.items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-label={`Go to item ${idx + 1}`}
              className={cn(
                'hit-44-y h-1 rounded-full transition-all',
                idx === activeIdx ? 'w-6 bg-white' : 'w-1.5 bg-white/45',
              )}
            />
          ))}
        </div>
      )}

      {/* Owner delete chip — same safe-area calc as the page dots above:
          a fixed top-16 collided with the TopBar's mute button on
          Dynamic-Island devices (inset ≈59px). */}
      {isMine && !hideOwnerDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-[calc(env(safe-area-inset-top)+56px)] right-3 z-20 w-9 h-9 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white/85 hover:text-rose-300 hover:bg-black/60"
          aria-label="Delete post"
        >
          <Trash2 size={16} />
        </button>
      )}

      {!hideActionRail && (
        <ActionRail post={post} onLike={onLike} onSave={onSave} onComment={onComment} onShare={onShare} />
      )}

      {/* Bottom info: author row stays visible; caption + location + the
          per-item attached card collapse into a tap-to-expand block, mirroring
          the reel video slide. The author Link is scoped to avatar + handle +
          EXPERT chip only — the audio label and the toggle hitbox live
          outside it so tapping audio/empty space doesn't open the profile.
          Skipped entirely when the parent (desktop layout) is going to
          render this content in a dedicated side panel instead. */}
      {!hideDetailsOverlay && (() => {
        const hasCollapsibleContent = !!captionForItem
          || !!post.locationLabel
          || (item?.attachedKind === 'restaurant' && !!item.restaurant)
          || (item?.attachedKind === 'recipe' && !!item.recipe);
        return (
          // pointer-events-none: taps in the lower third reach the video
          // (pause/play); only real controls re-enable pointer events —
          // same treatment as ReelSlide's overlay.
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 z-20 pl-4 pt-10 pointer-events-none',
              // Clears the solid 50 px bottom nav + iPhone safe-area
              // inset, sitting just above the scrub bar.
              phoneMode ? 'pb-[calc(70px+env(safe-area-inset-bottom))]' : 'pb-5',
              // Reserve room on the right for the action rail (44 px
              // wide buttons at right-3) so the featured card stops
              // short of the share/save/comment column instead of
              // running underneath it.
              phoneMode && !hideActionRail ? 'pr-[68px]' : 'pr-4',
            )}
          >
            <div className="flex items-center gap-3 mb-2">
              <Link
                to={`/user/${encodeURIComponent(post.author?.username || post.userId)}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-3 min-w-0 group pointer-events-auto"
              >
                <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-white/30 transition-transform group-hover:scale-[1.04] group-active:scale-[0.96]', post.author?.avatarColor || 'bg-stone-700')}>
                  {post.author?.initials || post.userId.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-white font-bold text-[15px] truncate group-hover:underline underline-offset-2">@{post.author?.username || post.userId.slice(0, 8)}</span>
                  {post.author?.isExpert && (
                    // bg-media-white: sits over the post media, must stay
                    // literal white in dark mode (the paper remap turned
                    // it near-black with dark-red text).
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-media-white text-primary text-[10px] font-bold flex-shrink-0">
                      <VerifiedBadge size={11} />
                      VERIFIED
                    </span>
                  )}
                </div>
              </Link>
              {/* Follow / Unfollow pill — replaces the audio label.
                  Hidden on the user's own posts and when signed out. */}
              {!isMine && currentUserId && (
                <button
                  type="button"
                  onClick={onToggleFollow}
                  disabled={followBusy}
                  className={cn(
                    'hit-44-y px-3 py-1 rounded-full text-[12px] font-semibold transition-colors disabled:opacity-60 pointer-events-auto',
                    isFollowing
                      ? 'bg-white/10 text-white border border-white/30 hover:bg-white/15'
                      : 'bg-media-white text-media-ink hover:opacity-90',
                  )}
                >
                  {isFollowing ? 'Unfollow' : 'Follow'}
                </button>
              )}
            </div>

            <AnimatePresence initial={false}>
              {infoOpen && hasCollapsibleContent && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  // The collapse toggle is the caption block itself, not
                  // the whole lower slide.
                  className="overflow-hidden pointer-events-auto cursor-pointer"
                  onClick={() => setInfoOpen(false)}
                  role="button"
                  aria-label="Collapse details"
                >
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

                  {/* Stop propagation so tapping the attached card navigates
                      to the restaurant/recipe instead of collapsing. */}
                  <div onClick={(e) => e.stopPropagation()}>
                    {item?.attachedKind === 'restaurant' && item.restaurant && (
                      <RestaurantCard item={item} onClick={() => onItemAttachmentClick(item)} />
                    )}
                    {item?.attachedKind === 'recipe' && item.recipe && (
                      <RecipeCard item={item} onClick={() => onItemAttachmentClick(item)} />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Collapsed state keeps a small explicit affordance — the old
                expand-by-tapping-anywhere is gone (those taps pause now). */}
            {!infoOpen && hasCollapsibleContent && (
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="pointer-events-auto inline-flex items-center gap-1 mt-1 h-7 px-2.5 rounded-full bg-black/35 backdrop-blur text-white/85 text-[11.5px] font-semibold"
                aria-label="Expand details"
              >
                More
                <ChevronRight size={12} className="-rotate-90" />
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// See ReelSlide for the rationale: scroll-induced setActiveKey in the
// parent feed should only re-render the slide whose `active` actually
// flipped, not every post on screen. The inline callbacks the parent
// builds change identity every render and are ignored here.
export const PostSlide = React.memo(PostSlideInner, (prev, next) =>
  prev.post === next.post
  && prev.active === next.active
  && prev.near === next.near
  && prev.preloadFull === next.preloadFull
  && prev.muted === next.muted
  && prev.isMine === next.isMine
  && prev.currentUserId === next.currentUserId
  && prev.hideActionRail === next.hideActionRail
  && prev.hideOwnerDelete === next.hideOwnerDelete
  && prev.hideDetailsOverlay === next.hideDetailsOverlay,
);

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
