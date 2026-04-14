import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Search, X, Star, Trash2, Check, UserCircle, Crown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getFriends, sendFriendRequest, followPublicAccount, removeFriend, getFriendActivity, searchUsersByUsername, getProfilesByIds, getPendingRequests, acceptFriendRequest, declineFriendRequest, getExpertProfiles, getUserRatings, getFollowCounts, type FriendInfo, type FriendRequest, type CommunityRating, type UserProfile } from '../lib/supabase-community';
import { Link } from 'react-router-dom';
import { CircleActivity } from '../components/CircleActivity';
import { LoadingSkeleton, LoadingSkeletonList } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';

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
        <main className="px-4 pt-4">
          <LoadingSkeletonList count={4} variant="list-item" />
        </main>
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
                  <div key={req.id} className="flex items-center gap-3 bg-primary/5 rounded-2xl px-4 py-3">
                    <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-base font-serif font-bold text-primary/60">{(p?.display_name || 'U').charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p?.display_name || 'User'}</p>
                      <p className="text-xs text-on-surface/50 mt-0.5 truncate">
                        @{p?.username || req.user_id.slice(0, 8)} wants to follow you
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleAcceptRequest(req)}
                        className="px-3.5 h-9 bg-primary text-white text-xs font-bold rounded-full hover:bg-primary/90 active:scale-[0.97] transition-all"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineRequest(req)}
                        className="px-3.5 h-9 text-xs font-bold text-on-surface/50 rounded-full hover:bg-on-surface/[0.06] active:scale-[0.97] transition-all"
                      >
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
              <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">My Friends</h2>
              <span className="text-xs font-bold text-on-surface/25">·</span>
              <span className="text-xs font-bold text-on-surface/25">{friends.length}</span>
            </div>
            <button onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); loadSuggestions(); setAddSuccess(null); }}
              className="text-xs font-bold text-primary uppercase tracking-wider">
              + Add
            </button>
          </div>
          <div className="h-px bg-on-surface/[0.06] -mx-4 mb-4" />

          {friends.length === 0 ? (
            <EmptyState
              icon={<Users size={48} />}
              heading="No friends yet"
              description="Follow friends to see their ratings and favorite spots."
              action={{
                label: 'Find Friends',
                onClick: () => {
                  setAddSheetOpen(true);
                  setSearchQuery('');
                  setSearchResults([]);
                  loadSuggestions();
                },
              }}
            />
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1 snap-x snap-mandatory">
              {/* Add button as first item */}
              <button
                onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); loadSuggestions(); setAddSuccess(null); }}
                className="flex flex-col items-center gap-1.5 flex-shrink-0 snap-start"
              >
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-primary/30 flex items-center justify-center bg-primary/5">
                  <UserPlus size={18} className="text-primary/50" />
                </div>
                <span className="text-[11px] font-bold text-primary/60 uppercase tracking-wider">Add</span>
              </button>

              {friends.map((f) => {
                const profile = friendProfiles[f.friend_id];
                const initial = (profile?.display_name || 'U').charAt(0).toUpperCase();
                return (
                  <Link key={f.friend_id} to={`/user/${profile?.username || f.friend_id}`}
                    className="flex flex-col items-center gap-1.5 flex-shrink-0 group snap-start">
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
                      <p className="text-[11px] font-semibold truncate leading-tight">{profile?.display_name || 'User'}</p>
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
              <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">Experts</h2>
              <span className="text-xs font-bold text-on-surface/25">·</span>
              <span className="text-xs font-bold text-on-surface/25">{expertProfiles.length}</span>
            </div>
          </div>
          <div className="h-px bg-on-surface/[0.06] -mx-4 mb-4" />

          {expertsLoading ? (
            <div className="flex gap-3 overflow-x-hidden pb-2">
              <LoadingSkeleton variant="card" className="w-44 flex-shrink-0" />
              <LoadingSkeleton variant="card" className="w-44 flex-shrink-0" />
            </div>
          ) : expertProfiles.length === 0 ? (
            <EmptyState
              icon={<Crown size={48} />}
              heading="No experts yet"
              description="Expert reviewers will appear here once they join."
            />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4 snap-x snap-mandatory">
              {expertProfiles.map((expert) => {
                const isFollowed = expertFollowedIds.has(expert.user_id);
                const rCount = expertRatingCounts[expert.user_id] || 0;
                const fCount = expertFollowerCounts[expert.user_id] || 0;
                return (
                  <div key={expert.user_id} className="flex-shrink-0 w-44 snap-start">
                    {/* Square image card with gradient overlay — no border */}
                    <Link
                      to={`/user/${expert.username}`}
                      className="relative block aspect-square rounded-2xl overflow-hidden group"
                    >
                      <div className="h-full w-full bg-gradient-to-br from-amber-100 to-primary/10 flex items-center justify-center">
                        <span className="text-6xl font-serif font-bold text-primary/25">
                          {expert.display_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 text-white">
                        <div className="flex items-center gap-1 mb-1">
                          <Crown size={11} className="text-amber-400" />
                          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/70">Expert</p>
                        </div>
                        <h3 className="font-serif text-lg font-bold leading-tight truncate">{expert.display_name}</h3>
                        <p className="text-[11px] font-medium text-white/75 mt-0.5">
                          {formatCount(rCount)} reviews · {formatCount(fCount)} followers
                        </p>
                      </div>
                    </Link>
                    {/* Follow button — 44px tap target, 12px+ font */}
                    {isFollowed ? (
                      <div className="mt-2 h-11 flex items-center justify-center gap-1.5 bg-on-surface/[0.06] rounded-full">
                        <Check size={14} className="text-on-surface/45" />
                        <span className="text-xs font-bold text-on-surface/55">Following</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleFollowExpert(expert.user_id)}
                        className="mt-2 w-full h-11 bg-primary/10 text-primary text-xs font-bold rounded-full hover:bg-primary/15 active:bg-primary/20 transition-colors"
                      >
                        Follow
                      </button>
                    )}
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
              <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">Activity</h2>
              {activity.length > 0 && (
                <>
                  <span className="text-xs font-bold text-on-surface/25">·</span>
                  <span className="text-xs font-bold text-on-surface/25">{activity.length}</span>
                </>
              )}
            </div>
          </div>
          <div className="h-px bg-on-surface/[0.06] -mx-4 mb-4" />

          {activity.length === 0 ? (
            <EmptyState
              icon={<Star size={48} />}
              heading="No activity yet"
              description="Ratings from your friends will show up here."
            />
          ) : (
            <ul className="divide-y divide-on-surface/[0.06]">
              {activity.map((r) => {
                const profile = activityProfiles[r.user_id];
                const initial = (profile?.display_name || 'U').charAt(0).toUpperCase();
                return (
                  <li key={r.id}>
                    <Link to={`/restaurant/${r.restaurant_id}`} className="block group">
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="py-5"
                      >
                        {/* Full-width restaurant photo */}
                        <div className="w-full aspect-[5/3] rounded-xl overflow-hidden bg-on-surface/[0.05] flex items-center justify-center mb-3">
                          {r.image ? (
                            <img
                              src={r.image}
                              alt={r.restaurant_name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-5xl font-serif font-bold text-on-surface/15">{r.restaurant_name.charAt(0)}</span>
                          )}
                        </div>

                        {/* Byline row: avatar + friend name + score */}
                        <div className="flex items-center gap-2.5 mb-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-serif font-bold text-primary/60">{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-on-surface truncate leading-tight">
                              {getFriendName(r.user_id, activityProfiles)}
                            </p>
                            <p className="text-[11px] text-on-surface/40 leading-tight mt-0.5">
                              @{getFriendUsername(r.user_id, activityProfiles)} · {timeAgo(r.created_at)}
                            </p>
                          </div>
                          <span className={cn("flex-shrink-0 text-xl font-serif font-bold leading-none", scoreColor(Number(r.score)))}>
                            {Number(r.score).toFixed(1)}
                          </span>
                        </div>

                        {/* Restaurant name + cuisine */}
                        <h3 className="font-serif font-bold text-[17px] leading-snug line-clamp-1">{r.restaurant_name}</h3>
                        <p className="text-[11px] text-on-surface/45 uppercase tracking-wider mt-0.5 font-semibold">
                          {r.cuisine}{r.price ? ` · ${r.price}` : ''}
                        </p>

                        {/* Review text */}
                        {r.notes && (
                          <p className="text-[13px] text-on-surface/65 leading-relaxed mt-2 line-clamp-3">
                            "{r.notes}"
                          </p>
                        )}
                      </motion.div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Circle Activity (mock data feed) ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">From Your Circle</h2>
            </div>
          </div>
          <div className="h-px bg-on-surface/[0.06] -mx-4 mb-4" />
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
                        <p className="text-xs text-on-surface/40">@{u.username}</p>
                      </div>
                      <button onClick={() => handleAddFriend(u.user_id, u.display_name, u.is_public)}
                        className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg">
                        {u.is_public ? "Follow" : "Send Request"}
                      </button>
                    </div>
                  ))
                ) : !searchQuery.trim() && suggestions.length > 0 ? (
                  <>
                    <p className="text-xs font-bold uppercase tracking-widest text-on-surface/40 mb-2 px-1">Suggested</p>
                    {suggestions.map((u) => (
                      <div key={u.user_id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <UserCircle size={18} className="text-primary/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{u.display_name}</p>
                          <p className="text-xs text-on-surface/40">@{u.username}</p>
                        </div>
                        <button onClick={() => handleAddFriend(u.user_id, u.display_name, u.is_public)}
                          className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg">
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
