import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, MapPin, Heart, MessageSquare, Send, X,
  Loader2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreRingStrong, scoreGradientOverlay } from '../lib/score';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  getProfilesByIds, getCommunityPhotos, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments,
  type CommunityRating, type CommunityPhoto, type UserProfile, type ActivityComment,
} from '../lib/supabase-community';

const AVATAR_PALETTE = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
];
const avatarColor = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};
const initialOf = (name: string) => (name || 'U').trim().charAt(0).toUpperCase() || 'U';

const timeAgo = (date: string) => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};

export const FriendReviewDetail: React.FC = () => {
  const { ratingId } = useParams<{ ratingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  // Mobile top bar dissolves with scroll, Discover-style.
  const headerFade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  const userId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<CommunityRating | null>(null);
  const [author, setAuthor] = useState<UserProfile | null>(null);
  const [userPhotos, setUserPhotos] = useState<CommunityPhoto[]>([]);

  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, UserProfile>>({});
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const commentSubmittingRef = useRef(false);

  const [heroIdx, setHeroIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    if (!ratingId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!supabaseConfigured) { setLoading(false); return; }
      try {
        const { data, error } = await supabase
          .from('community_ratings')
          .select('*')
          .eq('id', ratingId)
          .single();
        if (cancelled) return;
        if (error || !data) { setRating(null); setLoading(false); return; }
        const r = data as CommunityRating;
        setRating(r);

        const [profs, photos, likesData, counts, initialComments] = await Promise.all([
          getProfilesByIds([r.user_id]),
          getCommunityPhotos(r.restaurant_id),
          userId ? getLikesForRatings(userId, [r.id]) : Promise.resolve({ likes: { [r.id]: 0 } as Record<string, number>, userLiked: new Set<string>() }),
          getCommentCounts([r.id]),
          getComments(r.id),
        ]);
        if (cancelled) return;
        setAuthor(profs[r.user_id] || null);
        setUserPhotos(photos.filter((p) => p.user_id === r.user_id));
        setLikeCount(likesData.likes[r.id] || 0);
        setLiked(likesData.userLiked.has(r.id));
        setCommentCount(counts[r.id] || 0);
        setComments(initialComments);
        if (initialComments.length > 0) {
          const commentUserIds = [...new Set(initialComments.map((c) => c.user_id))];
          const commentProfs = await getProfilesByIds(commentUserIds);
          if (!cancelled) setCommentProfiles(commentProfs);
        }
      } catch (err) {
        console.error('[FriendReviewDetail] load failed:', err);
        if (!cancelled) setRating(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ratingId, userId]);

  const handleLike = async () => {
    if (!userId || !rating) return;
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));
    const res = await toggleLike(userId, rating.id);
    // Roll back when the write failed or the server didn't actually move.
    if (!res.ok || res.liked === wasLiked) {
      setLiked(wasLiked);
      setLikeCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
    }
  };

  const handleToggleComments = useCallback(async () => {
    if (!rating) return;
    if (commentsOpen) { setCommentsOpen(false); return; }
    setCommentsOpen(true);
    setCommentsLoading(true);
    setNewComment('');
    const cmts = await getComments(rating.id);
    setComments(cmts);
    if (cmts.length > 0) {
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      const profs = await getProfilesByIds(ids);
      setCommentProfiles(profs);
    }
    setCommentsLoading(false);
  }, [rating, commentsOpen]);

  const handleAddComment = async () => {
    const text = newComment.trim();
    // The ref is the double-post guard — Enter fires per keypress, and two
    // Enters during the awaited insert used to post the same comment twice.
    if (!userId || !rating || !text || commentSubmittingRef.current) return;
    commentSubmittingRef.current = true;
    setCommentSubmitting(true);
    // Clear optimistically so the box feels instant; restore on failure.
    setNewComment('');
    try {
      const ok = await addComment(userId, rating.id, text);
      if (ok) {
        setCommentCount((c) => c + 1);
        const cmts = await getComments(rating.id);
        setComments(cmts);
        const ids = [...new Set(cmts.map((c) => c.user_id))];
        setCommentProfiles(await getProfilesByIds(ids));
      } else {
        setNewComment(text);
      }
    } finally {
      commentSubmittingRef.current = false;
      setCommentSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!rating) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 text-center">
        <MessageSquare size={32} className="text-on-surface/20 mb-3" />
        <p className="text-sm font-semibold text-on-surface/60">Review not found</p>
        <p className="text-xs text-on-surface/40 mt-1 mb-6">This review may have been removed.</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-full bg-primary text-white text-sm font-bold">Go Back</button>
      </div>
    );
  }

  const authorName = author?.display_name || 'User';
  const authorUsername = author?.username || '';
  const authorColor = avatarColor(rating.user_id);
  const authorInitial = initialOf(authorName);
  const score = Number(rating.score) || 0;
  const hasPhotos = userPhotos.length > 0;
  const heroSrc = hasPhotos ? userPhotos[heroIdx]?.url : rating.photo_url;
  const visitDate = rating.visit_date
    ? new Date(rating.visit_date.length === 10 ? `${rating.visit_date}T12:00:00` : rating.visit_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-surface pb-28"
    >
      {/* Sticky header — fades away with scroll, back near the top */}
      <motion.div ref={headerFade.headerRef} style={headerFade.headerStyle} className="sticky top-0 z-30 bg-surface/70 backdrop-blur-md">
        <div className="flex items-center gap-3 px-3 pt-safe-3 pb-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0"
          >
            <ArrowLeft size={18} className="text-on-surface/70" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Review</p>
            <p className="text-sm font-semibold truncate">{authorName}</p>
          </div>
        </div>
      </motion.div>

      {/* Hero — score-matched gradient overlay; tap to cycle photos */}
      <div className="relative w-full aspect-[16/10] bg-on-surface/5 overflow-hidden">
        {heroSrc ? (
          <img
            src={heroSrc}
            alt={rating.restaurant_name}
            className={cn("w-full h-full object-cover", !hasPhotos && "opacity-60")}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-on-surface/5">
            <span className="font-serif text-5xl font-bold text-on-surface/15">{initialOf(rating.restaurant_name)}</span>
          </div>
        )}
        <div className={cn("absolute inset-0 bg-gradient-to-t", scoreGradientOverlay(score))} />
        {hasPhotos && userPhotos.length > 1 && (
          <>
            {/* Tap-to-advance overlay */}
            <button
              type="button"
              onClick={() => setHeroIdx((i) => (i + 1) % userPhotos.length)}
              className="absolute inset-0 cursor-pointer"
              aria-label={`Next photo (${heroIdx + 1} of ${userPhotos.length})`}
            />
            {/* Fraction counter */}
            <div className="absolute bottom-3 right-3 pointer-events-none px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md">
              <span className="text-[12px] font-semibold text-white tabular-nums tracking-tight">
                {heroIdx + 1} / {userPhotos.length}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Author row */}
      <div className="px-4 pt-4 flex items-center gap-3">
        <Link to={`/user/${authorUsername}`}>
          <div className={cn("w-11 h-11 rounded-full flex items-center justify-center ring-2 ring-white shadow-sm", authorColor.bg)}>
            <span className={cn("text-base font-serif font-bold", authorColor.text)}>{authorInitial}</span>
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={`/user/${authorUsername}`} className="text-sm font-semibold hover:text-primary">{authorName}</Link>
          <p className="text-[10px] text-on-surface/40 font-medium">{timeAgo(rating.created_at)}</p>
        </div>
      </div>

      {/* Restaurant info + score */}
      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              to={`/restaurant/${rating.restaurant_id}`}
              className="font-serif font-bold text-xl leading-tight hover:text-primary transition-colors"
            >
              {rating.restaurant_name}
            </Link>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {rating.cuisine && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface/60 bg-on-surface/5 px-2 py-0.5 rounded-full">{rating.cuisine}</span>
              )}
              {rating.price && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-primary/80 bg-primary/8 px-2 py-0.5 rounded-full">{rating.price}</span>
              )}
            </div>
            {rating.address && (
              <div className="flex items-start gap-1.5 mt-2">
                <MapPin size={12} className="text-on-surface/40 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-on-surface/50 leading-snug">{rating.address}</p>
              </div>
            )}
          </div>

          {/* Score orb */}
          <div className="flex-shrink-0 flex flex-col items-center">
            <div className={cn(
              "w-20 h-20 rounded-full bg-white ring-4 flex items-center justify-center shadow-sm",
              scoreRingStrong(score)
            )}>
              <span className={cn("text-2xl font-serif font-bold", scoreColor(score))}>{score.toFixed(1)}</span>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mt-1.5">out of 10</span>
          </div>
        </div>

        {/* Visit date */}
        {visitDate && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-on-surface/60 bg-on-surface/5 px-2.5 py-1 rounded-full">
              <Calendar size={11} /> {visitDate}
            </span>
          </div>
        )}
      </div>

      {/* Notes — editorial quote: floating accent bar + quotation mark, no card */}
      {rating.notes && (
        <div className="px-4 pt-6">
          <div className="relative pl-5">
            <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-primary/70" />
            <span className="absolute -top-3 left-3 font-serif text-5xl text-primary/25 leading-none select-none pointer-events-none">&ldquo;</span>
            <p className="selectable font-serif italic text-[15px] text-on-surface/75 leading-relaxed whitespace-pre-wrap pt-1">{rating.notes}</p>
          </div>
        </div>
      )}

      {/* Tags */}
      {rating.tags && rating.tags.length > 0 && (
        <div className="px-4 pt-4">
          <div className="flex gap-1.5 flex-wrap">
            {rating.tags.map((t) => (
              <span key={t} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-primary/8 text-primary/70">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Photos — open horizontal scroll, no card wrapper */}
      {hasPhotos && (
        <div className="pt-6">
          <div className="px-4 mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Photos</h3>
            <span className="text-[10px] text-on-surface/40 font-medium tabular-nums">{userPhotos.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-2 snap-x snap-mandatory">
            {userPhotos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setLightbox(i)}
                className="flex-shrink-0 w-48 group snap-start text-left"
              >
                <div className="w-48 h-48 rounded-2xl overflow-hidden bg-on-surface/[0.05]">
                  <img src={p.url} alt={p.caption || ''} className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" referrerPolicy="no-referrer" />
                </div>
                {p.caption && <p className="text-[11px] text-on-surface/55 mt-1.5 line-clamp-2 leading-snug">{p.caption}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="mx-4 my-6 h-px bg-on-surface/8" />

      {/* Like + Comment — 24px icons, 44x44 tap targets */}
      <div className="px-2 flex items-center gap-1">
        <button
          onClick={handleLike}
          aria-label={liked ? 'Unlike review' : 'Like review'}
          className={cn(
            "min-w-[44px] h-[44px] px-3 inline-flex items-center gap-2 rounded-full transition-colors",
            liked ? "text-red-500" : "text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]",
          )}
        >
          <Heart size={24} className={liked ? 'fill-red-500' : ''} />
          <span className="text-[15px] font-semibold tabular-nums">{likeCount}</span>
        </button>
        <button
          onClick={handleToggleComments}
          aria-label="Toggle comments"
          className={cn(
            "min-w-[44px] h-[44px] px-3 inline-flex items-center gap-2 rounded-full transition-colors",
            commentsOpen ? "text-primary" : "text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04]",
          )}
        >
          <MessageSquare size={24} />
          <span className="text-[15px] font-semibold tabular-nums">{commentCount}</span>
        </button>
      </div>

      {/* Inline comment preview — first 2 comments + "View all" toggle */}
      {!commentsOpen && comments.length > 0 && (
        <div className="px-4 pt-3 space-y-3">
          {comments.slice(0, 2).map((c) => {
            const cColor = avatarColor(c.user_id);
            const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
            return (
              <div key={c.id} className="flex gap-2.5">
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", cColor.bg)}>
                  <span className={cn("text-[11px] font-serif font-bold", cColor.text)}>{cInitial}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-relaxed">
                    <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/80 hover:text-primary">
                      {commentProfiles[c.user_id]?.display_name || 'User'}
                    </Link>{' '}
                    <span className="text-on-surface/65">{c.text}</span>
                  </p>
                  <p className="text-[11px] text-on-surface/35 mt-0.5">{timeAgo(c.created_at)}</p>
                </div>
              </div>
            );
          })}
          {commentCount > 2 && (
            <button
              type="button"
              onClick={handleToggleComments}
              className="text-[13px] font-semibold text-primary/80 hover:text-primary ml-[38px]"
            >
              View all {commentCount} comments
            </button>
          )}
        </div>
      )}

      {/* Comments — expanded view with full list + input */}
      <AnimatePresence initial={false}>
        {commentsOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 mx-4 border-t border-on-surface/8 pt-4 space-y-3">
              {commentsLoading ? (
                <div className="text-center py-3"><Loader2 size={16} className="animate-spin text-primary mx-auto" /></div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-on-surface/40 py-1">No comments yet — be the first!</p>
              ) : (() => {
                // Thread replies under their parent (same grouping as
                // SocialFeed) — rendering the array flat surfaced replies as
                // context-free top-level comments.
                const topLevel = comments.filter((c) => !c.parent_id);
                const repliesByParent: Record<string, typeof comments> = {};
                comments.forEach((c) => {
                  if (c.parent_id) (repliesByParent[c.parent_id] ||= []).push(c);
                });
                const renderRow = (c: (typeof comments)[number], isReply: boolean) => {
                  const cColor = avatarColor(c.user_id);
                  const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
                  return (
                    <div key={c.id} className={cn('flex gap-2.5', isReply && 'ml-9')}>
                      <div className={cn('rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', isReply ? 'w-6 h-6' : 'w-7 h-7', cColor.bg)}>
                        <span className={cn('font-serif font-bold', isReply ? 'text-[10px]' : 'text-[11px]', cColor.text)}>{cInitial}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-relaxed">
                          <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/80 hover:text-primary">
                            {commentProfiles[c.user_id]?.display_name || 'User'}
                          </Link>{' '}
                          <span className="text-on-surface/65">{c.text}</span>
                        </p>
                        <p className="text-[11px] text-on-surface/35 mt-0.5">{timeAgo(c.created_at)}</p>
                        {!isReply && (repliesByParent[c.id] || []).map((reply) => (
                          <div key={reply.id} className="mt-2.5">{renderRow(reply, true)}</div>
                        ))}
                      </div>
                    </div>
                  );
                };
                return <div className="space-y-3">{topLevel.map((c) => renderRow(c, false))}</div>;
              })()}
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 bg-on-surface/5 rounded-full py-2.5 px-4 text-[13px] focus:outline-none focus:bg-on-surface/[0.08] transition-colors"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddComment(); }}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || commentSubmitting}
                  aria-label="Post comment"
                  className="w-11 h-11 flex items-center justify-center text-primary disabled:text-on-surface/15 rounded-full hover:bg-primary/5 transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox !== null && userPhotos[lightbox] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setLightbox(null)}
          >
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            >
              <X size={20} />
            </button>
            {userPhotos.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? 0 : (i - 1 + userPhotos.length) % userPhotos.length)); }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? 0 : (i + 1) % userPhotos.length)); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
            <img
              src={userPhotos[lightbox].url}
              alt={userPhotos[lightbox].caption || ''}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
              referrerPolicy="no-referrer"
            />
            {userPhotos[lightbox].caption && (
              <div className="absolute bottom-4 left-4 right-4 text-center" onClick={(e) => e.stopPropagation()}>
                <p className="text-white/90 text-sm bg-black/40 backdrop-blur-sm px-4 py-2 rounded-xl inline-block max-w-md">
                  {userPhotos[lightbox].caption}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
