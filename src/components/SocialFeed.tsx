import React, { useState, useEffect, useCallback } from 'react';
import { Heart, MessageSquare, Send, UserCircle, ChefHat, UtensilsCrossed } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  getFriends, getFriendActivity, getProfilesByIds, getLikesForRatings,
  getCommentCounts, toggleLike, addComment, getComments,
  getFriendsPublicHomeMeals,
  type CommunityRating, type UserProfile, type ActivityComment, type FriendHomeMeal,
} from '../lib/supabase-community';

type FeedItem =
  | { type: 'rating'; data: CommunityRating; sortTime: number }
  | { type: 'homeMeal'; data: FriendHomeMeal; sortTime: number };

export const SocialFeed: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [homeMeals, setHomeMeals] = useState<FriendHomeMeal[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [userLiked, setUserLiked] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [commentProfiles, setCommentProfiles] = useState<Record<string, UserProfile>>({});
  const [newComment, setNewComment] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const friends = await getFriends(userId);
    if (friends.length === 0) { setLoading(false); return; }

    const friendIds = friends.map((f) => f.friend_id);
    const [act, meals] = await Promise.all([
      getFriendActivity(friendIds, 15),
      getFriendsPublicHomeMeals(friendIds),
    ]);
    setActivity(act);
    setHomeMeals(meals);

    // Collect all user IDs from both sources
    const allUserIds = new Set<string>();
    act.forEach((a) => allUserIds.add(a.user_id));
    meals.forEach((m) => allUserIds.add(m.userId));

    if (allUserIds.size > 0) {
      const ratingIds = act.map((a) => a.id).filter(Boolean);
      const [profs, likesData, ccounts] = await Promise.all([
        getProfilesByIds([...allUserIds]),
        ratingIds.length > 0 ? getLikesForRatings(userId, ratingIds) : Promise.resolve({ likes: {} as Record<string, number>, userLiked: new Set<string>() }),
        ratingIds.length > 0 ? getCommentCounts(ratingIds) : Promise.resolve({} as Record<string, number>),
      ]);
      setProfiles(profs);
      setLikes(likesData.likes);
      setUserLiked(likesData.userLiked);
      setCommentCounts(ccounts);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Merge and sort feed items by time
  const feedItems: FeedItem[] = [
    ...activity.map((r): FeedItem => ({
      type: 'rating', data: r,
      sortTime: r.created_at ? new Date(r.created_at).getTime() : 0,
    })),
    ...homeMeals.map((m): FeedItem => ({
      type: 'homeMeal', data: m,
      sortTime: m.createdAt,
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const handleLike = async (ratingId: string) => {
    if (!userId || !ratingId) return;
    const wasLiked = userLiked.has(ratingId);
    setUserLiked((prev) => { const next = new Set(prev); wasLiked ? next.delete(ratingId) : next.add(ratingId); return next; });
    setLikes((prev) => ({ ...prev, [ratingId]: Math.max(0, (prev[ratingId] || 0) + (wasLiked ? -1 : 1)) }));
    await toggleLike(userId, ratingId);
  };

  const handleOpenComments = async (ratingId: string) => {
    if (openComments === ratingId) { setOpenComments(null); return; }
    setOpenComments(ratingId);
    setCommentsLoading(true);
    setNewComment('');
    const cmts = await getComments(ratingId);
    setComments(cmts);
    if (cmts.length > 0) {
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      const profs = await getProfilesByIds(ids);
      setCommentProfiles(profs);
    }
    setCommentsLoading(false);
  };

  const handleAddComment = async (ratingId: string) => {
    if (!userId || !newComment.trim()) return;
    const ok = await addComment(userId, ratingId, newComment.trim());
    if (ok) {
      setNewComment('');
      setCommentCounts((prev) => ({ ...prev, [ratingId]: (prev[ratingId] || 0) + 1 }));
      const cmts = await getComments(ratingId);
      setComments(cmts);
      const ids = [...new Set(cmts.map((c) => c.user_id))];
      setCommentProfiles(await getProfilesByIds(ids));
    }
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  const getName = (uid: string) => profiles[uid]?.display_name || 'User';
  const getUsername = (uid: string) => profiles[uid]?.username || '';
  const timeAgo = (date: string) => {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (loading) return <div className="text-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  if (feedItems.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-serif font-bold mb-4">Friend Activity</h2>
      <div className="space-y-3">
        {feedItems.map((item) => {
          if (item.type === 'homeMeal') {
            const m = item.data;
            const mealTimeAgo = timeAgo(new Date(m.createdAt).toISOString());
            return (
              <div key={`meal-${m.id}`} className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
                {/* User header */}
                <div className="px-3.5 pt-3 pb-2 flex items-center gap-2.5">
                  <Link to={`/user/${getUsername(m.userId)}`}>
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <ChefHat size={16} className="text-emerald-600" />
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/user/${getUsername(m.userId)}`} className="text-sm font-semibold hover:text-primary">{getName(m.userId)}</Link>
                    <p className="text-[10px] text-emerald-600 font-medium">cooked at home</p>
                  </div>
                  <span className="text-[10px] text-on-surface/30">{mealTimeAgo}</span>
                </div>

                {/* Meal card */}
                <div className="px-3.5 pb-2">
                  <div className="bg-surface rounded-xl border border-on-surface/5 overflow-hidden">
                    {/* Photo */}
                    {m.photos.length > 0 && (
                      <img src={m.photos[0].url} alt={m.name} className="w-full aspect-[16/9] object-cover" />
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-serif font-bold text-sm truncate">{m.name}</h3>
                          <p className="text-[10px] text-on-surface/40">
                            {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {m.dishes.length > 0 && (
                              <> · <UtensilsCrossed size={9} className="inline -mt-0.5" /> {m.dishes.length} dish{m.dishes.length !== 1 ? 'es' : ''}</>
                            )}
                          </p>
                        </div>
                        <span className={cn("text-lg font-serif font-bold flex-shrink-0", scoreColor(m.score))}>{m.score.toFixed(1)}</span>
                      </div>
                      {m.description && <p className="text-[10px] text-on-surface/40 italic mt-1 line-clamp-2">&ldquo;{m.description}&rdquo;</p>}
                      {m.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">{m.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{t}</span>)}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // Restaurant rating card (existing)
          const r = item.data as CommunityRating;
          return (
          <div key={r.id} className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
            {/* User header */}
            <div className="px-3.5 pt-3 pb-2 flex items-center gap-2.5">
              <Link to={`/user/${getUsername(r.user_id)}`}>
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserCircle size={16} className="text-primary/50" />
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/user/${getUsername(r.user_id)}`} className="text-sm font-semibold hover:text-primary">{getName(r.user_id)}</Link>
                <p className="text-[10px] text-on-surface/35">rated a restaurant</p>
              </div>
              <span className="text-[10px] text-on-surface/30">{timeAgo(r.created_at)}</span>
            </div>

            {/* Restaurant card */}
            <Link to={`/restaurant/${r.restaurant_id}`} className="block px-3.5 pb-2">
              <div className="bg-surface rounded-xl p-3 border border-on-surface/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                    <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                  </div>
                  <span className={cn("text-lg font-serif font-bold flex-shrink-0", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                </div>
                {r.notes && <p className="text-[10px] text-on-surface/40 italic mt-1 line-clamp-2">&ldquo;{r.notes}&rdquo;</p>}
                {r.tags && r.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">{r.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}</div>
                )}
              </div>
            </Link>

            {/* Like & Comment */}
            <div className="px-3.5 pb-2 flex items-center gap-5">
              <button onClick={() => handleLike(r.id)} className={cn("flex items-center gap-1.5 transition-colors", userLiked.has(r.id) ? "text-red-500" : "text-on-surface/35 hover:text-red-500")}>
                <Heart size={16} className={userLiked.has(r.id) ? 'fill-red-500' : ''} />
                <span className="text-[11px] font-semibold">{likes[r.id] || 0}</span>
              </button>
              <button onClick={() => handleOpenComments(r.id)} className={cn("flex items-center gap-1.5 transition-colors", openComments === r.id ? "text-primary" : "text-on-surface/35 hover:text-primary")}>
                <MessageSquare size={16} />
                <span className="text-[11px] font-semibold">{commentCounts[r.id] || 0}</span>
              </button>
            </div>

            {/* Comments */}
            <AnimatePresence>
              {openComments === r.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="border-t border-on-surface/6 px-3.5 py-2.5 space-y-2">
                    {commentsLoading ? (
                      <div className="text-center py-2"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>
                    ) : comments.length === 0 ? (
                      <p className="text-[11px] text-on-surface/30 py-1">No comments yet — be the first!</p>
                    ) : (
                      <div className="space-y-2 max-h-44 overflow-y-auto">
                        {comments.map((c) => (
                          <div key={c.id} className="flex gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <UserCircle size={11} className="text-primary/40" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] leading-relaxed">
                                <Link to={`/user/${commentProfiles[c.user_id]?.username || ''}`} className="font-semibold text-on-surface/70 hover:text-primary">{commentProfiles[c.user_id]?.display_name || 'User'}</Link>{' '}
                                <span className="text-on-surface/50">{c.text}</span>
                              </p>
                              <p className="text-[9px] text-on-surface/25 mt-0.5">{timeAgo(c.created_at)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a comment..."
                        className="flex-1 bg-on-surface/5 rounded-xl py-2 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment(r.id)} />
                      <button onClick={() => handleAddComment(r.id)} disabled={!newComment.trim()}
                        className="p-2 text-primary disabled:text-on-surface/15 rounded-xl hover:bg-primary/5 transition-colors">
                        <Send size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          );
        })}
      </div>
    </section>
  );
};
