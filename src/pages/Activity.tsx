/**
 * Activity — "your activity" hub: a tiny index page that fans out to four
 * lists (saved / liked / commented / recipe drafts).
 *
 * Routing is path-driven so each list has its own URL:
 *   /activity           → index (4 navigation rows)
 *   /activity/saved     → reels + posts the user has bookmarked
 *   /activity/likes     → reels + posts the user has liked
 *   /activity/comments  → reels + posts the user has commented on
 *   /activity/drafts    → saved Advanced-builder recipe drafts
 *
 * Saved / liked lists are derived locally from the already-loaded reels +
 * posts (each carries a per-viewer `saved` / `liked` flag from the
 * PostgREST embed). Commented requires a dedicated query. Drafts live in
 * localStorage via src/lib/recipe-drafts.ts.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft, Bookmark, Heart, MessageCircle, ChefHat, MapPin, Play, Loader2,
  ChevronRight, Layers, FileText, Trash2, Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { useReels, reelRowToUi, type Reel } from '../contexts/ReelsContext';
import { usePosts, postRowToUi, type Post } from '../contexts/PostsContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { listReelIdsCommentedByUser, listReels } from '../lib/supabase-reels';
import { listPostIdsCommentedByUser, listPosts } from '../lib/supabase-posts';
import {
  loadDrafts,
  removeDraft,
  setPendingResumeDraftId,
  formatDraftTimeAgo,
  type RecipeDraft,
} from '../lib/recipe-drafts';

type ActivityTab = 'saved' | 'likes' | 'comments' | 'drafts';

function tabFromPathname(pathname: string): ActivityTab | null {
  if (pathname.endsWith('/saved')) return 'saved';
  if (pathname.endsWith('/likes')) return 'likes';
  if (pathname.endsWith('/comments')) return 'comments';
  if (pathname.endsWith('/drafts')) return 'drafts';
  return null;
}

type FeedItem =
  | { kind: 'reel'; createdAt: number; reel: Reel }
  | { kind: 'post'; createdAt: number; post: Post };

/** Posts that can fill a grid tile. A share published from the rating flow
 *  without photos is a real post, but it has no cover — it would render as
 *  an empty square here. Those live in the feed and on the Rated tab. */
const withTiles = (posts: Post[]): Post[] => posts.filter((p) => p.items.length > 0);

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

/* ── Reel tile (vertical 9:14) ────────────────────────────────────────── */

