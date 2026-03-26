import React, { useState } from 'react';
import { TopBar } from '../components/TopBar';
import { RadarChart } from '../components/RadarChart';
import { Edit2, Share2, Heart, Star, Bookmark, ChevronRight, Settings, LogOut, X, User, AtSign, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { saveProfile } from '../lib/supabase-community';
import { cn } from '../lib/utils';

const TASTE_DATA = [
  { subject: 'Umami', value: 120, fullMark: 150 },
  { subject: 'Sweet', value: 98, fullMark: 150 },
  { subject: 'Sour', value: 86, fullMark: 150 },
  { subject: 'Bitter', value: 99, fullMark: 150 },
  { subject: 'Salty', value: 85, fullMark: 150 },
  { subject: 'Spicy', value: 65, fullMark: 150 },
];

const WISHLIST = [
  { id: '1', name: 'Lumière', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400' },
  { id: '2', name: 'Alchemist', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=400' },
  { id: '3', name: 'Sakura Zen', image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=400' },
  { id: '4', name: 'Terra & Mare', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=400' },
];

export const Profile: React.FC = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { ratings, lists, wishlist } = useLists();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  const openSettings = () => {
    setEditName(profile?.display_name || '');
    setEditUsername(profile?.username || '');
    setEditError('');
    setEditSuccess(false);
    setSettingsOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!editName.trim() || !editUsername.trim()) { setEditError('Name and username are required'); return; }
    if (editUsername.length < 3) { setEditError('Username must be at least 3 characters'); return; }
    setEditSaving(true);
    const result = await saveProfile(user.id, editName.trim(), editUsername.trim());
    if (result.success) {
      setEditSuccess(true);
      await refreshProfile();
      setTimeout(() => setSettingsOpen(false), 800);
    } else {
      setEditError(result.error || 'Failed to save');
    }
    setEditSaving(false);
  };

  const displayName = profile?.display_name || 'Your Name';
  const username = profile?.username || 'username';

  return (
    <div className="pb-32">
      <TopBar title="My Profile" />

      <main className="px-3">
        <section className="flex flex-col items-center mb-12">
          <div className="relative mb-4">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-4xl font-serif font-bold text-primary">{displayName.charAt(0).toUpperCase()}</span>
            </div>
          </div>

          <h2 className="text-2xl font-serif font-bold mb-0.5">{displayName}</h2>
          <p className="text-sm text-on-surface/40 mb-4">@{username}</p>

          <div className="flex gap-3">
            <button onClick={openSettings}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-on-surface/15 text-xs font-semibold text-on-surface/60 hover:bg-on-surface/5 transition-colors">
              <Settings size={13} /> Settings
            </button>
            <button onClick={signOut}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-200 text-xs font-semibold text-red-400 hover:bg-red-50 transition-colors">
              <LogOut size={13} /> Sign Out
            </button>
          </div>
        </section>

        {/* Stats */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-on-surface/8 mb-8">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-serif font-bold text-primary">{ratings.length}</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Ratings</p>
            </div>
            <div className="border-x border-on-surface/8">
              <p className="text-2xl font-serif font-bold text-primary">{lists.length}</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Lists</p>
            </div>
            <div>
              <p className="text-2xl font-serif font-bold text-primary">{wishlist.length}</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Wishlist</p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-muted mb-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Taste Identity</p>
              <h3 className="text-2xl font-serif font-bold">Your Palate</h3>
            </div>
            <button className="p-3 rounded-full bg-muted text-on-surface/40">
              <Share2 size={18} />
            </button>
          </div>
          
          <RadarChart data={TASTE_DATA} />
          
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-serif font-bold text-primary">84</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Ratings</p>
            </div>
            <div className="text-center border-x border-muted">
              <p className="text-2xl font-serif font-bold text-primary">12</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Lists</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-serif font-bold text-primary">45</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Badges</p>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold">The Wishlist</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              View All <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {WISHLIST.map((item) => (
              <motion.div
                key={item.id}
                whileHover={{ scale: 1.02 }}
                className="relative aspect-square rounded-3xl overflow-hidden group cursor-pointer"
              >
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <h4 className="font-serif font-bold text-lg">{item.name}</h4>
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                    <Bookmark size={10} />
                    <span>Saved</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-serif font-bold mb-6">The Vault</h2>
          <div className="space-y-4">
            {['Date Nights', 'Hidden Gems', 'Best Cocktails'].map((list) => (
              <button
                key={list}
                className="w-full flex items-center justify-between p-6 rounded-3xl bg-muted/50 hover:bg-muted transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-primary shadow-sm">
                    <Star size={20} />
                  </div>
                  <div className="text-left">
                    <h4 className="font-bold text-sm">{list}</h4>
                    <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">12 items • Curated by you</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-on-surface/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Settings Sheet */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setSettingsOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl max-h-[70vh] flex flex-col overflow-hidden">
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Edit Profile</h3>
                <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Display Name</p>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Username</p>
                  <div className="relative">
                    <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      autoCapitalize="off" />
                  </div>
                </div>
                {editError && <p className="text-xs text-red-500">{editError}</p>}
                {editSuccess && (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <Check size={14} /><span className="text-xs font-semibold">Profile updated!</span>
                  </div>
                )}
                <button onClick={handleSaveProfile} disabled={editSaving}
                  className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
