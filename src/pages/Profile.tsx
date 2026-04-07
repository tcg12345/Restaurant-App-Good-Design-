import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Smartphone, Lock, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Heart, List as ListIcon, ChefHat, ExternalLink, Users, Map, Crown, Sparkles, TrendingUp, Search, LayoutGrid, Globe, EyeOff,
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
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.14] via-primary/[0.04] to-surface" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/30 to-surface pointer-events-none" />
        <div className="relative px-4 pt-2 pb-10">
          {pendingRequestCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/circle')}
              className="w-full mb-4 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200/60 text-left"
            >
              <span className="text-xs font-semibold text-amber-900">
                {pendingRequestCount} friend request{pendingRequestCount !== 1 ? 's' : ''} waiting
              </span>
              <ChevronRight size={16} className="text-amber-700 flex-shrink-0" />
            </button>
          )}

          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-110" />
              <div className="relative w-24 h-24 rounded-full ring-4 ring-white/80 shadow-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <span className="text-4xl font-serif font-bold text-primary">{displayName.charAt(0).toUpperCase()}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center">
              <h2 className="text-2xl font-serif font-bold text-on-surface tracking-tight">{displayName}</h2>
              {profile?.is_expert && <Crown size={20} className="text-amber-500" aria-hidden />}
            </div>
            <p className="text-sm text-on-surface/45 mt-0.5">@{username}</p>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              {profile?.is_expert && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200/70 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  <Star size={10} className="fill-amber-500 text-amber-500" />
                  Expert
                  {expertPickCount > 0 && <span className="text-amber-600/80 font-semibold normal-case"> · {expertPickCount} picks</span>}
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                  profile?.is_public
                    ? 'bg-emerald-50 border-emerald-200/70 text-emerald-800'
                    : 'bg-on-surface/5 border-on-surface/10 text-on-surface/50',
                )}
              >
                {profile?.is_public ? <Globe size={10} /> : <EyeOff size={10} />}
                {profile?.is_public ? 'Public' : 'Private'}
              </span>
              {memberSince && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/60 border border-on-surface/8 text-[10px] font-semibold text-on-surface/45">
                  <Sparkles size={10} />
                  Since {memberSince}
                </span>
              )}
            </div>

            {bio ? (
              <p className="text-sm text-on-surface/55 mt-3 max-w-sm leading-relaxed">{bio}</p>
            ) : (
              <p className="text-xs text-on-surface/30 mt-3 italic">Add a short bio so friends know your taste.</p>
            )}

            <div className="flex gap-8 mt-5">
              <div className="text-center min-w-[56px]">
                <p className="text-lg font-serif font-bold text-on-surface">{followers}</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface/35">Followers</p>
              </div>
              <div className="text-center min-w-[56px]">
                <p className="text-lg font-serif font-bold text-on-surface">{following}</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface/35">Following</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-5 w-full max-w-md">
              <button
                type="button"
                onClick={openEditProfile}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-primary text-white text-xs font-semibold shadow-md shadow-primary/20"
              >
                <Edit3 size={14} />
                Edit profile
              </button>
              <button
                type="button"
                onClick={openSettings}
                className="p-2.5 rounded-full bg-white/80 border border-on-surface/10 text-on-surface/50 hover:bg-white transition-colors shadow-sm"
                aria-label="Settings"
              >
                <Settings size={18} />
              </button>
              <Link
                to={publicProfilePath}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/80 border border-on-surface/10 text-on-surface/70 text-xs font-semibold hover:bg-white transition-colors"
              >
                <ExternalLink size={14} />
                View as others
              </Link>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-6 w-full max-w-md">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/70 border border-on-surface/8 hover:bg-white transition-colors"
              >
                <Map size={18} className="text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wide text-on-surface/45">Map</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/circle')}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/70 border border-on-surface/8 hover:bg-white transition-colors"
              >
                <Users size={18} className="text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wide text-on-surface/45">Circle</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/pantry')}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/70 border border-on-surface/8 hover:bg-white transition-colors"
              >
                <LayoutGrid size={18} className="text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wide text-on-surface/45">Pantry</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/experts')}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-white/70 border border-on-surface/8 hover:bg-white transition-colors"
              >
                <Star size={18} className="text-primary" />
                <span className="text-[9px] font-bold uppercase tracking-wide text-on-surface/45">Experts</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats card */}
      <div className="px-4 -mt-4 relative z-10 mb-6">
        <div className="rounded-2xl bg-white border border-on-surface/8 shadow-sm p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-3">Your food footprint</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{ratings.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Ratings</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{avgScore != null ? avgScore.toFixed(1) : '—'}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Avg score</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{lists.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Lists</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{wishlist.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Wishlist</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{trips.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Trips</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{myRecipes.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Recipes</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{homeMeals.length}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Home meals</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-on-surface/[0.03]">
              <p className="text-xl font-serif font-bold text-primary">{cuisineStats.length ? cuisineStats.length : '—'}</p>
              <p className="text-[9px] font-semibold text-on-surface/40 mt-0.5">Cuisines</p>
            </div>
          </div>
          {(wouldReturnPct != null || uniqueCities > 0) && (
            <div className="mt-4 pt-4 border-t border-on-surface/6 flex flex-wrap gap-3">
              {wouldReturnPct != null && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50/80 border border-emerald-100 flex-1 min-w-[140px]">
                  <TrendingUp size={16} className="text-emerald-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-emerald-900">{wouldReturnPct}%</p>
                    <p className="text-[10px] text-emerald-700/80">Would return again</p>
                  </div>
                </div>
              )}
              {uniqueCities > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50/80 border border-sky-100 flex-1 min-w-[140px]">
                  <MapPin size={16} className="text-sky-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-sky-900">{uniqueCities}</p>
                    <p className="text-[10px] text-sky-700/80">Places explored</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold transition-all border',
                activeTab === t.id
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-on-surface/45 border-on-surface/10 hover:border-on-surface/20',
              )}
            >
              {t.label}
              {t.count != null && t.id !== 'overview' && (
                <span className={cn('ml-1.5 tabular-nums', activeTab === t.id ? 'text-white/90' : 'text-on-surface/35')}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 space-y-6">
        {activeTab === 'overview' && (
          <>
            {cuisineStats.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/45">Top cuisines</h3>
                </div>
                <div className="rounded-2xl bg-white border border-on-surface/8 p-4 space-y-3">
                  {cuisineStats.map(([name, count]) => (
                    <div key={name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-on-surface/80">{name}</span>
                        <span className="text-on-surface/40 tabular-nums">{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-on-surface/8 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/80"
                          style={{ width: `${Math.max(8, (count / maxCuisine) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {topRated.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Star size={16} className="text-amber-500 fill-amber-500" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/45">Standouts</h3>
                  </div>
                  <button type="button" onClick={() => setActiveTab('ratings')} className="text-[11px] font-semibold text-primary">
                    See all
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                  {topRated.map((r) => (
                    <Link
                      key={r.restaurantId}
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex-shrink-0 w-36 rounded-2xl border border-on-surface/8 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="aspect-[4/3] bg-on-surface/5 relative">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface/20">
                            <MapPin size={24} />
                          </div>
                        )}
                        <span
                          className={cn(
                            'absolute top-2 right-2 text-[11px] font-serif font-bold px-2 py-0.5 rounded-full bg-white/95 shadow-sm',
                            scoreColor(numericScore(r.score)),
                          )}
                        >
                          {formatScore(r.score)}
                        </span>
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-serif font-bold truncate leading-tight">{r.name}</p>
                        <p className="text-[10px] text-on-surface/40 truncate mt-0.5">{r.cuisine}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {recentRatings.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={16} className="text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/45">Recent visits</h3>
                </div>
                <div className="space-y-2">
                  {recentRatings.slice(0, 5).map((r) => (
                    <Link
                      key={r.restaurantId}
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white border border-on-surface/8 hover:border-primary/20 transition-colors"
                    >
                      <div className="w-12 h-12 rounded-xl bg-on-surface/5 overflow-hidden flex-shrink-0">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface/25">
                            <MapPin size={18} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-serif font-bold truncate">{r.name}</p>
                        <p className="text-[10px] text-on-surface/40">
                          {r.visitDate
                            ? new Date(r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : 'Rated recently'}
                          {r.cuisine && ` · ${r.cuisine}`}
                        </p>
                      </div>
                      <span className={cn('text-lg font-serif font-bold flex-shrink-0', scoreColor(numericScore(r.score)))}>{formatScore(r.score)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {wishlist.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Heart size={16} className="text-rose-400 fill-rose-400" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/45">Saved for later</h3>
                  </div>
                  <button type="button" onClick={() => setActiveTab('wishlist')} className="text-[11px] font-semibold text-primary">
                    View wishlist
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
                  {wishlist.slice(0, 8).map((w) => (
                    <Link
                      key={w.restaurantId}
                      to={`/restaurant/${w.restaurantId}`}
                      className="flex-shrink-0 w-32 rounded-xl border border-on-surface/8 bg-white p-2.5 hover:border-rose-200/80 transition-colors"
                    >
                      <p className="text-xs font-semibold truncate">{w.name}</p>
                      <p className="text-[10px] text-on-surface/40 truncate mt-0.5">{w.cuisine}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {lists.filter((l) => listRestaurantIds(l).length > 0).length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ListIcon size={16} className="text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/45">Your lists</h3>
                  </div>
                  <button type="button" onClick={() => setActiveTab('lists')} className="text-[11px] font-semibold text-primary">
                    Browse
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {lists
                    .filter((l) => listRestaurantIds(l).length > 0)
                    .slice(0, 4)
                    .map((list) => {
                      const rids = listRestaurantIds(list);
                      return (
                      <div
                        key={list.id}
                        className="rounded-2xl border border-on-surface/8 bg-white p-3"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{list.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-serif font-bold truncate">{list.name}</p>
                            <p className="text-[10px] text-on-surface/40">{rids.length} places</p>
                          </div>
                        </div>
                        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                          {rids.slice(0, 4).map((id) => {
                            const r = ratings.find((x) => x.restaurantId === id);
                            return (
                              <Link
                                key={id}
                                to={`/restaurant/${id}`}
                                className="flex-shrink-0 w-14 h-14 rounded-lg bg-on-surface/5 overflow-hidden border border-on-surface/6"
                              >
                                {r?.image ? (
                                  <img src={r.image} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-on-surface/25 text-[10px] font-bold">
                                    {r?.name?.charAt(0) || '?'}
                                  </div>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                    })}
                </div>
              </section>
            )}

            {ratings.length === 0 && wishlist.length === 0 && (
              <div className="text-center py-12 rounded-2xl border border-dashed border-on-surface/15 bg-white/50">
                <MapPin size={36} className="mx-auto text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/50">Start exploring the map</p>
                <p className="text-xs text-on-surface/35 mt-1 max-w-xs mx-auto">Rate restaurants and build lists — your stats and history will show up here.</p>
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
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input
                  type="search"
                  value={ratingSearch}
                  onChange={(e) => setRatingSearch(e.target.value)}
                  placeholder="Search your ratings..."
                  className="w-full bg-white rounded-xl py-2.5 pl-9 pr-3 text-sm border border-on-surface/8 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['recent', 'high', 'low'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRatingSort(k)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                    ratingSort === k ? 'bg-primary text-white border-primary' : 'bg-white text-on-surface/45 border-on-surface/10',
                  )}
                >
                  {k === 'recent' ? 'Recent' : k === 'high' ? 'Highest' : 'Lowest'}
                </button>
              ))}
            </div>
            {filteredSortedRatings.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10">No ratings match your search.</p>
            ) : (
              <ul className="space-y-2">
                {filteredSortedRatings.map((r) => (
                  <li key={r.restaurantId}>
                    <Link
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white border border-on-surface/8 hover:border-primary/15 transition-colors"
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-on-surface/5 flex-shrink-0">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface/25">
                            <MapPin size={20} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-serif font-bold truncate">{r.name}</p>
                        <p className="text-[10px] text-on-surface/40 truncate">
                          {r.cuisine}
                          {r.price && ` · ${r.price}`}
                          {r.address && ` · ${cityFromAddress(r.address) || r.address.split(',').pop()?.trim()}`}
                        </p>
                        {r.notes && <p className="text-[11px] text-on-surface/45 line-clamp-1 mt-1 italic">&ldquo;{r.notes}&rdquo;</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn('text-xl font-serif font-bold', scoreColor(numericScore(r.score)))}>{formatScore(r.score)}</p>
                        {r.wouldReturn && <p className="text-[9px] text-emerald-600 font-semibold">Return</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {activeTab === 'lists' && (
          <section className="space-y-4 pb-4">
            {lists.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10">You have not created any lists yet.</p>
            ) : (
              lists.map((list) => {
                const rids = listRestaurantIds(list);
                return (
                <div key={list.id} className="rounded-2xl border border-on-surface/8 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-on-surface/6 flex items-center gap-2">
                    <span className="text-xl">{list.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-serif font-bold">{list.name}</p>
                      <p className="text-[10px] text-on-surface/40">
                        {rids.length} rated
                        {list.wishlistIds?.length ? ` · ${list.wishlistIds.length} wishlist` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                    {rids.length === 0 ? (
                      <p className="text-xs text-on-surface/35 px-1 py-2">No restaurants in this list yet.</p>
                    ) : (
                      rids.map((id) => {
                        const r = ratings.find((x) => x.restaurantId === id);
                        return (
                          <Link
                            key={id}
                            to={`/restaurant/${id}`}
                            className="flex items-center gap-2 p-2 rounded-xl hover:bg-on-surface/[0.04] transition-colors"
                          >
                            <div className="w-10 h-10 rounded-lg bg-on-surface/5 overflow-hidden flex-shrink-0">
                              {r?.image ? <img src={r.image} alt="" className="w-full h-full object-cover" /> : null}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate">{r?.name || 'Restaurant'}</p>
                              <p className="text-[10px] text-on-surface/35">{r?.cuisine}</p>
                            </div>
                            {r && <span className={cn('text-sm font-serif font-bold', scoreColor(numericScore(r.score)))}>{formatScore(r.score)}</span>}
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
              })
            )}
          </section>
        )}

        {activeTab === 'wishlist' && (
          <section className="grid gap-3 sm:grid-cols-2 pb-4">
            {wishlist.length === 0 ? (
              <p className="text-sm text-on-surface/40 text-center py-10 col-span-full">Your wishlist is empty.</p>
            ) : (
              wishlist.map((w) => (
                <Link
                  key={w.restaurantId}
                  to={`/restaurant/${w.restaurantId}`}
                  className="flex gap-3 p-3 rounded-2xl bg-white border border-on-surface/8 hover:border-rose-200/60 transition-colors"
                >
                  <div className="w-16 h-16 rounded-xl bg-on-surface/5 overflow-hidden flex-shrink-0">
                    {w.image ? <img src={w.image} alt="" className="w-full h-full object-cover" /> : (
                      <div className="w-full h-full flex items-center justify-center text-rose-300">
                        <Heart size={22} className="fill-current" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-serif font-bold truncate">{w.name}</p>
                    <p className="text-[10px] text-on-surface/40 mt-0.5">
                      {w.cuisine}
                      {w.price && ` · ${w.price}`}
                    </p>
                    {w.notes && <p className="text-[11px] text-on-surface/45 mt-1 line-clamp-2 italic">&ldquo;{w.notes}&rdquo;</p>}
                    {w.address && (
                      <p className="text-[10px] text-on-surface/30 mt-1 flex items-center gap-1">
                        <MapPin size={10} />
                        {w.address.split(',').slice(-2).join(', ').trim()}
                      </p>
                    )}
                  </div>
                </Link>
              ))
            )}
          </section>
        )}

        {activeTab === 'cooking' && (
          <section className="space-y-3 pb-4">
            {homeMeals.length === 0 ? (
              <div className="text-center py-10 rounded-2xl border border-dashed border-on-surface/15">
                <ChefHat size={32} className="mx-auto text-on-surface/20 mb-2" />
                <p className="text-sm text-on-surface/45">Log home-cooked meals from the map or pantry flow.</p>
              </div>
            ) : (
              homeMeals.map((meal) => {
                const mealPhotos = Array.isArray(meal.photos) ? meal.photos : [];
                const mealDishes = Array.isArray(meal.dishes) ? meal.dishes : [];
                const mealDate = meal.date ? new Date(meal.date) : null;
                const dateLabel = mealDate && !Number.isNaN(mealDate.getTime())
                  ? mealDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—';
                return (
                <div key={meal.id} className="rounded-2xl border border-on-surface/8 bg-white overflow-hidden">
                  {mealPhotos[0]?.url && (
                    <div className="aspect-[16/9] bg-on-surface/5">
                      <img src={mealPhotos[0].url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-serif font-bold">{meal.name}</p>
                        <p className="text-[10px] text-on-surface/40 mt-0.5">
                          {dateLabel}
                          {mealDishes.length > 0 && ` · ${mealDishes.length} dish${mealDishes.length !== 1 ? 'es' : ''}`}
                        </p>
                      </div>
                      <span className={cn('text-lg font-serif font-bold', scoreColor(numericScore(meal.score)))}>{formatScore(meal.score)}</span>
                    </div>
                    {meal.description && (
                      <p className="text-xs text-on-surface/50 mt-2 leading-relaxed line-clamp-3">&ldquo;{meal.description}&rdquo;</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                          meal.isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-on-surface/5 text-on-surface/40',
                        )}
                      >
                        {meal.isPublic ? 'Visible on profile' : 'Private'}
                      </span>
                      {meal.wouldMakeAgain && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Would make again</span>
                      )}
                    </div>
                  </div>
                </div>
              );
              })
            )}
            {publicHomeMeals.length > 0 && (
              <p className="text-[11px] text-center text-on-surface/35 pb-2">
                {publicHomeMeals.length} meal{publicHomeMeals.length !== 1 ? 's' : ''} shown on your public profile.
              </p>
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
