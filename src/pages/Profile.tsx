import React, { useState, useEffect } from 'react';
import { TopBar } from '../components/TopBar';
import { Settings, LogOut, X, User, AtSign, Check, ChevronRight, Smartphone, Lock, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { saveProfile, getFollowCounts } from '../lib/supabase-community';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

type SettingsPage = 'main' | 'account';

export const Profile: React.FC = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { ratings, lists, wishlist } = useLists();
  const { phoneMode, togglePhoneMode } = useSettings();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('main');
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  // Edit profile
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  // Follow counts
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);

  // Account management
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleteStep, setDeleteStep] = useState(0);

  useEffect(() => {
    if (user?.id) {
      getFollowCounts(user.id).then(({ followers: f, following: fg }) => { setFollowers(f); setFollowing(fg); });
    }
  }, [user?.id]);

  const openEditProfile = () => {
    setEditName(profile?.display_name || '');
    setEditUsername(profile?.username || '');
    setEditBio(profile?.bio || '');
    setEditError('');
    setEditSuccess(false);
    setEditProfileOpen(true);
  };

  const openSettings = () => {
    setSettingsPage('main');
    setAccountMsg(''); setAccountError('');
    setNewEmail(''); setNewPassword('');
    setDeleteStep(0);
    setSettingsOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!editName.trim() || !editUsername.trim()) { setEditError('Name and username are required'); return; }
    if (editUsername.length < 3) { setEditError('Username must be at least 3 characters'); return; }
    setEditSaving(true); setEditError('');
    const result = await saveProfile(user.id, editName.trim(), editUsername.trim(), editBio.trim());
    if (result.success) { setEditSuccess(true); await refreshProfile(); setTimeout(() => setEditProfileOpen(false), 800); }
    else { setEditError(result.error || 'Failed to save'); }
    setEditSaving(false);
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) return;
    setAccountMsg(''); setAccountError('');
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setAccountError(error.message);
    else setAccountMsg('Check your new email for a confirmation link');
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) { setAccountError('Password must be at least 6 characters'); return; }
    setAccountMsg(''); setAccountError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setAccountError(error.message);
    else { setAccountMsg('Password updated successfully'); setNewPassword(''); }
  };

  const displayName = profile?.display_name || 'Your Name';
  const username = profile?.username || 'username';
  const bio = profile?.bio || '';

  return (
    <div className="pb-32">
      <TopBar title="My Profile" />

      <main className="px-3">
        <section className="flex flex-col items-center mb-6">
          <div className="relative mb-3">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-3xl font-serif font-bold text-primary">{displayName.charAt(0).toUpperCase()}</span>
            </div>
          </div>
          <h2 className="text-xl font-serif font-bold mb-0.5">{displayName}</h2>
          <p className="text-sm text-on-surface/40">@{username}</p>

          {bio && <p className="text-xs text-on-surface/50 text-center mt-1.5 max-w-[250px] leading-relaxed">{bio}</p>}

          {/* Followers / Following */}
          <div className="flex gap-5 mt-3 mb-3">
            <div className="text-center">
              <p className="text-sm font-bold text-on-surface">{followers}</p>
              <p className="text-[10px] text-on-surface/40">Followers</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-on-surface">{following}</p>
              <p className="text-[10px] text-on-surface/40">Following</p>
            </div>
          </div>

          {/* Edit Profile + Settings buttons */}
          <div className="flex gap-2">
            <button onClick={openEditProfile}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-white text-xs font-semibold">
              <Edit3 size={12} /> Edit Profile
            </button>
            <button onClick={openSettings}
              className="p-2 rounded-full bg-on-surface/5 border border-on-surface/10 text-on-surface/50 hover:bg-on-surface/8 transition-colors">
              <Settings size={16} />
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
      </main>

      {/* Edit Profile Sheet */}
      <AnimatePresence>
        {editProfileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setEditProfileOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-[60] bg-surface rounded-t-3xl max-h-[80vh] flex flex-col overflow-hidden">
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Edit Profile</h3>
                <button onClick={() => setEditProfileOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"><X size={16} className="text-on-surface/60" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" autoCapitalize="off" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Bio</p>
                  <div className="relative">
                    <FileText size={16} className="absolute left-3 top-3 text-on-surface/30" />
                    <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={3} maxLength={150}
                      placeholder="Tell people about yourself..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
                  </div>
                  <p className="text-[10px] text-on-surface/30 text-right mt-0.5">{editBio.length}/150</p>
                </div>
                {editError && <p className="text-xs text-red-500">{editError}</p>}
                {editSuccess && <div className="flex items-center gap-1.5 text-green-600"><Check size={14} /><span className="text-xs font-semibold">Saved!</span></div>}
                <button onClick={handleSaveProfile} disabled={editSaving}
                  className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Sheet */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setSettingsOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed inset-x-0 bottom-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "h-[92vh]" : "max-h-[80vh]")}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <AnimatePresence mode="wait">
                {settingsPage === 'main' && (
                  <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                      <h3 className="font-serif font-bold text-lg">Settings</h3>
                      <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"><X size={16} className="text-on-surface/60" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
                      <button onClick={() => { setSettingsPage('account'); setAccountMsg(''); setAccountError(''); setDeleteStep(0); }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                        <Lock size={18} className="text-on-surface/40" />
                        <div className="flex-1"><p className="text-sm font-medium">Account</p><p className="text-[11px] text-on-surface/35">Email, password, delete account</p></div>
                        <ChevronRight size={16} className="text-on-surface/20" />
                      </button>
                      <div className="border-t border-on-surface/6 my-2" />
                      <button onClick={togglePhoneMode}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                        <Smartphone size={18} className="text-on-surface/40" />
                        <span className="flex-1 text-sm font-medium">Phone View</span>
                        <div className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${phoneMode ? 'bg-primary' : 'bg-on-surface/15'}`}>
                          <motion.div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                            animate={{ left: phoneMode ? '1.125rem' : '0.125rem' }} transition={{ type: 'spring', damping: 20, stiffness: 350 }} />
                        </div>
                      </button>
                      <button onClick={async () => {
                          if (!user?.id || !profile) return;
                          const newVal = !profile.is_public;
                          await saveProfile(user.id, profile.display_name, profile.username, profile.bio, newVal);
                          await refreshProfile();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                        <Lock size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Private Account</p>
                          <p className="text-[11px] text-on-surface/35">{profile?.is_public ? 'Anyone can see your profile' : 'Only approved followers'}</p>
                        </div>
                        <div className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${!profile?.is_public ? 'bg-primary' : 'bg-on-surface/15'}`}>
                          <motion.div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                            animate={{ left: !profile?.is_public ? '1.125rem' : '0.125rem' }} transition={{ type: 'spring', damping: 20, stiffness: 350 }} />
                        </div>
                      </button>
                      <div className="border-t border-on-surface/6 my-2" />
                      <button onClick={() => { setSettingsOpen(false); signOut(); }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-red-50 transition-colors text-left">
                        <LogOut size={18} className="text-red-400" />
                        <span className="text-sm font-medium text-red-500">Sign Out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
                {settingsPage === 'account' && (
                  <motion.div key="account" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                      <button onClick={() => setSettingsPage('main')} className="p-1 text-on-surface/40"><ArrowLeft size={20} /></button>
                      <h3 className="font-serif font-bold text-lg">Account</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                      <div className="bg-on-surface/3 rounded-xl px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-0.5">Current Email</p>
                        <p className="text-sm font-medium text-on-surface/70">{user?.email}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Change Email</p>
                        <div className="relative mb-2">
                          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                        <button onClick={handleUpdateEmail} disabled={!newEmail.trim()}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40">Update Email</button>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Change Password</p>
                        <div className="relative mb-2">
                          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 6)"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                        <button onClick={handleUpdatePassword} disabled={newPassword.length < 6}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40">Update Password</button>
                      </div>
                      {accountMsg && <div className="flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-xl"><Check size={14} className="text-green-600" /><span className="text-xs text-green-700">{accountMsg}</span></div>}
                      {accountError && <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl"><AlertTriangle size={14} className="text-red-500" /><span className="text-xs text-red-600">{accountError}</span></div>}
                      <div className="border-t border-on-surface/6 pt-4">
                        {deleteStep === 0 && (
                          <button onClick={() => setDeleteStep(1)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 transition-colors text-left">
                            <Trash2 size={16} className="text-red-400" /><span className="text-sm font-medium text-red-500">Delete Account</span>
                          </button>
                        )}
                        {deleteStep === 1 && (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-600 font-medium">Are you sure? This will permanently delete all your data.</p>
                            <div className="flex gap-2">
                              <button onClick={() => setDeleteStep(0)} className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50">Cancel</button>
                              <button onClick={() => setDeleteStep(2)} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-semibold">Yes, Continue</button>
                            </div>
                          </div>
                        )}
                        {deleteStep === 2 && (
                          <div className="bg-red-100 border border-red-300 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-700 font-bold">FINAL WARNING: This cannot be undone!</p>
                            <div className="flex gap-2">
                              <button onClick={() => setDeleteStep(0)} className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50">Cancel</button>
                              <button onClick={() => { setAccountMsg('Please contact support to delete your account.'); setDeleteStep(0); }}
                                className="flex-1 py-2 bg-red-700 text-white rounded-lg text-xs font-semibold">Delete Forever</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