const ReelTile: React.FC<{ reel: Reel; onClick: () => void }> = ({ reel, onClick }) => {
  // Title preference: the author's caption (what the video is actually
  // about) wins; only when there's no caption do we fall back to the
  // attached restaurant / recipe name. The kind chip in the top-left
  // already conveys what kind of attachment is on the reel, so showing
  // the attached entity name as the headline was redundant — and
  // confusing when the recipe/restaurant title doesn't match the video.
  const label =
    reel.caption?.trim()
    || (reel.kind === 'restaurant' ? reel.restaurant?.name : reel.recipe?.title)
    || '';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className={cn(
        'relative aspect-[9/14] w-full rounded-2xl overflow-hidden text-left',
        'ring-1 ring-on-surface/[0.06] shadow-sm hover:shadow-md transition-shadow',
        'bg-gradient-to-br',
        reel.bgGradient || 'from-stone-800 to-stone-900',
      )}
    >
      {/* Cover: prefer poster image, fall back to the video itself
          (preload=metadata + playsInline so the first frame paints in
          mobile browsers too). Final fallback is the bgGradient already
          set on the parent, plus a subtle radial sheen for texture. */}
      {reel.posterUrl ? (
        <img
          src={reel.posterUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : reel.videoUrl ? (
        <video
          src={reel.videoUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.12),transparent_60%)]" />
      )}

      {/* Kind chip top-left */}
      <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur text-white text-[9px] font-bold uppercase tracking-wider">
        {reel.kind === 'recipe' ? <ChefHat size={9} /> : <Play size={9} className="fill-white" />}
        {reel.kind}
      </div>

      {/* Likes pill top-right */}
      {reel.likes > 0 && (
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-semibold tabular-nums">
          <Heart size={9} className="fill-white" />
          {formatCount(reel.likes)}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        {label && (
          <p className="font-serif italic text-white text-[12px] leading-tight line-clamp-2 drop-shadow">
            {label}
          </p>
        )}
        <p className="text-white/75 text-[10px] font-mono truncate mt-0.5">@{reel.authorUsername}</p>
      </div>
    </motion.button>
  );
};

/* ── Post tile (square) ───────────────────────────────────────────────── */

const PostTile: React.FC<{ post: Post; onClick: () => void }> = ({ post, onClick }) => {
  const cover = post.items[0];
  const isMulti = post.items.length > 1;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className={cn(
        'relative aspect-square w-full rounded-2xl overflow-hidden text-left',
        'ring-1 ring-on-surface/[0.06] shadow-sm hover:shadow-md transition-shadow',
        'bg-gradient-to-br',
        cover?.bgGradient || 'from-stone-800 to-stone-900',
      )}
    >
      {/* Cover: video tile when the first item is explicitly a video (so the
          first frame paints), otherwise any mediaUrl is rendered as an
          image. Falls back to the parent gradient when both branches miss
          (e.g. signed URL failed). Mirrors ProfilePostsSection. */}
      {cover?.mediaType === 'video' && cover.mediaUrl ? (
        <video
          src={cover.mediaUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : cover?.mediaUrl ? (
        <img
          src={cover.mediaUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.12),transparent_60%)]" />
      )}

      {/* Multi-item indicator */}
      {isMulti && (
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur text-white text-[10px] font-semibold tabular-nums">
          <Layers size={10} />
          {post.items.length}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        {post.caption && (
          <p className="font-serif italic text-white text-[12px] leading-tight line-clamp-2 drop-shadow">
            {post.caption}
          </p>
        )}
        <p className="text-white/75 text-[10px] font-mono truncate mt-0.5">@{post.author?.username || post.userId.slice(0, 8)}</p>
      </div>
    </motion.button>
  );
};

/* ── Empty state ──────────────────────────────────────────────────────── */

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => (
  <div className="flex flex-col items-center justify-center text-center py-20 px-8">
    <div className="w-16 h-16 rounded-full bg-on-surface/[0.05] flex items-center justify-center text-on-surface/30 mb-4">
      {icon}
    </div>
    <h3 className="font-serif font-bold text-on-surface text-[17px] mb-1">{title}</h3>
    <p className="text-on-surface/55 text-[13px] leading-snug max-w-[280px]">{body}</p>
  </div>
);

/* ── Index page (3 navigation rows) ────────────────────────────────────── */

interface IndexRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  count: number;
  loading?: boolean;
  to: string;
}

const IndexRow: React.FC<IndexRowProps & { first?: boolean }> = ({ icon, label, description, count, loading, to, first }) => {
  const navigate = useNavigate();
  return (
    <div className={cn(!first && 'border-t border-on-surface/[0.08]')}>
      <button
        type="button"
        onClick={() => navigate(to)}
        className="w-full flex items-center gap-3.5 py-[15px] text-left active:opacity-60 transition-opacity"
      >
        <span className="flex-none w-[38px] h-[38px] rounded-[13px] bg-on-surface/[0.055] flex items-center justify-center text-on-surface">
          {icon}
        </span>
        <span className="flex-1 min-w-0 block">
          <span className="block font-serif font-bold text-[15px] leading-tight tracking-[-0.015em] text-on-surface">{label}</span>
          <span className="block mt-1 text-[12px] leading-snug text-on-surface/50">{description}</span>
        </span>
        <span className="flex-none flex items-center gap-2">
          <span className={cn('font-serif font-bold text-[15px] tabular-nums tracking-[-0.02em]', count === 0 ? 'text-on-surface/35' : 'text-on-surface')}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : formatCount(count)}
          </span>
          <ChevronRight size={15} strokeWidth={2.2} className="text-on-surface/30" />
        </span>
      </button>
    </div>
  );
};

/* ── Recipe draft row ──────────────────────────────────────────
   Tappable card showing the draft title, a small thumbnail preview
   from the cover photo if set, last-saved time + step indicator,
   and an inline delete button. */

