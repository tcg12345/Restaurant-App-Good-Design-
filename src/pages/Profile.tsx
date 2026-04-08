import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Smartphone, Lock, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Heart, List as ListIcon, ChefHat, ExternalLink, Users, Crown, Sparkles, TrendingUp, Search, Globe, EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { saveProfile, getFollowCounts, getExpertRecommendationCount } from '../lib/supabase-community';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

type SettingsPage = 'main' | 'account';
type ProfileTab = 'overview' | 'ratings' | 'lists' | 'wishlist' | 'cooking';

const scoreColor = (s: number) => (s >= 8 ? 'text-emerald-600' : s >= 5 ? 'text-amber-600' : 'text-rose-500');

function formatScore(s: unknown): string {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

function numericScore(s: unknown): number {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 2) return parts[parts.length - 1];
  return parts[0] || null;
}

/** ISO string for sorting by recency; never throws (missing/invalid → empty). */
function ratingRecencyIso(r: { visitDate?: string; createdAt?: number }): string {
  if (r.visitDate) {
    const d = new Date(r.visitDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)) {
    const d = new Date(r.createdAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

function listRestaurantIds(list: { restaurantIds?: string[] }): string[] {
  return Array.isArray(list.restaurantIds) ? list.restaurantIds : [];
}

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { profile, user, signOut, refreshProfile, pendingRequestCount } = useAuth();
  const listsCtx = useLists();
  const ratings = Array.isArray(listsCtx.ratings) ? listsCtx.ratings : [];
  const lists = Array.isArray(listsCtx.lists) ? listsCtx.lists : [];
  const wishlist = Array.isArray(listsCtx.wishlist) ? listsCtx.wishlist : [];
  const trips = Array.isArray(listsCtx.trips) ? listsCtx.trips : [];
  const homeMeals = Array.isArray(listsCtx.homeMeals) ? listsCtx.homeMeals : [];
  const { myRecipes: rawMyRecipes } = useRecipes();
  const myRecipes = Array.isArray(rawMyRecipes) ? rawMyRecipes : [];
  const { phoneMode, togglePhoneMode } = useSettings();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('main');
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [expertPickCount, setExpertPickCount] = useState(0);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleteStep, setDeleteStep] = useState(0);

  const [ratingSort, setRatingSort] = useState<'recent' | 'high' | 'low'>('recent');
  const [ratingSearch, setRatingSearch] = useState('');

  useEffect(() => {
    if (user?.id) {
      getFollowCounts(user.id).then(({ followers: f, following: fg }) => {
        setFollowers(f);
        setFollowing(fg);
      });
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !profile?.is_expert) {
      setExpertPickCount(0);
      return;
    }
    let cancelled = false;
    getExpertRecommendationCount(user.id).then((c) => {
      if (!cancelled) setExpertPickCount(c);
    });
    return () => { cancelled = true; };
  }, [user?.id, profile?.is_expert]);

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
    setAccountMsg('');
    setAccountError('');
    setNewEmail('');
    setNewPassword('');
    setDeleteStep(0);
    setSettingsOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!editName.trim() || !editUsername.trim()) {
      setEditError('Name and username are required');
      return;
    }
    if (editUsername.length < 3) {
      setEditError('Username must be at least 3 characters');
      return;
    }
    setEditSaving(true);
    setEditError('');
    const result = await saveProfile(user.id, editName.trim(), editUsername.trim(), editBio.trim());
    if (result.success) {
      setEditSuccess(true);
      await refreshProfile();
      setTimeout(() => setEditProfileOpen(false), 800);
    } else {
      setEditError(result.error || 'Failed to save');
    }
    setEditSaving(false);
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) return;
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setAccountError(error.message);
    else setAccountMsg('Check your new email for a confirmation link');
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      setAccountError('Password must be at least 6 characters');
      return;
    }
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setAccountError(error.message);
    else {
      setAccountMsg('Password updated successfully');
      setNewPassword('');
    }
  };

  const displayName = profile?.display_name || 'Your Name';
  const username = profile?.username || 'username';
  const bio = profile?.bio || '';
  const publicProfilePath = `/user/${encodeURIComponent(username)}`;

  const avgScore = useMemo(() => {
    if (!ratings.length) return null;
    const nums = ratings.map((r) => r.score).filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
    if (!nums.length) return null;
    return nums.reduce((a, s) => a + s, 0) / nums.length;
  }, [ratings]);

  const wouldReturnPct = useMemo(() => {
    if (!ratings.length) return null;
    const n = ratings.filter((r) => r.wouldReturn).length;
    return Math.round((n / ratings.length) * 100);
  }, [ratings]);

  const cuisineStats = useMemo(() => {
    const map = new Map<string, number>();
    ratings.forEach((r) => {
      if (!r.cuisine) return;
      map.set(r.cuisine, (map.get(r.cuisine) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [ratings]);

  const uniqueCities = useMemo(() => {
    const s = new Set<string>();
    ratings.forEach((r) => {
      const c = cityFromAddress(r.address || '');
      if (c) s.add(c);
    });
    return s.size;
  }, [ratings]);

  const topRated = useMemo(() => {
    return [...ratings].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 8);
  }, [ratings]);

  const recentRatings = useMemo(() => {
    return [...ratings].sort((a, b) => ratingRecencyIso(b).localeCompare(ratingRecencyIso(a))).slice(0, 10);
  }, [ratings]);

  const filteredSortedRatings = useMemo(() => {
    let r = [...ratings];
    const q = ratingSearch.trim().toLowerCase();
    if (q) {
      r = r.filter(
        (x) =>
          (x.name || '').toLowerCase().includes(q) ||
          (x.cuisine || '').toLowerCase().includes(q) ||
          (x.address || '').toLowerCase().includes(q),
      );
    }
    if (ratingSort === 'high') r.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    else if (ratingSort === 'low') r.sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0));
    else {
      r.sort((a, b) => ratingRecencyIso(b).localeCompare(ratingRecencyIso(a)));
    }
    return r;
  }, [ratings, ratingSearch, ratingSort]);

  const publicHomeMeals = useMemo(() => (Array.isArray(homeMeals) ? homeMeals : []).filter((m) => m.isPublic), [homeMeals]);
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const tabs: { id: ProfileTab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'ratings', label: 'Ratings', count: ratings.length },
    { id: 'lists', label: 'Lists', count: lists.length },
    { id: 'wishlist', label: 'Wishlist', count: wishlist.length },
    { id: 'cooking', label: 'Home', count: homeMeals.length },
  ];

  const maxCuisine = cuisineStats[0]?.[1] || 1;

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <TopBar title="Profile" />

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.08] to-surface" />
        <div className="relative px-5 pt-2 pb-6">
          {pendingRequestCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/circle')}
              className="w-full mb-4 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200/60 text-left"
            >
              <span className="text-xs font-semibold text-amber-900">
                {pendingRequestCount} friend request{pendingRequestCount !== 1 ? 's' : ''} waiting
              </span>
              <ChevronRight size={16} className="text-amber-700 flex-shrink-0" />
            </button>
          )}

          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-full ring-[3px] ring-white shadow-lg bg-gradient-to-br from-primary/25 to-primary/10 flex items-center justify-center">
                <span className="text-3xl font-serif font-bold text-primary">{displayName.charAt(0).toUpperCase()}</span>
              </div>
              {profile?.is_expert && (
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center">
                  <Crown size={12} className="text-white" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 pt-1">
              <h2 className="text-xl font-serif font-bold text-on-surface tracking-tight truncate">{displayName}</h2>
              <p className="text-sm text-on-surface/40">@{username}</p>

              <div className="flex items-center gap-4 mt-2.5">
                <button type="button" onClick={() => navigate('/circle')} className="text-center group">
                  <span className="text-base font-bold text-on-surface group-hover:text-primary transition-colors">{followers}</span>
                  <span className="text-[10px] text-on-surface/40 ml-1">followers</span>
                </button>
                <button type="button" onClick={() => navigate('/circle')} className="text-center group">
                  <span className="text-base font-bold text-on-surface group-hover:text-primary transition-colors">{following}</span>
                  <span className="text-[10px] text-on-surface/40 ml-1">following</span>
                </button>
              </div>
            </div>
          </div>

          {bio && <p className="text-sm text-on-surface/55 mt-3 leading-relaxed">{bio}</p>}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={openEditProfile}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-on-surface/[0.06] text-on-surface/70 text-xs font-semibold border border-on-surface/8 hover:bg-on-surface/10 transition-colors"
            >
              <Edit3 size={13} />
              Edit profile
            </button>
            <Link
              to={publicProfilePath}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-on-surface/[0.06] text-on-surface/70 text-xs font-semibold border border-on-surface/8 hover:bg-on-surface/10 transition-colors"
            >
              <ExternalLink size={13} />
              View public
            </Link>
            <button
              type="button"
              onClick={openSettings}
              className="p-2.5 rounded-xl bg-on-surface/[0.06] border border-on-surface/8 text-on-surface/45 hover:bg-on-surface/10 transition-colors"
              aria-label="Settings"
            >
              <Settings size={16} />
            </button>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {profile?.is_expert && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/70 text-[10px] font-bold text-amber-800">
                <Star size={9} className="fill-amber-500 text-amber-500" />
                Expert{expertPickCount > 0 && ` · ${expertPickCount} picks`}
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                profile?.is_public
                  ? 'bg-emerald-50/60 border-emerald-200/50 text-emerald-700'
                  : 'bg-on-surface/[0.03] border-on-surface/8 text-on-surface/40',
              )}
            >
              {profile?.is_public ? <Globe size={9} /> : <EyeOff size={9} />}
              {profile?.is_public ? 'Public' : 'Private'}
            </span>
            {memberSince && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-on-surface/[0.03] border border-on-surface/8 text-[10px] text-on-surface/40">
                Since {memberSince}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-5 pb-5">
        <div className="grid grid-cols-4 gap-px rounded-2xl bg-on-surface/8 overflow-hidden border border-on-surface/8">
          <div className="bg-white text-center py-3.5">
            <p className="text-lg font-serif font-bold text-on-surface">{ratings.length}</p>
            <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Rated</p>
          </div>
          <div className="bg-white text-center py-3.5">
            <p className="text-lg font-serif font-bold text-on-surface">{avgScore != null ? avgScore.toFixed(1) : '—'}</p>
            <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Avg</p>
          </div>
          <div className="bg-white text-center py-3.5">
            <p className="text-lg font-serif font-bold text-on-surface">{wishlist.length}</p>
            <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Wishlist</p>
          </div>
          <div className="bg-white text-center py-3.5">
            <p className="text-lg font-serif font-bold text-on-surface">{uniqueCities || '—'}</p>
            <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Cities</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-on-surface/8 mb-1">
        <div className="flex overflow-x-auto scrollbar-hide px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'relative flex-shrink-0 px-4 pb-2.5 pt-1 text-xs font-semibold transition-colors',
                activeTab === t.id
                  ? 'text-on-surface'
                  : 'text-on-surface/40 hover:text-on-surface/60',
              )}
            >
              {t.label}
              {t.count != null && t.id !== 'overview' && (
                <span className={cn('ml-1 tabular-nums', activeTab === t.id ? 'text-on-surface/60' : 'text-on-surface/30')}>
                  {t.count}
                </span>
              )}
              {activeTab === t.id && (
                <motion.div layoutId="profileTab" className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="px-5 space-y-5 pt-4">
        {activeTab === 'overview' && (
          <>
            {/* Highlights row */}
            {(wouldReturnPct != null || uniqueCities > 0 || homeMeals.length > 0) && (
              <div className="flex gap-2">
                {wouldReturnPct != null && (
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100/80">
                    <TrendingUp size={15} className="text-emerald-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-900">{wouldReturnPct}%</p>
                      <p className="text-[10px] text-emerald-700/70 leading-tight">would return</p>
                    </div>
                  </div>
                )}
                {homeMeals.length > 0 && (
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-orange-50/70 border border-orange-100/80">
                    <ChefHat size={15} className="text-orange-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-orange-900">{homeMeals.length}</p>
                      <p className="text-[10px] text-orange-700/70 leading-tight">home meals</p>
                    </div>
                  </div>
                )}
                {lists.length > 0 && (
                  <div className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-sky-50/70 border border-sky-100/80">
                    <ListIcon size={15} className="text-sky-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-sky-900">{lists.length}</p>
                      <p className="text-[10px] text-sky-700/70 leading-tight">lists</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Top cuisines */}
            {cuisineStats.length > 0 && (
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Top cuisines</h3>
                <div className="rounded-2xl bg-white border border-on-surface/8 p-4 space-y-2.5">
                  {cuisineStats.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-on-surface/70 w-20 truncate">{name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-on-surface/6 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(8, (count / maxCuisine) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-on-surface/35 tabular-nums w-6 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Standouts */}
            {topRated.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">Standouts</h3>
                  <button type="button" onClick={() => setActiveTab('ratings')} className="text-[11px] font-semibold text-primary">
                    See all
                  </button>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                  {topRated.slice(0, 6).map((r) => (
                    <Link
                      key={r.restaurantId}
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex-shrink-0 w-[130px] rounded-2xl border border-on-surface/8 bg-white overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="aspect-[4/3] bg-on-surface/[0.04] relative">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface/15">
                            <MapPin size={22} />
                          </div>
                        )}
                        <span
                          className={cn(
                            'absolute top-1.5 right-1.5 text-[11px] font-serif font-bold px-1.5 py-0.5 rounded-lg bg-white/90 shadow-sm backdrop-blur-sm',
                            scoreColor(numericScore(r.score)),
                          )}
                        >
                          {formatScore(r.score)}
                        </span>
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[11px] font-bold truncate leading-tight">{r.name}</p>
                        <p className="text-[10px] text-on-surface/40 truncate mt-0.5">{r.cuisine}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Recent visits */}
            {recentRatings.length > 0 && (
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Recent</h3>
                <div className="space-y-1.5">
                  {recentRatings.slice(0, 5).map((r) => (
                    <Link
                      key={r.restaurantId}
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-on-surface/8 hover:border-primary/15 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-on-surface/[0.04] overflow-hidden flex-shrink-0">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface/20">
                            <MapPin size={16} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{r.name}</p>
                        <p className="text-[10px] text-on-surface/35">
                          {r.visitDate
                            ? new Date(r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : ''}
                          {r.cuisine && `${r.visitDate ? ' · ' : ''}${r.cuisine}`}
                        </p>
                      </div>
                      <span className={cn('text-base font-serif font-bold flex-shrink-0', scoreColor(numericScore(r.score)))}>{formatScore(r.score)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {ratings.length === 0 && wishlist.length === 0 && (
              <div className="text-center py-14 rounded-2xl border border-dashed border-on-surface/10">
                <MapPin size={32} className="mx-auto text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/50">Start exploring</p>
                <p className="text-xs text-on-surface/30 mt-1 max-w-xs mx-auto">Rate restaurants and build lists to see your stats here.</p>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="mt-4 px-5 py-2.5 rounded-full bg-primary text-white text-xs font-semibold"
                >
                  Open map
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'ratings' && (
          <section className="space-y-3 pb-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/25" />
                <input
                  type="search"
                  value={ratingSearch}
                  onChange={(e) => setRatingSearch(e.target.value)}
                  placeholder="Search ratings..."
                  className="w-full bg-white rounded-xl py-2 pl-9 pr-3 text-sm border border-on-surface/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex bg-on-surface/[0.04] rounded-xl border border-on-surface/8 overflow-hidden">
                {(['recent', 'high', 'low'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRatingSort(k)}
                    className={cn(
                      'px-3 py-2 text-[11px] font-semibold transition-colors',
                      ratingSort === k ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface/40',
                    )}
                  >
                    {k === 'recent' ? 'New' : k === 'high' ? 'Top' : 'Low'}
                  </button>
                ))}
              </div>
            </div>
            {filteredSortedRatings.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10">No ratings match your search.</p>
            ) : (
              <div className="space-y-1.5">
                {filteredSortedRatings.map((r) => (
                  <Link
                    key={r.restaurantId}
                    to={`/restaurant/${r.restaurantId}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-on-surface/8 hover:border-primary/15 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-on-surface/[0.04] flex-shrink-0">
                      {r.image ? (
                        <img src={r.image} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-on-surface/20">
                          <MapPin size={18} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-[10px] text-on-surface/35 truncate">
                        {r.cuisine}
                        {r.price && ` · ${r.price}`}
                        {r.address && ` · ${cityFromAddress(r.address) || r.address.split(',').pop()?.trim()}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                      {r.wouldReturn && <TrendingUp size={12} className="text-emerald-500" />}
                      <span className={cn('text-lg font-serif font-bold', scoreColor(numericScore(r.score)))}>{formatScore(r.score)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'lists' && (
          <section className="space-y-3 pb-4">
            {lists.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10">No lists yet.</p>
            ) : (
              lists.map((list) => {
                const rids = listRestaurantIds(list);
                return (
                <div key={list.id} className="rounded-2xl border border-on-surface/8 bg-white overflow-hidden">
                  <div className="px-3.5 py-3 flex items-center gap-2.5">
                    <span className="text-lg">{list.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{list.name}</p>
                      <p className="text-[10px] text-on-surface/40">
                        {rids.length} rated
                        {list.wishlistIds?.length ? ` · ${list.wishlistIds.length} saved` : ''}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-on-surface/20 flex-shrink-0" />
                  </div>
                  {rids.length > 0 && (
                    <div className="flex gap-1 px-3.5 pb-3 overflow-x-auto scrollbar-hide">
                      {rids.slice(0, 5).map((id) => {
                        const r = ratings.find((x) => x.restaurantId === id);
                        return (
                          <Link
                            key={id}
                            to={`/restaurant/${id}`}
                            className="flex-shrink-0 w-12 h-12 rounded-lg bg-on-surface/[0.04] overflow-hidden border border-on-surface/6"
                          >
                            {r?.image ? (
                              <img src={r.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-on-surface/20 text-[10px] font-bold">
                                {r?.name?.charAt(0) || '?'}
                              </div>
                            )}
                          </Link>
                        );
                      })}
                      {rids.length > 5 && (
                        <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-on-surface/[0.04] flex items-center justify-center border border-on-surface/6">
                          <span className="text-[10px] font-semibold text-on-surface/35">+{rids.length - 5}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
              })
            )}
          </section>
        )}

        {activeTab === 'wishlist' && (
          <section className="space-y-1.5 pb-4">
            {wishlist.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10">Your wishlist is empty.</p>
            ) : (
              wishlist.map((w) => (
                <Link
                  key={w.restaurantId}
                  to={`/restaurant/${w.restaurantId}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-on-surface/8 hover:border-rose-200/60 transition-colors"
                >
                  <div className="w-12 h-12 rounded-lg bg-on-surface/[0.04] overflow-hidden flex-shrink-0">
                    {w.image ? <img src={w.image} alt="" className="w-full h-full object-cover" /> : (
                      <div className="w-full h-full flex items-center justify-center text-rose-200">
                        <Heart size={18} className="fill-current" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{w.name}</p>
                    <p className="text-[10px] text-on-surface/35 truncate">
                      {w.cuisine}
                      {w.price && ` · ${w.price}`}
                      {w.address && ` · ${cityFromAddress(w.address) || ''}`}
                    </p>
                  </div>
                  <Heart size={14} className="text-rose-300 fill-rose-300 flex-shrink-0" />
                </Link>
              ))
            )}
          </section>
        )}

        {activeTab === 'cooking' && (
          <section className="space-y-2.5 pb-4">
            {homeMeals.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-on-surface/10">
                <ChefHat size={28} className="mx-auto text-on-surface/15 mb-2" />
                <p className="text-sm text-on-surface/40">No home meals logged yet.</p>
              </div>
            ) : (
              homeMeals.map((meal) => {
                const mealPhotos = Array.isArray(meal.photos) ? meal.photos : [];
                const mealDishes = Array.isArray(meal.dishes) ? meal.dishes : [];
                const mealDate = meal.date ? new Date(meal.date) : null;
                const dateLabel = mealDate && !Number.isNaN(mealDate.getTime())
                  ? mealDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '';
                return (
                <div key={meal.id} className="rounded-2xl border border-on-surface/8 bg-white overflow-hidden">
                  {mealPhotos[0]?.url && (
                    <div className="aspect-[2/1] bg-on-surface/[0.04]">
                      <img src={mealPhotos[0].url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{meal.name}</p>
                        <p className="text-[10px] text-on-surface/35 mt-0.5">
                          {dateLabel}
                          {mealDishes.length > 0 && `${dateLabel ? ' · ' : ''}${mealDishes.length} dish${mealDishes.length !== 1 ? 'es' : ''}`}
                        </p>
                      </div>
                      <span className={cn('text-lg font-serif font-bold flex-shrink-0', scoreColor(numericScore(meal.score)))}>{formatScore(meal.score)}</span>
                    </div>
                    {meal.description && (
                      <p className="text-[11px] text-on-surface/45 mt-1.5 leading-relaxed line-clamp-2">{meal.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {meal.wouldMakeAgain && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">Would make again</span>
                      )}
                      {!meal.isPublic && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-on-surface/[0.04] text-on-surface/35 border border-on-surface/8">Private</span>
                      )}
                    </div>
                  </div>
                </div>
              );
              })
            )}
          </section>
        )}
      </main>

      {/* Edit Profile Sheet */}
      <AnimatePresence>
        {editProfileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
              onClick={() => setEditProfileOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-[60] bg-surface rounded-t-3xl max-h-[80vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Edit Profile</h3>
                <button
                  type="button"
                  onClick={() => setEditProfileOpen(false)}
                  className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"
                >
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Display Name</p>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Username</p>
                  <div className="relative">
                    <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input
                      type="text"
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      autoCapitalize="off"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Bio</p>
                  <div className="relative">
                    <FileText size={16} className="absolute left-3 top-3 text-on-surface/30" />
                    <textarea
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      rows={3}
                      maxLength={150}
                      placeholder="Tell people about yourself..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                    />
                  </div>
                  <p className="text-[10px] text-on-surface/30 text-right mt-0.5">{editBio.length}/150</p>
                </div>
                {editError && <p className="text-xs text-red-500">{editError}</p>}
                {editSuccess && (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <Check size={14} />
                    <span className="text-xs font-semibold">Saved!</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={editSaving}
                  className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-semibold disabled:opacity-60"
                >
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn(
                'fixed inset-x-0 bottom-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden',
                phoneMode ? 'h-[92vh]' : 'max-h-[80vh]',
              )}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <AnimatePresence mode="wait">
                {settingsPage === 'main' && (
                  <motion.div
                    key="main"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                      <h3 className="font-serif font-bold text-lg">Settings</h3>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                        className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"
                      >
                        <X size={16} className="text-on-surface/60" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsPage('account');
                          setAccountMsg('');
                          setAccountError('');
                          setDeleteStep(0);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Lock size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Account</p>
                          <p className="text-[11px] text-on-surface/35">Email, password, delete account</p>
                        </div>
                        <ChevronRight size={16} className="text-on-surface/20" />
                      </button>
                      <div className="border-t border-on-surface/6 my-2" />
                      <button
                        type="button"
                        onClick={togglePhoneMode}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Smartphone size={18} className="text-on-surface/40" />
                        <span className="flex-1 text-sm font-medium">Phone View</span>
                        <div
                          className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${phoneMode ? 'bg-primary' : 'bg-on-surface/15'}`}
                        >
                          <motion.div
                            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                            animate={{ left: phoneMode ? '1.125rem' : '0.125rem' }}
                            transition={{ type: 'spring', damping: 20, stiffness: 350 }}
                          />
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!user?.id || !profile) return;
                          const newVal = !profile.is_public;
                          await saveProfile(user.id, profile.display_name, profile.username, profile.bio, newVal);
                          await refreshProfile();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Lock size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Private Account</p>
                          <p className="text-[11px] text-on-surface/35">
                            {profile?.is_public ? 'Anyone can see your profile' : 'Only approved followers'}
                          </p>
                        </div>
                        <div
                          className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${!profile?.is_public ? 'bg-primary' : 'bg-on-surface/15'}`}
                        >
                          <motion.div
                            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                            animate={{ left: !profile?.is_public ? '1.125rem' : '0.125rem' }}
                            transition={{ type: 'spring', damping: 20, stiffness: 350 }}
                          />
                        </div>
                      </button>
                      <div className="border-t border-on-surface/6 my-2" />
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsOpen(false);
                          signOut();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-red-50 transition-colors text-left"
                      >
                        <LogOut size={18} className="text-red-400" />
                        <span className="text-sm font-medium text-red-500">Sign Out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
                {settingsPage === 'account' && (
                  <motion.div
                    key="account"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                      <button type="button" onClick={() => setSettingsPage('main')} className="p-1 text-on-surface/40">
                        <ArrowLeft size={20} />
                      </button>
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
                          <input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="New email"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleUpdateEmail}
                          disabled={!newEmail.trim()}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        >
                          Update Email
                        </button>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Change Password</p>
                        <div className="relative mb-2">
                          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New password (min 6)"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleUpdatePassword}
                          disabled={newPassword.length < 6}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        >
                          Update Password
                        </button>
                      </div>
                      {accountMsg && (
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                          <Check size={14} className="text-green-600" />
                          <span className="text-xs text-green-700">{accountMsg}</span>
                        </div>
                      )}
                      {accountError && (
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                          <AlertTriangle size={14} className="text-red-500" />
                          <span className="text-xs text-red-600">{accountError}</span>
                        </div>
                      )}
                      <div className="border-t border-on-surface/6 pt-4">
                        {deleteStep === 0 && (
                          <button
                            type="button"
                            onClick={() => setDeleteStep(1)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 transition-colors text-left"
                          >
                            <Trash2 size={16} className="text-red-400" />
                            <span className="text-sm font-medium text-red-500">Delete Account</span>
                          </button>
                        )}
                        {deleteStep === 1 && (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-600 font-medium">Are you sure? This will permanently delete all your data.</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDeleteStep(0)}
                                className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteStep(2)}
                                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-semibold"
                              >
                                Yes, Continue
                              </button>
                            </div>
                          </div>
                        )}
                        {deleteStep === 2 && (
                          <div className="bg-red-100 border border-red-300 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-700 font-bold">FINAL WARNING: This cannot be undone!</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDeleteStep(0)}
                                className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAccountMsg('Please contact support to delete your account.');
                                  setDeleteStep(0);
                                }}
                                className="flex-1 py-2 bg-red-700 text-white rounded-lg text-xs font-semibold"
                              >
                                Delete Forever
                              </button>
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
