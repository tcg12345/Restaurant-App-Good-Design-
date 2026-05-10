/**
 * Activity — "your activity" hub: a tiny index page that fans out to three
 * lists of feed items (saved / liked / commented).
 *
 * Routing is path-driven so each list has its own URL:
 *   /activity           → index (3 navigation rows)
 *   /activity/saved     → reels + posts the user has bookmarked
 *   /activity/likes     → reels + posts the user has liked
 *   /activity/comments  → reels + posts the user has commented on
 *
 * Saved / liked lists are derived locally from the already-loaded reels +
 * posts (each carries a per-viewer `saved` / `liked` flag from the
 * PostgREST embed). Commented requires a dedicated query because the
 * Reel / Post object doesn't tell us whether the viewer has commented.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft, Bookmark, Heart, MessageCircle, ChefHat, MapPin, Play, Loader2,
  ChevronRight, Layers,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useReels, type Reel } from '../contexts/ReelsContext';
import { usePosts, type Post } from '../contexts/PostsContext';
import { useAuth } from '../contexts/AuthContext';
import { listReelIdsCommentedByUser } from '../lib/supabase-reels';
import { listPostIdsCommentedByUser } from '../lib/supabase-posts';

type ActivityTab = 'saved' | 'likes' | 'comments';

function tabFromPathname(pathname: string): ActivityTab | null {
  if (pathname.endsWith('/saved')) return 'saved';
  if (pathname.endsWith('/likes')) return 'likes';
  if (pathname.endsWith('/comments')) return 'comments';
  return null;
}

type FeedItem =
  | { kind: 'reel'; createdAt: number; reel: Reel }
  | { kind: 'post'; createdAt: number; post: Post };

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

/* ── Reel tile (vertical 9:14) ────────────────────────────────────────── */