interface DraftRowProps {
  draft: RecipeDraft;
  onOpen: () => void;
  onDelete: () => void;
}

const DraftRow: React.FC<DraftRowProps & { first?: boolean }> = ({ draft, onOpen, onDelete, first }) => {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className={cn('flex items-center gap-3.5 py-[15px]', !first && 'border-t border-on-surface/[0.08]')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-3.5 flex-1 min-w-0 text-left active:opacity-60 transition-opacity"
      >
        <span
          className="w-12 h-12 rounded-[13px] bg-on-surface/[0.055] flex items-center justify-center text-on-surface/40 flex-shrink-0 overflow-hidden"
          style={draft.coverPhoto ? { backgroundImage: `url("${draft.coverPhoto}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          {!draft.coverPhoto && <FileText size={19} strokeWidth={1.9} />}
        </span>
        <span className="flex-1 min-w-0 block">
          <span className="block font-serif font-bold text-[15px] leading-tight tracking-[-0.015em] text-on-surface truncate">
            {draft.title}
          </span>
          <span className="mt-1 text-[12px] leading-snug text-on-surface/50 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {formatDraftTimeAgo(draft.savedAt)}
            </span>
            <span className="text-on-surface/30">·</span>
            <span>Step {draft.currentStep + 1} of 7</span>
            {draft.editingMealId && (
              <>
                <span className="text-on-surface/30">·</span>
                <span className="italic">Editing existing recipe</span>
              </>
            )}
          </span>
        </span>
      </button>
      {confirmDel ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }}
            className="px-3.5 py-2 text-[11.5px] font-bold text-on-surface border border-on-surface/20 rounded-full active:bg-on-surface/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="px-3.5 py-2 text-[11.5px] font-bold text-white bg-red-600 rounded-full active:opacity-85"
          >
            Delete
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
          aria-label={`Delete draft "${draft.title}"`}
          className="w-9 h-9 rounded-full text-on-surface/40 active:text-red-500 active:bg-red-500/10 flex items-center justify-center flex-shrink-0 transition-colors"
        >
          <Trash2 size={15} strokeWidth={1.9} />
        </button>
      )}
    </div>
  );
};

/* ── Top header (back arrow + title) ──────────────────────────────────── */

const ActivityHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => {
  // On phones the bar dissolves as you scroll (Discover-style) and
  // returns at the top; desktop keeps it pinned.
  const { phoneMode } = useSettings();
  const fade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  return (
    <motion.header
      ref={fade.headerRef}
      style={fade.headerStyle}
      className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-on-surface/[0.08] px-5 pt-safe-3 pb-3.5 flex items-center gap-3"
    >
      <GlassButton
        id="activity-back"
        symbol="chevron.left"
        label="Back"
        onClick={onBack}
        className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
      >
        <ArrowLeft size={18} />
      </GlassButton>
      <h1 className="font-serif font-bold text-on-surface text-[19px] leading-tight tracking-[-0.025em] truncate">{title}</h1>
    </motion.header>
  );
};

/* ── The page ─────────────────────────────────────────────────────────── */

export const Activity: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const tab = tabFromPathname(location.pathname);

  const { user } = useAuth();
  const { reels, loading: reelsLoading } = useReels();
  const { posts, loading: postsLoading, setLastActivePostId } = usePosts();

  /* ── Derived saved / liked lists (instant, no extra queries). */
  const savedReels = useMemo(() => reels.filter((r) => r.saved), [reels]);
  const likedReels = useMemo(() => reels.filter((r) => r.liked), [reels]);
  const savedPosts = useMemo(() => posts.filter((p) => p.saved), [posts]);
  const likedPosts = useMemo(() => posts.filter((p) => p.liked), [posts]);

  /* ── Commented requires a dedicated query because per-viewer "did I
        comment on this" isn't part of the Reel / Post embed shape. Fetch
        the distinct ids the user has commented on, then batch-get those
        exact reels/posts — intersecting with the currently-loaded feed
        pages used to make "Comments · 12" open a grid of 8 tiles. */
  const [commentedReels, setCommentedReels] = useState<Reel[]>([]);
  const [commentedPosts, setCommentedPosts] = useState<Post[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setCommentsLoading(false); return; }
    const uid = user.id;
    let cancelled = false;
    setCommentsLoading(true);
    (async () => {
      try {
        const [reelIds, postIds] = await Promise.all([
          listReelIdsCommentedByUser(uid),
          listPostIdsCommentedByUser(uid),
        ]);
        if (cancelled) return;
        const [reelRows, postRows] = await Promise.all([
          reelIds.length > 0 ? listReels({ viewerId: uid, ids: reelIds }) : Promise.resolve([]),
          postIds.length > 0 ? listPosts({ viewerId: uid, ids: postIds }) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setCommentedReels((reelRows || []).map(reelRowToUi));
        setCommentedPosts((postRows || []).map(postRowToUi));
      } catch { /* keep whatever loaded */ }
      if (!cancelled) setCommentsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const savedCount = savedReels.length + savedPosts.length;
  const likedCount = likedReels.length + likedPosts.length;
  // Count and grid derive from the SAME fetched lists, so the tile count
  // always matches what opens (comments on since-deleted items drop out
  // of both).
  const commentedCount = commentedReels.length + commentedPosts.length;

  /* ── Recipe drafts (Advanced-builder Save Draft entries). Local
        state mirrors localStorage so deletes / opens reflect
        immediately without a page reload. */
  const { openHomeMealModal, homeMeals } = useLists();
  const [drafts, setDrafts] = useState<RecipeDraft[]>(() => loadDrafts(user?.id || null));
  // Refresh whenever the user lands on the page or returns to it —
  // a draft could've been added from elsewhere in the app.
  useEffect(() => {
    setDrafts(loadDrafts(user?.id || null));
  }, [user?.id, location.pathname]);

  const handleResumeDraft = (draft: RecipeDraft) => {
    setPendingResumeDraftId(draft.id);
    // A draft saved mid-EDIT reopens as an edit of that meal — resuming
    // it as a fresh create used to publish a duplicate recipe. If the
    // meal has since been deleted, fall back to a fresh create.
    const editingMeal = draft.editingMealId
      ? homeMeals.find((m) => m.id === draft.editingMealId)
      : undefined;
    // Re-route to a surface that mounts the modal. The modal lives
    // app-global so we can open it directly from here.
    openHomeMealModal(editingMeal);
  };
  const handleDeleteDraft = (id: string) => {
    removeDraft(user?.id || null, id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  /* ── Click handler: open the focused single-item viewer. Same Reels
        component, but routed to /r/:focusKey so it shows just this item
        first with a back arrow and no bottom nav. */
  const handleReelTap = (r: Reel) => {
    navigate(`/r/reel-${r.id}`);
  };
  const handlePostTap = (p: Post) => {
    setLastActivePostId(p.id);
    navigate(`/r/post-${p.id}`);
  };

  /* ── Build the unified list for the active tab ── */
  let title = '';
  let items: FeedItem[] = [];
  let emptyIcon: React.ReactNode = null;
  let emptyTitle = '';
  let emptyBody = '';
  let activeLoading = false;
  if (tab === 'saved') {
    title = 'Saved';
    emptyIcon = <Bookmark size={26} strokeWidth={1.8} />;
    emptyTitle = 'No saves yet';
    emptyBody = 'Tap the bookmark on any reel or post to save it here for later.';
    items = [
      ...savedReels.map((r) => ({ kind: 'reel' as const, reel: r, createdAt: r.createdAt || 0 })),
      ...withTiles(savedPosts).map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = reelsLoading || postsLoading;
  } else if (tab === 'likes') {
    title = 'Likes';
    emptyIcon = <Heart size={26} strokeWidth={1.8} />;
    emptyTitle = 'No likes yet';
    emptyBody = 'Tap the heart on any reel or post to see it here.';
    items = [
      ...likedReels.map((r) => ({ kind: 'reel' as const, reel: r, createdAt: r.createdAt || 0 })),
      ...withTiles(likedPosts).map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = reelsLoading || postsLoading;
  } else if (tab === 'comments') {
    title = 'Comments';
    emptyIcon = <MessageCircle size={26} strokeWidth={1.8} />;
    emptyTitle = 'No comments yet';
    emptyBody = 'Reels and posts you comment on will show up here.';
    items = [
      ...commentedReels.map((r) => ({ kind: 'reel' as const, reel: r, createdAt: r.createdAt || 0 })),
      ...withTiles(commentedPosts).map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = commentsLoading || reelsLoading || postsLoading;
  }

  /* ── Index page ── */
  if (!tab) {
    return (
      <div className="min-h-screen bg-surface pb-32">
        <ActivityHeader title="Your activity" onBack={() => navigate(-1)} />
        <main className="max-w-2xl mx-auto px-5 pt-5">
          <p className="text-on-surface/55 text-[13.5px] leading-relaxed mb-1" style={{ textWrap: 'pretty' } as React.CSSProperties}>
            Everything you've saved, liked and joined in on — in one place.
          </p>
          <div>
            <IndexRow
              first
              icon={<Bookmark size={17} strokeWidth={1.9} />}
              label="Saved"
              description="Reels and posts you've bookmarked"
              count={savedCount}
              to="/activity/saved"
            />
            <IndexRow
              icon={<Heart size={17} strokeWidth={1.9} />}
              label="Likes"
              description="Everything you've liked"
              count={likedCount}
              to="/activity/likes"
            />
            <IndexRow
              icon={<MessageCircle size={17} strokeWidth={1.9} />}
              label="Comments"
              description="Reels and posts you've commented on"
              count={commentedCount}
              loading={commentsLoading}
              to="/activity/comments"
            />
            <IndexRow
              icon={<FileText size={17} strokeWidth={1.9} />}
              label="Recipe drafts"
              description="Saved drafts from the Advanced recipe builder"
              count={drafts.length}
              to="/activity/drafts"
            />
          </div>
        </main>
      </div>
    );
  }

  /* ── Drafts sub-page ──────────────────────────────────────────
        Drafts are stored locally per-user. Tapping a row sets a
        pending-resume flag and opens the Add Recipe modal, which
        forces the Advanced tab and hydrates the wizard from the
        draft on mount. */
  if (tab === 'drafts') {
    return (
      <div className="min-h-screen bg-surface pb-32">
        {/* Pop, don't push: navigating to '/activity' here grew the history
            stack every tap, so back from the index returned to this page —
            an endless index↔sub-page loop. */}
        <ActivityHeader title="Recipe drafts" onBack={() => navigate(-1)} />
        <main className="max-w-2xl mx-auto px-5 pt-5">
          {drafts.length === 0 ? (
            <EmptyState
              icon={<FileText size={28} />}
              title="No drafts yet"
              body="Tap Save draft inside the Advanced recipe builder and it'll land here."
            />
          ) : (
            <>
              <p className="text-on-surface/55 text-[12px] mb-1 tabular-nums">
                {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
              </p>
              <div>
                {drafts.map((d, i) => (
                  <DraftRow
                    key={d.id}
                    first={i === 0}
                    draft={d}
                    onOpen={() => handleResumeDraft(d)}
                    onDelete={() => handleDeleteDraft(d.id)}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  /* ── List page (saved / likes / comments) ── */
  return (
    <div className="min-h-screen bg-surface pb-32">
      {/* Pop, don't push — see the drafts header above. */}
      <ActivityHeader title={title} onBack={() => navigate(-1)} />
      <main className="max-w-3xl mx-auto px-5 pt-5">
        {activeLoading && items.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-on-surface/45">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={emptyIcon} title={emptyTitle} body={emptyBody} />
        ) : (
          <>
            <p className="text-on-surface/55 text-[12px] mb-4 tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </p>
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {items.map((it) =>
                it.kind === 'reel' ? (
                  <ReelTile key={`reel-${it.reel.id}`} reel={it.reel} onClick={() => handleReelTap(it.reel)} />
                ) : (
                  <PostTile key={`post-${it.post.id}`} post={it.post} onClick={() => handlePostTap(it.post)} />
                ),
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
