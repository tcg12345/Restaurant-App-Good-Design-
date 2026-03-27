import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Lock, UserCircle, Loader2, UserPlus, Check, Star, MapPin, Camera, Users, ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriends,
  sendFriendRequest, followPublicAccount, getUserRatings, getUserPhotos, getUserLists,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from './useRestaurantDetail';
import { searchPlacesByText, type PlaceResult } from '../lib/places';

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

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [filterCuisine, setFilterCuisine] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showMapPage, setShowMapPage] = useState(false);

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!username) return;
    (async () => {
      setLoading(true);
      const p = await getProfileByUsername(username);
      setProfile(p);

      if (p && userId) {
        const [viewable, counts, friends] = await Promise.all([
          canViewProfile(userId, p),
          getFollowCounts(p.user_id),
          getFriends(userId),
        ]);
        setCanView(viewable);
        setFollowers(counts.followers);
        setFollowing(counts.following);
        setIsFollowing(friends.some((f) => f.friend_id === p.user_id));

        if (viewable) {
          const [ratings, photos, lists] = await Promise.all([getUserRatings(p.user_id), getUserPhotos(p.user_id), getUserLists(p.user_id)]);
          setUserRatings(ratings);
          setUserPhotos(photos);
          setUserLists(lists.filter((l) => l.restaurantIds.length > 0));
        }
      } else if (p?.is_public) {
        setCanView(true);
        const [counts, ratings, photos, lists] = await Promise.all([
          getFollowCounts(p.user_id), getUserRatings(p.user_id), getUserPhotos(p.user_id), getUserLists(p.user_id),
        ]);
        setFollowers(counts.followers);
        setFollowing(counts.following);
        setUserRatings(ratings);
        setUserPhotos(photos);
        setUserLists(lists.filter((l) => l.restaurantIds.length > 0));
      }
      setLoading(false);
    })();
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

  // Unique cuisines for filter
  const allCuisines = useMemo(() => {
    const set = new Set<string>();
    userRatings.forEach((r) => { if (r.cuisine) set.add(r.cuisine); });
    return Array.from(set).sort();
  }, [userRatings]);

  // Selected list's restaurant IDs
  const selectedListRestaurantIds = useMemo(() => {
    if (!selectedListId) return null;
    const list = userLists.find((l) => l.id === selectedListId);
    return list ? new Set(list.restaurantIds) : null;
  }, [selectedListId, userLists]);

  // Filtered ratings
  const filteredRatings = useMemo(() => {
    let result = userRatings;
    if (selectedListRestaurantIds) {
      result = result.filter((r) => selectedListRestaurantIds.has(r.restaurant_id));
    }
    if (filterCuisine) {
      result = result.filter((r) => r.cuisine === filterCuisine);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.restaurant_name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    return result;
  }, [userRatings, searchQuery, selectedListRestaurantIds, filterCuisine]);

  // Init map with markers
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
      // Look up coordinates for each rated restaurant
      const bounds = new mapboxgl.LngLatBounds();
      let hasMarkers = false;

      for (const r of userRatings.slice(0, 30)) {
        try {
          const results = await searchPlacesByText(r.restaurant_name + ' ' + (r.address?.split(',').slice(-1)[0]?.trim() || ''), 0, 0);
          if (results.length > 0 && results[0].lat && results[0].lng) {
            const place = results[0];
            const el = document.createElement('div');
            el.className = 'w-8 h-8 rounded-full bg-white shadow-lg border-2 border-primary flex items-center justify-center cursor-pointer';
            el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#9f3012" stroke="none"><circle cx="12" cy="12" r="8"/></svg>';
            el.title = r.restaurant_name;

            const marker = new mapboxgl.Marker(el).setLngLat([place.lng, place.lat]).addTo(map);
            markersRef.current.push(marker);
            bounds.extend([place.lng, place.lat]);
            hasMarkers = true;
          }
        } catch {}
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (hasMarkers) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [showMapPage, userRatings]);

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
          <h2 className="text-xl font-serif font-bold">{profile.display_name}</h2>
          <p className="text-sm text-on-surface/40">@{profile.username}</p>
          {!profile.is_public && (
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
                  filterCuisine ? "bg-primary/10 border-primary/20 text-primary" : "bg-white border-on-surface/8 text-on-surface/40")}>
                <SlidersHorizontal size={14} />
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
            {filterCuisine && (
              <div className="flex gap-1.5 mb-3">
                <button onClick={() => setFilterCuisine(null)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                  {filterCuisine} <X size={10} />
                </button>
              </div>
            )}

            {/* Summary */}
            <p className="text-[10px] text-on-surface/35 font-bold uppercase tracking-widest mb-3">
              {filteredRatings.length} restaurant{filteredRatings.length !== 1 ? 's' : ''}
            </p>

            {/* Ratings list */}
            <div className="space-y-2 pb-20">
              {filteredRatings.length === 0 ? (
                <div className="text-center py-12"><p className="text-sm text-on-surface/30">{searchQuery || filterCuisine ? 'No matches' : 'No ratings yet'}</p></div>
              ) : (
                filteredRatings.map((r) => (
                  <Link key={r.id} to={`/restaurant/${r.restaurant_id}`} className="block">
                    <div className="bg-white rounded-xl border border-on-surface/8 px-3 py-2.5 active:scale-[0.99] transition-transform">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-serif font-bold text-sm truncate">{r.restaurant_name}</h3>
                          <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">
                            {r.cuisine}{r.price ? ` · ${r.price}` : ''}
                            {r.address && ` · ${r.address.split(',').slice(-1)[0]?.trim()}`}
                          </p>
                        </div>
                        <span className={cn("text-lg font-serif font-bold flex-shrink-0", scoreColor(Number(r.score)))}>
                          {Number(r.score).toFixed(1)}
                        </span>
                      </div>
                      {r.notes && <p className="text-[10px] text-on-surface/40 italic mt-1 line-clamp-1">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {r.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>

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

      {/* Filters sheet */}
      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-50" onClick={() => setFiltersOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[60vh] flex flex-col overflow-hidden">
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Filters</h3>
                <button onClick={() => setFiltersOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center"><X size={16} className="text-on-surface/60" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Cuisine</p>
                <div className="flex flex-wrap gap-1.5">
                  {allCuisines.map((c) => (
                    <button key={c} onClick={() => { setFilterCuisine(filterCuisine === c ? null : c); setFiltersOpen(false); }}
                      className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                        filterCuisine === c ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>{c}</button>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
                <button onClick={() => { setFilterCuisine(null); setFiltersOpen(false); }}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60">Reset</button>
                <button onClick={() => setFiltersOpen(false)}
                  className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold">Apply</button>
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
