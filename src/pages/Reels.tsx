import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Heart, MessageCircle, Bookmark, Share2, Volume2, VolumeX, ChefHat, ChevronRight, Plus, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useReels, type Reel, type ReelKind } from '../contexts/ReelsContext';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Reels — full-screen vertical video feed with two tabs.
 *
 * Explore tab → restaurant reels (tap the bottom card to open the
 * restaurant detail page).  Recipes tab → recipe reels (tap "View" to
 * open the recipe modal). Mobile is the canonical layout; the desktop
 * variant centers a single phone-shaped column with side info so the
 * page reads on a wide viewport without stretching the video.
 */

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

function formatDifficulty(d: 'Easy' | 'Medium' | 'Hard'): string {
  return d;
}

function formatRecipeMeta(prepTime: number, cookTime: number, servings: number, difficulty: 'Easy' | 'Medium' | 'Hard'): string {
  const total = (prepTime || 0) + (cookTime || 0);
  const time = total > 0 ? `${total} min` : '';
  const serv = servings > 0 ? `${servings} servings` : '';
  return [time, serv, formatDifficulty(difficulty)].filter(Boolean).join(' · ');
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
    <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-5 select-none">
      <button
        type="button"
        onClick={onLike}
        className="flex flex-col items-center gap-1 group"
        aria-label="Like"
      >
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

      <button
        type="button"
        onClick={onComment}
        className="flex flex-col items-center gap-1 group"
        aria-label="Comments"
      >
        <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80 transition-colors">
          <MessageCircle size={28} strokeWidth={2.2} />
        </span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">{formatCount(reel.comments)}</span>
      </button>

      <button
        type="button"
        onClick={onSave}
        className="flex flex-col items-center gap-1 group"
        aria-label="Save"
      >
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

      <button
        type="button"
        onClick={onShare}
        className="flex flex-col items-center gap-1 group"
        aria-label="Share"
      >
        <span className="w-11 h-11 rounded-full flex items-center justify-center text-white group-hover:text-white/80 transition-colors">
          <Share2 size={26} strokeWidth={2.2} />
        </span>
        <span className="text-white text-[12px] font-bold tabular-nums drop-shadow">Share</span>
      </button>

      {/* Audio disc — purely decorative (style mirror of TikTok) */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
        className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-200 via-amber-500 to-stone-900 ring-2 ring-white/40 flex items-center justify-center"
      >
        <span className="w-3 h-3 rounded-full bg-white/90" />
      </motion.div>
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
        <span className={cn(
          'inline-flex items-center justify-center min-w-[40px] h-9 px-2.5 rounded-xl text-sm font-bold tabular-nums',
          'bg-emerald-700 text-white',
        )}>
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
  onLike: () => void;
  onSave: () => void;
  onFollow: () => void;
  onCardClick: () => void;
}

const ReelSlide: React.FC<ReelSlideProps> = ({ reel, active, muted, onLike, onSave, onFollow, onCardClick }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pause / play in sync with which slide is active. The IntersectionObserver
  // upstream owns the "active" decision so we don't fight it here.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active) {
      el.muted = muted;
      el.play().catch(() => { /* autoplay can be blocked — the user can tap to unmute and retry */ });
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [active, muted]);

  const onTapVideo = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* Video / placeholder */}
      <div className="absolute inset-0">
        {reel.videoUrl ? (
          <video
            ref={videoRef}
            src={reel.videoUrl}
            poster={reel.posterUrl}
            playsInline
            loop
            muted={muted}
            preload="metadata"
            onClick={onTapVideo}
            className="w-full h-full object-cover"
          />
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

      {/* Top + bottom overlays for text legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/30 to-transparent z-10" />

      {/* Action rail */}
      <ActionRail reel={reel} onLike={onLike} onSave={onSave} onComment={() => { /* no-op for now */ }} onShare={() => { /* no-op */ }} />

      {/* Bottom info: author, caption, attached card */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-5 pt-10">
        {/* Author row */}
        <div className="flex items-center gap-3 mb-2">
          <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ring-white/30', reel.authorAvatarColor)}>
            {reel.authorInitials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-[15px] truncate">@{reel.authorUsername}</span>
              {reel.isExpert && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-300/95 text-stone-900 text-[10px] font-bold">
                  <Star size={9} className="fill-stone-900" />
                  EXPERT
                </span>
              )}
            </div>
            <p className="text-white/85 text-[12px] truncate font-mono">♪ {reel.audioLabel}</p>
          </div>
          <button
            type="button"
            onClick={onFollow}
            className={cn(
              'px-4 h-9 rounded-full text-[13px] font-bold transition-colors flex-shrink-0',
              reel.following
                ? 'bg-white/20 text-white'
                : 'bg-transparent text-white border border-white',
            )}
          >
            {reel.following ? 'Following' : 'Follow'}
          </button>
        </div>

        {/* Caption */}
        {reel.caption && (
          <p className="text-white text-[15px] font-serif italic leading-snug mb-3 line-clamp-3 max-w-[78%]">
            {reel.caption}
          </p>
        )}

        {/* Attached card */}
        {reel.kind === 'restaurant' && reel.restaurant && (
          <RestaurantCard reel={reel} onClick={onCardClick} />
        )}
        {reel.kind === 'recipe' && reel.recipe && (
          <RecipeCard reel={reel} onClick={onCardClick} />
        )}
      </div>
    </div>
  );
};

/* ── Tabs + mute pill (top header) ──────────────────────────────────── */

interface TopBarProps {
  kind: ReelKind;
  setKind: (k: ReelKind) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
}

const TopBar: React.FC<TopBarProps> = ({ kind, setKind, muted, setMuted }) => {
  return (
    <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between gap-2 px-3 pt-3">
      {/* Pill with two tabs */}
      <div className="relative flex-1 max-w-[280px] h-11 rounded-full bg-black/35 backdrop-blur flex items-center px-1">
        {(['restaurant', 'recipe'] as const).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'flex-1 h-9 rounded-full text-[14px] font-bold transition-colors',
                active ? 'bg-white text-stone-900 shadow' : 'text-white/85',
              )}
            >
              {k === 'restaurant' ? 'Explore' : 'Recipes'}
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
  const { restaurantReels, recipeReels, toggleLike, toggleSave, toggleFollow, openAddReelModal } = useReels();
  const { phoneMode } = useSettings();

  // The tab can be deep-linked via ?kind=recipe|restaurant.
  const initialKind: ReelKind = (() => {
    const sp = new URLSearchParams(location.search);
    const k = sp.get('kind');
    return k === 'recipe' ? 'recipe' : 'restaurant';
  })();
  const [kind, setKind] = useState<ReelKind>(initialKind);
  const [muted, setMuted] = useState(true);
  const [activeReelId, setActiveReelId] = useState<string | null>(null);

  const list = kind === 'restaurant' ? restaurantReels : recipeReels;

  // Reset the active reel when switching tabs and pick the first one.
  useEffect(() => {
    setActiveReelId(list[0]?.id ?? null);
  }, [kind, list.length]);

  // Detect which slide is most-visible inside the snap container so
  // exactly one video plays at a time.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const slides = Array.from(root.querySelectorAll<HTMLDivElement>('[data-reel-id]'));
    if (slides.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const e of entries) {
          const id = (e.target as HTMLDivElement).dataset.reelId || '';
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestId = id;
          }
        }
        if (bestId && bestRatio > 0.6) setActiveReelId(bestId);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    slides.forEach((s) => observer.observe(s as Element));
    return () => observer.disconnect();
  }, [list]);

  // Determine if we're on the wide / desktop layout by media query so we can
  // wrap the feed in a phone-shaped column. We can't rely on phoneMode here
  // because that's the optional preview mode toggled from Settings.
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

  const handleCardClick = (reel: Reel) => {
    if (reel.kind === 'restaurant' && reel.restaurant) {
      navigate(`/restaurant/${reel.restaurant.id}`);
      return;
    }
    if (reel.kind === 'recipe' && reel.recipe) {
      navigate(`/recipe/${reel.recipe.id}`);
    }
  };

  const feed = (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-auto snap-y snap-mandatory bg-black scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      <AnimatePresence initial={false}>
        {list.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-white/70 text-sm px-8 text-center">
            No {kind === 'restaurant' ? 'restaurant' : 'recipe'} reels yet. Tap{' '}
            <Plus size={14} className="inline-block mx-1" /> to post the first one.
          </div>
        ) : (
          list.map((reel) => (
            <motion.div
              key={reel.id}
              data-reel-id={reel.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full snap-start snap-always"
            >
              <ReelSlide
                reel={reel}
                active={activeReelId === reel.id}
                muted={muted}
                onLike={() => toggleLike(reel.id)}
                onSave={() => toggleSave(reel.id)}
                onFollow={() => toggleFollow(reel.authorId)}
                onCardClick={() => handleCardClick(reel)}
              />
            </motion.div>
          ))
        )}
      </AnimatePresence>
    </div>
  );

  /* ── Desktop layout ── */
  if (showDesktopFrame) {
    return (
      <div className="relative h-[calc(100vh-64px)] w-full bg-stone-950 overflow-hidden flex">
        {/* Left side info column */}
        <div className="hidden xl:flex w-[280px] flex-shrink-0 flex-col justify-between p-8 text-white/90">
          <div>
            <h1 className="text-3xl font-serif font-bold leading-tight">Reels</h1>
            <p className="text-sm text-white/55 mt-2 max-w-[220px]">
              Short videos from your circle and experts you trust. Tap a card to
              open the restaurant or recipe.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAddReelModal(kind)}
            className="inline-flex items-center gap-2 self-start h-11 px-5 rounded-full bg-white text-stone-900 text-sm font-bold hover:bg-white/90 transition-colors"
          >
            <Plus size={18} strokeWidth={2.5} />
            Post a reel
          </button>
        </div>

        {/* Center phone-shaped column */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div
            className="relative bg-black rounded-[40px] overflow-hidden shadow-2xl border border-white/10"
            style={{ aspectRatio: '9 / 19.5', height: 'min(100%, calc(100vh - 96px))' }}
          >
            <TopBar kind={kind} setKind={setKind} muted={muted} setMuted={setMuted} />
            {feed}
          </div>
        </div>

        {/* Right side hint column */}
        <div className="hidden xl:flex w-[280px] flex-shrink-0 flex-col gap-4 p-8 text-white/80">
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-xs uppercase tracking-widest text-white/40 font-bold mb-2">Now playing</p>
            <p className="text-sm text-white/90 leading-snug">
              Scroll to see the next reel. Use the mute toggle in the top right
              to turn audio on.
            </p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-xs uppercase tracking-widest text-white/40 font-bold mb-2">Tip</p>
            <p className="text-sm text-white/90 leading-snug">
              Posting a reel? Attach a {kind === 'restaurant' ? 'restaurant' : 'recipe'} so viewers
              can tap straight through to the details.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Mobile / phone-frame layout ── */
  return (
    <div className="relative h-screen w-full bg-black overflow-hidden">
      <TopBar kind={kind} setKind={setKind} muted={muted} setMuted={setMuted} />
      {feed}
    </div>
  );
};