const ReelTile: React.FC<{ reel: Reel; onClick: () => void }> = ({ reel, onClick }) => {
  const label = reel.kind === 'restaurant'
    ? reel.restaurant?.name
    : reel.recipe?.title;
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

const IndexRow: React.FC<IndexRowProps> = ({ icon, label, description, count, loading, to }) => {
  const navigate = useNavigate();
  return (
    <motion.button
      type="button"
      onClick={() => navigate(to)}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="w-full flex items-center gap-4 px-5 py-5 rounded-2xl bg-paper ring-1 ring-on-surface/[0.07] hover:ring-on-surface/[0.14] hover:bg-on-surface/[0.02] transition-colors text-left shadow-sm"
    >
      <span className="w-12 h-12 rounded-2xl bg-on-surface/[0.06] flex items-center justify-center text-on-surface flex-shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-serif font-bold text-on-surface text-[17px] leading-tight">{label}</p>
        <p className="text-on-surface/55 text-[12px] mt-0.5">{description}</p>
      </div>
      <span className="text-on-surface/50 text-[14px] font-semibold tabular-nums tabular-nums">
        {loading ? <Loader2 size={14} className="animate-spin" /> : formatCount(count)}
      </span>
      <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
    </motion.button>
  );
};

/* ── Top header (back arrow + title) ──────────────────────────────────── */

const ActivityHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-on-surface/[0.07] px-5 py-3 flex items-center gap-3">
    <button
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="w-9 h-9 rounded-full hover:bg-on-surface/[0.05] flex items-center justify-center text-on-surface/65 transition-colors"
    >
      <ArrowLeft size={18} />
    </button>
    <h1 className="font-serif font-bold text-on-surface text-[18px] leading-none">{title}</h1>
  </header>
);

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
        comment on this" isn't part of the Reel / Post embed shape. We
        fetch the distinct ids the user has commented on, then intersect
        with the already-loaded reels / posts. */
  const [commentedReelIds, setCommentedReelIds] = useState<string[]>([]);
  const [commentedPostIds, setCommentedPostIds] = useState<string[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setCommentsLoading(false); return; }
    let cancelled = false;
    setCommentsLoading(true);
    Promise.all([
      listReelIdsCommentedByUser(user.id),
      listPostIdsCommentedByUser(user.id),
    ]).then(([reelIds, postIds]) => {
      if (cancelled) return;
      setCommentedReelIds(reelIds);
      setCommentedPostIds(postIds);
      setCommentsLoading(false);
    }).catch(() => { if (!cancelled) setCommentsLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const commentedReels = useMemo(() => {
    const ids = new Set(commentedReelIds);
    return reels.filter((r) => ids.has(r.id));
  }, [reels, commentedReelIds]);
  const commentedPosts = useMemo(() => {
    const ids = new Set(commentedPostIds);
    return posts.filter((p) => ids.has(p.id));
  }, [posts, commentedPostIds]);

  const savedCount = savedReels.length + savedPosts.length;
  const likedCount = likedReels.length + likedPosts.length;
  // Commented count uses the id lists (not the filtered reels) so the
  // count reflects every comment in the DB even if a reel was deleted
  // or isn't currently in the loaded list.
  const commentedCount = commentedReelIds.length + commentedPostIds.length;

  /* ── Click handler: deep-link into /reels and let the page restore the
        active item. For posts we use the existing lastActivePostId hook
        (PostsContext) which the Reels page already reads on mount. For
        reels we fall back to navigating to /reels — the user lands at
        the top and scrolls. */
  const handleReelTap = (r: Reel) => {
    navigate(`/reels?kind=${r.kind === 'recipe' ? 'recipe' : 'explore'}`);
  };
  const handlePostTap = (p: Post) => {
    setLastActivePostId(p.id);
    navigate('/reels');
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
      ...savedPosts.map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = reelsLoading || postsLoading;
  } else if (tab === 'likes') {
    title = 'Likes';
    emptyIcon = <Heart size={26} strokeWidth={1.8} />;
    emptyTitle = 'No likes yet';
    emptyBody = 'Tap the heart on any reel or post to see it here.';
    items = [
      ...likedReels.map((r) => ({ kind: 'reel' as const, reel: r, createdAt: r.createdAt || 0 })),
      ...likedPosts.map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = reelsLoading || postsLoading;
  } else if (tab === 'comments') {
    title = 'Comments';
    emptyIcon = <MessageCircle size={26} strokeWidth={1.8} />;
    emptyTitle = 'No comments yet';
    emptyBody = 'Reels and posts you comment on will show up here.';
    items = [
      ...commentedReels.map((r) => ({ kind: 'reel' as const, reel: r, createdAt: r.createdAt || 0 })),
      ...commentedPosts.map((p) => ({ kind: 'post' as const, post: p, createdAt: p.createdAt ? Date.parse(p.createdAt) : 0 })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    activeLoading = commentsLoading || reelsLoading || postsLoading;
  }

  /* ── Index page ── */
  if (!tab) {
    return (
      <div className="min-h-screen bg-surface pb-32">
        <ActivityHeader title="Your activity" onBack={() => navigate(-1)} />
        <main className="max-w-2xl mx-auto px-5 pt-6">
          <p className="text-on-surface/55 text-[13px] leading-snug mb-5 px-1">
            Everything you've saved, liked, and joined in on — in one place.
          </p>
          <div className="space-y-2.5">
            <IndexRow
              icon={<Bookmark size={20} />}
              label="Saved"
              description="Reels and posts you've bookmarked"
              count={savedCount}
              to="/activity/saved"
            />
            <IndexRow
              icon={<Heart size={20} />}
              label="Likes"
              description="Everything you've liked"
              count={likedCount}
              to="/activity/likes"
            />
            <IndexRow
              icon={<MessageCircle size={20} />}
              label="Comments"
              description="Reels and posts you've commented on"
              count={commentedCount}
              loading={commentsLoading}
              to="/activity/comments"
            />
          </div>
        </main>
      </div>
    );
  }

  /* ── List page (saved / likes / comments) ── */
  return (
    <div className="min-h-screen bg-surface pb-32">
      <ActivityHeader title={title} onBack={() => navigate('/activity')} />
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
