import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Lock, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Heart, Crown, Globe, EyeOff, Smartphone, Moon, Film, Plus, Image as ImageIcon, Sparkles,
  LayoutGrid, List as ListIcon, Upload, Bookmark,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { ProfileReelsSection, ProfilePostsSection } from '../components/ProfileReelsSection';
import { useSettings } from '../contexts/SettingsContext';
import { saveProfile, getFollowCounts, getExpertRecommendationCount } from '../lib/supabase-community';
import { geocodePlace } from '../components/HomeLocationBar';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';

type SettingsPage = 'main' | 'edit' | 'account';

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
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Heuristic: in "<street>, <city>, <state-or-country>" the city is the
  // middle part; in "<street>, <city>" it's the last. Pick accordingly so
  // we don't render "CT" or "USA" as the place label.
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts[parts.length - 1];
}

/** Single neutral gradient behind cards with no photo. Kept identical
 *  across every card so the section reads as a calm row rather than a
 *  bag of colored tiles. */
const TOP_RATED_GRADIENT = 'from-stone-700 via-stone-800 to-stone-950';

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

/* ── TopRatedCard ──
   Text-only minimalist tile used in the Profile TOP tab. # + rank
   on the left, score-colored decimal on the right, serif name and
   meta sub-line below. Subtle border lifts on hover so the strip
   doesn't feel like detached chrome. */
