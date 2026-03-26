import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Search, X, Star, Trash2, Check, UserCircle, Crown } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getFriends, addFriend, removeFriend, getFriendActivity, searchUsersByUsername, getProfilesByIds, type FriendInfo, type CommunityRating, type UserProfile } from '../lib/supabase-community';
import { Link } from 'react-router-dom';

type Tab = 'friends' | 'experts';

const MOCK_EXPERTS = [
  { id: 'exp-1', name: 'Elena Vance', role: 'Senior Critic', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200', stats: '1.2k Reviews' },
  { id: 'exp-2', name: 'Marcus Thorne', role: 'Sommelier', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200', stats: '850 Reviews' },
  { id: 'exp-3', name: 'Sofia Rossi', role: 'Chef de Cuisine', image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200', stats: '2.1k Reviews' },
];

export const Circle: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [activeTab, setActiveTab] = useState<Tab>('friends');

  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  // Add friend sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const friendList = await getFriends(userId);
    setFriends(friendList);
    if (friendList.length > 0) {
      const ids = friendList.map((f) => f.friend_id);
      const [profiles, act] = await Promise.all([getProfilesByIds(ids), getFriendActivity(ids, 20)]);
      setFriendProfiles(profiles);
      setActivity(act);
      // Get profiles for activity feed
      const actIds = [...new Set(act.map((a) => a.user_id))];
      if (actIds.length > 0) {
        const actProf = await getProfilesByIds(actIds);
        setActivityProfiles(actProf);
      }
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim() || !userId) { setSearchResults([]); return; }
    setSearching(true);
    const results = await searchUsersByUsername(q, userId);
    // Filter out already-followed
    const friendIds = new Set(friends.map((f) => f.friend_id));
    setSearchResults(results.filter((r) => !friendIds.has(r.user_id)));
    setSearching(false);
  };

  const handleAddFriend = async (friendId: string, friendName: string) => {
    if (!userId) return;
    const ok = await addFriend(userId, friendId);
    if (ok) {
      setAddSuccess(friendName);
      setSearchResults((prev) => prev.filter((r) => r.user_id !== friendId));
      setTimeout(() => { setAddSuccess(null); }, 1500);
      loadData();
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!userId) return;
    await removeFriend(userId, friendId);
    setConfirmRemove(null);
    loadData();
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  const getFriendName = (uid: string, profiles: Record<string, UserProfile>) => {
    const p = profiles[uid];
    return p ? p.display_name || `@${p.username}` : uid.slice(0, 8) + '...';
  };

  return (
    <div className="pb-32">
      <TopBar title="Social" />

      <main className="px-3">
        {/* Tabs */}
        <div className="flex gap-1 bg-on-surface/5 rounded-2xl p-1 mb-5">
          {([{ key: 'friends' as Tab, label: 'Friends', icon: Users }, { key: 'experts' as Tab, label: 'Experts', icon: Crown }]).map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                activeTab === tab.key ? "bg-white text-on-surface shadow-sm" : "text-on-surface/40")}>
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Friends Tab ── */}
        {activeTab === 'friends' && (
          <>
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider">My Friends ({friends.length})</h2>
                <button onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); setAddSuccess(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-full">
                  <UserPlus size={12} /> Add
                </button>
              </div>

              {loading ? (
                <div className="text-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" /></div>
              ) : friends.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-2xl border border-on-surface/8">
                  <Users size={24} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm font-medium text-on-surface/40">No friends yet</p>
                  <p className="text-xs text-on-surface/30 mt-1">Search by username to add friends</p>
                  <button onClick={() => { setAddSheetOpen(true); setSearchQuery(''); setSearchResults([]); }}
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-full">
                    <UserPlus size={12} /> Find Friends
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {friends.map((f) => {
                    const profile = friendProfiles[f.friend_id];
                    return (
                      <div key={f.friend_id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <UserCircle size={18} className="text-primary/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{profile?.display_name || 'User'}</p>
                          <p className="text-[10px] text-on-surface/35">@{profile?.username || f.friend_id.slice(0, 8)}</p>
                        </div>
                        {confirmRemove === f.friend_id ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => setConfirmRemove(null)} className="px-2 py-1 text-[10px] font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg">Cancel</button>
                            <button onClick={() => handleRemoveFriend(f.friend_id)} className="px-2 py-1 text-[10px] font-semibold text-white bg-red-500 rounded-lg">Remove</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmRemove(f.friend_id)} className="p-1.5 text-on-surface/20 hover:text-red-500 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Activity Feed */}
            {activity.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-bold text-on-surface/60 uppercase tracking-wider mb-3">Activity</h2>
                <div className="space-y-2">
                  {activity.map((r) => (
                    <Link key={r.id} to={`/restaurant/${r.restaurant_id}`} className="block">
                      <div className="bg-white rounded-xl border border-on-surface/8 p-3 active:scale-[0.99] transition-transform">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCircle size={12} className="text-primary/50" />
                          </div>
                          <span className="text-[11px] font-semibold text-on-surface/60">{getFriendName(r.user_id, activityProfiles)}</span>
                          <span className="text-[10px] text-on-surface/30 ml-auto">rated</span>
                          <span className={cn("text-sm font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                        </div>
                        <h3 className="font-serif font-bold text-sm">{r.restaurant_name}</h3>
                        <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Experts Tab ── */}
        {activeTab === 'experts' && (
          <section>
            <p className="text-xs text-on-surface/40 mb-4">Follow expert reviewers for curated recommendations</p>
            <div className="space-y-3">
              {MOCK_EXPERTS.map((expert) => (
                <div key={expert.id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 p-3">
                  <img src={expert.image} alt={expert.name} className="w-11 h-11 rounded-full object-cover" referrerPolicy="no-referrer" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{expert.name}</p>
                    <p className="text-[10px] text-on-surface/40">{expert.role} · {expert.stats}</p>
                  </div>
                  <button className="px-3 py-1.5 border border-primary/30 text-primary text-[10px] font-semibold rounded-full hover:bg-primary/5 transition-colors">
                    Follow
                  </button>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-on-surface/30 mt-6">More experts coming soon</p>
          </section>
        )}
      </main>

      {/* Add Friend Sheet */}
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
                  <span className="text-xs font-semibold text-green-700">Added {addSuccess}!</span>
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
                      <button onClick={() => handleAddFriend(u.user_id, u.display_name)}
                        className="px-3 py-1.5 bg-primary text-white text-[10px] font-semibold rounded-lg">
                        Follow
                      </button>
                    </div>
                  ))
                ) : !searchQuery.trim() ? (
                  <div className="text-center py-8">
                    <Search size={24} className="mx-auto text-on-surface/15 mb-2" />
                    <p className="text-sm text-on-surface/40">Search for friends by username</p>
                    <p className="text-xs text-on-surface/30 mt-1">e.g. tyler_eats, foodie_anna</p>
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
