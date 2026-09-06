import { useEntryState } from '../lib/useEntryState';
import { usePageBack } from '../lib/usePageBack';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PinnedShelf, usePinnedCards } from '../components/profile/PinnedShelf';
import { normalizePins } from '../lib/pins';
import { ArrowLeft, Lock, UserCircle, Loader2, Check, Star, MapPin, ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon, Send, ArrowUpDown, Image as ImageIcon, Plus } from 'lucide-react';
import { ShareIcon } from '../components/icons/ShareIcon';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { scoreHex, scoreColor } from '../lib/score';
import { GlassButton } from '../lib/glass-buttons';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { shareExternally } from '../lib/native-share';
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
import { getRestaurantGeoBatch, saveRestaurantGeo } from '../lib/restaurant-geo';
import { getMyGuides, isPublicGuide, type Guide } from '../lib/supabase-guides';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter, restaurantLocalNow } from '../lib/hours';
import { useWarmHoursForFilter } from '../lib/useWarmHours';
import mapboxgl from 'mapbox-gl';
import { attachMapErrorFallback } from '../lib/map-error';
import { MAPBOX_TOKEN } from '../lib/keys';
import { searchPlacesByText } from '../lib/places';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { passesMichelinFilter } from '../lib/michelin';
import { MichelinDrillSection } from '../components/MichelinDistinctionFilter';
import { FilterSheet } from '../components/FilterSheet';
import { FilterSortSection, FilterSection, Segment, SegmentItem, Pill, PillRow, RangeSlider, FilterDrillSection, HoursFilterSection } from '../components/filterPrimitives';
import { ProfileRestaurantRow } from '../components/profile/ProfileRestaurantRow';
import { ProfileRestaurantRowMinimal } from '../components/profile/ProfileRestaurantRowMinimal';
import { ProfilePalate } from '../components/profile/ProfilePalate';
import { TasteSummaryCard } from '../components/profile/TasteProfileCard';
import { buildTasteStateFromCommunity } from '../lib/taste-state';
import { ProfileRecipeRow } from '../components/profile/ProfileRecipeRow';
import { ProfilePostsSection, ProfileReelsSection, ProfileGuidesSection } from '../components/ProfileReelsSection';
import { SearchField } from '../components/SearchField';
import '../components/profile/PublicProfileDesign.css';
import { homeHaptic } from '../lib/haptics';

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

