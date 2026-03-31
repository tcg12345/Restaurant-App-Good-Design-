import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Lock, UserCircle, Loader2, UserPlus, Check, Star, MapPin, Camera, Users, ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriends,
  sendFriendRequest, followPublicAccount, getUserRatings, getUserPhotos, getUserLists,
  getUserWishlist, publishCommunityRating, getExpertRecommendationCount,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { searchPlacesByText, type PlaceResult } from '../lib/places';

// Simple in-memory cache to avoid re-fetching on back navigation
const profileCache: Record<string, {
  profile: UserProfileType; canView: boolean; followers: number; following: number;
  isFollowing: boolean; ratings: CommunityRating[]; photos: CommunityPhoto[];
  lists: { id: string; name: string; emoji: string; restaurantIds: string[] }[];
  wishlistItems: { restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[];
  ts: number;
}> = {};

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ratings: myRatings } = useLists();
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
  const [userLists, setUserLists] = useState<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]>([]);
  const [userWishlistItems, setUserWishlistItems] = useState<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]>([]);

  // Expert recommendation count
  const [expertRecCount, setExpertRecCount] = useState(0);

  // Expanded review
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      const p = await getProfileByUsername(username);
      if (cancelled || !p) { setProfile(p); setLoading(false); return; }
      setProfile(p);

      const isAuthed = !!userId;
      const queries: Promise<any>[] = [
        getFollowCounts(p.user_id),
        getUserRatings(p.user_id),
        getUserLists(p.user_id),
        getUserWishlist(p.user_id),
      ];
      if (isAuthed) {
        queries.push(canViewProfile(userId!, p));
        queries.push(getFriends(userId!));
        queries.push(getUserPhotos(p.user_id));
      } else if (p.is_public) {
        queries.push(Promise.resolve(true));
        queries.push(Promise.resolve([]));
        queries.push(getUserPhotos(p.user_id));
      }

      const results = await Promise.all(queries);
      if (cancelled) return;

      const [counts, ratings, lists, wishlistItems, viewable, friends, photos] = results;
      const fCounts = counts as { followers: number; following: number };
      const fRatings = (ratings || []) as CommunityRating[];
      const fLists = ((lists || []) as any[]).filter((l: any) => l.restaurantIds?.length > 0);
      const fPhotos = (photos || []) as CommunityPhoto[];
      const fCanView = !!viewable;
      const fIsFollowing = (friends || []).some((f: any) => f.friend_id === p.user_id);

      setFollowers(fCounts.followers || 0);
      setFollowing(fCounts.following || 0);
      const fWishlistItems = (wishlistItems || []) as typeof userWishlistItems;

      setUserRatings(fRatings);
      setUserLists(fLists);
      setUserWishlistItems(fWishlistItems);
      setCanView(fCanView);
      setIsFollowing(fIsFollowing);
      setUserPhotos(fPhotos);

      // Fetch expert recommendation count if this is an expert
      if (p.is_expert) {
        getExpertRecommendationCount(p.user_id).then((c) => { if (!cancelled) setExpertRecCount(c); });
      }

      // Save to cache
      profileCache[cacheKey] = {
        profile: p, canView: fCanView, followers: fCounts.followers || 0,
        following: fCounts.following || 0, isFollowing: fIsFollowing,
        ratings: fRatings, photos: fPhotos, lists: fLists,
        wishlistItems: fWishlistItems, ts: Date.now(),
      };

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [username, userId]);

  // Shared restaurants
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

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
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
        <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3">
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
      <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3">
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

          <div className="flex gap-5 mt-3">
            <div className="text-center"><p className="text-sm font-bold text-on-surface">{followers}</p><p className="text-[10px] text-on-surface/40">Followers</p></div>
            <div className="text-center"><p className="text-sm font-bold text-on-surface">{following}</p><p className="text-[10px] text-on-surface/40">Following</p></div>
            {canView && userRatings.length > 0 && (
              <div className="text-center"><p className="text-sm font-bold text-on-surface">{userRatings.length}</p><p className="text-[10px] text-on-surface/40">Ratings</p></div>
            )}
            {profile.is_expert && expertRecCount > 0 && (
              <div className="text-center"><p className="text-sm font-bold text-amber-600">{expertRecCount}</p><p className="text-[10px] text-amber-500/70">Picks</p></div>
            )}
          </div>

          {userId && userId !== profile.user_id && (
            <div className="mt-3">
              {isFollowing ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-on-surface/5 border border-on-surface/10 text-xs font-semibold text-on-surface/50">
                  <Check size={13} /> Following
                </span>
              ) : followSent ? (
                <span className="px-4 py-2 rounded-full bg-on-surface/5 border border-on-surface/10 text-xs font-semibold text-on-surface/50">Request Sent</span>
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
            {/* Shared restaurants */}
            {sharedRestaurants.length > 0 && (
              <section className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Users size={14} className="text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">In Common ({sharedRestaurants.length})</h3>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 scrollbar-hide">
                  {sharedRestaurants.slice(0, 10).map((r) => (
                    <Link key={r.id || r.restaurant_id} to={`/restaurant/${r.restaurant_id}`} className="flex-shrink-0 w-28">
                      <div className="bg-white rounded-xl border border-on-surface/8 p-2 text-center">
                        <p className="text-xs font-semibold truncate">{r.restaurant_name}</p>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <span className={cn("text-xs font-bold", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                          <span className="text-[9px] text-on-surface/30">/ 10</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Search bar + filters button */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search restaurants..."
                  className="w-full bg-white rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium border border-on-surface/8 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30"><X size={14} /></button>}
              </div>
              <button onClick={() => setFiltersOpen(true)}
                className={cn("px-3 rounded-xl border flex items-center gap-1.5 flex-shrink-0 transition-colors",
                  activeFilterCount > 0 ? "bg-primary/10 border-primary/20 text-primary" : "bg-white border-on-surface/8 text-on-surface/40")}>
                <SlidersHorizontal size={14} />
                {activeFilterCount > 0 && <span className="w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{activeFilterCount}</span>}
              </button>
            </div>

            {/* List dropdown */}
            {userLists.length > 0 && (
              <div className="relative mb-3">
                <button onClick={() => setListDropdownOpen(!listDropdownOpen)}
                  className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all border w-full justify-between",
                    selectedListId ? "bg-primary/10 text-primary border-primary/20" : "bg-white text-on-surface/50 border-on-surface/8")}>
                  <span>{selectedListName ? `${userLists.find(l => l.id === selectedListId)?.emoji} ${selectedListName}` : 'All Restaurants'}</span>
                  <div className="flex items-center gap-1">
                    {selectedListId && <span onClick={(e) => { e.stopPropagation(); setSelectedListId(null); setListDropdownOpen(false); }}><X size={12} /></span>}
                    <ChevronDown size={12} className={cn("transition-transform", listDropdownOpen && "rotate-180")} />
                  </div>
                </button>
                {listDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setListDropdownOpen(false)} />
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-on-surface/10 z-40 max-h-48 overflow-y-auto">
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

            {/* Wishlist items (when wishlist selected) */}
            {isWishlistSelected && (
              <div className="space-y-2 pb-20">
                {filteredWishlist.length === 0 ? (
                  <div className="text-center py-12"><p className="text-sm text-on-surface/30">No wishlist items</p></div>
                ) : (
                  filteredWishlist.map((w) => (
                    <Link key={w.restaurantId} to={`/restaurant/${w.restaurantId}`} className="block">
                      <div className="bg-white rounded-xl border border-on-surface/8 px-3 py-2.5 active:scale-[0.99] transition-transform">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-serif font-bold text-sm truncate">{w.name}</h3>
                            <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">
                              {w.cuisine}{w.price ? ` · ${w.price}` : ''}
                              {w.address && ` · ${w.address.split(',').slice(-1)[0]?.trim()}`}
                            </p>
                          </div>
                          <span className="text-xs text-red-400 flex-shrink-0">❤️</span>
                        </div>
                        {w.notes && <p className="text-[10px] text-on-surface/40 italic mt-1 line-clamp-1">"{w.notes}"</p>}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            )}

            {/* Ratings list */}
            {!isWishlistSelected && (
            <div className="space-y-2 pb-20">
              {filteredRatings.length === 0 ? (
                <div className="text-center py-12"><p className="text-sm text-on-surface/30">{searchQuery || filterCuisine ? 'No matches' : 'No ratings yet'}</p></div>
              ) : (
                filteredRatings.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const photos = photosByRestaurant[r.restaurant_id] || [];
                  const hasDetails = !!(r.notes || r.visit_date || (r.tags && r.tags.length > 0) || photos.length > 0 || r.would_return);

                  return (
                    <div key={r.id} className="bg-white rounded-xl border border-on-surface/8 overflow-hidden">
                      {/* Header row */}
                      <div className="flex items-center px-3 py-2.5">
                        <Link to={`/restaurant/${r.restaurant_id}`} className="flex-1 min-w-0">
                          <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                          <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">
                            {r.cuisine}{r.price ? ` · ${r.price}` : ''}
                            {r.address && ` · ${r.address.split(',').slice(-1)[0]?.trim()}`}
                          </p>
                        </Link>
                        <span className={cn("text-lg font-serif font-bold flex-shrink-0 mr-2", scoreColor(Number(r.score)))}>
                          {Number(r.score).toFixed(1)}
                        </span>
                        <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="p-1.5 text-on-surface/25 hover:text-on-surface/50 transition-colors flex-shrink-0">
                          <ChevronDown size={16} className={cn("transition-transform", isExpanded && "rotate-180")} />
                        </button>
                      </div>

                      {/* Expandable review dropdown */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden">
                            <div className="border-t border-on-surface/6">
                              {/* Photos */}
                              {photos.length > 0 && (
                                <div className="flex gap-1 overflow-x-auto scrollbar-hide p-2">
                                  {photos.map((p) => (
                                    <img key={p.id} src={p.url} alt={p.caption || ''} className="h-24 w-auto rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                                  ))}
                                </div>
                              )}

                              <div className="px-3 py-2.5 space-y-2">
                                {/* Notes */}
                                {r.notes && (
                                  <div>
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30 mb-0.5">Notes</p>
                                    <p className="text-xs text-on-surface/60 leading-relaxed italic">"{r.notes}"</p>
                                  </div>
                                )}

                                {/* Date & Would Return */}
                                <div className="flex items-center gap-3 flex-wrap">
                                  {r.visit_date && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Visited</span>
                                      <span className="text-xs text-on-surface/50">{new Date(r.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </div>
                                  )}
                                  {r.would_return && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">Would return</span>
                                  )}
                                </div>

                                {/* Tags */}
                                {r.tags && r.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {r.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/60 font-medium">{t}</span>)}
                                  </div>
                                )}

                                {/* View restaurant link */}
                                <Link to={`/restaurant/${r.restaurant_id}`}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/70 pt-1">
                                  View Restaurant →
                                </Link>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
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

      {/* Filters sheet — matches lists page style */}
      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setFiltersOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl h-[92vh] flex flex-col overflow-hidden">
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Filters</h3>
                <button onClick={() => setFiltersOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"><X size={16} className="text-on-surface/60" /></button>
              </div>
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
              <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
                <button onClick={() => { handleResetFilters(); setFiltersOpen(false); }}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60">Reset</button>
                <button onClick={() => setFiltersOpen(false)}
                  className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25">Apply</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Full-screen map page */}
      <AnimatePresence>
        {showMapPage && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-40 bg-surface flex flex-col">
            <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3 border-b border-on-surface/6">
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
