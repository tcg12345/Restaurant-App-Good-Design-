import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Lock, UserCircle, Loader2, UserPlus, Check, Star, MapPin, Camera, Users, ChevronDown, Search, SlidersHorizontal, X, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import {
  getProfileByUsername, getFollowCounts, canViewProfile, getFriends,
  sendFriendRequest, followPublicAccount, getUserRatings, getUserPhotos,
  type UserProfile as UserProfileType, type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN } from './useRestaurantDetail';


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

  // Search & filter
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [showMapPage, setShowMapPage] = useState(false);

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

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
          const [ratings, photos] = await Promise.all([getUserRatings(p.user_id), getUserPhotos(p.user_id)]);
          setUserRatings(ratings);
          setUserPhotos(photos);
        }
      } else if (p?.is_public) {
        setCanView(true);
        const [counts, ratings, photos] = await Promise.all([
          getFollowCounts(p.user_id), getUserRatings(p.user_id), getUserPhotos(p.user_id),
        ]);
        setFollowers(counts.followers);
        setFollowing(counts.following);
        setUserRatings(ratings);
        setUserPhotos(photos);
      }
      setLoading(false);
    })();
  }, [username, userId]);

  // Shared restaurants — ones where either user tagged the other as "went with"
  const sharedRestaurants = useMemo(() => {
    if (!canView || !userId || !profile) return [];
    // Restaurants where this user tagged me
    const theyTaggedMe = userRatings.filter((r) => (r.friend_ids || []).includes(userId));
    // Restaurants where I tagged them
    const iTaggedThem = myRatings.filter((r) => (r.friendIds || []).includes(profile.user_id));
    // Combine and deduplicate by restaurant_id
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

  // Filtered ratings
  const filteredRatings = useMemo(() => {
    let result = userRatings;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) => r.restaurant_name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    return result;
  }, [userRatings, searchQuery]);

  // Init map when map page is shown
  useEffect(() => {
    if (!showMapPage || !mapContainerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.99, 40.73],
      zoom: 2,
      accessToken: MAPBOX_TOKEN,
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [showMapPage]);

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

        {/* Content — only visible if canView */}
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
                    <Link key={r.id} to={`/restaurant/${r.restaurant_id}`} className="flex-shrink-0 w-28">
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

            {/* Search bar */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search restaurants..."
                  className="w-full bg-white rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium border border-on-surface/8 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30"><X size={14} /></button>}
              </div>
            </div>

            {/* Summary */}
            <p className="text-[10px] text-on-surface/35 font-bold uppercase tracking-widest mb-3">
              {filteredRatings.length} restaurant{filteredRatings.length !== 1 ? 's' : ''}
              {searchQuery && ` matching "${searchQuery}"`}
            </p>

            {/* Ratings list */}
            <div className="space-y-2 pb-20">
              {filteredRatings.length === 0 ? (
                <div className="text-center py-12"><p className="text-sm text-on-surface/30">{searchQuery ? 'No matches' : 'No ratings yet'}</p></div>
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

      {/* Full-screen map page */}
      <AnimatePresence>
        {showMapPage && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-0 z-40 bg-surface flex flex-col">
            <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3 border-b border-on-surface/6">
              <button onClick={() => { setShowMapPage(false); mapRef.current?.remove(); mapRef.current = null; }}
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