// A score-badge map marker matching the main map page (Discover): a filled,
// score-coloured circle with the rating in white (green ≥8, amber 5–7, red <5),
// falling back to a neutral pin glyph when there's no score.
const createRatingMarkerEl = (score: number): HTMLDivElement => {
  const color = score > 0 ? scoreHex(score) : '#94a3b8';
  const label = score > 0
    ? `<span style="color:#fff;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;">${score.toFixed(1)}</span>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const el = document.createElement('div');
  el.className = 'mapbox-custom-marker';
  el.innerHTML = `<div class="marker-pin" style="width:36px;height:36px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;">${label}</div>`;
  el.addEventListener('mouseenter', () => { const p = el.querySelector('.marker-pin') as HTMLElement | null; if (p) p.style.transform = 'scale(1.15)'; });
  el.addEventListener('mouseleave', () => { const p = el.querySelector('.marker-pin') as HTMLElement | null; if (p) p.style.transform = 'scale(1)'; });
  return el;
};

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const goBack = usePageBack('/circle');
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { reels } = useReels();
  const { posts } = usePosts();
  const { phoneMode, twoDecimalScores } = useSettings();
  const { restaurantMeta, toggleWishlist, isWishlisted } = useLists();
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

  const [expandedId, setExpandedId] = useEntryState<string | null>('public-profile:expandedId', null);

  const [viewTab, setViewTab] = useEntryState<ViewTab>('public-profile:viewTab', 'restaurants');

  const [searchQuery, setSearchQuery] = useEntryState('public-profile:searchQuery', '');
  const [filterCuisine, setFilterCuisine] = useEntryState<string | null>('public-profile:filterCuisine', null);
  const [filterPrice, setFilterPrice] = useEntryState<string | null>('public-profile:filterPrice', null);
  const [filterCity, setFilterCity] = useEntryState<string | null>('public-profile:filterCity', null);
  const [filterMichelin, setFilterMichelin] = useEntryState<string[]>('public-profile:filterMichelin', []);
  const toggleFilterMichelin = (d: string) =>
    setFilterMichelin((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const michelinReady = useMichelinIndexReady();
  const [scoreRange, setScoreRange] = useEntryState<[number, number]>('public-profile:scoreRange', [0, 10]);
  const [hoursFilter, setHoursFilter] = useEntryState<HoursFilter>('public-profile:hoursFilter', emptyHoursFilter());
  const [sortBy, setSortBy] = useEntryState<SortBy>('public-profile:sortBy', 'recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Which drill page the sheet should open on (set by the quick chips).
  const [sheetPage, setSheetPage] = useState<{ id: string; title: string } | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [showMapPage, setShowMapPage] = useState(false);
  const [copied, setCopied] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const sortBtnRef = useRef<HTMLDivElement>(null);

  // Reference-style top bar (mobile): the bar itself never leaves — a mini
  // identity and follow pill fade IN once the identity band scrolls away,
  // and the tab strip sticks just under the bar (its measured height).
  const [scrolled, setScrolled] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    if (!phoneMode) return;
    const onScroll = () => setScrolled(window.scrollY > 130);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [phoneMode]);
  useEffect(() => {
    if (!phoneMode) return;
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phoneMode, loading, profile]);

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
      // Clear the previous person's content before resolving the next profile.
      setCanView(false); setUserRatings([]); setUserPhotos([]); setUserLists([]);
      setUserWishlistItems([]); setPublicHomeMeals([]); setPublicGuides([]);
      setFollowers(0); setFollowing(0); setIsFollowing(false); setFollowSent(false);
      setTheyFollowMe(false); setExpertRecCount(0); setExpandedId(null);
      const p = await getProfileByUsername(username);
      if (cancelled) return;
      setProfile(p);
      if (!p) { setLoading(false); return; }

      const isAuthed = !!userId;

      // Resolve visibility BEFORE fetching any profile content. A private
      // account's ratings / lists / wishlist / meals / photos must never be
      // fetched for a viewer who can't see them — otherwise the private lock
      // screen only hides data that's already been downloaded (and is sitting
      // in the network response). The server enforces this too (community_*
      // RLS + the profile RPCs, migrations 036/046); skipping the requests
      // means a blocked viewer's network tab shows zero of B's data.
      // canViewProfile returns true immediately for public accounts (no query).
      const viewable = isAuthed ? await canViewProfile(userId!, p) : !!p.is_public;
      if (cancelled) return;
      setCanView(viewable);
      setLoading(false);

      const fSnapshot: Partial<typeof profileCache[string]> = {
        profile: p,
        ratings: [], photos: [], lists: [], wishlistItems: [],
        publicHomeMeals: [], guides: [], followers: 0, following: 0,
        canView: viewable, isFollowing: false,
        followSent: false, theyFollowMe: false,
      };
      const promises: Promise<void>[] = [];

      // Follower / following counts + my relationship to them drive the header
      // and the follow button — shown even on the private lock screen, so they
      // are fetched regardless of `viewable`.
      promises.push(getFollowCounts(p.user_id).then((counts) => {
        if (cancelled) return;
        const c = counts || { followers: 0, following: 0 };
        setFollowers(c.followers || 0);
        setFollowing(c.following || 0);
        fSnapshot.followers = c.followers || 0;
        fSnapshot.following = c.following || 0;
      }));

      if (isAuthed) {
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
      }

      // Private profile content — only when the viewer is allowed to see it.
      if (viewable) {
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
          const g = (guides || []).filter(isPublicGuide);
          setPublicGuides(g);
          fSnapshot.guides = g;
        }));

        promises.push(getUserPhotos(p.user_id).then((photos) => {
          if (cancelled) return;
          const f = (photos || []) as CommunityPhoto[];
          setUserPhotos(f);
          fSnapshot.photos = f;
        }));
      }

      if (p.is_verified) {
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

  // The person's taste profile, from the community rows already loaded —
  // the same builder the /user/:username/taste page uses, so the card and
  // the page can't disagree. Only for viewers who may see the profile.
  const tasteState = useMemo(() => {
    if (!canView || !profile || userRatings.length === 0) return null;
    const name = (profile.display_name || profile.username || 'They').trim().split(/\s+/)[0];
    return buildTasteStateFromCommunity({ rows: userRatings, photos: userPhotos, profile, michelinReady: michelinReady, name });
  }, [canView, profile, userRatings, userPhotos, michelinReady]);
  // ── Pinned ── resolved from what this page already fetched for the
  // tabs (ratings, public meals, public guides) plus by-id reads for posts
  // and reels; everything fails closed under RLS.
  const ownerPins = useMemo(() => normalizePins(profile?.pinned), [profile?.pinned]);
  const pinnedCards = usePinnedCards(canView ? ownerPins : [], {
    ownerId: profile?.user_id ?? null, communityRatings: userRatings, photos: userPhotos, meals: publicHomeMeals, guides: publicGuides, posts: profilePosts, reels: profileReels, viewer: true,
  });

  const tasteCard = tasteState && profile ? (
    <TasteSummaryCard
      standing={tasteState.standing}
      points={tasteState.points.total}
      archetype={tasteState.insights.palate.archetype}
      lead={tasteState.insights.palate.tagline ?? tasteState.insights.sentences[0]?.headline ?? `${tasteState.ratingCount} places rated.`}
      chips={tasteState.insights.chips}
      onPress={() => navigate(`/user/${encodeURIComponent(profile.username)}/taste`)}
      ariaLabel={`${profile.display_name || profile.username}'s taste profile`}
    />
  ) : null;


  const activeFilterCount =
    (filterCuisine ? 1 : 0) + (filterPrice ? 1 : 0) + (filterCity ? 1 : 0) +
    (filterMichelin.length > 0 ? 1 : 0) +
    (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) +
    (isHoursFilterActive(hoursFilter) ? 1 : 0) +
    (sortBy !== 'recent' ? 1 : 0);

  const handleResetFilters = () => {
    setFilterCuisine(null); setFilterPrice(null); setFilterCity(null); setFilterMichelin([]);
    setScoreRange([0, 10]); setHoursFilter(emptyHoursFilter()); setSortBy('recent');
  };

  // Backfill hours for this profile's restaurants while the hours filter is
  // active — the filter reads cached meta, which is empty for places the
  // viewer never opened, and unknown hours are never hidden.
  const hoursWarmIds = useMemo(
    () => (isHoursFilterActive(hoursFilter) ? userRatings.map((r) => r.restaurant_id) : []),
    [hoursFilter, userRatings],
  );
  useWarmHoursForFilter(hoursWarmIds, isHoursFilterActive(hoursFilter));

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
    if (isHoursFilterActive(hoursFilter)) {
      result = result.filter((r) => passesHoursFilter(restaurantMeta[r.restaurant_id]?.hours, hoursFilter, restaurantLocalNow(restaurantMeta[r.restaurant_id]?.lng)));
    }
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
  }, [userRatings, searchQuery, filterCuisine, filterPrice, filterCity, filterMichelin, michelinReady, scoreRange, hoursFilter, restaurantMeta, sortBy]);

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

        const el = createRatingMarkerEl(Number(r.score) || 0);

        const cityState = (() => { const parts = (r.address || '').split(',').map(s => s.trim()); return parts.length >= 2 ? parts.slice(-2).join(', ').replace(/\d{5}.*/, '').trim().replace(/,\s*$/, '') : parts[0] || ''; })();

        const rid = r.restaurant_id;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activePopup) activePopup.remove();
          // Popup content is built with DOM APIs: every community_ratings
          // field is attacker-controlled, so user strings only ever go
          // through textContent / property setters, never into markup.
          const content = document.createElement('div');
          content.style.cssText = 'font-family:inherit;padding:4px 0;cursor:pointer;';
          content.addEventListener('click', () => navigate(`/restaurant/${rid}`));
          if (r.photo_url) {
            const img = document.createElement('img');
            img.src = r.photo_url;
            img.referrerPolicy = 'no-referrer';
            img.style.cssText = 'width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;';
            content.appendChild(img);
          }
          const name = document.createElement('div');
          name.style.cssText = 'font-size:13px;font-weight:700;margin-bottom:2px;';
          name.textContent = r.restaurant_name;
          content.appendChild(name);
          if (r.cuisine) {
            const cuisine = document.createElement('div');
            cuisine.style.cssText = 'font-size:10px;color:var(--color-primary);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;';
            cuisine.textContent = r.cuisine;
            content.appendChild(cuisine);
          }
          if (r.score) {
            const scoreRow = document.createElement('div');
            scoreRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px;';
            scoreRow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" style="fill:var(--color-primary)" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
            const scoreText = document.createElement('span');
            scoreText.style.cssText = 'font-size:12px;font-weight:700;color:var(--color-primary);';
            scoreText.textContent = Number(r.score).toFixed(1);
            scoreRow.appendChild(scoreText);
            if (r.price) {
              const dot = document.createElement('span');
              dot.style.cssText = 'color:#ccc;margin:0 2px;';
              dot.textContent = '·';
              scoreRow.appendChild(dot);
              const price = document.createElement('span');
              price.style.cssText = 'font-size:11px;color:#888;font-weight:600;';
              price.textContent = r.price;
              scoreRow.appendChild(price);
            }
            content.appendChild(scoreRow);
          }
          const city = document.createElement('div');
          city.style.cssText = 'font-size:11px;color:#999;';
          city.textContent = cityState;
          content.appendChild(city);

          const popup = new mapboxgl.Popup({ offset: [0, -20], closeButton: true, closeOnClick: false, maxWidth: '220px', className: 'restaurant-popup' })
            .setLngLat([lng, lat])
            .setDOMContent(content)
            .addTo(map);
          popup.on('close', () => { activePopup = null; });
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
        if (missing.length > 0) {
          const addMarker = (r: (typeof missing)[number], lt: number, ln: number) => {
            const el2 = createRatingMarkerEl(Number(r.score) || 0);
            const rid2 = r.restaurant_id;
            el2.addEventListener('click', () => { navigate(`/restaurant/${rid2}`); });
            new mapboxgl.Marker({ element: el2, anchor: 'center' }).setLngLat([ln, lt]).addTo(map);
          };
          // Shared geocode cache first (one batched read): places anyone has
          // resolved before cost zero Places calls here.
          const cachedGeo = await getRestaurantGeoBatch(missing.map((r) => r.restaurant_id));
          const stillMissing: typeof missing = [];
          for (const r of missing) {
            const hit = cachedGeo[r.restaurant_id];
            if (hit) addMarker(r, hit.lat, hit.lng);
            else stillMissing.push(r);
          }
          for (const r of stillMissing.slice(0, 15)) {
            try {
              const results = await searchPlacesByText(r.restaurant_name + ' ' + (r.address?.split(',').slice(-1)[0]?.trim() || ''), 0, 0);
              if (results[0]?.lat && results[0]?.lng) {
                const lt = results[0].lat, ln = results[0].lng;
                addMarker(r, lt, ln);
                // Persist to the SHARED cache so nobody geocodes this place
                // again — any signed-in user may write it.
                saveRestaurantGeo(r.restaurant_id, lt, ln);
                // The community row itself can only be patched by its OWNER:
                // the old unconditional publish fired one doomed RLS-rejected
                // write per rating on every other user's profile, every mount.
                // No activity stamp — see the matching backfill in Discover.
                if (userId && r.user_id === userId) {
                  publishCommunityRating(r.user_id, r.restaurant_id, {
                    name: r.restaurant_name, score: Number(r.score), notes: r.notes, cuisine: r.cuisine,
                    price: r.price, address: r.address, visitDate: r.visit_date, tags: r.tags,
                    wouldReturn: r.would_return, friendIds: r.friend_ids || [],
                    photoUrl: r.photo_url || '', lat: lt, lng: ln,
                  });
                }
              }
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [showMapPage, userRatings, resolvedCoords, navigate, userId]);

  const invalidateProfileCache = () => {
    if (username) delete profileCache[`${username}_${userId}`];
  };

  // Follow (or follow back). Respects the target's privacy: public/expert
  // accounts follow instantly; private accounts get a pending request they
  // must approve before you can see their content.
  const handleFollow = async () => {
    if (!userId) { requireSignIn('Sign in to follow'); return; }
    if (!profile) return;
    const immediate = !!(profile.is_public || profile.is_verified);
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

  // Share the profile — native share sheet where available, otherwise copy
  // the link to the clipboard and flash a "Copied" confirmation on the button.
  const handleShare = async () => {
    if (!profile) return;
    const url = `${window.location.origin}/user/${profile.username}`;
    const result = await shareExternally({ title: profile.display_name, url });
    if (result === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  // Single source of truth for the Follow control so the header and the
  // private-account state stay in lockstep:
  //   Following (tap to unfollow) · Requested (pending) · Follow back · Follow
  const renderFollowButton = (variant: 'header' | 'block' | 'sidebar') => {
    const base =
      variant === 'header'
        ? 'h-10 px-6 rounded-full text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all flex-1 md:flex-none'
        : variant === 'sidebar'
          ? 'h-12 flex-1 rounded-full text-[14px] font-bold inline-flex items-center justify-center gap-1.5 transition-all'
          : 'h-11 px-8 rounded-full text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all';
    if (isFollowing) {
      return (
        <button
          onClick={handleUnfollow}
          className={cn(base, 'bg-paper text-on-surface border border-line-2 hover:bg-primary/5 hover:border-primary hover:text-primary')}
        >
          <Check size={14} /> Following
        </button>
      );
    }
    if (followSent) {
      return (
        <button disabled className={cn(base, 'bg-on-surface/[0.06] text-ink-3 cursor-default')}>
          Requested
        </button>
      );
    }
    const followFill = variant === 'sidebar'
      ? 'bg-primary text-on-primary shadow-[var(--shadow-primary)] hover:-translate-y-0.5 hover:shadow-lg'
      : 'bg-on-surface text-surface hover:bg-primary hover:-translate-y-px';
    return (
      <button onClick={handleFollow} className={cn(base, followFill)}>
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
      <div className="public-profile-design public-profile-desktop min-h-screen bg-surface">
        <header className="sticky top-0 px-4 pt-safe-3 pb-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
          <button onClick={() => goBack()} className="p-2 -ml-2 text-on-surface/50"><ArrowLeft size={20} /></button>
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

  // ── Shared overlays (rendered by both the mobile and desktop layouts) ──
  const filterSheet = (
    <FilterSheet
      open={filtersOpen}
      onClose={() => setFiltersOpen(false)}
      title="Filters"
      initialPage={sheetPage}
      onReset={() => { handleResetFilters(); setFiltersOpen(false); }}
    >
      <FilterSortSection>
        <PillRow>
          {(['recent', 'highest', 'lowest', 'az'] as SortBy[]).map((s) => (
            <Pill key={s} active={sortBy === s} onClick={() => setSortBy(s)}>
              {sortLabel[s]}
            </Pill>
          ))}
        </PillRow>
      </FilterSortSection>

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

      <HoursFilterSection value={hoursFilter} onChange={setHoursFilter} />

      <MichelinDrillSection selected={filterMichelin} onToggle={toggleFilterMichelin} />

      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={allCuisines.map((c) => ({ value: c, label: c }))}
        selected={filterCuisine ? [filterCuisine] : []}
        onToggle={(v) => setFilterCuisine(filterCuisine === v ? null : v)}
        multiple={false}
        searchPlaceholder="Search cuisines"
      />

      <FilterDrillSection
        id="city"
        label="City / Location"
        options={allCities.map((c) => ({ value: c, label: c }))}
        selected={filterCity ? [filterCity] : []}
        onToggle={(v) => setFilterCity(filterCity === v ? null : v)}
        multiple={false}
        searchPlaceholder="Search locations"
      />
    </FilterSheet>
  );

  const mapModal = (
    <AnimatePresence>
      {showMapPage && (
        <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-0 z-40 bg-surface flex flex-col">
          <header className="sticky top-0 px-4 pt-safe-3 pb-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
            <GlassButton
              id="pubprofile-map-back"
              symbol="chevron.left"
              label="Close map"
              onClick={() => setShowMapPage(false)}
              className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
            >
              <ArrowLeft size={18} />
            </GlassButton>
            <h1 className="font-serif font-bold text-[19px] leading-tight tracking-[-0.025em] truncate">{profile.display_name}'s Map</h1>
          </header>
          <div ref={mapContainerRef} className="flex-1" />
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Count of restaurants visible under the current filters/cuisine.
  const countLabel = (
    <span className="text-[11px] font-bold tracking-[0.16em] uppercase text-ink-4">
      <strong className="text-ink-2 font-bold tabular-nums">{filteredRatings.length}</strong>{' '}
      {filterCuisine ? `${filterCuisine} · ` : ''}{filteredRatings.length === 1 ? 'Restaurant' : 'Restaurants'} rated
    </span>
  );

  // Centered empty state used across the desktop content tabs.
  const desktopEmpty = (title: string, message: string, icon: React.ReactNode = <ImageIcon size={26} strokeWidth={1.8} />) => (
    <div className="flex flex-col items-center justify-center text-center py-24">
      <div className="w-16 h-16 rounded-full bg-on-surface/[0.05] grid place-items-center text-ink-4 mb-4">
        {icon}
      </div>
      <div className="font-serif text-[20px] font-bold text-on-surface">{title}</div>
      <div className="text-[14px] font-medium text-ink-3 mt-1.5 max-w-xs">{message}</div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // DESKTOP — editorial two-column layout (GoodEats). Mobile / native
  // and narrow viewports keep the stacked layout below.
  // ═══════════════════════════════════════════════════════════════════════
  if (!phoneMode) {
    return (
      <div className="public-profile-design public-profile-desktop min-h-screen bg-surface">
        {/* slim top strip — just a back affordance, keeps the page airy */}
        <div className="max-w-[1180px] mx-auto px-12 pt-6">
          <button
            onClick={() => goBack()}
            className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink-3 px-3 py-2 -ml-3 rounded-full hover:bg-on-surface/[0.05] hover:text-on-surface transition-colors"
          >
            <ArrowLeft size={18} /> Back
          </button>
        </div>

        <div className="max-w-[1180px] mx-auto px-12 pt-4 pb-24 grid grid-cols-[340px_1fr] gap-14 items-start">

          {/* ── LEFT: sticky profile sidebar ─────────────────────────── */}
          <motion.aside
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="sticky top-8 flex flex-col"
          >
            {/* avatar + identity */}
            <div className="flex flex-col items-start">
              <div
                className="relative w-[100px] h-[100px] rounded-full grid place-items-center mb-5 overflow-hidden"
                style={{
                  background: 'linear-gradient(150deg, color-mix(in srgb, var(--color-primary) 14%, var(--color-paper)), color-mix(in srgb, var(--color-primary) 7%, var(--color-paper)))',
                  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 10%, transparent)',
                }}
              >
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <span className="font-serif font-bold text-[46px] leading-none text-primary">
                    {profile.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <h1 className="font-serif text-[32px] font-bold leading-none tracking-[-0.02em] text-on-surface max-w-full truncate">
                {profile.display_name}
              </h1>

              <div className="flex items-center gap-2 mt-2 text-[14px] font-semibold text-ink-3 flex-wrap">
                <span>@{profile.username}</span>
                {profile.is_verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/[0.07] border border-primary/20 text-[10.5px] font-bold uppercase tracking-wider text-primary">
                    <VerifiedBadge size={12} /> Verified
                  </span>
                )}
                {!profile.is_public && !profile.is_verified && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-4">
                    <Lock size={11} /> Private
                  </span>
                )}
              </div>

              {profile.is_verified && profile.verified_status && (
                <p className="mt-2 text-[13.5px] font-semibold text-primary/90">
                  {profile.verified_status}
                </p>
              )}

              {profile.bio && canView && (
                <p className="mt-3.5 text-[15px] leading-relaxed text-ink-2 max-w-[300px] text-pretty">
                  {profile.bio}
                </p>
              )}

              {profile.home_city && (
                <div className="flex items-center gap-1.5 mt-3.5 text-[13px] font-semibold text-ink-3">
                  <MapPin size={15} strokeWidth={2.2} className="text-primary" />
                  {profile.home_city}
                </div>
              )}

              {profile.is_verified && expertRecCount > 0 && (
                <div className="flex items-center gap-1.5 mt-2.5 text-[12.5px] font-semibold text-primary">
                  <VerifiedBadge size={13} />
                  {expertRecCount} pick{expertRecCount === 1 ? '' : 's'} from this verified user
                </div>
              )}
            </div>

            {/* actions */}
            <div className="flex gap-2.5 mt-6">
              {userId && !isOwnProfile ? (
                <>
                  {renderFollowButton('sidebar')}
                  <button
                    type="button"
                    title="Message"
                    onClick={() => navigate('/messages', { state: { openUserId: profile.user_id } })}
                    className="w-12 h-12 flex-none rounded-full bg-paper border border-line-2 grid place-items-center text-on-surface hover:bg-on-surface/[0.04] hover:border-ink-2 transition-colors"
                  >
                    <Send size={18} />
                  </button>
                  <button
                    type="button"
                    title={copied ? 'Link copied' : 'Share profile'}
                    onClick={handleShare}
                    className="w-12 h-12 flex-none rounded-full bg-paper border border-line-2 grid place-items-center text-on-surface hover:bg-on-surface/[0.04] hover:border-ink-2 transition-colors"
                  >
                    {copied ? <Check size={18} className="text-primary" /> : <ShareIcon size={18} />}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleShare}
                  className="h-12 flex-1 rounded-full bg-paper border border-line-2 inline-flex items-center justify-center gap-2 text-[14px] font-bold text-on-surface hover:bg-on-surface/[0.04] hover:border-ink-2 transition-colors"
                >
                  {copied ? <><Check size={16} className="text-primary" /> Link copied</> : <><ShareIcon size={16} /> Share profile</>}
                </button>
              )}
            </div>

            {/* stats — followers / following open the full-page lists when
                the viewer can see this profile's content at all */}
            <div className="flex items-stretch mt-7 py-[18px] border-y border-line">
              {([
                { n: userRatings.length, l: 'Ratings' },
                { n: publicHomeMeals.length, l: 'Cooked' },
                { n: followers, l: 'Followers', tab: 'followers' },
                { n: following, l: 'Following', tab: 'following' },
              ] as { n: number; l: string; tab?: 'followers' | 'following' }[]).map((it, i) => {
                const clickable = !!it.tab && canView && !!profile.username;
                const Tag = (clickable ? 'button' : 'div') as 'button';
                return (
                  <Tag
                    key={it.l}
                    type={clickable ? 'button' : undefined}
                    onClick={clickable ? () => navigate(`/user/${encodeURIComponent(profile.username)}/${it.tab}`) : undefined}
                    className={cn(
                      'flex-1 flex flex-col items-start pr-2 text-left',
                      i === 0 ? 'pl-0' : 'pl-4 border-l border-line',
                      clickable && 'group cursor-pointer',
                    )}
                  >
                    <span className={cn('font-serif text-[22px] font-bold leading-none tracking-[-0.01em] text-on-surface tabular-nums', clickable && 'group-hover:text-primary transition-colors')}>{it.n}</span>
                    <span className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-ink-4 mt-1.5">{it.l}</span>
                  </Tag>
                );
              })}
            </div>

            {tasteCard && <div className="mt-7">{tasteCard}</div>}

            {/* palate */}
            {canView && topCuisines.length > 0 && (
              <div className="mt-7">
                <ProfilePalate
                  items={topCuisines}
                  activeName={filterCuisine}
                  onSelect={(name) => { setViewTab('restaurants'); setFilterCuisine(filterCuisine === name ? null : name); }}
                />
              </div>
            )}
          </motion.aside>

          {/* ── RIGHT: content ───────────────────────────────────────── */}
          <main className="min-w-0">
            {canView ? (
              <>
                <PinnedShelf className="mb-8" gutter={0} cards={pinnedCards} isOwn={false} />
                {/* tabs + map view */}
                <div className="flex items-stretch gap-3 border-b border-line mb-7">
                  <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide min-w-0 flex-1">
                    {tabs.map((t) => {
                      const active = viewTab === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          aria-pressed={viewTab === t.key}
                  onClick={(event) => { homeHaptic(); setViewTab(t.key); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}
                          className={cn(
                            'inline-flex items-center gap-2 px-1 pb-3.5 -mb-px border-b-2 transition-colors mr-6 last:mr-0 flex-none',
                            active ? 'border-primary' : 'border-transparent',
                          )}
                        >
                          <span className={cn('text-[15px] whitespace-nowrap', active ? 'font-bold text-on-surface' : 'font-semibold text-ink-3 hover:text-ink-2')}>
                            {t.label}
                          </span>
                          <span className={cn(
                            'text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full',
                            active ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.05] text-ink-4',
                          )}>
                            {t.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {userRatings.length > 0 && viewTab === 'restaurants' && (
                    <button
                      onClick={() => setShowMapPage(true)}
                      className="flex-none self-center mb-2 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-paper border border-line-2 text-[13px] font-semibold text-on-surface hover:bg-on-surface/[0.04] transition-colors"
                    >
                      <MapIcon size={15} className="text-primary" /> Map view
                    </button>
                  )}
                </div>

                {/* RESTAURANTS */}
                {viewTab === 'restaurants' && (
                  <>
                    {/* toolbar: search + sort */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative flex-1 flex items-center">
                        <Search size={17} className="absolute left-5 text-ink-3" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search restaurants, neighborhoods…"
                          className="w-full h-[46px] pl-12 pr-11 rounded-full bg-paper border border-line-2 focus:border-ink-2 focus:outline-none focus:ring-4 focus:ring-on-surface/[0.04] text-[14px] font-medium text-on-surface placeholder:text-ink-3 transition-colors"
                        />
                        {searchQuery && (
                          <button onClick={() => setSearchQuery('')} className="absolute right-4 text-ink-3 hover:text-on-surface" title="Clear">
                            <X size={15} />
                          </button>
                        )}
                      </div>

                      <div className="relative flex-none" ref={sortBtnRef}>
                        <button
                          type="button"
                          onClick={() => setSortOpen((o) => !o)}
                          className="h-[46px] px-5 inline-flex items-center gap-2 rounded-full bg-paper border border-line-2 text-[13.5px] font-semibold text-on-surface hover:border-ink-2 whitespace-nowrap transition-colors"
                        >
                          <ArrowUpDown size={15} className="text-ink-3" />
                          <span className="text-ink-3">Sort</span>
                          {sortLabel[sortBy]}
                          <ChevronDown size={14} className={cn('text-ink-3 transition-transform', sortOpen && 'rotate-180')} />
                        </button>
                        {sortOpen && (
                          <div className="absolute top-[calc(100%+8px)] right-0 z-20 min-w-[180px] py-1.5 rounded-2xl bg-paper border border-line shadow-[var(--shadow-popup)]">
                            {(['recent', 'highest', 'lowest', 'az'] as SortBy[]).map((s) => (
                              <button
                                key={s}
                                onClick={() => { setSortBy(s); setSortOpen(false); }}
                                className={cn(
                                  'w-full text-left px-4 py-2 text-[13.5px] font-medium hover:bg-on-surface/[0.04] transition-colors',
                                  sortBy === s ? 'text-primary' : 'text-on-surface',
                                )}
                              >
                                {sortLabel[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => { setSheetPage(null); setFiltersOpen(true); }}
                        className={cn(
                          'h-[46px] px-5 rounded-full inline-flex items-center gap-2 text-[13.5px] font-semibold transition-colors whitespace-nowrap flex-none',
                          activeFilterCount > 0
                            ? 'bg-on-surface text-surface border border-on-surface'
                            : 'bg-paper border border-line-2 text-on-surface hover:border-ink-2',
                        )}
                      >
                        <SlidersHorizontal size={15} /> Filter
                        {activeFilterCount > 0 && (
                          <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10.5px] font-bold grid place-items-center tabular-nums">
                            {activeFilterCount}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* cuisine chips */}
                    {allCuisines.length > 0 && (
                      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 mb-5">
                        <button
                          onClick={() => setFilterCuisine(null)}
                          className={cn(
                            'h-9 px-4 rounded-full text-[13px] font-semibold border flex-none transition-colors',
                            !filterCuisine
                              ? 'bg-on-surface text-surface border-on-surface'
                              : 'bg-paper border-line-2 text-on-surface hover:border-ink-2',
                          )}
                        >
                          All cuisines
                        </button>
                        {allCuisines.map((c) => (
                          <button
                            key={c}
                            onClick={() => setFilterCuisine(filterCuisine === c ? null : c)}
                            className={cn(
                              'h-9 px-4 rounded-full text-[13px] font-semibold border flex-none transition-colors',
                              filterCuisine === c
                                ? 'bg-on-surface text-surface border-on-surface'
                                : 'bg-paper border-line-2 text-on-surface hover:border-ink-2',
                            )}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mb-1">{countLabel}</div>

                    {/* list */}
                    {filteredRatings.length === 0 ? (
                      desktopEmpty(
                        'No restaurants match',
                        'Try a different cuisine or clear your search.',
                        <Search size={26} strokeWidth={1.8} />,
                      )
                    ) : (
                      <div className="border-t border-line mt-2">
                        {filteredRatings.map((r) => (
                          <ProfileRestaurantRowMinimal
                            key={r.id}
                            rating={r}
                            photos={photosByRestaurant[r.restaurant_id] || []}
                            expanded={expandedId === r.id}
                            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                            ownerName={profile.display_name}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* RECIPES */}
                {viewTab === 'recipes' && (
                  publicHomeMeals.length === 0 ? (
                    desktopEmpty('No recipes yet', `When ${profile.display_name} shares a meal, it'll show up here.`)
                  ) : (
                    <>
                      <div className="mb-2 text-[11px] font-bold tracking-[0.16em] uppercase text-ink-4">
                        <strong className="text-ink-2 font-bold tabular-nums">{publicHomeMeals.length}</strong>{' '}
                        {publicHomeMeals.length === 1 ? 'Recipe' : 'Recipes'} cooked &amp; rated
                      </div>
                      <ul className="flex flex-col">
                        {publicHomeMeals.map((meal, i) => (
                          <ProfileRecipeRow key={meal.id} meal={meal} idx={i} userId={profile.user_id} />
                        ))}
                      </ul>
                    </>
                  )
                )}

                {/* POSTS */}
                {viewTab === 'posts' && (
                  profilePosts.length === 0
                    ? desktopEmpty('Nothing here yet', `${profile.display_name} hasn't posted yet.`)
                    : <ProfilePostsSection posts={profilePosts} hideHeader />
                )}

                {/* REELS */}
                {viewTab === 'reels' && (
                  profileReels.length === 0
                    ? desktopEmpty('Nothing here yet', `${profile.display_name} hasn't shared any reels yet.`)
                    : <ProfileReelsSection reels={profileReels} hideHeader />
                )}

                {/* GUIDES */}
                {viewTab === 'guides' && (
                  publicGuides.length === 0
                    ? desktopEmpty('Nothing here yet', `${profile.display_name} hasn't published any public guides yet.`)
                    : <ProfileGuidesSection guides={publicGuides} hideHeader />
                )}
              </>
            ) : (
              <section className="max-w-md mx-auto text-center pt-10 pb-20 px-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center mb-4">
                  <Lock size={26} className="text-ink-3" />
                </div>
                <h3 className="font-serif text-[22px] font-bold text-on-surface mb-2">This account is private</h3>
                <p className="text-[14px] leading-relaxed text-ink-3 mb-7">
                  {followSent
                    ? <>Your follow request is pending. Once {profile.display_name} approves it, you'll see their ratings, recipes, posts and activity.</>
                    : <>Follow {profile.display_name} to see their ratings, recipes, posts and activity. They'll need to approve your request.</>}
                </p>
                {userId && !isOwnProfile && (
                  <div className="flex justify-center">{renderFollowButton('block')}</div>
                )}
              </section>
            )}
          </main>
        </div>

        {filterSheet}
        {mapModal}
      </div>
    );
  }

  // Centered empty state for the mobile content tabs.
  const mobileEmpty = (title: string, message: string) => (
    <div className="text-center py-16 px-8">
      <div className="w-16 h-16 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center text-ink-4 mb-4">
        <ImageIcon size={26} strokeWidth={1.8} />
      </div>
      <div className="font-serif text-[19px] font-bold text-on-surface">{title}</div>
      <div className="text-[13.5px] font-medium text-ink-3 mt-1.5">{message}</div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // MOBILE / narrow — who they are, in one screen. The identity is one
  // compact band, the numbers are one line, and a taste signature says what
  // this person actually rates before the list starts. The top bar never
  // leaves; a mini identity and follow pill fade in as the band scrolls
  // away, and the tabs stick just under it.
  // ═══════════════════════════════════════════════════════════════════════
  const followPill = (mini: boolean) => {
    if (!userId || isOwnProfile) return null;
    const base = mini
      ? 'flex-none rounded-full px-3.5 py-[9px] text-[12px] font-bold transition-colors'
      : 'flex-1 rounded-full py-[13px] text-[13.5px] font-bold inline-flex items-center justify-center gap-2 transition-colors';
    if (isFollowing) {
      return (
        <button type="button" onClick={handleUnfollow} className={cn(base, 'border border-on-surface/20 text-on-surface bg-transparent active:bg-on-surface/[0.06]')}>
          Following
        </button>
      );
    }
    if (followSent) {
      return (
        <button type="button" disabled className={cn(base, 'bg-on-surface/[0.06] text-on-surface/45')}>
          Requested
        </button>
      );
    }
    return (
      <button type="button" onClick={handleFollow} className={cn(base, 'bg-primary text-on-primary shadow-[0_6px_16px_rgba(159,48,18,0.22)] active:opacity-85')}>
        {!mini && <Plus size={15} strokeWidth={2.3} />}
        {theyFollowMe ? 'Follow back' : 'Follow'}
      </button>
    );
  };

  return (
    <div className="public-profile-design relative min-h-screen bg-surface pb-16">
      {/* The same wash the owner's profile wears: the accent, fading out
          under the header, running up behind the bar. The bar only takes
          its glass once the page has scrolled under it. */}
      <div aria-hidden className="public-profile-wash" />
      {/* Top bar — always present; mini identity + follow fade in on scroll */}
      <header
        ref={barRef}
        className={cn(
          'public-profile-bar sticky top-0 z-30 border-b transition-colors duration-300',
          scrolled ? 'bg-surface/90 backdrop-blur-xl border-on-surface/[0.10]' : 'bg-transparent border-transparent',
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pt-safe-3 pb-2.5">
          <GlassButton
            id="pubprofile-back"
            symbol="chevron.left"
            label="Back"
            onClick={() => goBack()}
            className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
          <div
            className={cn(
              'flex-1 min-w-0 flex items-center gap-2 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              scrolled ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[5px] pointer-events-none',
            )}
            aria-hidden={!scrolled || undefined}
            inert={!scrolled}
          >
            <span className="relative flex-none w-[26px] h-[26px] rounded-full overflow-hidden bg-primary/[0.13] text-primary flex items-center justify-center font-serif font-bold text-[12px]">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
              ) : profile.display_name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 font-serif font-bold text-[15px] tracking-[-0.025em] text-on-surface truncate">
              {profile.display_name}
            </span>
          </div>
          <div
            className={cn(
              'flex-none transition-opacity duration-300',
              scrolled ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            aria-hidden={!scrolled || undefined}
            inert={!scrolled}
          >
            {followPill(true)}
          </div>
          <GlassButton
            id="pubprofile-share"
            symbol="app.paperplane"
            label={copied ? 'Link copied' : 'Share profile'}
            onClick={handleShare}
            className="hit-44 flex-none w-11 h-11 -mr-0.5 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
          >
            {copied ? <Check size={16} className="text-primary" /> : <ShareIcon size={16} />}
          </GlassButton>
        </div>
      </header>

      <section className="public-profile-identity" aria-label="Profile">
        <div className="public-profile-avatar">
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span>{profile.display_name.charAt(0).toUpperCase()}</span>}
        </div>
        <div className="public-profile-name">
          <div><h1>{profile.display_name}</h1>{profile.is_verified && <VerifiedBadge size={18} />}{!profile.is_public && <Lock size={14} />}</div>
          <p>@{profile.username}</p>
          {profile.home_city && <p className="public-profile-city"><MapPin size={12} />{profile.home_city}</p>}
        </div>
      </section>

      {profile.is_verified && profile.verified_status && (
        <p className="mt-3 px-5 text-[13px] font-semibold text-primary">{profile.verified_status}</p>
      )}
      {profile.bio && canView && (
        <p className="mt-3.5 px-5 text-[14px] leading-relaxed text-ink-2" style={{ textWrap: 'pretty' } as React.CSSProperties}>
          {profile.bio}
        </p>
      )}
      {profile.is_verified && expertRecCount > 0 && (
        <p className="mt-2.5 px-5 flex items-center gap-1.5 text-[12px] font-semibold text-primary">
          <VerifiedBadge size={13} /> {expertRecCount} pick{expertRecCount === 1 ? '' : 's'} from this verified user
        </p>
      )}

      <div className="public-profile-stats" aria-label="Profile statistics">
        <div><strong>{canView ? userRatings.length : '—'}</strong><span>Places rated</span></div>
        {(['followers', 'following'] as const).map((tab) => (
          <button key={tab} type="button" disabled={!canView} onClick={() => navigate(`/user/${encodeURIComponent(profile.username)}/${tab}`)}>
            <strong>{tab === 'followers' ? followers : following}</strong><span>{tab === 'followers' ? 'Followers' : 'Following'}</span>
          </button>
        ))}
      </div>
      {userId && !isOwnProfile ? (
        <div className="public-profile-actions">
          {followPill(false)}
          <button type="button" onClick={() => navigate('/messages', { state: { openUserId: profile.user_id } })}>Message</button>
        </div>
      ) : isOwnProfile ? (
        <div className="public-profile-actions"><button type="button" onClick={() => navigate('/profile')}>Manage profile</button></div>
      ) : (
        <div className="public-profile-actions"><button type="button" onClick={handleFollow}>Follow</button></div>
      )}

      {/* Taste profile — the palate behind the ratings; tap for the reading. */}
      {canView && <PinnedShelf className="mx-5 mt-6" gutter={20} cards={pinnedCards} isOwn={false} />}
      {tasteCard && <div className="mx-5 mt-5">{tasteCard}</div>}

      {canView ? (
        <>
          {/* Tabs — pills with counts, stuck just under the top bar */}
          <div
            className="public-profile-tabs sticky z-20 overflow-x-auto scrollbar-hide"
            role="group" aria-label="Profile content"
            style={{ top: barH ? barH - 1 : 0 }}
          >
            {tabs.map((t) => {
              const active = viewTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={viewTab === t.key}
                  onClick={(event) => { homeHaptic(); setViewTab(t.key); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}
                  className="flex-none inline-flex items-center whitespace-nowrap transition-colors"
                >
                  {t.label}
                  <span className="font-medium tabular-nums">{t.count}</span>
                </button>
              );
            })}
          </div>

          {/* RESTAURANTS */}
          {viewTab === 'restaurants' && (
            <>
              <div className="flex items-center gap-2 px-5 pt-3.5">
                {/* No `glassId` here on purpose. The native glass layer
                    samples this element's box on a rAF and pushes it over
                    the bridge, so a control that RIDES THE SCROLL arrives a
                    frame late and visibly swims against the list — the same
                    reason a swipe-back gesture stands every glass button
                    down. It also drew a capsule that matched nothing else
                    in this column. On the page's own CSS material it sits
                    still and reads like the chips beside it. */}
                <SearchField
                  className="flex-1 min-w-0"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search their ratings"
                />
                <button
                  onClick={() => { setSheetPage(null); setFiltersOpen(true); }}
                  className={cn(
                    'relative w-11 h-11 flex-none rounded-full grid place-items-center transition-colors',
                    activeFilterCount > 0 ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface',
                  )}
                  aria-label="Filter"
                >
                  <SlidersHorizontal size={17} />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-on-primary text-[9.5px] font-bold grid place-items-center tabular-nums">{activeFilterCount}</span>
                  )}
                </button>
              </div>

              <div className="public-profile-tools">
                <label className="public-profile-sort"><ArrowUpDown size={13} /><select aria-label="Sort ratings" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>{(['recent', 'highest', 'lowest', 'az'] as SortBy[]).map((value) => <option key={value} value={value}>{sortLabel[value]}</option>)}</select><ChevronDown size={12} /></label>
                <span className="public-profile-results">{filteredRatings.length} {filteredRatings.length === 1 ? 'place' : 'places'}</span>
                {userRatings.length > 0 && <button type="button" onClick={() => setShowMapPage(true)}><MapIcon size={15} />Map</button>}
              </div>
              {(activeFilterCount > 0 || searchQuery.trim()) && <div className="public-profile-filter-status"><span>{[filterCuisine, filterPrice, filterCity, filterMichelin.length ? 'Michelin' : null].filter(Boolean).join(' · ') || `${filteredRatings.length} of ${userRatings.length} places shown`}</span><button type="button" onClick={() => { handleResetFilters(); setSearchQuery(''); }}>Clear all</button></div>}

              {filteredRatings.length === 0 ? (
                <div className="px-5 pt-8">
                  <div className="font-serif text-[17px] font-bold tracking-[-0.028em] text-on-surface">{userRatings.length ? 'No matching places' : 'No ratings yet'}</div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3 max-w-[262px]" style={{ textWrap: 'pretty' } as React.CSSProperties}>
                    {userRatings.length ? 'Try another search or clear your filters.' : `${profile.display_name.split(' ')[0]}’s ratings will appear here.`}
                  </p>
                </div>
              ) : (
                <div className="px-5">
                  {filteredRatings.map((r) => (
                    <ProfileRestaurantRowMinimal
                      key={r.id}
                      rating={r}
                      photos={photosByRestaurant[r.restaurant_id] || []}
                      expanded={expandedId === r.id}
                      onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                      ownerName={profile.display_name}
                      compact
                      saved={isWishlisted(r.restaurant_id)}
                      onToggleSave={isOwnProfile ? undefined : () => { if (!userId) { requireSignIn('Sign in to save places'); return; } toggleWishlist({
                        id: r.restaurant_id,
                        name: r.restaurant_name || '',
                        image: r.photo_url || '',
                        cuisine: r.cuisine || '',
                        price: r.price || '',
                        address: r.address || '',
                      }); }}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* RECIPES */}
          {viewTab === 'recipes' && (
            publicHomeMeals.length === 0 ? (
              mobileEmpty('No recipes yet', `When ${profile.display_name} shares a meal, it'll show up here.`)
            ) : (
              <div className="px-5 pt-4">
                <div className="flex items-center gap-2.5 pb-1">
                  <span className="flex-none text-[12px] text-ink-3 tabular-nums">
                    {publicHomeMeals.length} {publicHomeMeals.length === 1 ? 'recipe' : 'recipes'} cooked &amp; rated
                  </span>
                  <span className="flex-1 h-px bg-on-surface/[0.12]" />
                </div>
                <ul className="flex flex-col">
                  {publicHomeMeals.map((meal, i) => (
                    <ProfileRecipeRow key={meal.id} meal={meal} idx={i} userId={profile.user_id} />
                  ))}
                </ul>
              </div>
            )
          )}

          {/* POSTS */}
          {viewTab === 'posts' && (
            <div className="pt-4">
              {profilePosts.length === 0
                ? mobileEmpty('Nothing here yet', `${profile.display_name} hasn't posted yet.`)
                : <ProfilePostsSection posts={profilePosts} hideHeader />}
            </div>
          )}

          {/* REELS */}
          {viewTab === 'reels' && (
            <div className="pt-4">
              {profileReels.length === 0
                ? mobileEmpty('Nothing here yet', `${profile.display_name} hasn't shared any reels yet.`)
                : <ProfileReelsSection reels={profileReels} hideHeader />}
            </div>
          )}

          {/* GUIDES */}
          {viewTab === 'guides' && (
            <div className="pt-4">
              {publicGuides.length === 0
                ? mobileEmpty('Nothing here yet', `${profile.display_name} hasn't published any public guides yet.`)
                : <ProfileGuidesSection guides={publicGuides} hideHeader />}
            </div>
          )}
        </>
      ) : (
        <section className="text-center pt-12 pb-20 px-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center mb-4">
            <Lock size={26} className="text-ink-3" />
          </div>
          <h3 className="font-serif text-[20px] font-bold text-on-surface mb-1.5">This account is private</h3>
          <p className="text-[13.5px] leading-relaxed text-ink-3 mb-6">
            {followSent
              ? <>Your follow request is pending. Once {profile.display_name} approves it, you'll see their ratings, recipes, posts and activity.</>
              : <>Follow {profile.display_name} to see their ratings, recipes, posts and activity. They'll need to approve your request.</>}
          </p>
        </section>
      )}

      {filterSheet}
      {mapModal}
    </div>
  );
};
