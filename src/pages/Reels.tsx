import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { Heart, MessageCircle, Bookmark, Share2, Volume2, VolumeX, ChefHat, ChevronRight, Plus, Star, Trash2, Loader2, X, Send, MoreHorizontal, Play, Pause, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useReels, type Reel, type ReelKind } from '../contexts/ReelsContext';
import { usePosts, type Post, type PostItemRow } from '../contexts/PostsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { ShareDialog } from '../components/ShareDialog';
import { type SharedReel, type SharedPost, type SharePayload } from '../contexts/ChatContext';
import { PostSlide, DesktopPostSideActions } from '../components/PostSlide';
import { RestaurantPanel, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { RecipePanel, type RecipePanelSnapshot } from '../components/RecipePanel';

/**
 * Reels — full-screen vertical video feed with two tabs, backed by Supabase.
 *
 * Explore tab → restaurant reels (tap the bottom card to open the
 * restaurant detail page).  Recipes tab → recipe reels (tap "View" to
 * open the recipe detail page). Mobile is the canonical layout; the
 * desktop variant centers a single phone-shaped column with side info
 * so the page reads on a wide viewport without stretching the video.
 */

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

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Action rail (right side) ───────────────────────────────────────── */

interface ActionRailProps {
  reel: Reel;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
}

const ActionRail: React.FC<ActionRailProps> = ({ reel, onLike, onSave, onComment, onShare }) => {
  return (
    <div className="absolute right-3 bottom-[calc(100px+env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-5 select-none">
      <button type="button" onClick={onLike} className="flex flex-col items-center gap-1 group" aria-label="Like">
        <motion.span
          whileTap={{ scale: 0.8 }}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
            reel.liked ? 'text-rose-500' : 'text-white group-hover:text-white/80',
          )}
        >
          <Heart size={30} strokeWidth={2.2} className={cn(reel.liked && 'fill-rose-500')} />
        </motion.span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(reel.likes)}</span>
      </button>

      <button type="button" onClick={onComment} className="flex flex-col items-center gap-1 group" aria-label="Comments">
        <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80 transition-colors">
          <MessageCircle size={28} strokeWidth={2.2} />
        </span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(reel.comments)}</span>
      </button>

      <button type="button" onClick={onSave} className="flex flex-col items-center gap-1 group" aria-label="Save">
        <motion.span
          whileTap={{ scale: 0.8 }}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
            reel.saved ? 'text-amber-300' : 'text-white group-hover:text-white/80',
          )}
        >
          <Bookmark size={28} strokeWidth={2.2} className={cn(reel.saved && 'fill-amber-300')} />
        </motion.span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(reel.saves)}</span>
      </button>

      <button type="button" onClick={onShare} className="flex flex-col items-center gap-1 group" aria-label="Share">
        <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80 transition-colors">
          <Share2 size={26} strokeWidth={2.2} />
        </span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">Share</span>
      </button>
    </div>
  );
};

/* ── Bottom card (restaurant or recipe) ─────────────────────────────── */

const RestaurantCard: React.FC<{ reel: Reel; onClick: () => void }> = ({ reel, onClick }) => {
  const r = reel.restaurant!;
  const score = r.score ?? 0;
  const distance = r.distanceMi != null ? `${r.distanceMi.toFixed(1)}mi` : '';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur',
        'pl-2 pr-3 py-2 text-left shadow-lg hover:bg-white transition-colors',
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Featured in reel</p>
        <p className="text-[15px] font-bold leading-tight text-stone-900 truncate">{r.name}</p>
        <p className="text-[11px] text-stone-500 truncate mt-0.5">
          {[r.cuisine, r.price, distance].filter(Boolean).join(' · ')}
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

const RecipeCard: React.FC<{ reel: Reel; onClick: () => void }> = ({ reel, onClick }) => {
  const r = reel.recipe!;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur',
        'pl-2 pr-2 py-2 text-left shadow-lg hover:bg-white transition-colors',
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">Recipe</p>
        <p className="text-[15px] font-bold leading-tight text-stone-900 truncate">{r.title}</p>
        <p className="text-[11px] text-stone-500 truncate mt-0.5">{formatRecipeMeta(r.prepTime, r.cookTime, r.servings, r.difficulty)}</p>
      </div>
      <span className="px-3.5 h-9 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">View</span>
    </button>
  );
};

/* ── A single reel slide ────────────────────────────────────────────── */

interface ReelSlideProps {
  reel: Reel;
  active: boolean;
  muted: boolean;
  isMine: boolean;
  /** When true, skip the right-edge action rail (desktop renders one beside the reel). */
  hideActionRail?: boolean;
  /** When true, skip the in-reel delete button (desktop puts delete in the side rail's "more" menu). */
  hideOwnerDelete?: boolean;
  /** When true, skip the bottom info overlay (author / audio label / caption / featured card).
   *  Desktop moves that into a dedicated side panel to the left of the reel. */
  hideDetailsOverlay?: boolean;
  /** Fires with the slide's underlying <video> element when this slide
   *  becomes active, and with `null` when it deactivates. Used by the
   *  page-level progress bar to scrub the active reel. */
  onActiveVideoChange?: (video: HTMLVideoElement | null) => void;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onCardClick: () => void;
  onDelete: () => void;
}

