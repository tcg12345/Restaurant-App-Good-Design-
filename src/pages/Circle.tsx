import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Search, X, Star, Trash2, Check, UserCircle, Crown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getFriends, sendFriendRequest, followPublicAccount, removeFriend, getFriendActivity, searchUsersByUsername, getProfilesByIds, getPendingRequests, acceptFriendRequest, declineFriendRequest, getExpertProfiles, getUserRatings, getFollowCounts, type FriendInfo, type FriendRequest, type CommunityRating, type UserProfile } from '../lib/supabase-community';
import { Link } from 'react-router-dom';
import { CircleActivity } from '../components/CircleActivity';

export const Circle: React.FC = () => {
  const { user, refreshPendingRequests } = useAuth();
  const userId = user?.id ?? null;

  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<Record<string, UserProfile>>({});
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  // Add friend sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // Expert data
  const [expertProfiles, setExpertProfiles] = useState<UserProfile[]>([]);
  const [expertRatingCounts, setExpertRatingCounts] = useState<Record<string, number>>({});
  const [expertFollowerCounts, setExpertFollowerCounts] = useState<Record<string, number>>({});
  const [expertsLoading, setExpertsLoading] = useState(false);
  const [expertsLoaded, setExpertsLoaded] = useState(false);
  const [expertFollowedIds, setExpertFollowedIds] = useState<Set<string>>(new Set());

  const loadExperts = useCallback(async () => {
    setExpertsLoading(true);
    const profiles = await getExpertProfiles();
    setExpertProfiles(profiles);
    if (profiles.length > 0) {
      const results = await Promise.all(profiles.map(async (p) => {
        const [ratings, counts] = await Promise.all([getUserRatings(p.user_id), getFollowCounts(p.user_id)]);
        return { id: p.user_id, ratingCount: ratings.length, followers: counts.followers };
      }));
      const rc: Record<string, number> = {};
      const fc: Record<string, number> = {};
      results.forEach((r) => { rc[r.id] = r.ratingCount; fc[r.id] = r.followers; });
      setExpertRatingCounts(rc);
      setExpertFollowerCounts(fc);
    }
    if (userId) {
      const fl = await getFriends(userId);
      const ids = new Set(fl.map((f) => f.friend_id));
      setExpertFollowedIds(ids);
    }
    setExpertsLoading(false);
    setExpertsLoaded(true);
  }, [userId]);

  const handleFollowExpert = async (expertId: string) => {
    if (!userId) return;
    const ok = await followPublicAccount(userId, expertId);
    if (ok) {
      setExpertFollowedIds((prev) => new Set([...prev, expertId]));
      setExpertFollowerCounts((prev) => ({ ...prev, [expertId]: (prev[expertId] || 0) + 1 }));
    }
  };

  const loadData = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const [friendList, requests] = await Promise.all([getFriends(userId), getPendingRequests(userId)]);
    setFriends(friendList);
    setPendingRequests(requests);

    const reqIds = requests.map((r) => r.user_id);
    if (reqIds.length > 0) {
      const reqProf = await getProfilesByIds(reqIds);
      setRequestProfiles(reqProf);
    }

    if (friendList.length > 0) {
      const ids = friendList.map((f) => f.friend_id);
      const [profiles, act] = await Promise.all([getProfilesByIds(ids), getFriendActivity(ids, 20)]);
      setFriendProfiles(profiles);
      setActivity(act);
      const actIds = [...new Set(act.map((a) => a.user_id))];
      if (actIds.length > 0) {
        const actProf = await getProfilesByIds(actIds);
        setActivityProfiles(actProf);
      }
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load experts on mount
  useEffect(() => {
    if (!expertsLoaded && !expertsLoading) loadExperts();
  }, [expertsLoaded, expertsLoading, loadExperts]);

  const [suggestions, setSuggestions] = useState<UserProfile[]>([]);

  const loadSuggestions = async () => {
    if (!userId) return;
    const results = await searchUsersByUsername('', userId);
    const friendIds = new Set(friends.map((f) => f.friend_id));
    setSuggestions(results.filter((r) => !friendIds.has(r.user_id)));
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!userId) return;
    setSearching(true);
    const results = await searchUsersByUsername(q, userId);
    const friendIds = new Set(friends.map((f) => f.friend_id));
    setSearchResults(results.filter((r) => !friendIds.has(r.user_id)));
    setSearching(false);
  };

  const handleAddFriend = async (friendId: string, friendName: string, isPublic: boolean) => {
    if (!userId) return;
    const ok = isPublic
      ? await followPublicAccount(userId, friendId)
      : await sendFriendRequest(userId, friendId);
    if (ok) {
      setAddSuccess(friendName);
      setSearchResults((prev) => prev.filter((r) => r.user_id !== friendId));
      setSuggestions((prev) => prev.filter((r) => r.user_id !== friendId));
      setTimeout(() => { setAddSuccess(null); }, 1500);
      if (isPublic) loadData();
    } else {
      setAddSuccess(null);
      alert('Could not send request. Make sure the friend request migration SQL has been run.');
    }
  };

  const handleAcceptRequest = async (req: FriendRequest) => {
    if (!userId) return;
    await acceptFriendRequest(req.id, userId, req.user_id);
    await refreshPendingRequests();
    loadData();
  };

  const handleDeclineRequest = async (req: FriendRequest) => {
    await declineFriendRequest(req.id);
    await refreshPendingRequests();
    loadData();
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!userId) return;
    await removeFriend(userId, friendId);
    setConfirmRemove(null);
    loadData();
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  const scoreBg = (s: number) => s >= 8 ? 'bg-green-50 border-green-200' : s >= 5 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';
  const getFriendName = (uid: string, profiles: Record<string, UserProfile>) => {
    const p = profiles[uid];
    return p ? p.display_name || `@${p.username}` : uid.slice(0, 8) + '...';
  };
  const getFriendUsername = (uid: string, profiles: Record<string, UserProfile>) => {
    const p = profiles[uid];
    return p?.username || uid.slice(0, 8);
  };
  const formatCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const timeAgo = (date: string) => {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
  };

  if (loading) {
    return (
      <div className="pb-32">
        <TopBar title="Social" showBackButton />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <TopBar title="Social" showBackButton />

      <main className="px-4">
        {/* ── Pending Requests ── */}
        {pendingRequests.length > 0 && (
          <section className="mb-5">
            <div className="space-y-2">
              {pendingRequests.map((req) => {
                const p = requestProfiles[req.user_id];
                return (
                  <div key={req.id} className="flex items-center gap-3 bg-primary/5 rounded-2xl border border-primary/12 px-3.5 py-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-serif font-bold text-primary/60">{(p?.display_name || 'U').charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p?.display_name || 'User'}</p>
                      <p className="text-[10px] text-on-surface/35">@{p?.username || req.user_id.slice(0, 8)} wants to follow you</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => handleAcceptRequest(req)}
                        className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                        Accept
                      </button>
                      <button onClick={() => handleDeclineRequest(req)}
                        className="px-3 py-1.5 border border-on-surface/15 text-[10px] font-bold text-on-surface/40 rounded-full uppercase tracking-wider">
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Friends Section ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">My Friends</h2>
              <span className="text-[10px] font-bold text-on-surface/25">·</span>
              <span className="text-[10px] font-bold text-on-surface/25">{friends.length}</span>
            </div>
            <button onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); loadSuggestions(); setAddSuccess(null); }}
              className="text-[10px] font-bold text-primary uppercase tracking-wider">
              + Add
            </button>
          </div>
          <div className="h-px bg-on-surface/6 -mx-4 mb-4" />

          {friends.length === 0 ? (
            <div className="flex flex-col items-center py-6 bg-white/60 rounded-2xl border border-on-surface/6">
              <Users size={20} className="text-on-surface/15 mb-2" />
              <p className="text-xs font-medium text-on-surface/35">No friends yet</p>
              <button onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); loadSuggestions(); }}
                className="mt-2.5 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                <UserPlus size={11} /> Find Friends
              </button>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
              {/* Add button as first item */}
              <button
                onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); loadSuggestions(); setAddSuccess(null); }}
                className="flex flex-col items-center gap-1.5 flex-shrink-0"
              >
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-primary/30 flex items-center justify-center bg-primary/5">
                  <UserPlus size={18} className="text-primary/50" />
                </div>
                <span className="text-[9px] font-bold text-primary/60 uppercase tracking-wider">Add</span>
              </button>

              {friends.map((f) => {
                const profile = friendProfiles[f.friend_id];
                const initial = (profile?.display_name || 'U').charAt(0).toUpperCase();
                return (
                  <Link key={f.friend_id} to={`/user/${profile?.username || f.friend_id}`}
                    className="flex flex-col items-center gap-1.5 flex-shrink-0 group">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border-2 border-white shadow-sm group-hover:shadow-md transition-shadow">
                        <span className="text-lg font-serif font-bold text-primary/60">{initial}</span>
                      </div>
                      {confirmRemove === f.friend_id ? (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveFriend(f.friend_id); }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm"
                        >
                          <X size={10} />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmRemove(f.friend_id); }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-on-surface/10 text-on-surface/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={9} />
                        </button>
                      )}
                    </div>
                    <div className="text-center w-16">
                      <p className="text-[10px] font-semibold truncate leading-tight">{profile?.display_name || 'User'}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Experts Section ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">Experts</h2>
              <span className="text-[10px] font-bold text-on-surface/25">·</span>
              <span className="text-[10px] font-bold text-on-surface/25">{expertProfiles.length}</span>
            </div>
          </div>
          <div className="h-px bg-on-surface/6 -mx-4 mb-4" />

          {expertsLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : expertProfiles.length === 0 ? (
            <div className="flex items-center gap-3 py-4 px-4 bg-amber-50/50 rounded-2xl border border-amber-200/30">
              <Crown size={18} className="text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-on-surface/50">No experts yet</p>
                <p className="text-[10px] text-on-surface/30 mt-0.5">Expert reviewers will appear here once they join</p>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
              {expertProfiles.map((expert) => {
                const isFollowed = expertFollowedIds.has(expert.user_id);
                const rCount = expertRatingCounts[expert.user_id] || 0;
                const fCount = expertFollowerCounts[expert.user_id] || 0;
                return (
                  <div key={expert.user_id} className="flex-shrink-0 w-44">
                    <div className="bg-white rounded-2xl border border-on-surface/8 p-3 h-full">
                      <Link to={`/user/${expert.username}`} className="block mb-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-base font-serif font-bold text-amber-700">{expert.display_name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <p className="text-xs font-bold truncate">{expert.display_name}</p>
                              <Crown size={10} className="text-amber-500 flex-shrink-0" />
                            </div>
                            <p className="text-[9px] text-on-surface/35 mt-0.5">
                              {formatCount(rCount)} reviews · {formatCount(fCount)} followers
                            </p>
                          </div>
                        </div>
                      </Link>
                      {isFollowed ? (
                        <div className="flex items-center justify-center gap-1 w-full py-1.5 bg-on-surface/4 rounded-full">
                          <Check size={10} className="text-on-surface/35" />
                          <span className="text-[9px] font-bold text-on-surface/35 uppercase tracking-wider">Following</span>
                        </div>
                      ) : (
                        <button onClick={() => handleFollowExpert(expert.user_id)}
                          className="w-full py-1.5 border border-primary/25 text-primary text-[9px] font-bold rounded-full uppercase tracking-wider hover:bg-primary/5 transition-colors">
                          Follow
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Activity Feed ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">Activity</h2>
              {activity.length > 0 && (
                <>
                  <span className="text-[10px] font-bold text-on-surface/25">·</span>
                  <span className="text-[10px] font-bold text-on-surface/25">{activity.length}</span>
                </>
              )}
            </div>
          </div>
          <div className="h-px bg-on-surface/6 -mx-4 mb-4" />

          {activity.length === 0 ? (
            <div className="flex flex-col items-center py-8 bg-white/60 rounded-2xl border border-on-surface/6">
              <Star size={20} className="text-on-surface/15 mb-2" />
              <p className="text-xs font-medium text-on-surface/35">No activity yet</p>
              <p className="text-[10px] text-on-surface/25 mt-1">Ratings from your friends will show up here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activity.map((r) => {
                const profile = activityProfiles[r.user_id];
                const initial = (profile?.display_name || 'U').charAt(0).toUpperCase();
                return (
                  <Link key={r.id} to={`/restaurant/${r.restaurant_id}`} className="block">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden flex active:scale-[0.99] transition-transform"
                    >
                      {/* Restaurant thumbnail */}
                      <div className="w-24 flex-shrink-0 bg-on-surface/5 flex items-center justify-center">
                        {r.image ? (
                          <img src={r.image} alt={r.restaurant_name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-2xl font-serif font-bold text-on-surface/10">{r.restaurant_name.charAt(0)}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 p-3 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-serif font-bold text-sm leading-tight truncate">{r.restaurant_name}</h3>
                            <p className="text-[10px] text-on-surface/40 uppercase tracking-wider mt-0.5">
                              {r.cuisine}{r.price ? ` · ${r.price}` : ''}
                            </p>
                          </div>
                          {/* Rating badge */}
                          <div className={cn("flex-shrink-0 px-2.5 py-1 rounded-lg border", scoreBg(Number(r.score)))}>
                            <span className={cn("text-sm font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                          </div>
                        </div>

                        {/* Notes preview */}
                        {r.notes && (
                          <p className="text-[11px] text-on-surface/40 italic mt-1.5 line-clamp-1">"{r.notes}"</p>
                        )}

                        {/* Who rated + time */}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-on-surface/5">
                          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[8px] font-serif font-bold text-primary/50">{initial}</span>
                          </div>
                          <span className="text-[10px] text-on-surface/40 truncate">
                            <span className="font-semibold text-on-surface/55">{getFriendName(r.user_id, activityProfiles)}</span>
                          </span>
                          <span className="text-[10px] text-on-surface/25 ml-auto flex-shrink-0">{timeAgo(r.created_at)}</span>
                        </div>
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Circle Activity (mock data feed) ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">From Your Circle</h2>
            </div>
          </div>
          <div className="h-px bg-on-surface/6 -mx-4 mb-4" />
          <CircleActivity />
        </section>
      </main>

      {/* ── Add Friend Sheet ── */}
      <AnimatePresence>
        {addSheetOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setAddSheetOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl h-[85vh] flex flex-col overflow-hidden">
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Find Friends</h3>
                <button onClick={() => setAddSheetOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pt-3 pb-2 flex-shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search by username..."
                    autoFocus className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    autoCapitalize="off" autoCorrect="off" />
                </div>
              </div>

              {addSuccess && (
                <div className="mx-5 mt-2 flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                  <Check size={14} className="text-green-600" />
                  <span className="text-xs font-semibold text-green-700">Request sent to {addSuccess}!</span>
                </div>
              )}

              {/* Results */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
                {searching ? (
                  <div className="text-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>
                ) : searchQuery.trim() && searchResults.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-on-surface/40">No users found for "@{searchQuery}"</p>
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((u) => (
                    <div key={u.user_id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <UserCircle size={18} className="text-primary/50" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{u.display_name}</p>
                        <p className="text-[10px] text-on-surface/35">@{u.username}</p>
                      </div>
                      <button onClick={() => handleAddFriend(u.user_id, u.display_name, u.is_public)}
                        className="px-3 py-1.5 bg-primary text-white text-[10px] font-semibold rounded-lg">
                        {u.is_public ? "Follow" : "Send Request"}
                      </button>
                    </div>
                  ))
                ) : !searchQuery.trim() && suggestions.length > 0 ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2 px-1">Suggested</p>
                    {suggestions.map((u) => (
                      <div key={u.user_id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <UserCircle size={18} className="text-primary/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{u.display_name}</p>
                          <p className="text-[10px] text-on-surface/35">@{u.username}</p>
                        </div>
                        <button onClick={() => handleAddFriend(u.user_id, u.display_name, u.is_public)}
                          className="px-3 py-1.5 bg-primary text-white text-[10px] font-semibold rounded-lg">
                          {u.is_public ? "Follow" : "Send Request"}
                        </button>
                      </div>
                    ))}
                  </>
                ) : !searchQuery.trim() ? (
                  <div className="text-center py-8">
                    <Search size={24} className="mx-auto text-on-surface/15 mb-2" />
                    <p className="text-sm text-on-surface/40">No users found yet</p>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
