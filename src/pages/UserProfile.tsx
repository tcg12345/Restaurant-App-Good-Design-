import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Lock, UserCircle, Loader2, Check, Star, MapPin,
  ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon,
  Share2, MoreHorizontal, Send,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { useSettings } from '../contexts/SettingsContext';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriends,
  sendFriendRequest, followPublicAccount, getUserRatings, getUserPhotos, getUserLists,
  getUserWishlist, publishCommunityRating, getUserPublicHomeMeals, getExpertRecommendationCount,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import type { HomeMeal } from '../contexts/ListsContext';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { searchPlacesByText } from '../lib/places';
import { useBottomSheet } from '../lib/useBottomSheet';
import { ProfileRestaurantRow } from '../components/profile/ProfileRestaurantRow';
import { ProfileRecipeRow } from '../components/profile/ProfileRecipeRow';
import { ProfilePostCard } from '../components/profile/ProfilePostCard';
import { ProfileReelCard } from '../components/profile/ProfileReelCard';

// Simple in-memory cache to avoid re-fetching on back navigation
const profileCache: Record<string, {
  profile: UserProfileType; canView: boolean; followers: number; following: number;
  isFollowing: boolean; ratings: CommunityRating[]; photos: CommunityPhoto[];
  lists: { id: string; name: string; emoji: string; restaurantIds: string[] }[];
  wishlistItems: { restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[];
  publicHomeMeals: HomeMeal[];
  ts: number;
}> = {};

type ViewTab = 'restaurants' | 'recipes' | 'posts' | 'reels' | 'guides';
type SortBy = 'recent' | 'highest' | 'lowest' | 'az';

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { reels } = useReels();
  const { posts } = usePosts();
  const { phoneMode } = useSettings();
  const userId = user?.id ?? null;

  const [profile, setProfile] = useState<UserProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followSent, setFollowSent] = useState(false);

  const [userRatings, setUserRatings] = useState<CommunityRating[]>([]);
  const [userPhotos, setUserPhotos] = useState<CommunityPhoto[]>([]);
  const [publicHomeMeals, setPublicHomeMeals] = useState<HomeMeal[]>([]);
  const [userLists, setUserLists] = useState<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]>([]);
  const [userWishlistItems, setUserWishlistItems] = useState<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]>([]);

  const [expertRecCount, setExpertRecCount] = useState(0);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<ViewTab>('restaurants');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCuisine, setFilterCuisine] = useState<string | null>(null);
  const [filterPrice, setFilterPrice] = useState<string | null>(null);
  const [filterCity, setFilterCity] = useState<string | null>(null);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [showMapPage, setShowMapPage] = useState(false);
  const { dragProps: filtersDragProps } = useBottomSheet(filtersOpen, () => setFiltersOpen(false));

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const sortBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;

    const cacheKey = `${username}_${userId}`;
    const cached = profileCache[cacheKey];
    if (cached && Date.now() - cached.ts < 60000) {
      setProfile(cached.profile);
      setCanView(cached.canView);
      setFollowers(cached.followers);
      setFollowing(cached.following);
      setIsFollowing(cached.isFollowing);
      setUserRatings(cached.ratings);
      setUserPhotos(cached.photos);
      setUserLists(cached.lists);
      setUserWishlistItems(cached.wishlistItems || []);
      setPublicHomeMeals(cached.publicHomeMeals || []);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      const p = await getProfileByUsername(username);
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
      if (!p) return;

      const isAuthed = !!userId;

      const fSnapshot: Partial<typeof profileCache[string]> = {
        profile: p,
        ratings: [], photos: [], lists: [], wishlistItems: [],
        publicHomeMeals: [], followers: 0, following: 0,
        canView: !isAuthed && !!p.is_public, isFollowing: false,
      };
      const promises: Promise<void>[] = [];

      promises.push(getFollowCounts(p.user_id).then((counts) => {
        if (cancelled) return;
        const c = counts || { followers: 0, following: 0 };
        setFollowers(c.followers || 0);
        setFollowing(c.following || 0);
        fSnapshot.followers = c.followers || 0;
        fSnapshot.following = c.following || 0;
      }));

      promises.push(getUserRatings(p.user_id).then((ratings) => {
        if (cancelled) return;
        const r = (ratings || []) as CommunityRating[];
        setUserRatings(r);
        fSnapshot.ratings = r;
      }));

      promises.push(getUserLists(p.user_id).then((lists) => {
        if (cancelled) return;
        const l = ((lists || []) as any[]).filter((x: any) => x.restaurantIds?.length > 0);
        setUserLists(l);
        fSnapshot.lists = l;
      }));

      promises.push(getUserWishlist(p.user_id).then((wishlist) => {
        if (cancelled) return;
        const w = (wishlist || []) as typeof userWishlistItems;
        setUserWishlistItems(w);
        fSnapshot.wishlistItems = w;
      }));

      promises.push(getUserPublicHomeMeals(p.user_id).then((meals) => {
        if (cancelled) return;
        const m = (meals || []) as HomeMeal[];
        setPublicHomeMeals(m);
        fSnapshot.publicHomeMeals = m;
      }));

      if (isAuthed) {
        promises.push(canViewProfile(userId!, p).then((viewable) => {
          if (cancelled) return;
          const v = !!viewable;
          setCanView(v);
          fSnapshot.canView = v;
        }));
        promises.push(getFriends(userId!).then((friends) => {
          if (cancelled) return;
          const isFollowing = (friends || []).some((f: any) => f.friend_id === p.user_id);
          setIsFollowing(isFollowing);
          fSnapshot.isFollowing = isFollowing;
        }));
        promises.push(getUserPhotos(p.user_id).then((photos) => {
          if (cancelled) return;
          const f = (photos || []) as CommunityPhoto[];
          setUserPhotos(f);
          fSnapshot.photos = f;
        }));
      } else if (p.is_public) {
        promises.push(getUserPhotos(p.user_id).then((photos) => {
          if (cancelled) return;
          const f = (photos || []) as CommunityPhoto[];
          setUserPhotos(f);
          fSnapshot.photos = f;
        }));
      }

      if (p.is_expert) {
        getExpertRecommendationCount(p.user_id).then((c) => { if (!cancelled) setExpertRecCount(c); });
      }

      Promise.allSettled(promises).then(() => {
        if (cancelled) return;
        profileCache[cacheKey] = {
          profile: p,
          canView: fSnapshot.canView ?? false,
          followers: fSnapshot.followers ?? 0,
          following: fSnapshot.following ?? 0,
          isFollowing: fSnapshot.isFollowing ?? false,
          ratings: fSnapshot.ratings ?? [],
          photos: fSnapshot.photos ?? [],
          lists: fSnapshot.lists ?? [],
          wishlistItems: fSnapshot.wishlistItems ?? [],
          publicHomeMeals: fSnapshot.publicHomeMeals ?? [],
          ts: Date.now(),
        };
      });
    })();

    return () => { cancelled = true; };
  }, [username, userId]);

  const profileReels = useMemo(
    () => (profile?.user_id ? reels.filter((r) => r.authorId === profile.user_id) : []),
    [reels, profile?.user_id],
  );
  const profilePosts = useMemo(
    () => (profile?.user_id ? posts.filter((p) => p.userId === profile.user_id) : []),
    [posts, profile?.user_id],
  );

  const photosByRestaurant = useMemo(() => {
    const map: Record<string, CommunityPhoto[]> = {};
    userPhotos.forEach((p) => {
      if (!map[p.restaurant_id]) map[p.restaurant_id] = [];
      map[p.restaurant_id].push(p);
    });
    return map;
  }, [userPhotos]);

  const allCuisines = useMemo(() => {
    const set = new Set<string>();
    userRatings.forEach((r) => { if (r.cuisine) set.add(r.cuisine); });
    return Array.from(set).sort();
  }, [userRatings]);

  const allCities = useMemo(() => {
    const set = new Set<string>();
    userRatings.forEach((r) => {
      if (r.address) { const parts = r.address.split(',').map((s) => s.trim()); if (parts.length >= 2) set.add(parts[parts.length - 1]); }
    });
    return Array.from(set).sort();
  }, [userRatings]);

  // Top cuisines with counts — for the "Most rated" pills strip
  const topCuisines = useMemo(() => {
    const counts = new Map<string, number>();
    userRatings.forEach((r) => {
      if (!r.cuisine) return;
      counts.set(r.cuisine, (counts.get(r.cuisine) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [userRatings]);

  const activeFilterCount =
    (filterPrice ? 1 : 0) + (filterCity ? 1 : 0) +
    (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) +
    (sortBy !== 'recent' ? 1 : 0);

  const handleResetFilters = () => {
    setFilterPrice(null); setFilterCity(null);
    setScoreRange([0, 10]); setSortBy('recent');
  };

  const filteredRatings = useMemo(() => {
    let result = userRatings;
    if (filterCuisine) result = result.filter((r) => r.cuisine === filterCuisine);
    if (filterPrice) result = result.filter((r) => r.price === filterPrice);
    if (filterCity) result = result.filter((r) => r.address?.includes(filterCity));
    result = result.filter((r) => Number(r.score) >= scoreRange[0] && Number(r.score) <= scoreRange[1]);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) =>
        r.restaurant_name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q),
      );
    }
    if (sortBy === 'highest') result = [...result].sort((a, b) => Number(b.score) - Number(a.score));
    else if (sortBy === 'lowest') result = [...result].sort((a, b) => Number(a.score) - Number(b.score));
    else if (sortBy === 'az') result = [...result].sort((a, b) => a.restaurant_name.localeCompare(b.restaurant_name));
    return result;
  }, [userRatings, searchQuery, filterCuisine, filterPrice, filterCity, scoreRange, sortBy]);

  // Coordinate lookup — only runs when map is opened
  const [resolvedCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const coordsLookedUp = useRef(false);

  useEffect(() => {
    if (!showMapPage || !mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.99, 40.73],
      zoom: 3,
      accessToken: MAPBOX_TOKEN,
    });
    mapRef.current = map;

    map.on('load', async () => {
      const bounds = new mapboxgl.LngLatBounds();
      let hasMarkers = false;
      let activePopup: mapboxgl.Popup | null = null;

      for (const r of userRatings) {
        const lat = r.lat || resolvedCoords[r.restaurant_id]?.lat;
        const lng = r.lng || resolvedCoords[r.restaurant_id]?.lng;
        if (!lat || !lng) continue;

        const el = document.createElement('div');
        el.style.cssText = 'width:36px;height:36px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;';
        el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

        const cityState = (() => { const parts = (r.address || '').split(',').map(s => s.trim()); return parts.length >= 2 ? parts.slice(-2).join(', ').replace(/\d{5}.*/, '').trim().replace(/,\s*$/, '') : parts[0] || ''; })();
        const photoHtml = r.photo_url ? `<img src="${r.photo_url}" referrerpolicy="no-referrer" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />` : '';
        const scoreHtml = r.score ? `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="#9f3012" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span style="font-size:12px;font-weight:700;color:#9f3012;">${Number(r.score).toFixed(1)}</span>${r.price ? `<span style="color:#ccc;margin:0 2px;">·</span><span style="font-size:11px;color:#888;font-weight:600;">${r.price}</span>` : ''}</div>` : '';

        const rid = r.restaurant_id;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activePopup) activePopup.remove();
          const cbId = `mp_${Date.now()}`;
          (window as any)[cbId] = () => { navigate(`/restaurant/${rid}`); delete (window as any)[cbId]; };
          const popup = new mapboxgl.Popup({ offset: [0, -20], closeButton: true, closeOnClick: false, maxWidth: '220px', className: 'restaurant-popup' })
            .setLngLat([lng, lat])
            .setHTML(`<div style="font-family:inherit;padding:4px 0;cursor:pointer;" onclick="window.${cbId}()">${photoHtml}<div style="font-size:13px;font-weight:700;margin-bottom:2px;">${r.restaurant_name}</div><div style="font-size:10px;color:#9f3012;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">${r.cuisine}</div>${scoreHtml}<div style="font-size:11px;color:#999;">${cityState}</div></div>`)
            .addTo(map);
          popup.on('close', () => { activePopup = null; delete (window as any)[cbId]; });
          activePopup = popup;
        });

        new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
        bounds.extend([lng, lat]);
        hasMarkers = true;
      }

      if (hasMarkers) map.fitBounds(bounds, { padding: 50, maxZoom: 13 });

      if (!coordsLookedUp.current) {
        coordsLookedUp.current = true;
        const missing = userRatings.filter((r) => !r.lat && !r.lng && !resolvedCoords[r.restaurant_id]);
        for (const r of missing.slice(0, 15)) {
          try {
            const results = await searchPlacesByText(r.restaurant_name + ' ' + (r.address?.split(',').slice(-1)[0]?.trim() || ''), 0, 0);
            if (results[0]?.lat && results[0]?.lng) {
              const lt = results[0].lat, ln = results[0].lng;
              const el2 = document.createElement('div');
              el2.style.cssText = 'width:36px;height:36px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;';
              el2.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
              const rid2 = r.restaurant_id;
              el2.addEventListener('click', () => { navigate(`/restaurant/${rid2}`); });
              new mapboxgl.Marker({ element: el2, anchor: 'center' }).setLngLat([ln, lt]).addTo(map);
              publishCommunityRating(r.user_id, r.restaurant_id, {
                name: r.restaurant_name, score: Number(r.score), notes: r.notes, cuisine: r.cuisine,
                price: r.price, address: r.address, visitDate: r.visit_date, tags: r.tags,
                wouldReturn: r.would_return, friendIds: r.friend_ids || [],
                photoUrl: r.photo_url || '', lat: lt, lng: ln,
              });
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [showMapPage, userRatings, resolvedCoords, navigate]);

  const handleFollow = async () => {
    if (!userId || !profile) return;
    if (profile.is_public) {
      const ok = await followPublicAccount(userId, profile.user_id);
      if (ok) { setIsFollowing(true); setFollowers((f) => f + 1); }
    } else {
      const ok = await sendFriendRequest(userId, profile.user_id);
      if (ok) setFollowSent(true);
    }
  };

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortBtnRef.current && !sortBtnRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="sticky top-0 px-4 pt-safe-3 pb-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50"><ArrowLeft size={20} /></button>
          <h1 className="font-serif font-bold text-lg">User Not Found</h1>
        </header>
        <div className="text-center py-16">
          <UserCircle size={48} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm text-on-surface/40">This user doesn't exist</p>
        </div>
      </div>
    );
  }

  const isOwnProfile = userId === profile.user_id;
  const sortLabel: Record<SortBy, string> = {
    recent: 'Recent', highest: 'Highest rated', lowest: 'Lowest rated', az: 'A → Z',
  };

  const tabs: { key: ViewTab; label: string; count: number }[] = [
    { key: 'restaurants', label: 'Restaurants', count: userRatings.length },
    { key: 'recipes',     label: 'Recipes',     count: publicHomeMeals.length },
    { key: 'posts',       label: 'Posts',       count: profilePosts.length },
    { key: 'reels',       label: 'Reels',       count: profileReels.length },
    { key: 'guides',      label: 'Guides',      count: 0 },
  ];

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="max-w-[1280px] mx-auto px-4 md:px-9 pt-6 md:pt-7">

        {/* TOP NAV STRIP */}
        <div className="flex items-center justify-between gap-3 pb-5">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-[var(--color-ink-2)] px-3 py-2 -ml-1.5 rounded-full hover:bg-[rgba(31,26,23,0.06)] hover:text-on-surface transition-colors"
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--color-ink-2)] hover:bg-[rgba(31,26,23,0.06)] hover:text-on-surface transition-colors"
              title="Share profile"
            >
              <Share2 size={18} />
            </button>
            <button
              type="button"
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--color-ink-2)] hover:bg-[rgba(31,26,23,0.06)] hover:text-on-surface transition-colors"
              title="More"
            >
              <MoreHorizontal size={19} />
            </button>
          </div>
        </div>

        {/* HERO */}
        <section className="grid md:grid-cols-[156px_1fr_auto] gap-6 md:gap-8 items-start pb-7 border-b border-[var(--color-line)]">
          <div className="justify-self-center md:justify-self-start relative w-24 h-24 md:w-[156px] md:h-[156px] rounded-full bg-gradient-to-br from-primary/15 to-[#E8C8B5] grid place-items-center font-serif font-semibold text-5xl md:text-[78px] text-primary tracking-[-0.04em] border border-primary/15 shadow-sm">
            {profile.display_name.charAt(0).toUpperCase()}
            <span className="absolute inset-1.5 rounded-full border border-white/50 pointer-events-none" />
          </div>

          <div className="flex flex-col pt-1 md:pt-2.5 min-w-0 text-center md:text-left">
            <h1 className="font-serif text-[28px] md:text-[38px] font-semibold leading-[1.05] tracking-[-0.02em] text-on-surface mb-1">
              {profile.display_name}
            </h1>
            <div className="flex items-center gap-2.5 text-sm text-[var(--color-ink-3)] mb-3.5 justify-center md:justify-start flex-wrap">
              <span className="font-medium">@{profile.username}</span>
              {profile.is_expert && (
                <>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-ink-4)]" />
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200/60 text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    <Star size={10} className="fill-amber-500 text-amber-500" /> Expert
                  </span>
                </>
              )}
              {!profile.is_public && !profile.is_expert && (
                <>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-ink-4)]" />
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-ink-4)]">
                    <Lock size={11} /> Private
                  </span>
                </>
              )}
            </div>
            {profile.bio && canView && (
              <p className="font-sans text-[15px] leading-relaxed text-[var(--color-ink-2)] max-w-xl mb-4 text-pretty">
                {profile.bio}
              </p>
            )}
            {profile.home_city && (
              <div className="flex items-center gap-4 text-[13px] text-[var(--color-ink-3)] justify-center md:justify-start flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} /> {profile.home_city}
                </span>
              </div>
            )}
            {profile.is_expert && expertRecCount > 0 && (
              <div className="flex items-center gap-1.5 mt-3 text-[12px] font-semibold text-amber-700 justify-center md:justify-start">
                <Star size={12} className="fill-amber-500 text-amber-500" />
                {expertRecCount} expert pick{expertRecCount === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {userId && !isOwnProfile && (
            <div className="flex flex-col gap-2 pt-2 md:pt-3.5 min-w-0 md:min-w-[160px] justify-self-center md:justify-self-end">
              <div className="flex gap-2">
                {isFollowing ? (
                  <button className="h-10 px-5 rounded-full bg-[var(--color-paper)] text-on-surface border border-[var(--color-line-2)] text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-primary/5 hover:border-primary hover:text-primary transition-colors flex-1 md:flex-none">
                    <Check size={14} /> Following
                  </button>
                ) : followSent ? (
                  <button disabled className="h-10 px-5 rounded-full bg-on-surface/[0.06] text-[var(--color-ink-3)] text-[13.5px] font-semibold flex-1 md:flex-none">
                    Request Sent
                  </button>
                ) : (
                  <button
                    onClick={handleFollow}
                    className="h-10 px-6 rounded-full bg-on-surface text-surface text-[13.5px] font-semibold hover:bg-primary hover:-translate-y-px transition-all flex-1 md:flex-none"
                  >
                    {profile.is_public ? 'Follow' : 'Send Request'}
                  </button>
                )}
                <button
                  type="button"
                  title="Message"
                  className="w-10 h-10 rounded-full bg-[var(--color-paper)] border border-[var(--color-line-2)] grid place-items-center text-on-surface hover:bg-on-surface/[0.04] hover:border-[var(--color-ink-2)] transition-colors flex-shrink-0"
                >
                  <Send size={17} />
                </button>
                <button
                  type="button"
                  title="Share"
                  className="w-10 h-10 rounded-full bg-[var(--color-paper)] border border-[var(--color-line-2)] grid place-items-center text-on-surface hover:bg-on-surface/[0.04] hover:border-[var(--color-ink-2)] transition-colors flex-shrink-0"
                >
                  <Share2 size={17} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* STATS STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 border-b border-[var(--color-line)]">
          {[
            { n: userRatings.length, l: 'Ratings' },
            { n: publicHomeMeals.length, l: 'Recipes Cooked' },
            { n: followers, l: 'Followers' },
            { n: following, l: 'Following' },
          ].map((it) => (
            <div key={it.l} className="py-5 md:py-6 flex flex-col gap-1 items-center md:items-center text-center hover:bg-[rgba(31,26,23,0.025)] transition-colors rounded">
              <span className="font-serif text-[26px] md:text-[30px] font-semibold leading-none text-on-surface tracking-[-0.02em] tabular-nums">{it.n}</span>
              <span className="text-[11.5px] md:text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ink-3)]">{it.l}</span>
            </div>
          ))}
        </div>

        {/* CUISINE STRIP — "Most rated" */}
        {topCuisines.length > 0 && (
          <div className="flex items-center gap-3.5 py-4 border-b border-[var(--color-line)] overflow-x-auto scrollbar-hide">
            <span className="text-[11.5px] font-bold tracking-[0.1em] uppercase text-[var(--color-ink-3)] flex-shrink-0">
              Most rated
            </span>
            {topCuisines.map((c) => (
              <button
                key={c.name}
                onClick={() => { setViewTab('restaurants'); setFilterCuisine(filterCuisine === c.name ? null : c.name); }}
                className={cn(
                  'inline-flex items-baseline gap-2 px-3.5 py-1.5 rounded-full text-[13.5px] font-medium flex-shrink-0 transition-colors border',
                  filterCuisine === c.name
                    ? 'bg-on-surface text-surface border-on-surface'
                    : 'bg-[var(--color-paper)] border-[var(--color-line)] text-on-surface hover:border-[var(--color-line-2)]',
                )}
              >
                {c.name}
                <span className={cn('text-[12px] font-semibold', filterCuisine === c.name ? 'text-surface/70' : 'text-[var(--color-ink-3)]')}>{c.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* TAB BAR */}
        <div className="flex items-end gap-5 md:gap-7 pt-5 border-b border-[var(--color-line)] mb-5 sticky top-0 bg-surface z-10 overflow-x-auto scrollbar-hide">
          {tabs.map((t) => {
            const active = viewTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setViewTab(t.key)}
                className={cn(
                  'inline-flex items-center gap-2 pb-3.5 text-[14.5px] font-semibold transition-colors relative flex-shrink-0',
                  active ? 'text-on-surface' : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]',
                )}
              >
                {t.label}
                <span className={cn(
                  'text-[12px] font-semibold px-1.5 py-0.5 rounded-full',
                  active ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.06] text-[var(--color-ink-2)]',
                )}>
                  {t.count}
                </span>
                {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-t" />}
              </button>
            );
          })}
          <span className="flex-1" />
          {userRatings.length > 0 && (viewTab === 'restaurants') && (
            <button
              onClick={() => setShowMapPage(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 mb-2 rounded-full bg-[var(--color-paper)] border border-[var(--color-line)] text-[12.5px] font-semibold text-[var(--color-ink-2)] hover:border-[var(--color-ink-2)] hover:text-on-surface transition-colors flex-shrink-0"
            >
              <MapIcon size={14} /> Open map view
            </button>
          )}
        </div>

        {/* TAB CONTENT */}
        {canView ? (
          <>
            {viewTab === 'restaurants' && (
              <>
                {/* Filter bar */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2.5 mb-2">
                  <div className="relative flex items-center">
                    <Search size={16} className="absolute left-4 text-[var(--color-ink-3)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search restaurants, neighborhoods..."
                      className="w-full h-10 pl-10 pr-10 rounded-full bg-[var(--color-paper)] border border-[var(--color-line)] focus:border-[var(--color-ink-2)] focus:outline-none focus:ring-4 focus:ring-[rgba(31,26,23,0.04)] text-sm font-medium text-on-surface placeholder:text-[var(--color-ink-3)] transition-colors"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute right-3.5 text-[var(--color-ink-3)] hover:text-on-surface" title="Clear">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Sort dropdown */}
                  <div className="relative" ref={sortBtnRef}>
                    <button
                      type="button"
                      onClick={() => setSortOpen((o) => !o)}
                      className="h-10 px-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-paper)] border border-[var(--color-line)] text-[13.5px] font-medium text-on-surface hover:border-[var(--color-line-2)] whitespace-nowrap"
                    >
                      <span className="text-[var(--color-ink-3)]">Sort:</span>
                      {sortLabel[sortBy]}
                      <ChevronDown size={14} className={cn('text-[var(--color-ink-3)] transition-transform', sortOpen && 'rotate-180')} />
                    </button>
                    {sortOpen && (
                      <div className="absolute top-[calc(100%+6px)] right-0 z-20 min-w-[180px] py-1 rounded-2xl bg-[var(--color-paper)] border border-[var(--color-line)] shadow-lg">
                        {(['recent', 'highest', 'lowest', 'az'] as SortBy[]).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setSortBy(s); setSortOpen(false); }}
                            className={cn(
                              'w-full text-left px-3.5 py-2 text-[13px] font-medium hover:bg-on-surface/[0.04] transition-colors',
                              sortBy === s ? 'text-primary' : 'text-on-surface',
                            )}
                          >
                            {sortLabel[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Filter button */}
                  <button
                    onClick={() => setFiltersOpen(true)}
                    className={cn(
                      'h-10 px-4 rounded-full inline-flex items-center gap-2 text-[13.5px] font-medium transition-colors whitespace-nowrap',
                      activeFilterCount > 0
                        ? 'bg-on-surface text-surface border border-on-surface'
                        : 'bg-[var(--color-paper)] border border-[var(--color-line)] text-on-surface hover:border-[var(--color-line-2)]',
                    )}
                  >
                    <SlidersHorizontal size={14} /> Filter
                    {activeFilterCount > 0 && (
                      <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10.5px] font-bold grid place-items-center">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* Cuisine chips */}
                {allCuisines.length > 0 && (
                  <div className="flex gap-1.5 pt-3 pb-4 overflow-x-auto scrollbar-hide">
                    <button
                      onClick={() => setFilterCuisine(null)}
                      className={cn(
                        'h-[30px] px-3.5 rounded-full text-[12.5px] font-medium border flex-shrink-0 transition-colors',
                        !filterCuisine
                          ? 'bg-on-surface text-surface border-on-surface'
                          : 'bg-transparent border-[var(--color-line-2)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]',
                      )}
                    >
                      All cuisines
                    </button>
                    {allCuisines.map((c) => (
                      <button
                        key={c}
                        onClick={() => setFilterCuisine(filterCuisine === c ? null : c)}
                        className={cn(
                          'h-[30px] px-3.5 rounded-full text-[12.5px] font-medium border flex-shrink-0 transition-colors',
                          filterCuisine === c
                            ? 'bg-on-surface text-surface border-on-surface'
                            : 'bg-transparent border-[var(--color-line-2)] text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]',
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Count header */}
                <div className="flex items-baseline justify-between px-1 pb-3">
                  <span className="text-[11.5px] font-bold tracking-[0.12em] uppercase text-[var(--color-ink-3)]">
                    <strong className="text-[var(--color-ink-2)] font-bold">{filteredRatings.length}</strong>{' '}
                    {filterCuisine ? `${filterCuisine} · ` : ''}{filteredRatings.length === 1 ? 'restaurant' : 'restaurants'} rated
                  </span>
                </div>

                {/* Restaurant list */}
                <ul className="flex flex-col border-t border-[var(--color-line)]">
                  {filteredRatings.length === 0 ? (
                    <li className="text-center py-16">
                      <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">No restaurants match</div>
                      <div className="text-[13.5px] text-[var(--color-ink-3)]">Try a different cuisine or clear your search.</div>
                    </li>
                  ) : (
                    filteredRatings.map((r) => (
                      <ProfileRestaurantRow
                        key={r.id}
                        rating={r}
                        photos={photosByRestaurant[r.restaurant_id] || []}
                        expanded={expandedId === r.id}
                        onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      />
                    ))
                  )}
                </ul>
              </>
            )}

            {viewTab === 'recipes' && (
              <>
                <div className="px-1 pt-2 pb-3">
                  <span className="text-[11.5px] font-bold tracking-[0.12em] uppercase text-[var(--color-ink-3)]">
                    <strong className="text-[var(--color-ink-2)] font-bold">{publicHomeMeals.length}</strong>{' '}
                    {publicHomeMeals.length === 1 ? 'recipe' : 'recipes'} cooked & rated
                  </span>
                </div>
                {publicHomeMeals.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">No recipes yet</div>
                    <div className="text-[13.5px] text-[var(--color-ink-3)]">When this user shares a meal, it'll show up here.</div>
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {publicHomeMeals.map((meal, i) => (
                      <ProfileRecipeRow key={meal.id} meal={meal} idx={i} userId={profile.user_id} />
                    ))}
                  </ul>
                )}
              </>
            )}

            {viewTab === 'posts' && (
              <>
                <div className="px-1 pt-2 pb-4">
                  <span className="text-[11.5px] font-bold tracking-[0.12em] uppercase text-[var(--color-ink-3)]">
                    <strong className="text-[var(--color-ink-2)] font-bold">{profilePosts.length}</strong>{' '}
                    {profilePosts.length === 1 ? 'post' : 'posts'}
                  </span>
                </div>
                {profilePosts.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">No posts yet</div>
                    <div className="text-[13.5px] text-[var(--color-ink-3)]">When this user shares a post, it'll show up here.</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    {profilePosts.map((p) => (
                      <ProfilePostCard key={p.id} post={p} />
                    ))}
                  </div>
                )}
              </>
            )}

            {viewTab === 'reels' && (
              <>
                <div className="px-1 pt-2 pb-4">
                  <span className="text-[11.5px] font-bold tracking-[0.12em] uppercase text-[var(--color-ink-3)]">
                    <strong className="text-[var(--color-ink-2)] font-bold">{profileReels.length}</strong>{' '}
                    {profileReels.length === 1 ? 'reel' : 'reels'}
                  </span>
                </div>
                {profileReels.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">No reels yet</div>
                    <div className="text-[13.5px] text-[var(--color-ink-3)]">When this user posts a reel, it'll show up here.</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {profileReels.map((r) => (
                      <ProfileReelCard key={r.id} reel={r} />
                    ))}
                  </div>
                )}
              </>
            )}

            {viewTab === 'guides' && (
              <div className="text-center py-20">
                <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">Guides coming soon</div>
                <div className="text-[13.5px] text-[var(--color-ink-3)]">
                  {profile.display_name} hasn't published any public guides yet.
                </div>
              </div>
            )}
          </>
        ) : (
          <section className="text-center py-20">
            <Lock size={32} className="mx-auto text-[var(--color-ink-4)] mb-3" />
            <p className="text-sm font-medium text-[var(--color-ink-3)]">This account is private</p>
            <p className="text-xs text-[var(--color-ink-4)] mt-1">Follow this user to see their profile</p>
          </section>
        )}
      </div>

      {/* Filters sheet — Spotlight popup on desktop, bottom sheet on phone */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: phoneMode ? 0.18 : 0.16 }}
            className={cn(
              'fixed inset-0 z-50',
              phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
              !phoneMode && 'flex items-start justify-center pt-[10vh] px-4',
            )}
            onClick={() => setFiltersOpen(false)}
          >
            <motion.div
              {...(phoneMode
                ? {
                    initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                    transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                    ...filtersDragProps,
                  }
                : {
                    initial: { opacity: 0, scale: 0.94, y: -12 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.96, y: -8 },
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                  })}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={cn(
                'flex flex-col overflow-hidden bg-surface',
                phoneMode
                  ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[92vh]'
                  : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
              )}
            >
              {phoneMode && (
                <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              )}
              <div className={cn(
                'flex items-center justify-between flex-shrink-0',
                phoneMode ? 'px-5 pt-3 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
              )}>
                <h3 className={cn('font-serif font-bold', phoneMode ? 'text-lg' : 'text-[20px]')}>Filters</h3>
                <button onClick={() => setFiltersOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"><X size={16} className="text-on-surface/60" /></button>
              </div>
              {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Score range */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Score: {scoreRange[0]} – {scoreRange[1]}</p>
                  <div className="relative h-6 flex items-center">
                    <div className="absolute inset-x-0 h-1 bg-on-surface/10 rounded-full" />
                    <div className="absolute h-1 bg-primary rounded-full" style={{ left: `${scoreRange[0] * 10}%`, right: `${100 - scoreRange[1] * 10}%` }} />
                    <input type="range" min={0} max={10} step={1} value={scoreRange[0]}
                      onChange={(e) => setScoreRange([Math.min(+e.target.value, scoreRange[1]), scoreRange[1]])}
                      className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer" />
                    <input type="range" min={0} max={10} step={1} value={scoreRange[1]}
                      onChange={(e) => setScoreRange([scoreRange[0], Math.max(+e.target.value, scoreRange[0])])}
                      className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer" />
                  </div>
                  <div className="flex justify-between mt-1"><span className="text-[10px] text-on-surface/30">0</span><span className="text-[10px] text-on-surface/30">10</span></div>
                </div>

                {/* Price */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Price</p>
                  <div className="flex gap-2">
                    {['$', '$$', '$$$', '$$$$'].map((p) => (
                      <button key={p} onClick={() => setFilterPrice(filterPrice === p ? null : p)}
                        className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2",
                          filterPrice === p ? "border-primary bg-primary/5 text-primary" : "border-on-surface/10 text-on-surface/50")}>{p}</button>
                    ))}
                  </div>
                </div>

                {/* Cuisine — collapsible */}
                <div>
                  <button onClick={() => setCuisineOpen(!cuisineOpen)} className="flex items-center justify-between w-full mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Cuisine {filterCuisine && <span className="text-primary ml-1">{filterCuisine}</span>}</p>
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cuisineOpen && "rotate-180")} />
                  </button>
                  {cuisineOpen && (
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                      {allCuisines.map((c) => (
                        <button key={c} onClick={() => setFilterCuisine(filterCuisine === c ? null : c)}
                          className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                            filterCuisine === c ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>{c}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* City — collapsible */}
                <div>
                  <button onClick={() => setCityOpen(!cityOpen)} className="flex items-center justify-between w-full mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">City / Location {filterCity && <span className="text-primary ml-1">{filterCity}</span>}</p>
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cityOpen && "rotate-180")} />
                  </button>
                  {cityOpen && (
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                      {allCities.map((c) => (
                        <button key={c} onClick={() => setFilterCity(filterCity === c ? null : c)}
                          className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                            filterCity === c ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>{c}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 border-t border-on-surface/[0.06] px-5 py-4 flex gap-3">
                <button onClick={() => { handleResetFilters(); setFiltersOpen(false); }}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/[0.04] transition-colors">Reset</button>
                <button onClick={() => setFiltersOpen(false)}
                  className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all">Apply</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen map page */}
      <AnimatePresence>
        {showMapPage && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-40 bg-surface flex flex-col">
            <header className="sticky top-0 px-4 pt-safe-3 pb-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
              <button onClick={() => setShowMapPage(false)}
                className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface"><ArrowLeft size={20} /></button>
              <h1 className="font-serif font-bold text-lg">{profile.display_name}'s Map</h1>
            </header>
            <div ref={mapContainerRef} className="flex-1" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