const TopRatedCard: React.FC<{
  rank: number;
  rating: { restaurantId: string; name: string; score: number; cuisine?: string; price?: string; address?: string; image?: string };
  /** Bottom sub-line under the name. Defaults to cuisine · price · city. */
  metaText?: string;
}> = ({ rank, rating, metaText }) => {
  const city = cityFromAddress(rating.address || '');
  const resolvedMeta = metaText ?? [rating.cuisine, rating.price, city].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/restaurant/${rating.restaurantId}`}
      className="block w-52 flex-shrink-0 snap-start rounded-2xl bg-surface border border-on-surface/[0.08] px-4 py-3.5 hover:border-on-surface/[0.18] hover:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.08)] transition-all"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[13px] font-medium text-on-surface/30 leading-none">#</span>
          <span className="font-serif font-bold text-on-surface text-[26px] leading-none tabular-nums">
            {rank}
          </span>
        </div>
        <span className={cn(
          'font-serif font-bold tabular-nums text-[28px] leading-none flex-shrink-0',
          scoreColor(numericScore(rating.score)),
        )}>
          {formatScore(rating.score)}
        </span>
      </div>

      <p className="font-serif font-bold text-on-surface text-[16px] leading-tight line-clamp-1 mt-3">
        {rating.name}
      </p>
      <p className="text-[12px] text-on-surface/45 truncate mt-1">
        {resolvedMeta}
      </p>
    </Link>
  );
};

/* ── GuideCard ──
   Recommended-guide tile used in the Profile TOP tab. Cover with a
   GUIDE chip + bookmark, place count footer, then title + author row
   sit below the card. Author avatars are simple initial circles. */
type Guide = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  placeCount: number;
  cuisineLabel: string;
  coverGradient: string;
  bgImage?: string;
};

const GuideCard: React.FC<{ guide: Guide }> = ({ guide }) => (
  <Link
    to="/discover"
    className="flex-shrink-0 snap-start w-[260px] group"
  >
    <div className={cn(
      'relative w-full aspect-[4/3] rounded-2xl overflow-hidden ring-1 ring-on-surface/[0.06] shadow-sm bg-gradient-to-br',
      guide.coverGradient,
    )}>
      {guide.bgImage && (
        <img
          src={guide.bgImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          referrerPolicy="no-referrer"
        />
      )}
      {!guide.bgImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-mono uppercase tracking-[0.18em] text-white/25 text-[12px]">
            {guide.cuisineLabel}
          </span>
        </div>
      )}

      {/* GUIDE badge top-left */}
      <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg bg-white px-2 h-7 text-on-surface text-[11px] font-bold tracking-wider">
        <ListIcon size={12} />
        GUIDE
      </span>

      {/* Bookmark top-right */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        aria-label="Save guide"
        className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/35 backdrop-blur flex items-center justify-center text-white hover:bg-black/55 transition-colors"
      >
        <Bookmark size={14} className="fill-white" />
      </button>

      {/* Bottom wash + place count */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="absolute bottom-2.5 left-3 inline-flex items-center gap-1 text-white text-[12.5px] font-semibold">
        <MapPin size={12} />
        {guide.placeCount} places
      </div>
    </div>

    <p className="mt-3 font-serif font-bold text-on-surface text-[16px] leading-tight line-clamp-2">
      {guide.title}
    </p>
    <div className="mt-2 flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
        <span className="text-[11px] font-bold text-primary">{guide.authorInitials}</span>
      </div>
      <p className="text-[12px] text-on-surface/55 truncate">
        <span className="font-semibold text-on-surface/75">{guide.authorName}</span>
        <span className="text-on-surface/40"> · @{guide.authorHandle}</span>
      </p>
    </div>
  </Link>
);

/* ── Top10Section ──
   Section header (title + subtitle + See all) followed by a
   horizontally scrolling strip of TopRatedCards. Kept inline so the
   Profile page can repeat it for each slice (overall, per cuisine,
   per city). */
const Top10Section: React.FC<{
  title: React.ReactNode;
  subtitle: string;
  onSeeAll?: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, onSeeAll, children }) => (
  <section>
    <div className="px-5 flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h3 className="font-serif font-bold text-on-surface text-[20px] leading-tight">{title}</h3>
        <p className="text-[12.5px] text-on-surface/45 mt-0.5">{subtitle}</p>
      </div>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface/65 hover:text-on-surface mt-1 flex-shrink-0"
        >
          See all <ChevronRight size={14} />
        </button>
      )}
    </div>
    <div className="flex gap-3 overflow-x-auto px-5 pb-1.5 scrollbar-hide snap-x snap-mandatory">
      {children}
    </div>
  </section>
);

/* ── Mock recommended guides ──
   Placeholder guides "curated by people you follow" until the real
   guides feature is built. Each guide gets a distinct gradient and a
   plausible author so the strip reads as a populated feed, not chrome. */
const MOCK_GUIDES: Guide[] = [
  {
    id: 'mg-nyc-italian',
    title: 'NYC Italian Hall of Fame',
    authorName: 'Carmen Russo',
    authorHandle: 'forkful',
    authorInitials: 'CR',
    placeCount: 22,
    cuisineLabel: 'GUIDE COVER',
    coverGradient: 'from-stone-700 via-stone-800 to-stone-950',
  },
  {
    id: 'mg-paris-budget',
    title: 'Paris on a budget',
    authorName: 'Léa Bernard',
    authorHandle: 'leabparis',
    authorInitials: 'LB',
    placeCount: 24,
    cuisineLabel: 'GUIDE COVER',
    coverGradient: 'from-zinc-700 via-zinc-800 to-stone-950',
  },
  {
    id: 'mg-tokyo-ramen',
    title: "Tokyo's hidden ramen gems",
    authorName: 'Aiko Tanaka',
    authorHandle: 'aiko_eats',
    authorInitials: 'AT',
    placeCount: 18,
    cuisineLabel: 'GUIDE COVER',
    coverGradient: 'from-neutral-700 via-neutral-800 to-stone-950',
  },
  {
    id: 'mg-london-sundayroast',
    title: 'Best Sunday roast in London',
    authorName: 'Oliver West',
    authorHandle: 'oliveats',
    authorInitials: 'OW',
    placeCount: 11,
    cuisineLabel: 'GUIDE COVER',
    coverGradient: 'from-stone-800 via-stone-900 to-zinc-950',
  },
];

/* ── EmptyTabState ──
   Friendly empty placeholder for any tab with no items. Matches the
   surface tone so it never feels like an error state. */
const EmptyTabState: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ctaLabel: string;
  onCta: () => void;
}> = ({ icon, title, subtitle, ctaLabel, onCta }) => (
  <div className="text-center py-12 rounded-2xl border border-dashed border-on-surface/10">
    <div className="mb-3 flex justify-center">{icon}</div>
    <p className="text-sm font-semibold text-on-surface/55">{title}</p>
    <p className="text-xs text-on-surface/35 mt-1 max-w-xs mx-auto">{subtitle}</p>
    <button
      type="button"
      onClick={onCta}
      className="mt-4 px-5 py-2.5 rounded-full bg-primary text-white text-xs font-semibold"
    >
      {ctaLabel}
    </button>
  </div>
);

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { profile, user, signOut, refreshProfile, pendingRequestCount } = useAuth();
  const listsCtx = useLists();
  const { openAddReelModal, openEditReelModal, reels, deleteReel, setReelVisibility } = useReels();
  const { openAddPostModal, openEditPostModal, posts, deletePost, setPostVisibility } = usePosts();
  const ratings = Array.isArray(listsCtx.ratings) ? listsCtx.ratings : [];

  // Reels and posts authored by the signed-in user. Both come from their
  // respective contexts (loaded once at mount), filtered locally.
  const myReels = useMemo(
    () => reels.filter((r) => r.authorId === user?.id),
    [reels, user?.id],
  );
  const myPosts = useMemo(
    () => posts.filter((p) => p.userId === user?.id),
    [posts, user?.id],
  );
  const [confirmDeleteReelId, setConfirmDeleteReelId] = useState<string | null>(null);
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [deletingReel, setDeletingReel] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const onConfirmDeleteReel = async () => {
    if (!confirmDeleteReelId) return;
    setDeletingReel(true);
    const ok = await deleteReel(confirmDeleteReelId);
    setDeletingReel(false);
    setConfirmDeleteReelId(null);
    if (!ok) alert("Couldn't delete that reel. Try again.");
  };
  const onConfirmDeletePost = async () => {
    if (!confirmDeletePostId) return;
    setDeletingPost(true);
    const ok = await deletePost(confirmDeletePostId);
    setDeletingPost(false);
    setConfirmDeletePostId(null);
    if (!ok) alert("Couldn't delete that post. Try again.");
  };
  const { phoneMode, togglePhoneMode, darkMode, toggleDarkMode } = useSettings();
  const [activeTab, setActiveTab] = useState<'top' | 'posts' | 'reels' | 'rated'>('top');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('main');
  // Create menu — single button under the action row that opens a small
  // popover offering Post or Reel. Mirrors the desktop sidebar's pattern.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (createWrapRef.current && !createWrapRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [createMenuOpen]);

  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  // Home city the user is based in. Surfaced on Circle expert cards and
  // used by /location to suggest experts in the area being explored.
  // Free-text input here; on save it's forward-geocoded to lat/lng so
  // location-based queries don't have to re-geocode every profile.
  const [editHomeCity, setEditHomeCity] = useState('');
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

  const resetEditFields = () => {
    setEditName(profile?.display_name || '');
    setEditUsername(profile?.username || '');
    setEditBio(profile?.bio || '');
    setEditHomeCity(profile?.home_city || '');
    setEditError('');
    setEditSuccess(false);
  };

  const openEditProfile = () => {
    resetEditFields();
    setSettingsPage('edit');
    setSettingsOpen(true);
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

  const goToMyRatings = () => {
    sessionStorage.setItem('map-mode', 'myratings');
    navigate('/map');
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
    // Resolve the typed home-city to coords on save so location-based
    // queries (e.g. "experts in Westport") don't have to forward-geocode
    // every profile at read time. Only changed-or-new entries hit Mapbox;
    // a cleared field resets coords too.
    const homeCityTrim = editHomeCity.trim();
    const previousCity = profile?.home_city || '';
    let homeBase: { homeCity?: string | null; homeLat?: number | null; homeLng?: number | null } | undefined;
    if (homeCityTrim !== previousCity) {
      if (!homeCityTrim) {
        homeBase = { homeCity: null, homeLat: null, homeLng: null };
      } else {
        const geo = await geocodePlace(homeCityTrim);
        homeBase = {
          homeCity: geo?.label || homeCityTrim,
          homeLat: geo?.lat ?? null,
          homeLng: geo?.lng ?? null,
        };
      }
    }
    const result = await saveProfile(
      user.id,
      editName.trim(),
      editUsername.trim(),
      editBio.trim(),
      undefined,
      undefined,
      homeBase,
    );
    if (result.success) {
      setEditSuccess(true);
      await refreshProfile();
      setTimeout(() => setSettingsPage('main'), 800);
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

  /** Top-N highest scoring ratings, used by every TOP-tab slice. */
  const topOverall = useMemo(() => {
    return [...ratings]
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, 10);
  }, [ratings]);

  /** Per-cuisine slices — only kept when there's enough data to fill a
   *  meaningful Top 10 (4+ entries). Sorted by total count desc so the
   *  user's most-rated cuisines surface first. */
  const topByCuisine = useMemo(() => {
    const grouped = new Map<string, typeof ratings>();
    ratings.forEach((r) => {
      if (!r.cuisine) return;
      const arr = grouped.get(r.cuisine) ?? [];
      arr.push(r);
      grouped.set(r.cuisine, arr);
    });
    return Array.from(grouped.entries())
      .filter(([, items]) => items.length >= 4)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([cuisine, items]) => {
        const sorted = [...items].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 10);
        const avg = items.reduce((s, r) => s + (Number(r.score) || 0), 0) / items.length;
        return { cuisine, items: sorted, total: items.length, avg };
      });
  }, [ratings]);

  /** Per-city slices, same shape and 4+ threshold as cuisine. */
  const topByCity = useMemo(() => {
    const grouped = new Map<string, typeof ratings>();
    ratings.forEach((r) => {
      const city = cityFromAddress(r.address || '');
      if (!city) return;
      const arr = grouped.get(city) ?? [];
      arr.push(r);
      grouped.set(city, arr);
    });
    return Array.from(grouped.entries())
      .filter(([, items]) => items.length >= 4)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([city, items]) => {
        const sorted = [...items].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 10);
        const avg = items.reduce((s, r) => s + (Number(r.score) || 0), 0) / items.length;
        return { city, items: sorted, total: items.length, avg };
      });
  }, [ratings]);

  const recentRatings = useMemo(() => {
    return [...ratings].sort((a, b) => ratingRecencyIso(b).localeCompare(ratingRecencyIso(a))).slice(0, 6);
  }, [ratings]);

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const maxCuisine = cuisineStats[0]?.[1] || 1;

  return (
    <div className="pb-32 min-h-screen bg-surface">
      {pendingRequestCount > 0 && (
        <div className="mx-5 mt-4 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200/60">
          <span className="text-xs font-semibold text-amber-900">
            {pendingRequestCount} friend request{pendingRequestCount !== 1 ? 's' : ''} waiting
          </span>
          <Heart size={14} className="text-amber-700 flex-shrink-0" />
        </div>
      )}

      {/* ── Profile header ────────────────────────────────────────────── */}
      <div className="px-5 pt-6 pb-5">
        {/* Avatar + horizontal stats row */}
        <div className="flex items-center gap-5">
          <div className="relative flex-shrink-0">
            <div className="w-[92px] h-[92px] rounded-full bg-gradient-to-br from-primary/30 to-primary/15 flex items-center justify-center">
              <span className="text-[42px] font-serif font-bold text-primary leading-none">{displayName.charAt(0).toUpperCase()}</span>
            </div>
            {profile?.is_expert && (
              <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-amber-400 ring-[3px] ring-surface flex items-center justify-center">
                <Crown size={13} className="text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 grid grid-cols-3 gap-2">
            <button type="button" onClick={goToMyRatings} className="flex flex-col items-center text-center">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums">{ratings.length}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">rated</span>
            </button>
            <button type="button" onClick={() => navigate('/circle')} className="flex flex-col items-center text-center">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums">{followers}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">followers</span>
            </button>
            <button type="button" onClick={() => navigate('/circle')} className="flex flex-col items-center text-center">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums">{following}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">following</span>
            </button>
          </div>
        </div>

        {/* Name + handle */}
        <div className="mt-5 flex items-baseline gap-2 flex-wrap">
          <h1 className="text-[26px] font-serif font-bold text-on-surface leading-none tracking-tight">{displayName}</h1>
          <span className="text-[15px] text-on-surface/40">@{username}</span>
        </div>

        {/* Public + joined */}
        <div className="flex items-center gap-2 mt-2.5">
          <span className={cn(
            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border',
            profile?.is_public
              ? 'bg-emerald-50/70 border-emerald-200/60 text-emerald-700'
              : 'bg-on-surface/[0.04] border-on-surface/8 text-on-surface/45',
          )}>
            {profile?.is_public ? <Globe size={11} /> : <EyeOff size={11} />}
            {profile?.is_public ? 'Public' : 'Private'}
          </span>
          {profile?.is_expert && (
            <>
              <span className="text-on-surface/25 text-xs">·</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/70 text-[11px] font-semibold text-amber-800">
                <Star size={10} className="fill-amber-500 text-amber-500" />
                Expert{expertPickCount > 0 && ` · ${expertPickCount}`}
              </span>
            </>
          )}
          {memberSince && (
            <>
              <span className="text-on-surface/25 text-xs">·</span>
              <span className="text-[12px] text-on-surface/45">Joined {memberSince}</span>
            </>
          )}
        </div>

        {bio && <p className="text-[13.5px] text-on-surface/65 mt-3 leading-relaxed">{bio}</p>}

        {/* Action row */}
        <div ref={createWrapRef} className="relative flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => setCreateMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-primary text-white text-[13px] font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus
              size={15}
              strokeWidth={2.5}
              className={cn('transition-transform duration-200', createMenuOpen && 'rotate-45')}
            />
            Create
          </button>
          <button
            type="button"
            onClick={openEditProfile}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-on-surface/[0.06] text-on-surface/80 text-[13px] font-bold border border-on-surface/8 hover:bg-on-surface/10 transition-colors"
          >
            <Edit3 size={14} />
            Edit
          </button>
          <Link
            to={publicProfilePath}
            className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-on-surface/[0.06] border border-on-surface/8 text-on-surface/55 hover:bg-on-surface/10 transition-colors"
            aria-label="View public profile"
          >
            <Upload size={15} />
          </Link>
          <button
            type="button"
            onClick={openSettings}
            className="w-10 h-10 inline-flex items-center justify-center rounded-xl bg-on-surface/[0.06] border border-on-surface/8 text-on-surface/55 hover:bg-on-surface/10 transition-colors"
            aria-label="Settings"
          >
            <Settings size={15} />
          </button>

          <AnimatePresence>
            {createMenuOpen && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute left-0 top-[calc(100%+0.25rem)] w-52 z-30 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setCreateMenuOpen(false); openAddPostModal(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <ImageIcon size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold leading-tight">Post</span>
                    <span className="block text-[11px] text-on-surface/50 leading-tight">Up to 15 photos & videos</span>
                  </span>
                </button>
                <div className="border-t border-on-surface/[0.06]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setCreateMenuOpen(false); openAddReelModal(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-on-surface/[0.06] text-on-surface flex items-center justify-center flex-shrink-0">
                    <Film size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold leading-tight">Reel</span>
                    <span className="block text-[11px] text-on-surface/50 leading-tight">Single short video</span>
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="border-t border-on-surface/[0.08]">
        <div className="grid grid-cols-4">
          {([
            ['top', Star, 'TOP'],
            ['posts', LayoutGrid, 'POSTS'],
            ['reels', Film, 'REELS'],
            ['rated', ListIcon, 'RATED'],
          ] as const).map(([key, Icon, label]) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'relative py-3.5 flex flex-col items-center justify-center gap-1.5 transition-colors',
                  isActive ? 'text-on-surface' : 'text-on-surface/30',
                )}
              >
                <Icon size={18} className={cn(isActive && key === 'top' && 'fill-on-surface')} />
                <span className={cn(
                  'text-[10px] font-bold tracking-[0.18em]',
                  isActive ? 'text-on-surface' : 'text-on-surface/40',
                )}>
                  {label}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-on-surface" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <main className="px-5 pt-5">
        {activeTab === 'top' && (
          topOverall.length === 0 ? (
            <EmptyTabState
              icon={<Star size={32} className="text-on-surface/15" />}
              title="No rated restaurants yet"
              subtitle="Rate restaurants to see your top picks here."
              ctaLabel="Open map"
              onCta={() => navigate('/')}
            />
          ) : (
            // Full-bleed strips: negative margin cancels the `main` pad
            // so cards run edge-to-edge during horizontal scroll.
            <div className="-mx-5 space-y-7">
              <Top10Section
                title="Top 10"
                subtitle="Your highest scores, all-time"
                onSeeAll={goToMyRatings}
              >
                {topOverall.map((r, i) => (
                  <TopRatedCard key={r.restaurantId} rank={i + 1} rating={r} />
                ))}
              </Top10Section>

              {topByCuisine.map(({ cuisine, items, total, avg }) => (
                <Top10Section
                  key={`cuisine-${cuisine}`}
                  title={<>Top 10 · <span className="text-on-surface/70">{cuisine}</span></>}
                  subtitle={`${total} place${total === 1 ? '' : 's'} · ${avg.toFixed(1)} avg`}
                  onSeeAll={goToMyRatings}
                >
                  {items.map((r, i) => {
                    const cityLabel = cityFromAddress(r.address || '');
                    return (
                      <TopRatedCard
                        key={r.restaurantId}
                        rank={i + 1}
                        rating={r}
                        metaText={[cityLabel, r.price].filter(Boolean).join(' · ')}
                      />
                    );
                  })}
                </Top10Section>
              ))}

              {topByCity.map(({ city, items, total, avg }) => (
                <Top10Section
                  key={`city-${city}`}
                  title={<>Top 10 in <span className="text-on-surface/70">{city}</span></>}
                  subtitle={`${total} place${total === 1 ? '' : 's'} · ${avg.toFixed(1)} avg`}
                  onSeeAll={goToMyRatings}
                >
                  {items.map((r, i) => (
                    <TopRatedCard
                      key={r.restaurantId}
                      rank={i + 1}
                      rating={r}
                      metaText={[r.cuisine, r.price].filter(Boolean).join(' · ')}
                    />
                  ))}
                </Top10Section>
              ))}

              {/* Recommended guides — mock for now; "Explore" routes to
                  Discover where real guides live. */}
              <section>
                <div className="px-5 flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="font-serif font-bold text-on-surface text-[20px] leading-tight">Recommended guides</h3>
                    <p className="text-[12.5px] text-on-surface/45 mt-0.5">Curated by people you follow</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/discover')}
                    className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface/65 hover:text-on-surface mt-1 flex-shrink-0"
                  >
                    Explore <ChevronRight size={14} />
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto px-5 pb-2 scrollbar-hide snap-x snap-mandatory">
                  {MOCK_GUIDES.map((g) => (
                    <GuideCard key={g.id} guide={g} />
                  ))}
                </div>
              </section>
            </div>
          )
        )}

        {activeTab === 'posts' && (
          myPosts.length === 0 ? (
            <EmptyTabState
              icon={<LayoutGrid size={32} className="text-on-surface/15" />}
              title="No posts yet"
              subtitle="Share photos and videos from your favorite spots."
              ctaLabel="Create a post"
              onCta={() => openAddPostModal()}
            />
          ) : (
            <ProfilePostsSection
              posts={myPosts}
              isOwn
              onEdit={(id) => openEditPostModal(id)}
              onDelete={(id) => setConfirmDeletePostId(id)}
              onToggleVisibility={(id, next) => setPostVisibility(id, next)}
              hideHeader
            />
          )
        )}

        {activeTab === 'reels' && (
          myReels.length === 0 ? (
            <EmptyTabState
              icon={<Film size={32} className="text-on-surface/15" />}
              title="No reels yet"
              subtitle="Share short videos of your favorite places and recipes."
              ctaLabel="Create a reel"
              onCta={() => openAddReelModal()}
            />
          ) : (
            <ProfileReelsSection
              reels={myReels}
              isOwn
              onEdit={(id) => openEditReelModal(id)}
              onDelete={(id) => setConfirmDeleteReelId(id)}
              onToggleVisibility={(id, next) => setReelVisibility(id, next)}
              hideHeader
            />
          )
        )}

        {activeTab === 'rated' && (
          ratings.length === 0 ? (
            <EmptyTabState
              icon={<ListIcon size={32} className="text-on-surface/15" />}
              title="No ratings yet"
              subtitle="Rate restaurants to see your cuisine breakdown and history."
              ctaLabel="Open map"
              onCta={() => navigate('/')}
            />
          ) : (
            <div className="space-y-7">
              {cuisineStats.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-4">Cuisine breakdown</h3>
                  <div className="space-y-3.5">
                    {cuisineStats.map(([name, count]) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="text-[13px] font-medium text-on-surface/75 w-24 truncate">{name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-on-surface/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max(8, (count / maxCuisine) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[12px] text-on-surface/40 tabular-nums w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recentRatings.length > 0 && (
                <section>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Recent</h3>
                    <button
                      type="button"
                      onClick={goToMyRatings}
                      className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
                    >
                      See all <ChevronRight size={12} />
                    </button>
                  </div>
                  <ul className="divide-y divide-on-surface/[0.06]">
                    {recentRatings.map((r) => (
                      <li key={r.restaurantId}>
                        <Link
                          to={`/restaurant/${r.restaurantId}`}
                          className="flex items-center gap-3.5 py-3 group"
                        >
                          <div className="w-11 h-11 rounded-xl bg-on-surface/[0.05] overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {r.image ? (
                              <img src={r.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <MapPin size={15} className="text-on-surface/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-serif font-bold truncate leading-tight">{r.name}</p>
                            <p className="text-[11.5px] text-on-surface/45 mt-0.5">
                              {r.visitDate
                                ? new Date(r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : ''}
                              {r.cuisine && `${r.visitDate ? ' · ' : ''}${r.cuisine}`}
                            </p>
                          </div>
                          <span className={cn('text-[16px] font-serif font-bold flex-shrink-0 tabular-nums', scoreColor(numericScore(r.score)))}>
                            {formatScore(r.score)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )
        )}
      </main>

      {/* Delete-reel / Delete-post confirmations. Both call into their
          respective contexts and clean up storage objects. */}
      <AnimatePresence>
        {confirmDeleteReelId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[80] flex items-center justify-center px-6"
            onClick={() => { if (!deletingReel) setConfirmDeleteReelId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-on-surface text-lg">Delete reel?</h4>
              <p className="text-sm text-on-surface/55 mt-1">This permanently removes the video and all of its likes, saves, and comments. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeleteReelId(null)} disabled={deletingReel} className="flex-1 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold hover:bg-on-surface/[0.1] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={onConfirmDeleteReel} disabled={deletingReel} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-60">{deletingReel ? 'Deleting…' : 'Delete'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {confirmDeletePostId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[80] flex items-center justify-center px-6"
            onClick={() => { if (!deletingPost) setConfirmDeletePostId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-on-surface text-lg">Delete post?</h4>
              <p className="text-sm text-on-surface/55 mt-1">This permanently removes every photo / video and the comments. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeletePostId(null)} disabled={deletingPost} className="flex-1 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold hover:bg-on-surface/[0.1] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={onConfirmDeletePost} disabled={deletingPost} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-60">{deletingPost ? 'Deleting…' : 'Delete'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Sheet — unified: main, edit profile, account sub-pages */}
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
              className="fixed inset-x-0 bottom-0 z-[60] bg-surface rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden"
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
                          setSettingsOpen(false);
                          navigate('/activity');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Sparkles size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Your Activity</p>
                          <p className="text-[11px] text-on-surface/35">Saves, likes, and comments</p>
                        </div>
                        <ChevronRight size={16} className="text-on-surface/20" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetEditFields();
                          setSettingsPage('edit');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Edit3 size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Edit Profile</p>
                          <p className="text-[11px] text-on-surface/35">Name, username, bio</p>
                        </div>
                        <ChevronRight size={16} className="text-on-surface/20" />
                      </button>
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
                      <button
                        type="button"
                        onClick={toggleDarkMode}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Moon size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Dark Mode</p>
                          <p className="text-[11px] text-on-surface/35">{darkMode ? 'On — dark surface across the app' : 'Off — light cream surface'}</p>
                        </div>
                        <div
                          className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${darkMode ? 'bg-primary' : 'bg-on-surface/15'}`}
                        >
                          <motion.div
                            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                            animate={{ left: darkMode ? '1.125rem' : '0.125rem' }}
                            transition={{ type: 'spring', damping: 20, stiffness: 350 }}
                          />
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={togglePhoneMode}
                        className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl hover:bg-on-surface/3 transition-colors text-left"
                      >
                        <Smartphone size={18} className="text-on-surface/40" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Phone View</p>
                          <p className="text-[11px] text-on-surface/35">Force mobile layout on desktop</p>
                        </div>
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
                {settingsPage === 'edit' && (
                  <motion.div
                    key="edit"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                      <button type="button" onClick={() => setSettingsPage('main')} className="p-1 text-on-surface/40">
                        <ArrowLeft size={20} />
                      </button>
                      <h3 className="font-serif font-bold text-lg">Edit Profile</h3>
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
                        <p className="text-[11px] text-on-surface/40 text-right mt-1 tabular-nums">{editBio.length}/150 characters</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">
                          Home city
                          {profile?.is_expert && (
                            <span className="ml-1.5 text-primary normal-case font-semibold tracking-normal">· recommended for experts</span>
                          )}
                        </p>
                        <div className="relative">
                          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="text"
                            value={editHomeCity}
                            onChange={(e) => setEditHomeCity(e.target.value)}
                            placeholder="e.g. Westport, CT"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            autoCapitalize="words"
                            autoCorrect="off"
                          />
                        </div>
                        <p className="text-[11px] text-on-surface/40 mt-1">
                          Where you're based. Shown on your profile and helps surface you to people exploring your area.
                        </p>
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