const ReelSlide: React.FC<ReelSlideProps> = ({ reel, active, muted, isMine, hideActionRail = false, hideOwnerDelete = false, hideDetailsOverlay = false, onActiveVideoChange, onLike, onSave, onComment, onShare, onCardClick, onDelete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Second video element behind the foreground — same source rendered with
  // object-cover + heavy blur so phone screens taller than 9:16 letterbox
  // into a soft, color-matched backdrop instead of black bars.
  const backdropRef = useRef<HTMLVideoElement>(null);
  const { phoneMode } = useSettings();
  const hasCollapsibleContent = !!reel.caption
    || (reel.kind === 'restaurant' && !!reel.restaurant)
    || (reel.kind === 'recipe' && !!reel.recipe);
  const [infoOpen, setInfoOpen] = useState(true);
  // Brief play/pause feedback overlay — flashes a centered icon when the
  // user taps the video to toggle, then fades out after ~700ms. The
  // icon shown matches the action that just happened (pause icon when
  // pausing, play icon when resuming).
  const [tapIndicator, setTapIndicator] = useState<'play' | 'pause' | null>(null);
  const tapTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    const bg = backdropRef.current;
    if (!el) return;
    if (active) {
      el.muted = muted;
      el.play().catch(() => { /* autoplay may be blocked until user gesture */ });
      if (bg) {
        bg.muted = true; // backdrop is always silent
        bg.play().catch(() => { /* see above */ });
      }
    } else {
      el.pause();
      el.currentTime = 0;
      if (bg) {
        bg.pause();
        bg.currentTime = 0;
      }
    }
  }, [active, muted]);

  // Publish / withdraw the underlying <video> element to the parent
  // page when this slide becomes active. The page-level progress bar
  // uses it to render and scrub playback.
  useEffect(() => {
    if (!onActiveVideoChange) return;
    if (active) {
      onActiveVideoChange(videoRef.current);
    }
    return () => {
      // When this slide deactivates (or unmounts), only withdraw if
      // we were the publisher — guards against a new active slide
      // racing the cleanup of the previous one.
      if (active) onActiveVideoChange(null);
    };
  }, [active, onActiveVideoChange]);

  // Clear any in-flight tap-feedback timeout when this slide unmounts
  // (e.g. user scrolls past mid-flash).
  useEffect(() => () => {
    if (tapTimeoutRef.current != null) window.clearTimeout(tapTimeoutRef.current);
  }, []);

  const showTapIndicator = (kind: 'play' | 'pause') => {
    if (tapTimeoutRef.current != null) window.clearTimeout(tapTimeoutRef.current);
    setTapIndicator(kind);
    tapTimeoutRef.current = window.setTimeout(() => setTapIndicator(null), 650);
  };

  const onTapVideo = () => {
    const el = videoRef.current;
    const bg = backdropRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      if (bg) bg.play().catch(() => {});
      showTapIndicator('play');
    } else {
      el.pause();
      if (bg) bg.pause();
      showTapIndicator('pause');
    }
  };

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* Video / gradient placeholder. The foreground video uses
          object-contain so it preserves its native 9:16 aspect on any
          screen size — on tall phones (19:9, 20:9, ...) that means
          letterboxing top/bottom. We fill that letterbox with a
          blurred + scaled copy of the same source so the dead space
          reads as a soft color extension of the reel rather than
          black bars. */}
      <div className="absolute inset-0">
        {reel.videoUrl ? (
          <>
            <video
              ref={backdropRef}
              src={reel.videoUrl}
              playsInline
              loop
              muted
              preload="metadata"
              aria-hidden
              tabIndex={-1}
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 pointer-events-none"
            />
            <video
              ref={videoRef}
              src={reel.videoUrl}
              poster={reel.posterUrl}
              playsInline
              loop
              muted={muted}
              preload="metadata"
              onClick={onTapVideo}
              className="absolute inset-0 w-full h-full object-contain"
            />
          </>
        ) : (
          <div className={cn('w-full h-full bg-gradient-to-b flex items-center justify-center', reel.bgGradient)}>
            {reel.bgLabel && (
              <span className="text-white/15 text-sm tracking-[0.4em] font-mono uppercase select-none">
                {reel.bgLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Gradient overlays for text legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/30 to-transparent z-10" />

      {/* Tap-to-toggle feedback — flashes a centered play/pause icon for
          ~650ms whenever the user toggles playback by tapping the video.
          pointer-events-none so a quick double tap still routes to the
          underlying video click handler. */}
      <AnimatePresence>
        {tapIndicator && (
          <motion.div
            key={`${tapIndicator}-${Date.now()}`}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.25 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          >
            <div className="w-[88px] h-[88px] rounded-full bg-black/55 backdrop-blur flex items-center justify-center shadow-lg">
              {tapIndicator === 'play' ? (
                <Play size={40} className="text-white fill-white ml-1.5" strokeWidth={1.5} />
              ) : (
                <Pause size={40} className="text-white fill-white" strokeWidth={1.5} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Owner-only delete button (top-right area, below the mute pill) */}
      {isMine && !hideOwnerDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-16 right-3 z-20 w-9 h-9 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-white/85 hover:text-rose-300 hover:bg-black/60 transition-colors"
          aria-label="Delete reel"
        >
          <Trash2 size={16} />
        </button>
      )}

      {/* In-reel action rail — hidden on desktop where actions live beside the reel */}
      {!hideActionRail && (
        <ActionRail reel={reel} onLike={onLike} onSave={onSave} onComment={onComment} onShare={onShare} />
      )}

      {/* Bottom info: author row, then a collapsible block with the
          caption + attached card. The whole region is a click-to-toggle
          target on phone — child interactives (avatar/handle link, the
          attached card) stop propagation so they still work normally.
          On phone the floating BottomNav sits ~70-90px above the bottom
          edge so we pad-bottom enough to clear it; desktop keeps the
          original tighter padding. */}
      {!hideDetailsOverlay && (
      <div
        role={hasCollapsibleContent ? 'button' : undefined}
        tabIndex={hasCollapsibleContent ? 0 : undefined}
        onClick={() => hasCollapsibleContent && setInfoOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!hasCollapsibleContent) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setInfoOpen((o) => !o);
          }
        }}
        aria-expanded={hasCollapsibleContent ? infoOpen : undefined}
        aria-label={hasCollapsibleContent ? (infoOpen ? 'Collapse details' : 'Expand details') : undefined}
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 px-4 pt-10',
          // Padding clears the solid 50 px bottom nav + the safe-area
          // inset on a real iPhone, with a ~30 px gap above the scrub bar.
          phoneMode ? 'pb-[calc(80px+env(safe-area-inset-bottom))]' : 'pb-5',
          hasCollapsibleContent && 'cursor-pointer',
        )}
      >
        <div className="flex items-center gap-3 mb-2">
          {/* Avatar + @handle + EXPERT chip — only this region opens the
              author's profile. Audio label is rendered outside the
              Link so it falls through to the toggle handler. Stop
              propagation so the toggle doesn't also fire. */}
          <Link
            to={`/user/${encodeURIComponent(reel.authorUsername)}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-3 min-w-0 group"
          >
            <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-white/30 transition-transform group-hover:scale-[1.04] group-active:scale-[0.96]', reel.authorAvatarColor)}>
              {reel.authorInitials}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-white font-bold text-[15px] truncate group-hover:underline underline-offset-2">@{reel.authorUsername}</span>
              {reel.isExpert && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-300/95 text-stone-900 text-[10px] font-bold flex-shrink-0">
                  <Star size={9} className="fill-stone-900" />
                  EXPERT
                </span>
              )}
            </div>
          </Link>
          {/* Audio label sits to the right, outside the profile link
              hitbox. It still falls under the toggle handler. */}
          <p className="text-white/85 text-[12px] truncate font-mono flex-1 min-w-0">♪ {reel.audioLabel}</p>
        </div>

        <AnimatePresence initial={false}>
          {infoOpen && hasCollapsibleContent && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              {reel.caption && (
                <p className="text-white text-[15px] font-serif italic leading-snug mb-3 line-clamp-3 max-w-[78%]">
                  {reel.caption}
                </p>
              )}

              {/* Stop click propagation on the card so tapping it
                  navigates to the restaurant/recipe instead of just
                  collapsing the section. */}
              <div onClick={(e) => e.stopPropagation()}>
                {reel.kind === 'restaurant' && reel.restaurant && (
                  <RestaurantCard reel={reel} onClick={onCardClick} />
                )}
                {reel.kind === 'recipe' && reel.recipe && (
                  <RecipeCard reel={reel} onClick={onCardClick} />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}
    </div>
  );
};

/* ── Side details panel (desktop) ───────────────────────────────────── */
// YouTube-Shorts-style metadata column that lives to the left of the
// centered reel: author + audio label, optional caption, and the
// featured restaurant / recipe card. Mirrors what used to be overlaid
// at the bottom of the video on phone, just relocated into the blank
// space beside the column on wide viewports.

const DesktopReelSideDetails: React.FC<{ reel: Reel; onCardClick: () => void }> = ({ reel, onCardClick }) => {
  return (
    <div className="hidden md:flex w-[300px] flex-col gap-3.5 self-end pb-3">
      {/* Author + expert chip */}
      <Link
        to={`/user/${encodeURIComponent(reel.authorUsername)}`}
        className="flex items-center gap-3 group min-w-0"
      >
        <div className={cn(
          'w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-on-surface/[0.06] transition-transform group-hover:scale-[1.04] group-active:scale-[0.96] flex-shrink-0',
          reel.authorAvatarColor,
        )}>
          {reel.authorInitials}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-[15px] truncate text-on-surface group-hover:underline underline-offset-2">@{reel.authorUsername}</span>
          {reel.isExpert && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-300/95 text-stone-900 text-[10px] font-bold flex-shrink-0">
              <Star size={9} className="fill-stone-900" />
              EXPERT
            </span>
          )}
        </div>
      </Link>

      {/* Audio label */}
      <p className="text-on-surface/55 text-[12.5px] font-mono truncate">♪ {reel.audioLabel}</p>

      {/* Caption */}
      {reel.caption && (
        <p className="text-on-surface/85 text-[14.5px] font-serif italic leading-snug line-clamp-5">
          {reel.caption}
        </p>
      )}

      {/* Featured restaurant / recipe — re-uses the existing card
          components. The cards use bg-white/95 which sits cleanly on
          the cream app surface without retuning. */}
      {reel.kind === 'restaurant' && reel.restaurant && (
        <div className="mt-1">
          <RestaurantCard reel={reel} onClick={onCardClick} />
        </div>
      )}
      {reel.kind === 'recipe' && reel.recipe && (
        <div className="mt-1">
          <RecipeCard reel={reel} onClick={onCardClick} />
        </div>
      )}
    </div>
  );
};

/* ── Playback progress bar ───────────────────────────────────────────── */
// A thin, draggable progress bar that sits at the bottom of the page
// and tracks the active reel's playback. Dragging scrubs and pauses
// playback for the duration of the drag; on release, playback resumes
// if it was running before. The bar thickens while dragging.

const ReelProgressBar: React.FC<{
  videoEl: HTMLVideoElement | null;
  className?: string;
}> = ({ videoEl, className }) => {
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const wasPlayingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // rAF loop sync — using requestAnimationFrame instead of timeupdate
  // gives a smooth 60 Hz fill animation without needing a CSS
  // transition (which would fight per-frame width updates).
  useEffect(() => {
    if (!videoEl) {
      setProgress(0);
      return;
    }
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (!dragging && videoEl.duration && Number.isFinite(videoEl.duration)) {
        setProgress(Math.max(0, Math.min(1, videoEl.currentTime / videoEl.duration)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [videoEl, dragging]);

  const pointerToProgress = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const seekTo = (frac: number) => {
    if (!videoEl) return;
    const dur = videoEl.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try { videoEl.currentTime = frac * dur; } catch { /* ignore */ }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!videoEl) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wasPlayingRef.current = !videoEl.paused;
    try { videoEl.pause(); } catch { /* ignore */ }
    setDragging(true);
    const p = pointerToProgress(e.clientX);
    setProgress(p);
    seekTo(p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const p = pointerToProgress(e.clientX);
    setProgress(p);
    seekTo(p);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    if (videoEl && wasPlayingRef.current) {
      videoEl.play().catch(() => { /* autoplay may be blocked */ });
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        'relative w-full select-none touch-none cursor-pointer group',
        // 14 px tall hit area centred on the visible bar so the
        // drag target is easy to grab on touch + mouse.
        'py-[6px]',
        className,
      )}
    >
      <div
        className="relative w-full bg-white/25 rounded-full overflow-hidden transition-[height] duration-200 ease-out ring-1 ring-black/35 shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        style={{ height: dragging ? 4 : 2 }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-white rounded-full"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
};

/* ── Side action rail (desktop) ─────────────────────────────────────── */
// Renders a vertical column of icon buttons beside the reel, styled for the
// app's light surface (not a dark video). Mirrors Instagram's desktop reels.

interface DesktopSideActionsProps {
  reel: Reel;
  isMine: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onDelete: () => void;
}

const DesktopSideActions: React.FC<DesktopSideActionsProps> = ({ reel, isMine, onLike, onSave, onComment, onShare, onDelete }) => {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [moreOpen]);

  const Btn: React.FC<{
    onClick: () => void;
    label: string;
    count?: number;
    active?: boolean;
    activeColor?: string;
    children: React.ReactNode;
  }> = ({ onClick, label, count, active = false, activeColor, children }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex flex-col items-center gap-1 group"
    >
      <motion.span
        whileTap={{ scale: 0.85 }}
        className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
          'bg-on-surface/[0.06] group-hover:bg-on-surface/10',
          active ? activeColor : 'text-on-surface',
        )}
      >
        {children}
      </motion.span>
      {count != null && (
        <span className="text-[12px] font-semibold tabular-nums text-on-surface/70">
          {formatCount(count)}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <Btn
        onClick={onLike}
        label="Like"
        count={reel.likes}
        active={reel.liked}
        activeColor="text-rose-500 bg-rose-50 group-hover:bg-rose-100"
      >
        <Heart size={26} strokeWidth={2.2} className={cn(reel.liked && 'fill-rose-500')} />
      </Btn>

      <Btn onClick={onComment} label="Comments" count={reel.comments}>
        <MessageCircle size={24} strokeWidth={2.2} />
      </Btn>

      <Btn
        onClick={onSave}
        label="Save"
        count={reel.saves}
        active={reel.saved}
        activeColor="text-amber-600 bg-amber-50 group-hover:bg-amber-100"
      >
        <Bookmark size={24} strokeWidth={2.2} className={cn(reel.saved && 'fill-amber-500')} />
      </Btn>

      <Btn onClick={onShare} label="Share">
        <Share2 size={22} strokeWidth={2.2} />
      </Btn>

      {/* More menu (copy link + owner delete) */}
      <div ref={moreRef} className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          className="w-12 h-12 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 flex items-center justify-center text-on-surface transition-colors"
        >
          <MoreHorizontal size={22} />
        </button>

        <AnimatePresence>
          {moreOpen && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, scale: 0.96, x: 4 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.96, x: 4 }}
              transition={{ duration: 0.12 }}
              className="absolute right-full top-0 mr-2 min-w-[180px] bg-surface border border-on-surface/[0.08] rounded-2xl shadow-xl overflow-hidden z-30"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMoreOpen(false); onShare(); }}
                className="w-full text-left px-3 py-2.5 text-sm font-semibold text-on-surface hover:bg-on-surface/[0.05]"
              >
                Copy link
              </button>
              {isMine && (
                <>
                  <div className="border-t border-on-surface/[0.06]" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMoreOpen(false); onDelete(); }}
                    className="w-full text-left px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Delete reel
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

/* ── Comments body (shared between mobile sheet and desktop panel) ──── */

// Polymorphic comment shape — works for both reel and post comments
// (which have the same fields after row → object mapping).
interface UnifiedComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  author?: { username: string; displayName?: string; avatarColor: string; initials: string; isExpert: boolean };
}

interface CommentsBodyProps {
  /** The id we operate against (a reel id or a post id depending on caller). */
  targetId: string;
  onClose: () => void;
  variant: 'sheet' | 'panel';
  /** Polymorphic adapters — caller picks reels or posts. */
  loadComments: (id: string) => Promise<UnifiedComment[]>;
  addComment: (id: string, body: string) => Promise<UnifiedComment | null>;
  deleteComment: (id: string, commentId: string) => Promise<boolean>;
  currentUserId: string | null;
}

/** State + composer + list. The wrapper (sheet/panel) decides chrome. */
export const CommentsBody: React.FC<CommentsBodyProps> = ({ targetId, onClose, variant, loadComments, addComment, deleteComment, currentUserId }) => {
  const { showToast } = useToast();
  const [comments, setComments] = useState<UnifiedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadComments(targetId).then((list) => {
      if (cancelled) return;
      setComments(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [targetId, loadComments]);

  const onSubmit = async () => {
    if (!draft.trim() || posting) return;
    if (!currentUserId) {
      showToast('Sign in to comment');
      return;
    }
    setPosting(true);
    const c = await addComment(targetId, draft);
    setPosting(false);
    if (c) {
      setComments((prev) => [c, ...prev]);
      setDraft('');
    } else {
      showToast("Couldn't post comment");
    }
  };

  const onDeleteOne = async (commentId: string) => {
    const ok = await deleteComment(targetId, commentId);
    if (ok) setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  // Mobile sheet uses light-gray pill chrome; desktop panel uses on-surface
  // tokens so it blends with the app's surface color (not a dark bg).
  const headerCls = variant === 'sheet'
    ? 'border-b border-stone-100'
    : 'border-b border-on-surface/[0.07]';
  const titleCls = variant === 'sheet'
    ? 'font-serif font-bold text-stone-900 text-base'
    : 'font-serif font-bold text-on-surface text-base';
  const closeCls = variant === 'sheet'
    ? 'w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600'
    : 'w-8 h-8 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.1] text-on-surface/65';
  const composerInputCls = variant === 'sheet'
    ? 'h-11 rounded-full bg-stone-100 px-4 text-sm placeholder:text-stone-400 focus:bg-stone-50 focus:ring-2 focus:ring-stone-900/10'
    : 'h-11 rounded-full bg-on-surface/[0.05] px-4 text-sm placeholder:text-on-surface/40 focus:bg-on-surface/[0.08] focus:ring-2 focus:ring-on-surface/10';
  const submitActiveCls = variant === 'sheet'
    ? 'bg-stone-900 text-white hover:bg-stone-800'
    : 'bg-on-surface text-surface hover:bg-on-surface/90';
  const composerBorderCls = variant === 'sheet' ? 'border-stone-100' : 'border-on-surface/[0.07]';
  const usernameCls = variant === 'sheet' ? 'text-stone-900' : 'text-on-surface';
  const bodyTextCls = variant === 'sheet' ? 'text-stone-800' : 'text-on-surface/85';
  const muteCls = variant === 'sheet' ? 'text-stone-400' : 'text-on-surface/40';

  return (
    <>
      {/* Header */}
      <div className={cn('px-5 pt-3 pb-3 flex items-center justify-between flex-shrink-0', headerCls)}>
        <h3 className={titleCls}>
          {comments.length === 0 ? 'Comments' : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className={cn('flex items-center justify-center transition-colors', closeCls)}
          aria-label="Close comments"
        >
          <X size={16} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-4">
        {loading ? (
          <div className={cn('flex items-center justify-center py-8', muteCls)}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <p className={cn('text-sm', variant === 'sheet' ? 'text-stone-500' : 'text-on-surface/55')}>No comments yet.</p>
            <p className={cn('text-xs mt-1', muteCls)}>Be the first to say something.</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0', c.author?.avatarColor || 'bg-stone-500')}>
                {c.author?.initials || c.userId.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={cn('text-[13px] font-bold truncate', usernameCls)}>@{c.author?.username || c.userId.slice(0, 8)}</span>
                  {c.author?.isExpert && (
                    <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded-sm bg-amber-200 text-amber-900 text-[9px] font-bold">EXPERT</span>
                  )}
                  <span className={cn('text-[11px]', muteCls)}>{formatRelativeTime(c.createdAt)}</span>
                </div>
                <p className={cn('text-[14px] leading-snug whitespace-pre-wrap break-words', bodyTextCls)}>{c.body}</p>
              </div>
              {c.userId === currentUserId && (
                <button
                  type="button"
                  onClick={() => onDeleteOne(c.id)}
                  className={cn('p-1 hover:text-rose-500', muteCls)}
                  aria-label="Delete comment"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className={cn('border-t px-4 py-3 flex items-center gap-2 flex-shrink-0', composerBorderCls)}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
          placeholder={currentUserId ? 'Add a comment…' : 'Sign in to comment'}
          disabled={!currentUserId || posting}
          maxLength={500}
          className={cn('flex-1 focus:outline-none disabled:opacity-50', composerInputCls)}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!currentUserId || !draft.trim() || posting}
          className={cn(
            'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
            draft.trim() && !posting && currentUserId
              ? submitActiveCls
              : 'bg-on-surface/[0.08] text-on-surface/35 cursor-not-allowed',
          )}
          aria-label="Post comment"
        >
          {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </>
  );
};

/* ── Mobile bottom sheet ─────────────────────────────────────────────── */

interface CommentsSheetProps {
  targetId: string | null;
  onClose: () => void;
  loadComments: (id: string) => Promise<UnifiedComment[]>;
  addComment: (id: string, body: string) => Promise<UnifiedComment | null>;
  deleteComment: (id: string, commentId: string) => Promise<boolean>;
  currentUserId: string | null;
}

const CommentsSheet: React.FC<CommentsSheetProps> = ({ targetId, onClose, loadComments, addComment, deleteComment, currentUserId }) => {
  return (
    <AnimatePresence>
      {targetId && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 bg-black/55 backdrop-blur-sm flex items-end"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full rounded-t-3xl flex flex-col"
            style={{ height: '75%' }}
          >
            <div className="pt-2 pb-1 flex justify-center">
              <span className="w-10 h-1 rounded-full bg-stone-300" />
            </div>
            <CommentsBody
              targetId={targetId}
              onClose={onClose}
              variant="sheet"
              loadComments={loadComments}
              addComment={addComment}
              deleteComment={deleteComment}
              currentUserId={currentUserId}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Desktop side panel ──────────────────────────────────────────────── */

interface CommentsPanelProps {
  targetId: string | null;
  onClose: () => void;
  loadComments: (id: string) => Promise<UnifiedComment[]>;
  addComment: (id: string, body: string) => Promise<UnifiedComment | null>;
  deleteComment: (id: string, commentId: string) => Promise<boolean>;
  currentUserId: string | null;
}

const CommentsPanel: React.FC<CommentsPanelProps> = ({ targetId, onClose, loadComments, addComment, deleteComment, currentUserId }) => {
  return (
    <AnimatePresence>
      {targetId && (
        <motion.div
          key={targetId}
          initial={{ opacity: 0, x: 20, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 360 }}
          exit={{ opacity: 0, x: 20, width: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="h-full bg-surface border border-on-surface/[0.08] rounded-[24px] overflow-hidden flex flex-col flex-shrink-0"
        >
          <div className="w-[360px] h-full flex flex-col">
            <CommentsBody
              targetId={targetId}
              onClose={onClose}
              variant="panel"
              loadComments={loadComments}
              addComment={addComment}
              deleteComment={deleteComment}
              currentUserId={currentUserId}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Tabs + mute pill (top header) ──────────────────────────────────── */

// The page-level "kind" controls the unified feed:
//   • explore: every reel + every post (mixed by createdAt)
//   • recipe:  only recipe reels + posts that include a recipe item
type FeedKind = 'explore' | 'recipe';

interface TopBarProps {
  kind: FeedKind;
  setKind: (k: FeedKind) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
}

const TopBar: React.FC<TopBarProps> = ({ kind, setKind, muted, setMuted }) => {
  return (
    <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between gap-2 px-3 pt-safe-3">
      <div className="relative flex-1 max-w-[280px] h-11 rounded-full bg-black/35 backdrop-blur flex items-center px-1">
        {([
          { value: 'explore', label: 'Explore' },
          { value: 'recipe', label: 'Recipes' },
        ] as const).map((opt) => {
          const active = kind === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKind(opt.value)}
              className={cn(
                'flex-1 h-9 rounded-full text-[14px] font-bold transition-colors',
                active ? 'bg-white text-stone-900 shadow' : 'text-white/85',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setMuted(!muted)}
        className="w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white"
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </div>
  );
};

/* ── The page ───────────────────────────────────────────────────────── */

export const Reels: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // When mounted under /r/:focusKey the page acts as a focused viewer
  // for a single reel/post — full feed and full functionality, but
  // scrolled to the target item and chromeless (no bottom nav, back
  // arrow overlay top-left). The key matches the FeedItem.key format
  // used elsewhere (`reel-<id>` or `post-<id>`).
  const { focusKey } = useParams<{ focusKey?: string }>();
  const focused = !!focusKey;
  const {
    reels: allReels, recipeReels, loading: reelsLoading,
    toggleLike, toggleSave, deleteReel, openAddReelModal,
    openCommentsSheet, closeCommentsSheet, openCommentsReelId,
    currentUserId,
    loadComments: reelLoadComments, addComment: reelAddComment, deleteComment: reelDeleteComment,
  } = useReels();
  const {
    posts: allPosts, loading: postsLoading,
    togglePostLike, togglePostSave, deletePost,
    setPostVisibility: _setPostVisibility,
    openAddPostModal,
    openPostCommentsSheet, closePostCommentsSheet, openPostCommentsId,
    loadPostComments, addPostComment, deletePostComment,
    lastActivePostId, setLastActivePostId,
  } = usePosts();
  const { phoneMode, setHideBottomNav } = useSettings();
  const { showToast } = useToast();

  // Tab can be deep-linked via ?kind=explore|recipe. Older deep links
  // (?kind=restaurant or ?kind=post) collapse into Explore.
  const initialKind: FeedKind = (() => {
    const sp = new URLSearchParams(location.search);
    const k = sp.get('kind');
    return k === 'recipe' ? 'recipe' : 'explore';
  })();
  const [kind, setKind] = useState<FeedKind>(initialKind);
  const [muted, setMuted] = useState(true);
  // The active reel's <video> element, published by ReelSlide via
  // onActiveVideoChange. Drives the page-level scrub progress bar.
  const [activeVideoEl, setActiveVideoEl] = useState<HTMLVideoElement | null>(null);
  // Single "active feed item" key — `reel-<id>` or `post-<id>` — so the
  // unified scroll-snap feed can track exactly one playing slide.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [sharePayload, setSharePayload] = useState<SharePayload | null>(null);
  // Tapping a featured-restaurant card on a reel/post opens this side panel
  // instead of navigating to /restaurant/:id. Set to the restaurant snapshot
  // attached to the card so the panel can render immediately while it fetches
  // community/friend/expert data.
  const [restaurantPanelSnapshot, setRestaurantPanelSnapshot] = useState<RestaurantPanelSnapshot | null>(null);
  // Same idea for the featured-recipe card. The snapshot carries authorId +
  // ReelRecipeSnapshot; the panel resolves the full meal record lazily.
  const [recipePanelSnapshot, setRecipePanelSnapshot] = useState<RecipePanelSnapshot | null>(null);

  const loading = reelsLoading || postsLoading;

  // ── Build the unified, sorted feed for the active tab ──
  // Explore: every reel + every post.
  // Recipes: recipe reels + posts that include at least one recipe item.
  type FeedItem =
    | { kind: 'reel'; key: string; createdAt: number; reel: Reel }
    | { kind: 'post'; key: string; createdAt: number; post: Post };
  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    const reelsForTab = kind === 'recipe' ? recipeReels : allReels;
    for (const r of reelsForTab) {
      items.push({ kind: 'reel', key: `reel-${r.id}`, createdAt: r.createdAt || 0, reel: r });
    }
    const postsForTab = kind === 'recipe' ? allPosts.filter((p) => p.hasRecipe) : allPosts;
    for (const p of postsForTab) {
      const ts = p.createdAt ? Date.parse(p.createdAt) : 0;
      items.push({ kind: 'post', key: `post-${p.id}`, createdAt: Number.isFinite(ts) ? ts : 0, post: p });
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items;
  }, [kind, allReels, recipeReels, allPosts]);

  const activeReelId = activeKey?.startsWith('reel-') ? activeKey.slice(5) : null;
  const activePostId = activeKey?.startsWith('post-') ? activeKey.slice(5) : null;

  // ── Per-tab "last seen" feed-item key.
  //
  // The user expects tab-switching to be a stack-of-pages, not a
  // single-position cursor: scroll to reel #7 on Explore, hop to
  // Recipes and scroll to recipe #3, hop back to Explore and you're
  // returned to reel #7. We track the last-active key per tab in
  // component state (resets when /reels unmounts). The first visit
  // to a tab — including the very first Recipes view — falls
  // through to "top of the feed". The cross-mount PostsContext
  // lastActivePostId pointer remains a secondary fallback so
  // returning from /restaurant/X back to /reels still lands you on
  // the post you were on (mostly useful on the Explore tab).
  const [lastKeyByTab, setLastKeyByTab] = useState<Record<FeedKind, string | null>>({
    explore: null,
    recipe: null,
  });

  useEffect(() => {
    // Focused mode wins: if the URL points at a specific feed item
    // and that item is in this tab's feed, jump straight to it. If it
    // isn't here (e.g. a recipe reel viewed on the explore tab), try
    // flipping the tab — otherwise fall through to the normal restore.
    if (focused && focusKey) {
      const match = feedItems.find((f) => f.key === focusKey);
      if (match) {
        setActiveKey(focusKey);
        return;
      }
    }
    // First try the per-tab saved key. Drop it if the underlying item
    // is gone (deleted / no longer visible to this viewer).
    const saved = lastKeyByTab[kind];
    if (saved && feedItems.some((f) => f.key === saved)) {
      setActiveKey(saved);
      return;
    }
    // Cross-mount post pointer — useful for returning from a featured
    // attachment detail page. Only meaningful on the explore tab
    // since recipe-only filters won't carry every post.
    if (lastActivePostId) {
      const match = feedItems.find((f) => f.kind === 'post' && f.post.id === lastActivePostId);
      if (match) {
        setActiveKey(match.key);
        return;
      }
    }
    setActiveKey(feedItems[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, feedItems.length, focusKey, focused]);

  // If the focused item is a recipe reel that doesn't appear on the
  // current tab (e.g. it's not also in Explore for some reason), flip
  // the tab once the feeds are populated so it can find the item. We
  // only do this once per focus to avoid bouncing back if the user
  // intentionally switches tabs after landing.
  const flippedForFocusRef = useRef(false);
  useEffect(() => {
    if (!focused || !focusKey) { flippedForFocusRef.current = false; return; }
    if (flippedForFocusRef.current) return;
    if (feedItems.some((f) => f.key === focusKey)) return;
    if (focusKey.startsWith('reel-')) {
      const id = focusKey.slice('reel-'.length);
      const r = allReels.find((rr) => rr.id === id);
      if (r && r.kind === 'recipe' && kind !== 'recipe') {
        flippedForFocusRef.current = true;
        setKind('recipe');
      } else if (r && r.kind !== 'recipe' && kind !== 'explore') {
        flippedForFocusRef.current = true;
        setKind('explore');
      }
    } else if (focusKey.startsWith('post-') && kind !== 'explore') {
      flippedForFocusRef.current = true;
      setKind('explore');
    }
  }, [focused, focusKey, feedItems, allReels, kind]);

  // Mirror the activeKey into per-tab state whenever it changes, and
  // into PostsContext's cross-mount pointer for posts.
  useEffect(() => {
    if (!activeKey) return;
    setLastKeyByTab((prev) => (prev[kind] === activeKey ? prev : { ...prev, [kind]: activeKey }));
  }, [activeKey, kind]);

  useEffect(() => {
    if (activePostId) setLastActivePostId(activePostId);
  }, [activePostId, setLastActivePostId]);

  // ── Side-panel auto-sync as the user scrolls between feed items ──
  //
  // When activeKey changes (user scrolls to a new reel/post) we want any
  // open side pane to follow:
  //   • Restaurant panel: swap to the new item's featured restaurant. For
  //     posts the source is the first slide's attachment. If the new item
  //     has no featured restaurant the panel just closes.
  //   • Comments: always swap to the new item's comments (per spec —
  //     comments stuck on a previous reel were confusing).
  //
  // We read the current open-state through refs so the effect only fires
  // on activeKey changes — including the open-state in deps would loop
  // every time we update it from inside.
  const restaurantPanelSnapshotRef = useRef(restaurantPanelSnapshot);
  restaurantPanelSnapshotRef.current = restaurantPanelSnapshot;
  const recipePanelSnapshotRef = useRef(recipePanelSnapshot);
  recipePanelSnapshotRef.current = recipePanelSnapshot;
  const openCommentsReelIdRef = useRef(openCommentsReelId);
  openCommentsReelIdRef.current = openCommentsReelId;
  const openPostCommentsIdRef = useRef(openPostCommentsId);
  openPostCommentsIdRef.current = openPostCommentsId;

  // Hide the floating BottomNav whenever either feature pane (restaurant
  // or recipe) is open on the mobile sheet — its presence at the bottom
  // collides visually with the bottom-anchored sheet handle. Reset on
  // close + on unmount so other pages don't inherit the hidden state.
  // In focused mode (/r/:key) the nav stays hidden the whole time.
  useEffect(() => {
    const anyPanelOpen = !!restaurantPanelSnapshot || !!recipePanelSnapshot;
    setHideBottomNav(focused || anyPanelOpen);
    return () => setHideBottomNav(false);
  }, [focused, restaurantPanelSnapshot, recipePanelSnapshot, setHideBottomNav]);

  useEffect(() => {
    if (!activeKey) return;
    const isReel = activeKey.startsWith('reel-');
    const isPost = activeKey.startsWith('post-');
    const id = isReel || isPost ? activeKey.slice(5) : null;
    if (!id) return;

    // Locate the underlying record. Reels live in either the all-reels or
    // recipe-only list depending on the current tab.
    const reel = isReel
      ? (allReels.find((r) => r.id === id) || recipeReels.find((r) => r.id === id) || null)
      : null;
    const post = isPost ? (allPosts.find((p) => p.id === id) || null) : null;

    // ── Restaurant / recipe panel auto-switch ──
    // The two panels share a single "feature pane" — whichever kind the
    // new active reel/post features, that's what the panel shows. So
    // scrolling from a restaurant-featured reel to a recipe-featured
    // reel with the panel already open swaps the contents (and the
    // panel kind) rather than closing and reopening. If the new item
    // has no featured attachment at all, the pane closes.
    const anyPanelOpen = !!restaurantPanelSnapshotRef.current || !!recipePanelSnapshotRef.current;
    if (anyPanelOpen) {
      // Resolve what the active item features, preferring the reel's
      // declared kind (or the post's first slide for posts).
      let nextRestaurant: RestaurantPanelSnapshot | null = null;
      let nextRecipe: RecipePanelSnapshot | null = null;
      if (reel) {
        if (reel.kind === 'restaurant' && reel.restaurant) nextRestaurant = reel.restaurant;
        else if (reel.kind === 'recipe' && reel.recipe) nextRecipe = { authorId: reel.authorId, recipe: reel.recipe };
      } else if (post) {
        const first = post.items[0];
        if (first && first.attachedKind === 'restaurant' && first.restaurant) {
          nextRestaurant = first.restaurant;
        } else if (first && first.attachedKind === 'recipe' && first.recipe) {
          nextRecipe = { authorId: post.userId, recipe: first.recipe };
        }
      }

      const curR = restaurantPanelSnapshotRef.current;
      const curC = recipePanelSnapshotRef.current;

      // Apply transitions, only writing state when something actually
      // changes (so we don't churn the panel mounts every frame).
      if (nextRestaurant) {
        if (curC) setRecipePanelSnapshot(null);
        if (curR?.id !== nextRestaurant.id) setRestaurantPanelSnapshot(nextRestaurant);
      } else if (nextRecipe) {
        if (curR) setRestaurantPanelSnapshot(null);
        const sameRecipe = curC
          && curC.recipe.id === nextRecipe.recipe.id
          && curC.authorId === nextRecipe.authorId;
        if (!sameRecipe) setRecipePanelSnapshot(nextRecipe);
      } else {
        // New item features neither — close whichever pane is open.
        if (curR) setRestaurantPanelSnapshot(null);
        if (curC) setRecipePanelSnapshot(null);
      }
    }

    // Comments auto-switch. If comments are open they always follow the
    // active item — swapping kinds (reel↔post) when crossing item types.
    const commentsAreOpen = !!openCommentsReelIdRef.current || !!openPostCommentsIdRef.current;
    if (commentsAreOpen) {
      if (reel) {
        if (openCommentsReelIdRef.current !== reel.id) {
          if (openPostCommentsIdRef.current) closePostCommentsSheet();
          openCommentsSheet(reel.id);
        }
      } else if (post) {
        if (openPostCommentsIdRef.current !== post.id) {
          if (openCommentsReelIdRef.current) closeCommentsSheet();
          openPostCommentsSheet(post.id);
        }
      }
    }
  }, [activeKey, allReels, recipeReels, allPosts, openCommentsSheet, openPostCommentsSheet, closeCommentsSheet, closePostCommentsSheet]);

  // After the feed renders with a restored active key, scroll the snap
  // container so that item is the visible slide. Works for both reels
  // and posts now that per-tab restoration applies to either kind.
  // useLayoutEffect so the scroll happens before paint and there's no
  // flash of slide 0.
  const restoredKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!activeKey) return;
    if (restoredKeyRef.current === activeKey) return;
    const root = containerRef.current;
    if (!root) return;
    const target = root.querySelector(`[data-feed-key="${activeKey}"]`) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    restoredKeyRef.current = activeKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, feedItems.length]);

  // IntersectionObserver picks the most-visible slide so exactly one video
  // plays. Each slide carries data-feed-key="reel-<id>" | "post-<id>".
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const slides = Array.from(root.querySelectorAll<HTMLDivElement>('[data-feed-key]'));
    if (slides.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestEl: HTMLDivElement | null = null;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestEl = e.target as HTMLDivElement;
          }
        }
        if (bestEl && bestRatio > 0.6 && bestEl.dataset.feedKey) {
          setActiveKey(bestEl.dataset.feedKey);
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    slides.forEach((s) => observer.observe(s as Element));
    return () => observer.disconnect();
  }, [feedItems]);

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const showDesktopFrame = isDesktop && !phoneMode;

  // ── Mutual exclusion between the side panes (restaurant / recipe /
  // comments): only one can be visible at a time. Wrap the open calls so
  // opening any one always closes the other two. Tapping the same
  // featured card twice toggles its panel closed; tapping a different
  // card swaps to it. Functional setters so we don't have to add the
  // panel snapshots to the useCallback deps.
  const openRestaurantPanel = useCallback((snap: RestaurantPanelSnapshot) => {
    closeCommentsSheet();
    closePostCommentsSheet();
    setRecipePanelSnapshot(null);
    setRestaurantPanelSnapshot((current) => (current && current.id === snap.id ? null : snap));
  }, [closeCommentsSheet, closePostCommentsSheet]);

  const openRecipePanel = useCallback((snap: RecipePanelSnapshot) => {
    closeCommentsSheet();
    closePostCommentsSheet();
    setRestaurantPanelSnapshot(null);
    setRecipePanelSnapshot((current) => (
      current && current.recipe.id === snap.recipe.id && current.authorId === snap.authorId
        ? null
        : snap
    ));
  }, [closeCommentsSheet, closePostCommentsSheet]);

  const openReelComments = useCallback((reelId: string) => {
    setRestaurantPanelSnapshot(null);
    setRecipePanelSnapshot(null);
    openCommentsSheet(reelId);
  }, [openCommentsSheet]);

  const openPostComments = useCallback((postId: string) => {
    setRestaurantPanelSnapshot(null);
    setRecipePanelSnapshot(null);
    openPostCommentsSheet(postId);
  }, [openPostCommentsSheet]);

  const handleCardClick = (reel: Reel) => {
    if (reel.kind === 'restaurant' && reel.restaurant) {
      openRestaurantPanel(reel.restaurant);
      return;
    }
    if (reel.kind === 'recipe' && reel.recipe) {
      // Same in-feed-panel pattern for recipes — opens RecipePanel
      // instead of navigating to /meal/:userId/:mealId. The panel
      // resolves the full home-meal record lazily.
      openRecipePanel({ authorId: reel.authorId, recipe: reel.recipe });
    }
  };

  // Build the snapshot we hand to the share dialog. Same shape as the chat
  // message attachment so the recipient's thread can render the rich card.
  const buildSharedReel = (reel: Reel): SharedReel => {
    const attachedTitle = reel.kind === 'restaurant'
      ? (reel.restaurant?.name || 'Untitled')
      : (reel.recipe?.title || 'Untitled');
    const attachedSubtitle = reel.kind === 'restaurant'
      ? [reel.restaurant?.cuisine, reel.restaurant?.price].filter(Boolean).join(' · ') || undefined
      : reel.recipe
        ? `${(reel.recipe.prepTime + reel.recipe.cookTime) || 0} min · ${reel.recipe.servings || 0} servings · ${reel.recipe.difficulty}`
        : undefined;
    const attachedRoute = reel.kind === 'restaurant' && reel.restaurant
      ? `/restaurant/${reel.restaurant.id}`
      : reel.recipe
        ? `/meal/${encodeURIComponent(reel.authorId)}/${encodeURIComponent(reel.recipe.id)}`
        : '/reels';
    return {
      reelId: reel.id,
      authorId: reel.authorId,
      authorUsername: reel.authorUsername,
      authorDisplayName: reel.authorDisplayName,
      authorAvatarColor: reel.authorAvatarColor,
      authorInitials: reel.authorInitials,
      isExpert: reel.isExpert,
      kind: reel.kind,
      videoUrl: reel.videoUrl,
      posterUrl: reel.posterUrl,
      bgGradient: reel.bgGradient,
      caption: reel.caption,
      attachedTitle,
      attachedSubtitle,
      attachedImage: reel.kind === 'restaurant' ? reel.restaurant?.image : reel.recipe?.image,
      attachedRoute,
    };
  };

  const handleShare = (reel: Reel) => {
    setSharePayload({ sharedReel: buildSharedReel(reel) });
  };

  // Build the snapshot we hand the share dialog for posts.
  const buildSharedPost = (post: Post): SharedPost => {
    const cover = post.items[0];
    return {
      postId: post.id,
      authorId: post.userId,
      authorUsername: post.author?.username || post.userId.slice(0, 8),
      authorDisplayName: post.author?.displayName,
      authorAvatarColor: post.author?.avatarColor || 'bg-stone-700',
      authorInitials: post.author?.initials || post.userId.slice(0, 2).toUpperCase(),
      isExpert: post.author?.isExpert ?? false,
      caption: post.caption,
      locationLabel: post.locationLabel,
      coverUrl: cover?.mediaUrl,
      coverMediaType: cover?.mediaType,
      bgGradient: cover?.bgGradient || 'from-stone-800 to-stone-900',
      itemCount: post.items.length,
    };
  };
  const handleSharePost = (post: Post) => {
    setSharePayload({ sharedPost: buildSharedPost(post) });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const ok = await deleteReel(id);
    if (ok) showToast('Reel deleted');
    else showToast("Couldn't delete reel");
  };

  const handleConfirmDeletePost = async () => {
    if (!confirmDeletePostId) return;
    const id = confirmDeletePostId;
    setConfirmDeletePostId(null);
    const ok = await deletePost(id);
    if (ok) showToast('Post deleted');
    else showToast("Couldn't delete post");
  };

  // Per-item attachment click — restaurants open the in-feed side panel;
  // recipes still navigate to the home-meal read view (/meal/:userId/:mealId,
  // not /recipe/:id, because attached recipes are home-meal entries owned
  // by the post's author).
  const handlePostItemClick = (postUserId: string, item: PostItemRow) => {
    if (item.attachedKind === 'restaurant' && item.restaurant) {
      openRestaurantPanel(item.restaurant);
    } else if (item.attachedKind === 'recipe' && item.recipe) {
      openRecipePanel({ authorId: postUserId, recipe: item.recipe });
    }
  };

  // Comments adapter — only one of the two sheets can be open at a time
  // (a tap on a reel comment button sets openCommentsReelId; a tap on a
  // post comment button sets openPostCommentsId). We branch on whichever
  // is non-null so the same CommentsBody/Sheet/Panel can serve both.
  const commentsKind: 'reel' | 'post' | null = openPostCommentsId ? 'post' : openCommentsReelId ? 'reel' : null;
  const commentsTargetId = commentsKind === 'post' ? openPostCommentsId : commentsKind === 'reel' ? openCommentsReelId : null;
  const commentsClose = commentsKind === 'post' ? closePostCommentsSheet : closeCommentsSheet;
  const commentsLoad = commentsKind === 'post' ? loadPostComments : reelLoadComments;
  const commentsAdd = commentsKind === 'post' ? addPostComment : reelAddComment;
  const commentsDelete = commentsKind === 'post' ? deletePostComment : reelDeleteComment;

  const renderFeed = (opts: { hideActionRail?: boolean; hideOwnerDelete?: boolean; hideCommentsSheet?: boolean; hideDetailsOverlay?: boolean; onActiveVideoChange?: (video: HTMLVideoElement | null) => void }) => (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto snap-y snap-mandatory bg-black scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      <AnimatePresence initial={false}>
        {loading && feedItems.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-white/60">
            <Loader2 size={26} className="animate-spin" />
          </div>
        ) : feedItems.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/70 text-sm px-8 text-center gap-3">
            <p className="text-base text-white/85">
              {kind === 'recipe' ? 'No recipe reels or posts yet.' : 'Nothing here yet.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openAddPostModal()}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-white text-stone-900 text-sm font-bold"
              >
                <Plus size={16} />
                New post
              </button>
              <button
                type="button"
                onClick={() => openAddReelModal(kind === 'recipe' ? 'recipe' : 'restaurant')}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-white/15 text-white text-sm font-bold border border-white/25"
              >
                <Plus size={16} />
                New reel
              </button>
            </div>
          </div>
        ) : (
          feedItems.map((item) => (
            <motion.div
              key={item.key}
              data-feed-key={item.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full snap-start snap-always"
            >
              {item.kind === 'reel' ? (
                <ReelSlide
                  reel={item.reel}
                  active={activeKey === item.key}
                  muted={muted}
                  isMine={!!currentUserId && item.reel.authorId === currentUserId}
                  hideActionRail={opts.hideActionRail}
                  hideOwnerDelete={opts.hideOwnerDelete}
                  hideDetailsOverlay={opts.hideDetailsOverlay}
                  onActiveVideoChange={opts.onActiveVideoChange}
                  onLike={() => {
                    if (!currentUserId) { showToast('Sign in to like reels'); return; }
                    toggleLike(item.reel.id);
                  }}
                  onSave={() => {
                    if (!currentUserId) { showToast('Sign in to save reels'); return; }
                    toggleSave(item.reel.id);
                  }}
                  onComment={() => openReelComments(item.reel.id)}
                  onShare={() => handleShare(item.reel)}
                  onCardClick={() => handleCardClick(item.reel)}
                  onDelete={() => setConfirmDeleteId(item.reel.id)}
                />
              ) : (
                <PostSlide
                  post={item.post}
                  active={activeKey === item.key}
                  muted={muted}
                  isMine={!!currentUserId && item.post.userId === currentUserId}
                  hideActionRail={opts.hideActionRail}
                  hideOwnerDelete={opts.hideOwnerDelete}
                  onLike={() => {
                    if (!currentUserId) { showToast('Sign in to like posts'); return; }
                    togglePostLike(item.post.id);
                  }}
                  onSave={() => {
                    if (!currentUserId) { showToast('Sign in to save posts'); return; }
                    togglePostSave(item.post.id);
                  }}
                  onComment={() => openPostComments(item.post.id)}
                  onShare={() => handleSharePost(item.post)}
                  onItemAttachmentClick={(postItem) => handlePostItemClick(item.post.userId, postItem)}
                  onDelete={() => setConfirmDeletePostId(item.post.id)}
                />
              )}
            </motion.div>
          ))
        )}
      </AnimatePresence>

      {/* Comments sheet floats above the feed (mobile only — desktop uses
          the side panel rendered by the layout). The target id and adapter
          callbacks switch between reel and post engagement APIs. */}
      {!opts.hideCommentsSheet && (
        <CommentsSheet
          targetId={commentsTargetId}
          onClose={commentsClose}
          loadComments={commentsLoad}
          addComment={commentsAdd}
          deleteComment={commentsDelete}
          currentUserId={currentUserId}
        />
      )}

      {/* Delete confirmations — separate states for reel vs post. */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center px-6"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-stone-900 text-lg">Delete reel?</h4>
              <p className="text-sm text-stone-500 mt-1">This can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeleteId(null)} className="flex-1 h-11 rounded-full bg-stone-100 text-stone-700 text-sm font-bold hover:bg-stone-200">Cancel</button>
                <button type="button" onClick={handleConfirmDelete} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700">Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {confirmDeletePostId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center px-6"
            onClick={() => setConfirmDeletePostId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-stone-900 text-lg">Delete post?</h4>
              <p className="text-sm text-stone-500 mt-1">This permanently removes every photo / video and the comments. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeletePostId(null)} className="flex-1 h-11 rounded-full bg-stone-100 text-stone-700 text-sm font-bold hover:bg-stone-200">Cancel</button>
                <button type="button" onClick={handleConfirmDeletePost} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700">Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Resolve the actual Reel or Post the active key points at — at most
  // one of these is non-null at a time (the activeKey prefix decides).
  const activeReel = activeReelId ? allReels.find((r) => r.id === activeReelId) ?? null : null;
  const activePost = activePostId ? allPosts.find((p) => p.id === activePostId) ?? null : null;

  /* ── Desktop layout ──
     Instagram-style: app surface background, no copy / side panels, no
     "Post a reel" CTA (the sidebar's Create button handles posting). The
     reel sits centered as a tall phone-shaped column; like / comment /
     save / share / more buttons live in a column right next to it. */
  if (showDesktopFrame) {
    return (
      // h-screen because /reels hides the desktop header (no top offset
      // to subtract). py-3 keeps a hair of breathing room without eating
      // into the reel — the reel is height-driven, so the smaller the
      // vertical padding, the bigger the reel ends up.
      <div className="relative h-screen w-full bg-surface overflow-hidden flex items-center justify-center gap-4 px-6 py-3">
        {focused && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-50 w-10 h-10 rounded-full bg-on-surface/[0.08] backdrop-blur text-on-surface flex items-center justify-center hover:bg-on-surface/[0.14] active:scale-95 transition-all"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
        )}

        {/* Left details panel — author / audio label / caption /
            featured card for the active reel. Lives in the blank space
            to the left of the centered reel column, mirroring how
            YouTube Shorts surfaces metadata on desktop. */}
        {activeReel && (
          <DesktopReelSideDetails
            reel={activeReel}
            onCardClick={() => handleCardClick(activeReel)}
          />
        )}

        {/* Reel column — full available height; aspect ratio drives width.
            9/16 matches the native reels video ratio and Instagram's desktop
            reels column, so the frame reads as a proper short-form video
            surface instead of a too-narrow phone shape. */}
        <div
          className="relative h-full bg-black rounded-[22px] overflow-hidden shadow-xl border border-on-surface/[0.08]"
          style={{ aspectRatio: '9 / 16' }}
        >
          <TopBar kind={kind} setKind={setKind} muted={muted} setMuted={setMuted} />
          {renderFeed({ hideActionRail: true, hideOwnerDelete: true, hideCommentsSheet: true, hideDetailsOverlay: true, onActiveVideoChange: setActiveVideoEl })}
        </div>

        {/* Side actions — bottom-aligned, dispatched to reel or post APIs
            based on which tab is active. */}
        {activeReel && (
          <div className="self-end pb-2">
            <DesktopSideActions
              reel={activeReel}
              isMine={!!currentUserId && activeReel.authorId === currentUserId}
              onLike={() => {
                if (!currentUserId) { showToast('Sign in to like reels'); return; }
                toggleLike(activeReel.id);
              }}
              onSave={() => {
                if (!currentUserId) { showToast('Sign in to save reels'); return; }
                toggleSave(activeReel.id);
              }}
              onComment={() => openReelComments(activeReel.id)}
              onShare={() => handleShare(activeReel)}
              onDelete={() => setConfirmDeleteId(activeReel.id)}
            />
          </div>
        )}
        {activePost && (
          <div className="self-end pb-2">
            <DesktopPostSideActions
              post={activePost}
              isMine={!!currentUserId && activePost.userId === currentUserId}
              onLike={() => {
                if (!currentUserId) { showToast('Sign in to like posts'); return; }
                togglePostLike(activePost.id);
              }}
              onSave={() => {
                if (!currentUserId) { showToast('Sign in to save posts'); return; }
                togglePostSave(activePost.id);
              }}
              onComment={() => openPostComments(activePost.id)}
              onShare={() => handleSharePost(activePost)}
              onDelete={() => setConfirmDeletePostId(activePost.id)}
            />
          </div>
        )}

        {/* Comments panel — switches data source based on active tab. */}
        <CommentsPanel
          targetId={commentsTargetId}
          onClose={commentsClose}
          loadComments={commentsLoad}
          addComment={commentsAdd}
          deleteComment={commentsDelete}
          currentUserId={currentUserId}
        />

        {/* Restaurant side panel — opens when a featured-place card is tapped
            on a reel or post. Sits to the right of the action rail, mirrors
            the comments panel's animation + chrome. */}
        <RestaurantPanel
          variant="panel"
          snapshot={restaurantPanelSnapshot}
          onClose={() => setRestaurantPanelSnapshot(null)}
          currentUserId={currentUserId}
        />

        {/* Recipe side panel — sibling of the restaurant panel; opens when
            a featured-recipe card is tapped. Mutual-exclusion logic
            guarantees only one of the two is ever mounted at a time. */}
        <RecipePanel
          variant="panel"
          snapshot={recipePanelSnapshot}
          onClose={() => setRecipePanelSnapshot(null)}
          currentUserId={currentUserId}
        />

        {/* Share dialog — fixed-position, floats above the layout. */}
        <ShareDialog
          open={!!sharePayload}
          payload={sharePayload}
          onClose={() => setSharePayload(null)}
        />

        {/* Playback progress bar — pinned to the very bottom of the
            desktop frame so it spans the full width. */}
        {activeVideoEl && (
          <div className="absolute inset-x-0 bottom-0 px-4 pb-1 z-30">
            <ReelProgressBar videoEl={activeVideoEl} />
          </div>
        )}
      </div>
    );
  }

  /* ── Mobile / phone-frame layout ── */
  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <TopBar kind={kind} setKind={setKind} muted={muted} setMuted={setMuted} />
      {focused && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-50 w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all"
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
      )}
      {renderFeed({ onActiveVideoChange: setActiveVideoEl })}
      {/* Restaurant sheet — mobile counterpart of the desktop panel. Slides
          up from the bottom over the feed. */}
      <RestaurantPanel
        variant="sheet"
        snapshot={restaurantPanelSnapshot}
        onClose={() => setRestaurantPanelSnapshot(null)}
        currentUserId={currentUserId}
      />
      {/* Recipe sheet — mobile counterpart of the recipe panel. */}
      <RecipePanel
        variant="sheet"
        snapshot={recipePanelSnapshot}
        onClose={() => setRecipePanelSnapshot(null)}
        currentUserId={currentUserId}
      />
      <ShareDialog
        open={!!sharePayload}
        payload={sharePayload}
        onClose={() => setSharePayload(null)}
      />

      {/* Playback progress bar — sits directly above the solid
          BottomNav. The nav is 50 px tall + env(safe-area-inset-bottom)
          on a real iPhone, so this offset puts the bar flush against
          its top edge. */}
      {activeVideoEl && (
        <div className="absolute inset-x-0 bottom-[calc(50px+env(safe-area-inset-bottom))] px-4 z-30">
          <ReelProgressBar videoEl={activeVideoEl} />
        </div>
      )}
    </div>
  );
};
