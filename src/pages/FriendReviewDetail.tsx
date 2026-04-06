import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, MapPin, Heart, MessageSquare, Send, X,
  CornerDownLeft, Loader2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
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

const scoreColor = (s: number) =>
  s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
const scoreRing = (s: number) =>
  s >= 8 ? 'ring-green-500/40' : s >= 5 ? 'ring-yellow-500/40' : 'ring-red-500/40';
const scoreGradient = (s: number) =>
  s >= 8 ? 'from-green-500/20 to-green-500/0'
    : s >= 5 ? 'from-yellow-500/20 to-yellow-500/0'
    : 'from-red-500/20 to-red-500/0';

export const FriendReviewDetail: React.FC = () => {
  const { ratingId } = useParams<{ ratingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
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

        const [profs, photos, likesData, counts] = await Promise.all([
          getProfilesByIds([r.user_id]),
          getCommunityPhotos(r.restaurant_id),
          userId ? getLikesForRatings(userId, [r.id]) : Promise.resolve({ likes: { [r.id]: 0 } as Record<string, number>, userLiked: new Set<string>() }),
          getCommentCounts([r.id]),
        ]);
        if (cancelled) return;
        setAuthor(profs[r.user_id] || null);
        setUserPhotos(photos.filter((p) => p.user_id === r.user_id));
        setLikeCount(likesData.likes[r.id] || 0);
        setLiked(likesData.userLiked.has(r.id));
        setCommentCount(counts[r.id] || 0);
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
    await toggleLike(userId, rating.id);
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
    if (!userId || !rating || !newComment.trim()) return;
    const ok = await addComment(userId, rating.id, newComment.trim());
    if (ok) {
      setNewComment('');
      setCommentCount((c) => c + 1);
      const cmts = await getComments(rating.id);
      setComments(cmts);
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      setCommentProfiles(await getProfilesByIds(ids));
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
    ? new Date(rating.visit_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-surface pb-28"
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-on-surface/6">
        <div className="flex items-center gap-3 px-3 py-3">
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
      </div>

      {/* Hero */}
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
        <div className={cn("absolute inset-0 bg-gradient-to-t", scoreGradient(score))} />
        {hasPhotos && userPhotos.length > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {userPhotos.map((_, i) => (
              <button
                key={i}
                onClick={() => setHeroIdx(i)}
                className={cn("h-1.5 rounded-full transition-all",
                  i === heroIdx ? "w-6 bg-white" : "w-1.5 bg-white/50"
                )}
                aria-label={`View photo ${i + 1}`}
              />
            ))}
          </div>
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
              scoreRing(score)
            )}>
              <span className={cn("text-2xl font-serif font-bold", scoreColor(score))}>{score.toFixed(1)}</span>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mt-1.5">out of 10</span>
          </div>
        </div>

        {/* Would return + visit date */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {rating.would_return ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
              <CornerDownLeft size={11} /> Would return
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
              <X size={11} /> Wouldn&apos;t return
            </span>
          )}
          {visitDate && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-on-surface/60 bg-on-surface/5 px-2.5 py-1 rounded-full">
              <Calendar size={11} /> {visitDate}
            </span>
          )}
        </div>
      </div>

      {/* Notes */}
      {rating.notes && (
        <div className="px-4 pt-6">
          <div className="relative bg-white rounded-2xl border border-on-surface/8 shadow-sm p-5 pl-6">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl bg-primary" />
            <span className="absolute -top-2 left-4 font-serif text-4xl text-primary/30 leading-none select-none">&ldquo;</span>
            <p className="font-serif italic text-sm text-on-surface/75 leading-relaxed whitespace-pre-wrap">{rating.notes}</p>
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

      {/* Photos grid */}
      {hasPhotos && (
        <div className="pt-6">
          <div className="px-4 mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Photos</h3>
            <span className="text-[10px] text-on-surface/40 font-medium">{userPhotos.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 pb-2">
            {userPhotos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setLightbox(i)}
                className="flex-shrink-0 w-48 group"
              >
                <div className="w-48 h-48 rounded-xl overflow-hidden bg-on-surface/5 ring-1 ring-on-surface/5">
                  <img src={p.url} alt={p.caption || ''} className="w-full h-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                </div>
                {p.caption && <p className="text-[11px] text-on-surface/60 mt-1.5 line-clamp-2 leading-snug text-left">{p.caption}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="mx-4 my-6 h-px bg-on-surface/8" />

      {/* Like + Comment */}
      <div className="px-4 flex items-center gap-5">
        <button
          onClick={handleLike}
          className={cn("flex items-center gap-1.5 transition-colors", liked ? "text-red-500" : "text-on-surface/50 hover:text-red-500")}
        >
          <Heart size={20} className={liked ? 'fill-red-500' : ''} />
          <span className="text-sm font-semibold">{likeCount}</span>
        </button>
        <button
          onClick={handleToggleComments}
          className={cn("flex items-center gap-1.5 transition-colors", commentsOpen ? "text-primary" : "text-on-surface/50 hover:text-primary")}
        >
          <MessageSquare size={20} />
          <span className="text-sm font-semibold">{commentCount}</span>
        </button>
      </div>

      {/* Comments */}
      <AnimatePresence initial={false}>
        {commentsOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 mx-4 border-t border-on-surface/8 pt-4 space-y-3">
              {commentsLoading ? (
                <div className="text-center py-3"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-on-surface/40 py-1">No comments yet — be the first!</p>
              ) : (
                <div className="space-y-3">
                  {comments.map((c) => {
                    const cColor = avatarColor(c.user_id);
                    const cInitial = initialOf(commentProfiles[c.user_id]?.display_name || 'User');
                    return (
                      <div key={c.id} className="flex gap-2.5">
                        <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", cColor.bg)}>
                          <span className={cn("text-[11px] font-serif font-bold", cColor.text)}>{cInitial}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs leading-relaxed">
                            <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/75 hover:text-primary">
                              {commentProfiles[c.user_id]?.display_name || 'User'}
                            </Link>{' '}
                            <span className="text-on-surface/60">{c.text}</span>
                          </p>
                          <p className="text-[10px] text-on-surface/30 mt-0.5">{timeAgo(c.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 bg-on-surface/5 rounded-xl py-2.5 px-3.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  className="p-2.5 text-primary disabled:text-on-surface/15 rounded-xl hover:bg-primary/5 transition-colors"
                >
                  <Send size={16} />
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
