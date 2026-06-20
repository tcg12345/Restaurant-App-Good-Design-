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
import { useSignInModal } from '../contexts/SignInModalContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { useSettings } from '../contexts/SettingsContext';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriendshipStatus,
  sendFriendRequest, followPublicAccount, removeFriend, getUserRatings, getUserPhotos, getUserLists,
  getUserWishlist, publishCommunityRating, getUserPublicHomeMeals, getExpertRecommendationCount,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import { getMyGuides, type Guide } from '../lib/supabase-guides';
import type { HomeMeal } from '../contexts/ListsContext';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { searchPlacesByText } from '../lib/places';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { passesMichelinFilter } from '../lib/michelin';
import { MichelinDistinctionFilter } from '../components/MichelinDistinctionFilter';
import { FilterSheet } from '../components/FilterSheet';
import { FilterSection, Segment, SegmentItem, RangeSlider, FilterDropdown } from '../components/filterPrimitives';
import { ProfileRestaurantRow } from '../components/profile/ProfileRestaurantRow';
import { ProfileRecipeRow } from '../components/profile/ProfileRecipeRow';
import { ProfilePostsSection, ProfileReelsSection, ProfileGuidesSection } from '../components/ProfileReelsSection';

// Simple in-memory cache to avoid re-fetching on back navigation
const profileCache: Record<string, {
  profile: UserProfileType; canView: boolean; followers: number; following: number;
  isFollowing: boolean; followSent: boolean; theyFollowMe: boolean;
  ratings: CommunityRating[]; photos: CommunityPhoto[];
  lists: { id: string; name: string; emoji: string; restaurantIds: string[] }[];
  wishlistItems: { restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[];
  publicHomeMeals: HomeMeal[];
  guides: Guide[];
  ts: number;
}> = {};

type ViewTab = 'restaurants' | 'recipes' | 'posts' | 'reels' | 'guides';
type SortBy = 'recent' | 'highest' | 'lowest' | 'az';

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
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
  // They follow me (their edge → me is accepted) but I don't follow them yet —
  // drives the "Follow back" state on the button.
  const [theyFollowMe, setTheyFollowMe] = useState(false);

  const [userRatings, setUserRatings] = useState<CommunityRating[]>([]);
  const [userPhotos, setUserPhotos] = useState<CommunityPhoto[]>([]);
  const [publicHomeMeals, setPublicHomeMeals] = useState<HomeMeal[]>([]);
  const [userLists, setUserLists] = useState<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]>([]);
  const [userWishlistItems, setUserWishlistItems] = useState<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]>([]);
  const [publicGuides, setPublicGuides] = useState<Guide[]>([]);

  const [expertRecCount, setExpertRecCount] = useState(0);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<ViewTab>('restaurants');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCuisine, setFilterCuisine] = useState<string | null>(null);
  const [filterPrice, setFilterPrice] = useState<string | null>(null);
  const [filterCity, setFilterCity] = useState<string | null>(null);
  const [filterMichelin, setFilterMichelin] = useState<string[]>([]);
  const toggleFilterMichelin = (d: string) =>
    setFilterMichelin((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const michelinReady = useMichelinIndexReady();
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [showMapPage, setShowMapPage] = useState(false);

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
      setFollowSent(cached.followSent ?? false);
      setTheyFollowMe(cached.theyFollowMe ?? false);
      setUserRatings(cached.ratings);
      setUserPhotos(cached.photos);
      setUserLists(cached.lists);
      setUserWishlistItems(cached.wishlistItems || []);
      setPublicHomeMeals(cached.publicHomeMeals || []);
      setPublicGuides(cached.guides || []);
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
        publicHomeMeals: [], guides: [], followers: 0, following: 0,
        canView: !isAuthed && !!p.is_public, isFollowing: false,
        followSent: false, theyFollowMe: false,
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

      promises.push(getMyGuides(p.user_id).then((guides) => {
        if (cancelled) return;
        const g = (guides || []).filter((x) => x.isPublished && x.visibility === 'public');
        setPublicGuides(g);
        fSnapshot.guides = g;
      }));

      if (isAuthed) {
        promises.push(canViewProfile(userId!, p).then((viewable) => {
          if (cancelled) return;
          const v = !!viewable;
          setCanView(v);
          fSnapshot.canView = v;
        }));
        promises.push(getFriendshipStatus(userId!, p.user_id).then((st) => {
          if (cancelled) return;
          const following = st.iFollow === 'accepted';
          const sent = st.iFollow === 'pending';
          const followsMe = st.theyFollow === 'accepted';
          setIsFollowing(following);
          setFollowSent(sent);
          setTheyFollowMe(followsMe);
          fSnapshot.isFollowing = following;
          fSnapshot.followSent = sent;
          fSnapshot.theyFollowMe = followsMe;
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
          followSent: fSnapshot.followSent ?? false,
          theyFollowMe: fSnapshot.theyFollowMe ?? false,
          ratings: fSnapshot.ratings ?? [],
          photos: fSnapshot.photos ?? [],
          lists: fSnapshot.lists ?? [],
          wishlistItems: fSnapshot.wishlistItems ?? [],
          publicHomeMeals: fSnapshot.publicHomeMeals ?? [],
          guides: fSnapshot.guides ?? [],
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
    (filterMichelin.length > 0 ? 1 : 0) +
    (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) +
    (sortBy !== 'recent' ? 1 : 0);

  const handleResetFilters = () => {
    setFilterPrice(null); setFilterCity(null); setFilterMichelin([]);
    setScoreRange([0, 10]); setSortBy('recent');
  };

  const filteredRatings = useMemo(() => {
    let result = userRatings;
    if (filterCuisine) result = result.filter((r) => r.cuisine === filterCuisine);
    if (filterPrice) result = result.filter((r) => r.price === filterPrice);
    if (filterCity) result = result.filter((r) => r.address?.includes(filterCity));
    if (filterMichelin.length > 0) {
      result = result.filter((r) => passesMichelinFilter(
        filterMichelin, r.restaurant_name, r.lat ?? undefined, r.lng ?? undefined, r.address));
    }
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
  }, [userRatings, searchQuery, filterCuisine, filterPrice, filterCity, filterMichelin, michelinReady, scoreRange, sortBy]);

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
    attachMapErrorFallback(map, mapContainerRef.current);
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

  const invalidateProfileCache = () => {
    if (username) delete profileCache[`${username}_${userId}`];
  };

  // Follow (or follow back). Respects the target's privacy: public/expert
  // accounts follow instantly; private accounts get a pending request they
  // must approve before you can see their content.
  const handleFollow = async () => {
    if (!userId) { requireSignIn('Sign in to follow'); return; }
    if (!profile) return;
    const immediate = !!(profile.is_public || profile.is_expert);
    if (immediate) {
      const ok = await followPublicAccount(userId, profile.user_id);
      if (ok) {
        setIsFollowing(true);
        setFollowSent(false);
        setFollowers((f) => f + 1);
        setCanView(true);
        invalidateProfileCache();
      }
    } else {
      const ok = await sendFriendRequest(userId, profile.user_id);
      if (ok) { setFollowSent(true); invalidateProfileCache(); }
    }
  };

  const handleUnfollow = async () => {
    if (!userId || !profile) return;
    const ok = await removeFriend(userId, profile.user_id);
    if (ok) {
      setIsFollowing(false);
      setFollowers((f) => Math.max(0, f - 1));
      // Lose access when the account is private (canViewProfile = public OR
      // I-follow-them; removing my follow revokes the private view).
      if (!profile.is_public) setCanView(false);
      invalidateProfileCache();
    }
  };

  // Single source of truth for the Follow control so the header and the
  // private-account state stay in lockstep:
  //   Following (tap to unfollow) · Requested (pending) · Follow back · Follow
  const renderFollowButton = (variant: 'header' | 'block') => {
    const base = variant === 'header'
      ? 'h-10 px-6 rounded-full text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all flex-1 md:flex-none'
      : 'h-11 px-8 rounded-full text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all';
    if (isFollowing) {
      return (
        <button
          onClick={handleUnfollow}
          className={cn(base, 'bg-[var(--color-paper)] text-on-surface border border-[var(--color-line-2)] hover:bg-primary/5 hover:border-primary hover:text-primary')}
        >
          <Check size={14} /> Following
        </button>
      );
    }
    if (followSent) {
      return (
        <button disabled className={cn(base, 'bg-on-surface/[0.06] text-[var(--color-ink-3)] cursor-default')}>
          Requested
        </button>
      );
    }
    return (
      <button
        onClick={handleFollow}
        className={cn(base, 'bg-on-surface text-surface hover:bg-primary hover:-translate-y-px')}
      >
        {theyFollowMe ? 'Follow back' : 'Follow'}
      </button>
    );
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
    { key: 'guides',      label: 'Guides',      count: publicGuides.length },
  ];

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="max-w-[1280px] mx-auto px-4 md:px-9 pt-safe-5 md:pt-7">

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
                {renderFollowButton('header')}
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

        {/* CUISINE STRIP — "Most rated" (hidden for gated private profiles —
            it's derived from their rating activity). */}
        {canView && topCuisines.length > 0 && (
          <div className="flex items-center gap-3.5 py-4 border-b border-[var(--color-line)] overflow-x-auto scrollbar-hide touch-pan-x">
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

        {/* TAB BAR — only when content is viewable (public, or you follow a
            private account). Gated profiles get the Private state instead. */}
        {canView && (
        <div className="flex items-end gap-5 md:gap-7 pt-5 border-b border-[var(--color-line)] mb-5 overflow-x-auto scrollbar-hide touch-pan-x">
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
        )}

        {/* TAB CONTENT */}
        {canView ? (
          <>
            {viewTab === 'restaurants' && (
              <>
                {/* Filter bar — search on its own row; Sort + Filter share a
                    compact second row on phones (single row on ≥sm). */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center mb-2">
                  <div className="relative flex items-center sm:flex-1">
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

                  <div className="flex items-center gap-2.5">
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
                </div>

                {/* Cuisine chips */}
                {allCuisines.length > 0 && (
                  <div className="flex gap-1.5 pt-3 pb-4 overflow-x-auto scrollbar-hide touch-pan-x">
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
                  <ProfilePostsSection posts={profilePosts} hideHeader />
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
                  <ProfileReelsSection reels={profileReels} hideHeader />
                )}
              </>
            )}

            {viewTab === 'guides' && (
              <>
                <div className="px-1 pt-2 pb-4">
                  <span className="text-[11.5px] font-bold tracking-[0.12em] uppercase text-[var(--color-ink-3)]">
                    <strong className="text-[var(--color-ink-2)] font-bold">{publicGuides.length}</strong>{' '}
                    {publicGuides.length === 1 ? 'guide' : 'guides'}
                  </span>
                </div>
                {publicGuides.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="font-serif text-[20px] text-[var(--color-ink-2)] mb-1">No guides yet</div>
                    <div className="text-[13.5px] text-[var(--color-ink-3)]">
                      {profile.display_name} hasn't published any public guides yet.
                    </div>
                  </div>
                ) : (
                  <ProfileGuidesSection guides={publicGuides} hideHeader />
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
          <section className="max-w-md mx-auto text-center pt-14 pb-20 px-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center mb-4">
              <Lock size={26} className="text-[var(--color-ink-3)]" />
            </div>
            <h3 className="font-serif text-[20px] font-semibold text-on-surface mb-1.5">
              This account is private
            </h3>
            <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-3)] mb-6">
              {followSent
                ? <>Your follow request is pending. Once {profile.display_name} approves it, you'll see their ratings, recipes, posts and activity.</>
                : <>Follow {profile.display_name} to see their ratings, recipes, posts and activity. They'll need to approve your request.</>}
            </p>
            {userId && !isOwnProfile && (
              <div className="flex justify-center">
                {renderFollowButton('block')}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Filters sheet — shared design (matches the Location page) */}
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        onReset={() => { handleResetFilters(); setFiltersOpen(false); }}
      >
        <FilterSection
          label="Score"
          value={`${scoreRange[0]} – ${scoreRange[1]}`}
          isSet={scoreRange[0] > 0 || scoreRange[1] < 10}
        >
          <RangeSlider
            min={0}
            max={10}
            value={scoreRange}
            onChange={setScoreRange}
            ariaLabelMin="Minimum score"
            ariaLabelMax="Maximum score"
          />
          <div className="fs-slider-range"><span>0</span><span>10</span></div>
        </FilterSection>

        <FilterSection label="Price">
          <Segment>
            <SegmentItem active={filterPrice === null} onClick={() => setFilterPrice(null)}>Any</SegmentItem>
            {['$', '$$', '$$$', '$$$$'].map((p) => (
              <SegmentItem
                key={p}
                active={filterPrice === p}
                onClick={() => setFilterPrice(filterPrice === p ? null : p)}
              >
                {p}
              </SegmentItem>
            ))}
          </Segment>
        </FilterSection>

        <FilterSection label="Michelin" sub="Show only restaurants in the Michelin Guide.">
          <MichelinDistinctionFilter selected={filterMichelin} onToggle={toggleFilterMichelin} />
        </FilterSection>

        <FilterSection label="Cuisine">
          <FilterDropdown
            options={allCuisines.map((c) => ({ value: c, label: c }))}
            selected={filterCuisine ? [filterCuisine] : []}
            onToggle={(v) => setFilterCuisine(filterCuisine === v ? null : v)}
            multiple={false}
            placeholder="All cuisines"
            searchPlaceholder="Search cuisines"
          />
        </FilterSection>

        <FilterSection label="City / Location">
          <FilterDropdown
            options={allCities.map((c) => ({ value: c, label: c }))}
            selected={filterCity ? [filterCity] : []}
            onToggle={(v) => setFilterCity(filterCity === v ? null : v)}
            multiple={false}
            placeholder="All locations"
            searchPlaceholder="Search locations"
          />
        </FilterSection>
      </FilterSheet>

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
