import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, MapPin, Heart, MessageSquare, Send, X,
  Loader2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreRingStrong } from '../lib/score';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { Collapse } from '../components/Collapse';
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

/* ── Shared surface language, matched to the restaurant detail pages ──── */
/** Page gutter + max width. One container for the header and the body so
 *  they stay in the same column on wide screens. */
const SHELL = 'mx-auto w-full max-w-[1060px] px-4 sm:px-6 lg:px-8';
const EYEBROW = 'text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/40';

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

  const routerLocation = useLocation();
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

  /* Arriving from a card whose comment button was tapped: open the thread
     rather than landing on a collapsed toggle the user has to find and
     press again. The feed's compact "Also rated this week" cards have no
     room for an inline thread, so their comment button routes HERE — and
     it has to arrive on the thing it promised. Runs once, when the rating
     it belongs to has loaded. */
  const openOnArrival = (routerLocation.state as { openComments?: boolean } | null)?.openComments === true;
  const openedOnArrivalRef = useRef(false);
  useEffect(() => {
    if (!openOnArrival || !rating || openedOnArrivalRef.current) return;
    openedOnArrivalRef.current = true;
    void handleToggleComments();
  }, [openOnArrival, rating, handleToggleComments]);

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
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-full bg-primary text-on-primary text-sm font-bold">Go Back</button>
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
  // One gallery instead of a full-bleed hero PLUS a second big strip of the
  // same shots: a contained lead image with small thumbnails under it.
  const hasGallery = !!heroSrc;
  const heroCaption = hasPhotos ? userPhotos[heroIdx]?.caption || '' : '';
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
      {/* Sticky header — fades away with scroll on phones */}
      <motion.div ref={headerFade.headerRef} style={headerFade.headerStyle} className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-on-surface/[0.06]">
        <div className={SHELL}>
          <div className="flex items-center gap-3 pt-safe-3 pb-3">
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="w-9 h-9 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={18} className="text-on-surface/70" />
            </button>
            <div className="flex-1 min-w-0">
              <p className={EYEBROW}>Review</p>
              <p className="text-sm font-semibold truncate">{authorName}</p>
            </div>
          </div>
        </div>
      </motion.div>

      <div className={cn(SHELL, 'pt-4 sm:pt-6')}>
        <div className={cn(
          'grid items-start gap-4 sm:gap-5',
          // Wide screens put the gallery beside the review instead of
          // stacking one giant column (the old layout let the hero grow to
          // the full viewport width — ~1200px tall on a desktop monitor).
          hasGallery && 'lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,1fr)]',
        )}>

          {/* ── Gallery: contained lead image + small thumbnails ── */}
          {hasGallery && (
            <section className="-mx-4 sm:mx-0 sm:rounded-[20px] overflow-hidden">
              {/* Full-bleed on the phone — the photo IS the top of the page,
                  not a picture inside a frame inside a page. Wide screens
                  keep a soft corner so it sits as a block beside the text. */}
              <button
                type="button"
                onClick={() => hasPhotos && setLightbox(heroIdx)}
                aria-label={hasPhotos ? 'Open photo' : undefined}
                className="relative block w-full h-[260px] sm:h-[320px] lg:h-[360px] bg-on-surface/[0.04] group"
              >
                <img
                  src={heroSrc || ''}
                  alt={rating.restaurant_name}
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                {hasPhotos && userPhotos.length > 1 && (
                  <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-md">
                    <span className="text-[11.5px] font-semibold text-white tabular-nums">
                      {heroIdx + 1} / {userPhotos.length}
                    </span>
                  </div>
                )}
              </button>

              {(userPhotos.length > 1 || heroCaption) && (
                <div className="px-4 sm:px-0 pt-3 pb-1">
                  {userPhotos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {userPhotos.map((p, i) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setHeroIdx(i)}
                          aria-label={`Photo ${i + 1}`}
                          aria-current={i === heroIdx}
                          className={cn(
                            'flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden transition-all',
                            i === heroIdx
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface'
                              : 'opacity-60 hover:opacity-100',
                          )}
                        >
                          <img src={p.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </button>
                      ))}
                    </div>
                  )}
                  {heroCaption && (
                    <p className={cn('font-serif italic text-[13px] text-on-surface/55 leading-snug', userPhotos.length > 1 && 'mt-3')}>
                      {heroCaption}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── The review itself ── */}
          <section className="pt-1">
            {/* Author */}
            <div className="flex items-center gap-3">
              <Link to={`/user/${authorUsername}`} className="flex-shrink-0">
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', authorColor.bg)}>
                  <span className={cn('text-[15px] font-serif font-bold', authorColor.text)}>{authorInitial}</span>
                </div>
              </Link>
              <div className="min-w-0 flex-1">
                <Link to={`/user/${authorUsername}`} className="block text-[14.5px] font-semibold truncate hover:text-primary transition-colors">{authorName}</Link>
                <p className="text-[11.5px] text-on-surface/45 font-medium">{timeAgo(rating.created_at)}</p>
              </div>
            </div>

            {/* Restaurant + score — spacing does the separating; the old
                hairline here was the first of the boxes-within-boxes. */}
            <div className="mt-6 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/restaurant/${rating.restaurant_id}`}
                  className="font-serif font-bold text-[24px] sm:text-[26px] leading-[1.12] tracking-[-0.025em] hover:text-primary transition-colors"
                >
                  {rating.restaurant_name}
                </Link>
                {/* Cuisine and price as a quiet meta line, not two more
                    little boxes. */}
                {(rating.cuisine || rating.price) && (
                  <p className="mt-2 text-[12.5px] font-semibold tracking-wide text-on-surface/50">
                    {[rating.cuisine, rating.price].filter(Boolean).join('  ·  ')}
                  </p>
                )}
              </div>

              <div className="flex-shrink-0 flex flex-col items-center">
                <div className={cn('w-[58px] h-[58px] sm:w-[64px] sm:h-[64px] rounded-full bg-surface ring-[3px] flex items-center justify-center', scoreRingStrong(score))}>
                  <span className={cn('text-[19px] sm:text-[21px] font-serif font-bold tabular-nums', scoreColor(score))}>{score.toFixed(1)}</span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mt-1.5">
                  {rating.rating_method === 'slider' ? 'Self-scored' : 'out of 10'}
                </span>
              </div>
            </div>

            {/* Where + when — one quiet meta block instead of scattered pills */}
            {(rating.address || visitDate) && (
              <div className="mt-4 flex flex-col gap-1.5 text-[13px] text-on-surface/55">
                {rating.address && (
                  <div className="flex items-start gap-1.5">
                    <MapPin size={13} className="text-on-surface/35 mt-[2px] flex-shrink-0" />
                    <span className="leading-snug">{rating.address}</span>
                  </div>
                )}
                {visitDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-on-surface/35 flex-shrink-0" />
                    <span>Visited {visitDate}</span>
                  </div>
                )}
              </div>
            )}

            {/* Notes — editorial quote with an accent rule */}
            {rating.notes && (
              <div className="mt-6">
                <p
                  className="selectable font-serif italic text-[16px] text-on-surface/75 leading-[1.6] whitespace-pre-wrap pl-4"
                  style={{ borderLeft: '2px solid var(--color-primary)' }}
                >
                  {rating.notes}
                </p>
              </div>
            )}

            {/* Tags */}
            {rating.tags && rating.tags.length > 0 && (
              <div className="mt-4 flex gap-1.5 flex-wrap">
                {rating.tags.map((t) => (
                  <span key={t} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/60">{t}</span>
                ))}
              </div>
            )}
          </section>

          {/* ── Likes + comments ── */}
          <section className={cn('mt-3 border-t border-on-surface/[0.07] pt-2', hasGallery && 'lg:col-span-2')}>
            <div className="-ml-3 flex items-center gap-1">
              <button
                onClick={handleLike}
                aria-label={liked ? 'Unlike review' : 'Like review'}
                className={cn(
                  'min-w-[44px] h-11 px-3 inline-flex items-center gap-2 rounded-full transition-colors',
                  liked ? 'text-red-500' : 'text-on-surface/55 hover:text-red-500 hover:bg-on-surface/[0.04]',
                )}
              >
                <Heart size={21} className={liked ? 'fill-red-500' : ''} />
                <span className="text-[14.5px] font-semibold tabular-nums">{likeCount}</span>
              </button>
              <button
                onClick={handleToggleComments}
                aria-label="Toggle comments"
                className={cn(
                  'min-w-[44px] h-11 px-3 inline-flex items-center gap-2 rounded-full transition-colors',
                  commentsOpen ? 'text-primary' : 'text-on-surface/55 hover:text-primary hover:bg-on-surface/[0.04]',
                )}
              >
                <MessageSquare size={21} />
                <span className="text-[14.5px] font-semibold tabular-nums">{commentCount}</span>
              </button>
            </div>

            {/* Nothing yet: say so where the thread would be, so the page
                doesn't end in two icons above a void. */}
            {!commentsOpen && commentCount === 0 && !commentsLoading && (
              <p className="pt-1 pb-2 text-[13px] text-on-surface/40">No comments yet — be the first.</p>
            )}

            {/* Inline preview — first 2 comments + "View all" toggle */}
            {!commentsOpen && comments.length > 0 && (
              <div className="pt-2 pb-1 space-y-3">
                {comments.slice(0, 2).map((c) => {
                  const cColor = avatarColor(c.user_id);
                  const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
                  return (
                    <div key={c.id} className="flex gap-2.5">
                      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', cColor.bg)}>
                        <span className={cn('text-[11px] font-serif font-bold', cColor.text)}>{cInitial}</span>
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

            {/* Expanded thread + input */}
            <Collapse open={commentsOpen}>
                  <div className="mt-2 pt-1 space-y-3">
                    {commentsLoading ? (
                      <div className="text-center py-3"><Loader2 size={16} className="animate-spin text-primary mx-auto" /></div>
                    ) : comments.length === 0 ? (
                      <p className="text-[13px] text-on-surface/40 py-1">No comments yet — be the first.</p>
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
                  </div>
            </Collapse>

            {/* The composer is always on the page — a reply box you have to
                unfold first is a reply box most people never find. */}
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 bg-on-surface/[0.05] rounded-full py-2.5 px-4 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddComment(); }}
              />
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim() || commentSubmitting}
                aria-label="Post comment"
                className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-primary disabled:text-on-surface/15 rounded-full hover:bg-primary/5 transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
          </section>
        </div>
      </div>

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
            {userPhotos.length > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white/85 text-[12px] font-semibold tabular-nums z-10 pointer-events-none">
                {lightbox + 1} of {userPhotos.length}
              </div>
            )}
            {/* Swipe between photos on touch — same gesture as the
                restaurant photo gallery. */}
            <motion.img
              key={lightbox}
              src={userPhotos[lightbox].url}
              alt={userPhotos[lightbox].caption || ''}
              className="max-w-full max-h-full object-contain touch-pan-y"
              drag={userPhotos.length > 1 ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.9}
              onDragEnd={(_e, info) => {
                if (userPhotos.length < 2) return;
                if (info.offset.x < -70 || info.velocity.x < -500) setLightbox((i) => (i === null ? 0 : (i + 1) % userPhotos.length));
                else if (info.offset.x > 70 || info.velocity.x > 500) setLightbox((i) => (i === null ? 0 : (i - 1 + userPhotos.length) % userPhotos.length));
              }}
              draggable={false}
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
