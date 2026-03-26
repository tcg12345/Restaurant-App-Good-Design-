import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Users, UserPlus, Search, X, Star, Trash2, Check, UserCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getFriends, addFriend, removeFriend, getFriendActivity, searchUsers, type FriendInfo, type CommunityRating } from '../lib/supabase-community';
import { Link } from 'react-router-dom';

export const Circle: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [loading, setLoading] = useState(true);

  // Add friend sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [friendIdInput, setFriendIdInput] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<{ id: string; email: string }[]>([]);

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const [friendList] = await Promise.all([getFriends(userId)]);
    setFriends(friendList);
    if (friendList.length > 0) {
      const act = await getFriendActivity(friendList.map((f) => f.friend_id), 20);
      setActivity(act);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddFriend = async () => {
    if (!userId || !friendIdInput.trim()) return;
    setAddError('');
    const success = await addFriend(userId, friendIdInput.trim());
    if (success) {
      setAddSuccess(true);
      setFriendIdInput('');
      setTimeout(() => { setAddSuccess(false); setAddSheetOpen(false); loadData(); }, 1000);
    } else {
      setAddError('Could not add friend. Check the ID and try again.');
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!userId) return;
    await removeFriend(userId, friendId);
    setConfirmRemove(null);
    loadData();
  };

  const openAddSheet = async () => {
    setAddSheetOpen(true);
    setAddError('');
    setAddSuccess(false);
    setFriendIdInput('');
    const users = await searchUsers('');
    // Filter out self and already-friends
    const friendIds = new Set(friends.map((f) => f.friend_id));
    setAvailableUsers(users.filter((u) => u.id !== userId && !friendIds.has(u.id)));
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

  return (
    <div className="pb-32">
      <TopBar title="The Social Circle" />

      <main className="px-3">
        {/* My Friends */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-serif font-bold">My Friends</h2>
            <button onClick={openAddSheet}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-full">
              <UserPlus size={13} /> Add
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : friends.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-on-surface/8">
              <Users size={28} className="mx-auto text-on-surface/15 mb-2" />
              <p className="text-sm font-medium text-on-surface/40">No friends yet</p>
              <p className="text-xs text-on-surface/30 mt-1">Add friends to see their ratings</p>
              <button onClick={openAddSheet}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-full">
                <UserPlus size={13} /> Add Friend
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {friends.map((f) => (
                <div key={f.friend_id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <UserCircle size={18} className="text-primary/50" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{f.friend_id.slice(0, 8)}...</p>
                    <p className="text-[10px] text-on-surface/35">Friend</p>
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
              ))}
            </div>
          )}
        </section>

        {/* Friends Activity Feed */}
        {activity.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-serif font-bold mb-4">Friends Activity</h2>
            <div className="space-y-3">
              {activity.map((r) => (
                <Link key={r.id} to={`/restaurant/${r.restaurant_id}`} className="block">
                  <div className="bg-white rounded-xl border border-on-surface/8 p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                          <UserCircle size={14} className="text-primary/50" />
                        </div>
                        <span className="text-[10px] text-on-surface/40">{r.user_id.slice(0, 8)}...</span>
                      </div>
                      <span className={cn("text-lg font-serif font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                    </div>
                    <h3 className="font-serif font-bold text-sm">{r.restaurant_name}</h3>
                    <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                    {r.notes && <p className="text-xs text-on-surface/50 italic mt-1 line-clamp-2">"{r.notes}"</p>}
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {r.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Add Friend Sheet */}
      <AnimatePresence>
        {addSheetOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setAddSheetOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Add Friend</h3>
                <button onClick={() => setAddSheetOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
                {/* Manual ID input */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Add by User ID</p>
                  <p className="text-[11px] text-on-surface/30 mb-2">Paste a friend's user ID to follow them</p>
                  <div className="flex gap-2">
                    <input type="text" value={friendIdInput} onChange={(e) => setFriendIdInput(e.target.value)}
                      placeholder="Paste user ID..."
                      className="flex-1 bg-on-surface/5 rounded-xl py-2.5 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <button onClick={handleAddFriend} disabled={!friendIdInput.trim()}
                      className="px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl disabled:opacity-40">
                      Add
                    </button>
                  </div>
                  {addError && <p className="text-xs text-red-500 mt-1.5">{addError}</p>}
                  {addSuccess && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-green-600">
                      <Check size={14} />
                      <span className="text-xs font-semibold">Friend added!</span>
                    </div>
                  )}
                </div>

                {/* Discover users */}
                {availableUsers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Other Users</p>
                    <p className="text-[11px] text-on-surface/30 mb-2">People who have rated restaurants</p>
                    <div className="space-y-1.5">
                      {availableUsers.map((u) => (
                        <div key={u.id} className="flex items-center gap-3 bg-white rounded-xl border border-on-surface/8 px-3 py-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <UserCircle size={16} className="text-primary/50" />
                          </div>
                          <span className="flex-1 text-xs font-medium text-on-surface/60 truncate">{u.id.slice(0, 12)}...</span>
                          <button onClick={async () => {
                            if (!userId) return;
                            const ok = await addFriend(userId, u.id);
                            if (ok) {
                              setAvailableUsers((prev) => prev.filter((p) => p.id !== u.id));
                              loadData();
                            }
                          }} className="px-3 py-1.5 bg-primary text-white text-[10px] font-semibold rounded-lg">
                            Follow
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
