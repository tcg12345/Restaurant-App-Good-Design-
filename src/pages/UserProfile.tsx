import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Lock, UserCircle, Loader2, UserPlus, Check, Star, MapPin, Camera, Users, ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon, ChefHat, UtensilsCrossed, Crown, Heart, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ScoreBadge } from '../components/ScoreBadge';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { useSettings } from '../contexts/SettingsContext';
import { ProfileReelsSection, ProfilePostsSection } from '../components/ProfileReelsSection';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriends,
  sendFriendRequest, followPublicAccount, getUserRatings, getUserPhotos, getUserLists,
  getUserWishlist, publishCommunityRating, getUserPublicHomeMeals, getExpertRecommendationCount,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import type { HomeMeal } from '../contexts/ListsContext';
import { getMealCoverUrl, formatDuration } from '../lib/recipe-display';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { searchPlacesByText, type PlaceResult } from '../lib/places';

// Simple in-memory cache to avoid re-fetching on back navigation
const profileCache: Record<string, {
  profile: UserProfileType; canView: boolean; followers: number; following: number;
  isFollowing: boolean; ratings: CommunityRating[]; photos: CommunityPhoto[];
  lists: { id: string; name: string; emoji: string; restaurantIds: string[] }[];
  wishlistItems: { restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[];
  publicHomeMeals: HomeMeal[];
  ts: number;
}> = {};

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ratings: myRatings } = useLists();
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

  // Content
  const [userRatings, setUserRatings] = useState<CommunityRating[]>([]);
  const [userPhotos, setUserPhotos] = useState<CommunityPhoto[]>([]);
  const [publicHomeMeals, setPublicHomeMeals] = useState<HomeMeal[]>([]);
  const [userLists, setUserLists] = useState<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]>([]);
  const [userWishlistItems, setUserWishlistItems] = useState<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]>([]);

  // Expert recommendation count
  const [expertRecCount, setExpertRecCount] = useState(0);

  // Expanded review
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Which content tab is active under this user's profile —
  // restaurants (rated places + wishlist) vs. recipes (their public
  // home meals). Defaults to restaurants since that's the primary
  // surface for most users.
  const [viewTab, setViewTab] = useState<'restaurants' | 'recipes'>('restaurants');

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [filterCuisine, setFilterCuisine] = useState<string | null>(null);
  const [filterPrice, setFilterPrice] = useState<string | null>(null);
  const [filterCity, setFilterCity] = useState<string | null>(null);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest'>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [showMapPage, setShowMapPage] = useState(false);

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;

    // Check cache first (valid for 60 seconds)
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
      // Drop the spinner the moment we have the profile. Every secondary
      // query (ratings, photos, lists, etc.) backfills its own state and
      // each section already handles "no data yet" gracefully.
      setLoading(false);
      if (!p) return;

      const isAuthed = !!userId;

      // Fire every secondary query in parallel and wire each result to
      // its own setter as soon as it lands — no global await Promise.all.
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

      // Expert pick count is rare — fire-and-forget so it never blocks.
      if (p.is_expert) {
        getExpertRecommendationCount(p.user_id).then((c) => { if (!cancelled) setExpertRecCount(c); });
      }

      // Cache once everything settles.
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

  // Shared restaurants
  // Reels and posts by this profile owner. RLS already filters out
  // followers-only entries the viewer can't see, so we just match by id.
  const profileReels = useMemo(
    () => (profile?.user_id ? reels.filter((r) => r.authorId === profile.user_id) : []),
    [reels, profile?.user_id],
  );
  const profilePosts = useMemo(
    () => (profile?.user_id ? posts.filter((p) => p.userId === profile.user_id) : []),
    [posts, profile?.user_id],
  );

  const sharedRestaurants = useMemo(() => {
    if (!canView || !userId || !profile) return [];
    const theyTaggedMe = userRatings.filter((r) => (r.friend_ids || []).includes(userId));
    const iTaggedThem = myRatings.filter((r) => (r.friendIds || []).includes(profile.user_id));
    const seen = new Set<string>();
    const result: CommunityRating[] = [];
    theyTaggedMe.forEach((r) => { if (!seen.has(r.restaurant_id)) { seen.add(r.restaurant_id); result.push(r); } });
    iTaggedThem.forEach((r) => {
      if (!seen.has(r.restaurantId)) {
        seen.add(r.restaurantId);
        result.push({ id: '', user_id: userId, restaurant_id: r.restaurantId, restaurant_name: r.name, score: r.score as any, notes: r.notes, cuisine: r.cuisine, price: r.price, address: r.address, visit_date: r.visitDate, tags: r.tags, would_return: r.wouldReturn, friend_ids: r.friendIds || [], created_at: '' });
      }
    });
    return result;
  }, [userRatings, myRatings, canView, userId, profile]);

  // Photos grouped by restaurant
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

  const activeFilterCount = (filterCuisine ? 1 : 0) + (filterPrice ? 1 : 0) + (filterCity ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0);

  const handleResetFilters = () => {
    setFilterCuisine(null); setFilterPrice(null); setFilterCity(null);
    setScoreRange([0, 10]); setSortBy('recent');
  };

  // Selected list's restaurant IDs
  const selectedListRestaurantIds = useMemo(() => {
    if (!selectedListId) return null;
    const list = userLists.find((l) => l.id === selectedListId);
    return list ? new Set(list.restaurantIds) : null;
  }, [selectedListId, userLists]);

  // When wishlist is selected, show wishlist items; otherwise filter ratings
  const isWishlistSelected = selectedListId === '__wishlist__';

  const filteredRatings = useMemo(() => {
    if (isWishlistSelected) return []; // handled separately
    let result = userRatings;
    if (selectedListRestaurantIds) result = result.filter((r) => selectedListRestaurantIds.has(r.restaurant_id));
    if (filterCuisine) result = result.filter((r) => r.cuisine === filterCuisine);
    if (filterPrice) result = result.filter((r) => r.price === filterPrice);
    if (filterCity) result = result.filter((r) => r.address?.includes(filterCity));
    result = result.filter((r) => Number(r.score) >= scoreRange[0] && Number(r.score) <= scoreRange[1]);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.restaurant_name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    if (sortBy === 'highest') result = [...result].sort((a, b) => Number(b.score) - Number(a.score));
    else if (sortBy === 'lowest') result = [...result].sort((a, b) => Number(a.score) - Number(b.score));
    return result;
  }, [userRatings, searchQuery, selectedListRestaurantIds, filterCuisine, filterPrice, filterCity, scoreRange, sortBy, isWishlistSelected]);

  const filteredWishlist = useMemo(() => {
    if (!isWishlistSelected) return [];
    let result = userWishlistItems;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) => w.name.toLowerCase().includes(q) || w.cuisine.toLowerCase().includes(q) || w.address.toLowerCase().includes(q));
    }
    return result;
  }, [userWishlistItems, searchQuery, isWishlistSelected]);

  // Coordinate lookup — only runs when map is opened
  const [resolvedCoords, setResolvedCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const coordsLookedUp = useRef(false);

  // Init map
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

      // First: add all markers that already have coordinates (instant)
      for (const r of userRatings) {
        const lat = r.lat || resolvedCoords[r.restaurant_id]?.lat;
        const lng = r.lng || resolvedCoords[r.restaurant_id]?.lng;
        if (!lat || !lng) continue;

        // Create marker element
        const el = document.createElement('div');
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.borderRadius = '50%';
        el.style.background = 'white';
        el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.cursor = 'pointer';
        el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

        // Popup content
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

      // Background: look up missing coordinates and add markers as they resolve
      if (!coordsLookedUp.current) {
        coordsLookedUp.current = true;
        const missing = userRatings.filter((r) => !r.lat && !r.lng && !resolvedCoords[r.restaurant_id]);
        for (const r of missing.slice(0, 15)) {
          try {
            const results = await searchPlacesByText(r.restaurant_name + ' ' + (r.address?.split(',').slice(-1)[0]?.trim() || ''), 0, 0);
            if (results[0]?.lat && results[0]?.lng) {
              const lt = results[0].lat, ln = results[0].lng;
              // Add marker to map
              const el2 = document.createElement('div');
              el2.style.cssText = 'width:36px;height:36px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;';
              el2.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
              const rid2 = r.restaurant_id;
              el2.addEventListener('click', () => { navigate(`/restaurant/${rid2}`); });
              new mapboxgl.Marker({ element: el2, anchor: 'center' }).setLngLat([ln, lt]).addTo(map);
              // Save coords to DB
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

  const selectedListName = selectedListId ? userLists.find((l) => l.id === selectedListId)?.name : null;

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
        <header className="sticky top-0 px-4 py-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
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

  return (
    <div className="min-h-screen bg-surface pb-32">
      <header className="sticky top-0 px-4 py-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50"><ArrowLeft size={20} /></button>
        <h1 className="font-serif font-bold text-lg">@{profile.username}</h1>
      </header>

      <div className="px-3">
        {/* Profile header */}
        <section className="flex flex-col items-center mb-5 pt-2">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <span className="text-3xl font-serif font-bold text-primary">{profile.display_name.charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-serif font-bold">{profile.display_name}</h2>
            {profile.is_expert && <Crown size={18} className="text-amber-500" />}
          </div>
          <p className="text-sm text-on-surface/40">@{profile.username}</p>
          {profile.is_expert && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/60 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              <Star size={10} className="fill-amber-500 text-amber-500" /> Verified Expert
            </span>
          )}
          {!profile.is_public && !profile.is_expert && (
            <div className="flex items-center gap-1 mt-1 text-on-surface/30">
              <Lock size={11} /><span className="text-[10px] font-medium">Private Account</span>
            </div>
          )}
          {profile.bio && canView && <p className="text-xs text-on-surface/50 text-center mt-2 max-w-[250px] leading-relaxed">{profile.bio}</p>}

          {/* Open stats row — large numbers, card-less */}
          <div className="flex items-start gap-7 mt-4">
            <div className="text-center">
              <p className="text-[28px] font-serif font-bold text-on-surface leading-none tabular-nums">{followers}</p>
              <p className="text-[12px] font-medium text-on-surface/45 mt-1.5">Followers</p>
            </div>
            <div className="text-center">
              <p className="text-[28px] font-serif font-bold text-on-surface leading-none tabular-nums">{following}</p>
              <p className="text-[12px] font-medium text-on-surface/45 mt-1.5">Following</p>
            </div>
            {canView && userRatings.length > 0 && (
              <div className="text-center">
                <p className="text-[28px] font-serif font-bold text-on-surface leading-none tabular-nums">{userRatings.length}</p>
                <p className="text-[12px] font-medium text-on-surface/45 mt-1.5">Ratings</p>
              </div>
            )}
            {profile.is_expert && expertRecCount > 0 && (
              <div className="text-center">
                <p className="text-[28px] font-serif font-bold text-amber-600 leading-none tabular-nums">{expertRecCount}</p>
                <p className="text-[12px] font-medium text-amber-500/70 mt-1.5">Picks</p>
              </div>
            )}
          </div>

          {userId && userId !== profile.user_id && (
            <div className="mt-3">
              {isFollowing ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-on-surface/[0.06] text-xs font-semibold text-on-surface/55">
                  <Check size={13} /> Following
                </span>
              ) : followSent ? (
                <span className="px-4 py-2 rounded-full bg-on-surface/[0.06] text-xs font-semibold text-on-surface/55">Request Sent</span>
              ) : (
                <button onClick={handleFollow} className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary text-white text-xs font-semibold">
                  <UserPlus size={13} /> {profile.is_public ? 'Follow' : 'Send Request'}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Content */}
        {canView ? (
          <>
            {/* Shared restaurants — In Common */}
            {sharedRestaurants.length > 0 && (
              <section className="mb-5 -mx-3">
                <div className="flex items-center gap-2 mb-2.5 px-3">
                  <Users size={14} className="text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">In Common ({sharedRestaurants.length})</h3>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-2 px-3 scrollbar-hide snap-x snap-mandatory">
                  {sharedRestaurants.slice(0, 10).map((r) => {
                    const photo = (photosByRestaurant[r.restaurant_id] || [])[0]?.url;
                    return (
                      <Link key={r.id || r.restaurant_id} to={`/restaurant/${r.restaurant_id}`} className="flex-shrink-0 w-32 snap-start group">
                        <div className="relative aspect-square rounded-2xl overflow-hidden bg-on-surface/[0.05]">
                          {photo ? (
                            <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-on-surface/15 font-serif text-4xl font-bold">{r.restaurant_name.charAt(0)}</div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
                          <div className="absolute inset-x-0 bottom-0 p-2.5">
                            <p className="text-white text-[12px] font-bold leading-tight drop-shadow-sm line-clamp-2">{r.restaurant_name}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Star size={9} className="fill-white text-white" />
                              <span className="text-white/95 text-[10px] font-semibold tabular-nums">{Number(r.score).toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Posts + reels by this user — read-only grids. RLS already
                filters out followers-only items the viewer can't see. */}
            {profilePosts.length > 0 && (
              <div className="mb-5">
                <ProfilePostsSection posts={profilePosts} />
              </div>
            )}
            {profileReels.length > 0 && (
              <div className="mb-5">
                <ProfileReelsSection reels={profileReels} />
              </div>
            )}

            {/* Tab switcher — Restaurants vs Recipes. Mirrors the
                "see what they've rated / what they've cooked" split
                so each surface has its own filter + list rather than
                stacking them on a long scroll. Counts shown so the
                user can tell which tab has anything in it. */}
            <div className="flex gap-1 mb-4 p-1 rounded-full bg-on-surface/[0.05]">
              {([
                { value: 'restaurants', label: 'Restaurants', count: userRatings.length },
                { value: 'recipes', label: 'Recipes', count: publicHomeMeals.length },
              ] as const).map((opt) => {
                const active = viewTab === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setViewTab(opt.value)}
                    className={cn(
                      'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-[13px] font-bold transition-colors',
                      active
                        ? 'bg-on-surface text-surface shadow-sm'
                        : 'text-on-surface/60 hover:text-on-surface',
                    )}
                  >
                    {opt.label}
                    <span className={cn(
                      'text-[11px] tabular-nums font-semibold',
                      active ? 'text-surface/65' : 'text-on-surface/35',
                    )}>
                      {opt.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {viewTab === 'restaurants' && (
              <>
            {/* Search bar + filters button */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/25" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search restaurants..."
                  className="w-full bg-on-surface/[0.04] rounded-full py-2 pl-9 pr-9 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06] transition-colors" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30"><X size={14} /></button>}
              </div>
              <button onClick={() => setFiltersOpen(true)}
                className={cn("px-3.5 rounded-full flex items-center gap-1.5 flex-shrink-0 transition-colors",
                  activeFilterCount > 0 ? "bg-primary/10 text-primary" : "bg-on-surface/[0.04] text-on-surface/40 hover:bg-on-surface/[0.06]")}>
                <SlidersHorizontal size={14} />
                {activeFilterCount > 0 && <span className="w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{activeFilterCount}</span>}
              </button>
            </div>

            {/* List dropdown */}
            {userLists.length > 0 && (
              <div className="relative mb-3">
                <button onClick={() => setListDropdownOpen(!listDropdownOpen)}
                  className={cn("flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all w-full justify-between",
                    selectedListId ? "bg-primary/10 text-primary" : "bg-on-surface/[0.04] text-on-surface/50 hover:bg-on-surface/[0.06]")}>
                  <span>{selectedListName ? `${userLists.find(l => l.id === selectedListId)?.emoji} ${selectedListName}` : 'All Restaurants'}</span>
                  <div className="flex items-center gap-1">
                    {selectedListId && <span onClick={(e) => { e.stopPropagation(); setSelectedListId(null); setListDropdownOpen(false); }}><X size={12} /></span>}
                    <ChevronDown size={12} className={cn("transition-transform", listDropdownOpen && "rotate-180")} />
                  </div>
                </button>
                {listDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setListDropdownOpen(false)} />
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface rounded-2xl shadow-xl shadow-on-surface/10 z-40 max-h-48 overflow-y-auto py-1">
                      <button onClick={() => { setSelectedListId(null); setListDropdownOpen(false); }}
                        className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 transition-colors",
                          !selectedListId ? "text-primary bg-primary/5" : "text-on-surface/70")}>
                        All Restaurants
                      </button>
                      {userLists.map((list) => (
                        <button key={list.id} onClick={() => { setSelectedListId(list.id); setListDropdownOpen(false); }}
                          className={cn("w-full text-left px-3.5 py-2.5 text-xs font-medium hover:bg-on-surface/5 transition-colors flex items-center gap-2",
                            selectedListId === list.id ? "text-primary bg-primary/5" : "text-on-surface/70")}>
                          <span>{list.emoji}</span>
                          <span className="flex-1">{list.name}</span>
                          <span className="text-[10px] text-on-surface/30">{list.restaurantIds.length}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Active filters */}
            {activeFilterCount > 0 && (
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {filterCuisine && <button onClick={() => setFilterCuisine(null)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{filterCuisine} <X size={10} /></button>}
                {filterPrice && <button onClick={() => setFilterPrice(null)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{filterPrice} <X size={10} /></button>}
                {filterCity && <button onClick={() => setFilterCity(null)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{filterCity} <X size={10} /></button>}
                {sortBy !== 'recent' && <button onClick={() => setSortBy('recent')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{sortBy === 'highest' ? 'Highest' : 'Lowest'} <X size={10} /></button>}
                <button onClick={handleResetFilters} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-red-400 text-[11px] font-semibold">Clear all</button>
              </div>
            )}

            {/* Summary */}
            <p className="text-[10px] text-on-surface/35 font-bold uppercase tracking-widest mb-3">
              {isWishlistSelected ? `${filteredWishlist.length} wishlisted` : `${filteredRatings.length} restaurant${filteredRatings.length !== 1 ? 's' : ''}`}
            </p>

            {/* Wishlist items (when wishlist selected) — flat divider list */}
            {isWishlistSelected && (
              <ul className="-mx-3 pb-20">
                {filteredWishlist.length === 0 ? (
                  <li className="text-center py-12"><p className="text-sm text-on-surface/30">No wishlist items</p></li>
                ) : (
                  filteredWishlist.map((w) => (
                    <li key={w.restaurantId} className="border-b border-on-surface/[0.06]">
                      <Link to={`/restaurant/${w.restaurantId}`}
                        className="flex items-center gap-3.5 px-3 py-3.5 active:bg-on-surface/[0.02] transition-colors">
                        <div className="w-14 h-14 rounded-lg bg-rose-50/70 flex items-center justify-center flex-shrink-0">
                          <Heart size={20} className="text-rose-400 fill-rose-100" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif font-bold text-[15px] truncate leading-snug">{w.name}</h3>
                          <p className="text-[12px] text-on-surface/45 truncate mt-1">
                            {w.cuisine}{w.price ? ` · ${w.price}` : ''}
                            {w.address && ` · ${w.address.split(',').slice(-1)[0]?.trim()}`}
                          </p>
                          {w.notes && <p className="text-[11px] text-on-surface/35 italic mt-0.5 line-clamp-1">&ldquo;{w.notes}&rdquo;</p>}
                        </div>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )}

            {/* Ratings list — flat rows with dividers, thumbnail flush left, score right */}
            {!isWishlistSelected && (
            <ul className="-mx-3 pb-20">
              {filteredRatings.length === 0 ? (
                <li className="text-center py-12"><p className="text-sm text-on-surface/30">{searchQuery || filterCuisine ? 'No matches' : 'No ratings yet'}</p></li>
              ) : (
                filteredRatings.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const photos = photosByRestaurant[r.restaurant_id] || [];
                  const thumbnail = r.photo_url || photos[0]?.url || '';
                  const visitLabel = r.visit_date
                    ? new Date(r.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '';
                  const city = r.address ? r.address.split(',').slice(-1)[0]?.trim() : '';

                  return (
                    <li key={r.id} className="border-b border-on-surface/[0.06]">
                      {/* Header row — full-width tap target */}
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                        className="w-full flex items-center gap-3.5 px-3 py-3.5 text-left active:bg-on-surface/[0.02] transition-colors"
                      >
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-on-surface/[0.05] flex-shrink-0 flex items-center justify-center">
                          {thumbnail ? (
                            <img src={thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <MapPin size={18} className="text-on-surface/20" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif font-bold text-[15px] truncate leading-snug">{r.restaurant_name}</h3>
                          <p className="text-[12px] text-on-surface/45 truncate mt-1">
                            {visitLabel}
                            {r.cuisine && `${visitLabel ? ' · ' : ''}${r.cuisine}`}
                            {city && ` · ${city}`}
                          </p>
                        </div>
                        <ScoreBadge rating={Number(r.score)} size="sm" />
                        <ChevronDown size={16} className={cn("text-on-surface/25 flex-shrink-0 transition-transform ml-1", isExpanded && "rotate-180")} />
                      </button>

                      {/* Expandable review details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden">
                            <div className="pl-[76px] pr-4 pb-4 space-y-2.5">
                              {/* Photos */}
                              {photos.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -ml-[60px] pl-[60px]">
                                  {photos.map((p) => (
                                    <img key={p.id} src={p.url} alt={p.caption || ''} className="h-24 w-auto rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                                  ))}
                                </div>
                              )}

                              {/* Notes */}
                              {r.notes && (
                                <p className="text-[13px] text-on-surface/65 leading-relaxed italic">&ldquo;{r.notes}&rdquo;</p>
                              )}

                              {/* Tags */}
                              {r.tags && r.tags.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {r.tags.map((t) => (
                                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/[0.08] text-primary/70 font-medium">{t}</span>
                                  ))}
                                </div>
                              )}

                              {/* View restaurant link */}
                              <Link to={`/restaurant/${r.restaurant_id}`}
                                className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:text-primary/70 pt-1">
                                View restaurant →
                              </Link>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })
              )}
            </ul>
            )}
              </>
            )}

            {viewTab === 'recipes' && canView && (
              <>
                <p className="text-[10px] text-on-surface/35 font-bold uppercase tracking-widest mb-3">
                  {publicHomeMeals.length} {publicHomeMeals.length === 1 ? 'recipe' : 'recipes'}
                </p>
                {publicHomeMeals.length === 0 ? (
                  <div className="text-center py-16 px-8">
                    <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3 text-emerald-500">
                      <ChefHat size={22} strokeWidth={1.8} />
                    </div>
                    <p className="text-sm text-on-surface/45">No public recipes yet</p>
                    <p className="text-xs text-on-surface/30 mt-1">When this user shares a meal, it'll show up here.</p>
                  </div>
                ) : (
                  /* Pantry-style flat row list — title + meta + ingredient
                     preview on the left, score chip on the right. Hairline
                     dividers, no card chrome. Tapping a row jumps into the
                     full /meal page; the recipe panel pattern only fires
                     from inside the reels feed. */
                  <ul className="-mx-3 pb-20 divide-y divide-on-surface/[0.06]">
                    {publicHomeMeals.map((meal) => {
                      const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
                      const ingredientPreview = (meal.ingredients ?? []).slice(0, 6);
                      return (
                        <li key={meal.id}>
                          <Link
                            to={`/meal/${encodeURIComponent(profile?.user_id || '')}/${encodeURIComponent(meal.id)}`}
                            className="block w-full px-3 py-4 hover:bg-on-surface/[0.02] active:scale-[0.99] transition-transform"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2 flex-1 text-on-surface">{meal.name}</h3>
                              {meal.score > 0 ? (
                                <ScoreBadge rating={meal.score} size="sm" />
                              ) : (
                                <span className="text-on-surface/25 text-lg font-serif font-bold flex-shrink-0 leading-none pt-0.5">—</span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider">
                              {meal.cuisine && <span>{meal.cuisine}</span>}
                              {meal.cuisine && totalTime > 0 && <span className="text-on-surface/25">·</span>}
                              {totalTime > 0 ? (
                                <>
                                  <Clock size={11} />
                                  <span>{formatDuration(totalTime)}</span>
                                  {meal.difficulty && <><span className="text-on-surface/25">·</span><span>{meal.difficulty}</span></>}
                                </>
                              ) : meal.difficulty ? (
                                <span>{meal.difficulty}</span>
                              ) : meal.dishes.length > 0 ? (
                                <span>{meal.dishes.length} dish{meal.dishes.length !== 1 ? 'es' : ''}</span>
                              ) : null}
                            </div>
                            {ingredientPreview.length > 0 ? (
                              <p className="text-[12px] text-on-surface/50 mt-1.5 leading-snug line-clamp-2">
                                {ingredientPreview.map((i) => i.name).filter(Boolean).join(', ')}
                                {(meal.ingredients?.length ?? 0) > 6 ? '…' : ''}
                              </p>
                            ) : meal.description ? (
                              <p className="text-[12px] text-on-surface/40 italic mt-1.5 line-clamp-2">"{meal.description}"</p>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {/* Floating map button */}
            {userRatings.length > 0 && (
              <button onClick={() => setShowMapPage(true)}
                className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-white rounded-full shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform z-30">
                <MapIcon size={22} />
              </button>
            )}
          </>
        ) : (
          <section className="text-center py-16">
            <Lock size={32} className="mx-auto text-on-surface/15 mb-3" />
            <p className="text-sm font-medium text-on-surface/40">This account is private</p>
            <p className="text-xs text-on-surface/30 mt-1">Follow this user to see their profile</p>
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
                {/* Sort */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Sort by</p>
                  <div className="flex flex-wrap gap-2">
                    {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score']] as const).map(([key, label]) => (
                      <button key={key} onClick={() => setSortBy(key)}
                        className={cn("px-3.5 py-2 rounded-full text-xs font-semibold transition-all",
                          sortBy === key ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/50")}>{label}</button>
                    ))}
                  </div>
                </div>

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
            <header className="sticky top-0 px-4 py-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
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
