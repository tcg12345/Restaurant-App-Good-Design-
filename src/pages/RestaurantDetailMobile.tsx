import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, Search, Share2, Heart,
  StickyNote, DollarSign, CalendarDays, Tag, Image, Edit3, Building2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type CommunityPhoto, type HotelDining, type DiningType } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';

/** Parse hours array to find next opening time when currently closed */
function getNextOpenTime(hours: string[]): string {
  if (!hours || hours.length === 0) return '';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayIdx = now.getDay();

  // Look at today first, then upcoming days
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const dayName = days[dayIdx];
    const entry = hours.find((h) => h.startsWith(dayName));
    if (!entry) continue;
    // Skip "Closed" days
    if (/closed/i.test(entry)) continue;
    // Extract opening time — format: "Monday: 11:30 AM – 10:00 PM" or "Monday: 5:00 – 11:00 PM"
    const timePart = entry.split(':').slice(1).join(':').trim();
    const openMatch = timePart.match(/^(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
    if (!openMatch) continue;
    const openTime = openMatch[1].trim();
    if (offset === 0) return `today at ${openTime}`;
    if (offset === 1) return `tomorrow at ${openTime}`;
    return `${dayName} at ${openTime}`;
  }
  return '';
}
import { RadarChart } from '../components/RadarChart';
import { getFlavorProfile, getTopFlavors } from '../lib/flavorProfile';
import 'mapbox-gl/dist/mapbox-gl.css';

/* ── Photo Gallery Bottom Sheet ── */
interface GalleryPhoto {
  url: string;
  caption: string;
  isGoogle: boolean;
}

interface DishGroup {
  dish: string;
  photos: GalleryPhoto[];
}

const PhotoGallery: React.FC<{
  photos: string[];
  communityPhotos: CommunityPhoto[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, communityPhotos, name, initialIndex, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDish, setActiveDish] = useState<string | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<GalleryPhoto | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Build unified photo list with captions
  const allPhotos: GalleryPhoto[] = React.useMemo(() => {
    const communityUrls = new Set(communityPhotos.map((p) => p.url));
    const googlePhotos = photos
      .filter((url) => !communityUrls.has(url))
      .map((url) => ({ url, caption: '', isGoogle: true }));
    const userPhotos = communityPhotos
      .filter((p) => p.url && p.url.length < 500000)
      .map((p) => ({ url: p.url, caption: p.caption || '', isGoogle: false }));
    return [...googlePhotos, ...userPhotos];
  }, [photos, communityPhotos]);

  // Group photos by dish name (normalize to lowercase for matching)
  const dishGroups: DishGroup[] = React.useMemo(() => {
    const groups: Record<string, GalleryPhoto[]> = {};
    for (const p of allPhotos) {
      if (!p.caption) continue;
      const key = p.caption.trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    // Only show groups with 2+ photos, sorted by count descending
    return Object.entries(groups)
      .filter(([, arr]) => arr.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, arr]) => ({ dish: arr[0].caption, photos: arr }));
  }, [allPhotos]);

  // Filter photos
  const displayPhotos = React.useMemo(() => {
    if (activeDish) {
      const key = activeDish.toLowerCase();
      return allPhotos.filter((p) => p.caption.toLowerCase() === key);
    }
    if (searchQuery.trim()) {
      return allPhotos.filter((p) => p.caption.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return allPhotos;
  }, [allPhotos, searchQuery, activeDish]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 bg-surface flex flex-col"
      >
        {/* Header */}
        <div className="flex-shrink-0 pt-4 pb-2 px-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-serif font-bold">Photos</h2>
              <p className="text-[11px] text-on-surface/40 mt-0.5">{allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-on-surface/5 transition-colors"
            >
              <X size={22} className="text-on-surface/50" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex-shrink-0 px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
            <input
              type="text"
              placeholder="Search by dish or description..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setActiveDish(null); }}
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

          {/* Active dish filter chip */}
          {activeDish && (
            <div className="flex items-center gap-2 px-5 pb-3">
              <span className="text-xs font-semibold text-on-surface/50 uppercase tracking-wider">Showing:</span>
              <button onClick={() => setActiveDish(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-bold">
                {activeDish}
                <X size={12} />
              </button>
            </div>
          )}

          {/* Popular Dishes section */}
          {!searchQuery.trim() && !activeDish && dishGroups.length > 0 && (
            <div className="pb-5">
              <h3 className="text-sm font-serif font-bold text-on-surface px-5 pb-3">Popular dishes</h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-5">
                {dishGroups.map((group) => (
                  <button
                    key={group.dish}
                    onClick={() => setActiveDish(group.dish)}
                    className="flex-shrink-0 w-36 text-left"
                  >
                    <div className="rounded-xl overflow-hidden aspect-[4/3] mb-2">
                      <img
                        src={group.photos[0].url}
                        alt={group.dish}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <p className="text-sm font-semibold text-on-surface truncate">{group.dish}</p>
                    <p className="text-[11px] text-on-surface/40">{group.photos.length} recommended</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results info when searching */}
          {(searchQuery.trim() || activeDish) && (
            <div className="px-5 pb-2">
              <p className="text-[11px] text-on-surface/40">{displayPhotos.length} result{displayPhotos.length !== 1 ? 's' : ''}</p>
            </div>
          )}

          {displayPhotos.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-on-surface/40">No photos match "{searchQuery}"</p>
            </div>
          ) : (
            <>
              {/* All Photos header */}
              {!searchQuery.trim() && !activeDish && (
                <h3 className="text-sm font-serif font-bold text-on-surface px-5 pb-3">Photos from members</h3>
              )}

              {/* Photo grid — 2 columns like reference */}
              <div className="grid grid-cols-2 gap-2 px-5">
                {displayPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedPhoto(photo)}
                    className="relative aspect-square rounded-2xl overflow-hidden"
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption || `${name} photo ${i + 1}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    {photo.caption && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2.5 pt-6">
                        <p className="text-[13px] text-white font-semibold truncate">{photo.caption}</p>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Expanded single photo overlay */}
        <AnimatePresence>
          {expandedPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-black/90 flex flex-col items-center justify-center"
              onClick={() => setExpandedPhoto(null)}
            >
              <button
                onClick={() => setExpandedPhoto(null)}
                className="absolute top-6 right-5 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-20"
              >
                <X size={22} className="text-white" />
              </button>
              <img
                src={expandedPhoto.url}
                alt={expandedPhoto.caption || name}
                className="max-w-full max-h-[75vh] object-contain rounded-xl"
                referrerPolicy="no-referrer"
                onClick={(e) => e.stopPropagation()}
              />
              {expandedPhoto.caption && (
                <p className="text-white/80 text-sm font-medium mt-3 px-8 text-center">{expandedPhoto.caption}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

export const RestaurantDetailMobile: React.FC = () => {
  const {
    place, loading, error, navigate,
    photoIndex, setPhotoIndex,
    hoursOpen, setHoursOpen,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos,
    showFriendsDetail, setShowFriendsDetail,
    hotelDiningOptions, refreshHotelDining,
  } = useRestaurantDetail();

  const { openWishlistModal, isWishlisted, getRating, openAddRestaurantModal } = useLists();
  const { user } = useAuth();
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [diningFilter, setDiningFilter] = useState<DiningType | 'all'>('all');
  const [addDiningOpen, setAddDiningOpen] = useState(false);
  const [diningRatings, setDiningRatings] = useState<Record<string, number>>({});

  const myRating = place ? getRating(place.id) : undefined;
  // Only treat as hotel if the primary type is hotel (types[0]) or the user rated it as Hotel Breakfast
  const isHotel = place ? (place.types[0] === 'hotel' || place.types[0] === 'lodging' || myRating?.cuisine === 'Hotel Breakfast') : false;

  // Load friend names for the "Went With" section
  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

  // Load community ratings for hotel dining options
  useEffect(() => {
    if (hotelDiningOptions.length === 0) return;
    (async () => {
      const ratings: Record<string, number> = {};
      for (const d of hotelDiningOptions) {
        const stats = await getCommunityStats(d.restaurant_place_id);
        if (stats.avgScore > 0) ratings[d.restaurant_place_id] = stats.avgScore;
      }
      setDiningRatings(ratings);
    })();
  }, [hotelDiningOptions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-primary" />
      </div>
    );
  }

  if (error || !place) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-on-surface/60 text-center">{error || 'Restaurant not found'}</p>
        <button onClick={() => navigate(-1)} className="text-primary font-medium">Go Back</button>
      </div>
    );
  }

  return (
    <div className="pb-32 bg-surface min-h-screen">

      {/* ── Hero — full-bleed tall image, text at very bottom ── */}
      <div className="relative w-full overflow-hidden" style={{ height: '75vh', maxHeight: '85vh' }}>
        {photos.length > 0 ? (
          <button
            onClick={() => setGalleryOpen(true)}
            className="absolute inset-0 w-full h-full cursor-pointer z-[1]"
          >
            <img
              src={photos[photoIndex]}
              alt={place.name}
              className="h-full w-full object-cover transition-all duration-500"
              referrerPolicy="no-referrer"
            />
          </button>
        ) : (
          <div className="absolute inset-0 w-full h-full bg-muted flex items-center justify-center">
            <MapPin size={64} className="text-on-surface/20" />
          </div>
        )}

        {/* Dark gradient — bottom half only for text legibility */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.45) 40%, rgba(0,0,0,0.1) 75%, transparent 100%)' }}
        />
        {/* Thin fade into page bg */}
        <div
          className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
          style={{ background: 'linear-gradient(to top, #fff8f6, transparent)' }}
        />

        {/* Carousel arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
            >
              <ChevronRight size={18} />
            </button>
            <div className="absolute bottom-[100px] left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                  className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-white w-5' : 'bg-white/40 w-1.5'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Top-right actions */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: place.name, url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80"
          >
            <Share2 size={16} />
          </button>
          {photos.length > 1 && (
            <button
              onClick={() => setGalleryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 text-xs font-medium"
            >
              <Images size={14} />
              {photos.length}
            </button>
          )}
        </div>

        {/* Name + badges — anchored at very bottom, white on dark gradient */}
        <div className="absolute bottom-10 left-5 right-5 z-10 pointer-events-none">
          <h1 className="text-2xl font-serif font-bold text-white leading-tight mb-1.5 drop-shadow-lg">{place.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">{isHotel ? 'Hotel' : cuisine}</span>
            {!isHotel && priceStr && (
              <>
                <span className="text-white/50">·</span>
                <span className="text-[11px] font-semibold text-white/90 uppercase tracking-wider">{priceStr}</span>
              </>
            )}
            {place.isOpen !== null && (
              <>
                <span className="text-white/50">·</span>
                {place.isOpen ? (
                  <span className="text-[11px] font-semibold text-green-400">Open</span>
                ) : (
                  <span className="text-[11px] font-semibold text-red-400">
                    Closed{(() => {
                      const next = getNextOpenTime(place.hours);
                      return next ? ` · Opens ${next}` : '';
                    })()}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="px-3 pt-6">

        {/* Action buttons — Rate, Wishlist */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => place && openAddRestaurantModal({
              id: place.id, name: place.name,
              image: place.photoUrl || '',
              cuisine, price: priceStr,
              address: place.address,
            })}
            className={`flex items-center justify-center gap-1.5 py-3 rounded-2xl font-medium text-sm active:scale-[0.98] transition-transform ${
              place && getRating(place.id) ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-primary text-white'
            }`}
          >
            <Star size={16} />
            {place && getRating(place.id) ? `${getRating(place.id)!.score.toFixed(1)}` : 'Rate'}
          </button>
          <button
            onClick={() => place && openWishlistModal({
              id: place.id, name: place.name,
              image: place.photoUrl || '',
              cuisine, price: priceStr,
              address: place.address,
            })}
            className={`flex items-center justify-center gap-1.5 py-3 rounded-2xl font-medium text-sm active:scale-[0.98] transition-transform border ${
              place && isWishlisted(place.id) ? 'bg-secondary/10 text-secondary border-secondary/30' : 'bg-white text-on-surface/60 border-on-surface/12'
            }`}
          >
            <Heart size={16} className={place && isWishlisted(place.id) ? 'fill-secondary' : ''} />
            {place && isWishlisted(place.id) ? 'Saved' : 'Wishlist'}
          </button>
        </div>

        {/* Action row — Directions, Website, Photos */}
        <div className="grid grid-cols-3 gap-3 mb-7">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform"
          >
            <Navigation size={18} />
            <span className="text-[11px] font-medium">Directions</span>
          </a>
          {place.website ? (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform"
            >
              <Globe size={18} />
              <span className="text-[11px] font-medium">Website</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/8 text-on-surface/30">
              <Globe size={18} />
              <span className="text-[11px] font-medium">Website</span>
            </div>
          )}
          <button
            onClick={() => setGalleryOpen(true)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform"
          >
            <Images size={18} />
            <span className="text-[11px] font-medium">Photos</span>
          </button>
        </div>

        {/* Ratings — Google, Friends/Breakfast, Community */}
        <section className="mb-7 space-y-3">
          {isHotel && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-1">Food Ratings</p>
          )}
          {/* Google */}
          <div className="bg-white rounded-2xl p-4 border border-on-surface/8">
            <div className="flex items-center gap-4">
              <div className="text-center flex-shrink-0">
                <p className="text-3xl font-serif font-bold leading-none">{place.rating}</p>
                <div className="flex gap-0.5 justify-center mt-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={12} className={s <= Math.round(place.rating) ? 'fill-primary text-primary' : 'text-on-surface/15'} />
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface">Google Reviews</p>
                <p className="text-xs text-on-surface/50 mt-0.5">{formatReviewCount(place.userRatingCount)} ratings</p>
              </div>
            </div>
          </div>

          {/* Friends — hidden for hotels */}
          {!isHotel && (
            <button onClick={() => friendsStats.totalRatings > 0 && setShowFriendsDetail(true)}
              className="w-full bg-white rounded-2xl p-4 border border-on-surface/8 text-left">
              <div className="flex items-center gap-4">
                {friendsStats.totalRatings > 0 ? (
                  <div className="text-center flex-shrink-0">
                    <p className="text-3xl font-serif font-bold leading-none text-primary">{friendsStats.avgScore.toFixed(1)}</p>
                    <p className="text-[10px] text-on-surface/35 font-medium mt-0.5">/ 10</p>
                  </div>
                ) : (
                  <div className="text-center flex-shrink-0 w-14">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <UserCircle size={20} className="text-primary/50" />
                    </div>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">Friends</p>
                  <p className="text-xs text-on-surface/45 mt-0.5">
                    {friendsStats.totalRatings > 0 ? `${friendsStats.totalRatings} friend rating${friendsStats.totalRatings !== 1 ? 's' : ''} · Tap to view` : 'No friends have rated this place yet'}
                  </p>
                </div>
                {friendsStats.totalRatings > 0 && <ChevronRight size={16} className="text-on-surface/30 flex-shrink-0" />}
              </div>
            </button>
          )}

          {/* Breakfast rating — only for hotels with community ratings */}
          {isHotel && communityStats.totalRatings > 0 && (
            <div className="bg-white rounded-2xl p-4 border border-amber-200/50">
              <div className="flex items-center gap-4">
                <div className="text-center flex-shrink-0">
                  <p className="text-3xl font-serif font-bold leading-none text-amber-600">{communityStats.avgScore.toFixed(1)}</p>
                  <p className="text-[10px] text-on-surface/35 font-medium mt-0.5">/ 10</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">Breakfast</p>
                  <p className="text-xs text-on-surface/45 mt-0.5">{communityStats.totalRatings} rating{communityStats.totalRatings !== 1 ? 's' : ''} from members</p>
                </div>
              </div>
            </div>
          )}

          {/* Community — hidden for hotels (shown as Breakfast above) */}
          {!isHotel && (
            <div className="bg-white rounded-2xl p-4 border border-on-surface/8">
              <div className="flex items-center gap-4">
                {communityStats.totalRatings > 0 ? (
                  <div className="text-center flex-shrink-0">
                    <p className="text-3xl font-serif font-bold leading-none text-violet-600">{communityStats.avgScore.toFixed(1)}</p>
                    <p className="text-[10px] text-on-surface/35 font-medium mt-0.5">/ 10</p>
                  </div>
                ) : (
                  <div className="text-center flex-shrink-0 w-14">
                    <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mx-auto">
                      <Users size={20} className="text-violet-400" />
                    </div>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-on-surface">Community</p>
                  <p className="text-xs text-on-surface/45 mt-0.5">
                    {communityStats.totalRatings > 0 ? `${communityStats.totalRatings} rating${communityStats.totalRatings !== 1 ? 's' : ''} from the community` : 'No community ratings yet'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Hotel Dining */}
        {isHotel && (
          <section className="mb-7">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-on-surface/70 uppercase tracking-wider">Hotel Dining</h3>
              {user?.id && (
                <button onClick={() => setAddDiningOpen(true)} className="text-xs font-semibold text-primary active:scale-95 transition-transform">
                  + Add Option
                </button>
              )}
            </div>

            {/* Category filter pills */}
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
              {([{ value: 'all' as const, label: 'All' }, { value: 'restaurant' as const, label: 'Restaurants' }, { value: 'breakfast' as const, label: 'Breakfast' }, { value: 'bar' as const, label: 'Bars' }, { value: 'room_service' as const, label: 'Room Service' }, { value: 'pool_bar' as const, label: 'Pool Bar' }, { value: 'rooftop' as const, label: 'Rooftop' }] as const).map((f) => (
                <button key={f.value} onClick={() => setDiningFilter(f.value)}
                  className={cn("px-3.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition-all flex-shrink-0",
                    diningFilter === f.value ? "bg-primary/10 border-primary/25 text-primary" : "bg-white border-on-surface/10 text-on-surface/50"
                  )}>
                  {f.label}
                </button>
              ))}
            </div>

            {hotelDiningOptions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-on-surface/8 p-6 text-center">
                <Building2 size={24} className="mx-auto text-on-surface/15 mb-2" />
                <p className="text-xs text-on-surface/35">No dining options added yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {hotelDiningOptions
                  .filter((d) => diningFilter === 'all' || d.dining_type === diningFilter)
                  .map((d) => {
                    const score = diningRatings[d.restaurant_place_id];
                    return (
                      <div key={d.id} onClick={() => navigate(`/restaurant/${d.restaurant_place_id}`)}
                        className="bg-white rounded-2xl border border-on-surface/8 p-3.5 active:scale-[0.99] transition-transform cursor-pointer">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-serif font-bold text-sm truncate">{d.restaurant_name}</h4>
                            <span className={cn(
                              "inline-block mt-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                              d.dining_type === 'restaurant' ? "bg-primary/8 text-primary/70" :
                              d.dining_type === 'breakfast' ? "bg-amber-50 text-amber-600" :
                              d.dining_type === 'bar' ? "bg-violet-50 text-violet-600" :
                              d.dining_type === 'rooftop' ? "bg-sky-50 text-sky-600" :
                              "bg-on-surface/5 text-on-surface/50"
                            )}>
                              {d.dining_type.replace('_', ' ')}
                            </span>
                          </div>
                          {score != null && (
                            <span className={cn("text-lg font-serif font-bold flex-shrink-0", score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                              {score.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {/* Hours */}
        {place.hours.length > 0 && (
          <section className="mb-3">
            <div className="bg-white rounded-2xl border border-on-surface/8">
              <button
                onClick={() => setHoursOpen(!hoursOpen)}
                className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors"
              >
                <Clock size={18} className="text-on-surface/40 flex-shrink-0" />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {place.isOpen !== null && (
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${place.isOpen ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      {place.isOpen ? 'Open' : 'Closed'}
                    </span>
                  )}
                  <span className="text-sm text-on-surface/60 truncate">{getTodayHours(place.hours)}</span>
                </div>
                <ChevronDown size={16} className={`text-on-surface/30 flex-shrink-0 transition-transform duration-200 ${hoursOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {hoursOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 pl-11 space-y-1.5">
                      {place.hours.map((line, i) => {
                        const [day, ...timeParts] = line.split(': ');
                        const time = timeParts.join(': ');
                        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                        return (
                          <div key={i} className={`flex justify-between text-sm ${isToday ? 'font-medium text-on-surface' : 'text-on-surface/45'}`}>
                            <span>{day}</span>
                            <span>{time}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Contact & Address */}
        <section className="mb-7">
          <div className="bg-white rounded-2xl border border-on-surface/8 divide-y divide-on-surface/6">
            {place.phone && (
              <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors">
                <Phone size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70">{place.phone}</span>
              </a>
            )}

            {place.website && (
              <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors">
                <Globe size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            )}

            <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors">
              <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
              <span className="text-sm text-on-surface/70 flex-1">{place.address}</span>
              <Navigation size={14} className="text-primary flex-shrink-0" />
            </a>
          </div>
        </section>

        {/* My Rating details */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: isHotel ? 'Hotel Breakfast' : cuisine, price: isHotel ? '' : priceStr, address: place.address };
          const details = [
            { key: 'notes', icon: <StickyNote size={16} />, label: 'Notes', hasContent: !!myRating.notes, content: myRating.notes ? <p className="text-xs text-on-surface/60 italic">"{myRating.notes}"</p> : null },
            ...(!isHotel ? [{ key: 'price', icon: <DollarSign size={16} />, label: 'Price', hasContent: !!myRating.price, content: myRating.price ? <p className="text-xs text-on-surface/60">{myRating.price}</p> : null }] : []),
            { key: 'date', icon: <CalendarDays size={16} />, label: 'Visit Date', hasContent: !!myRating.visitDate, content: myRating.visitDate ? <p className="text-xs text-on-surface/60">{new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p> : null },
            { key: 'tags', icon: <Tag size={16} />, label: 'Tags', hasContent: myRating.tags?.length > 0, content: myRating.tags?.length > 0 ? <div className="flex flex-wrap gap-1">{myRating.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{t}</span>)}</div> : null },
            { key: 'photos', icon: <Image size={16} />, label: 'Photos', hasContent: myRating.photos?.length > 0, content: myRating.photos?.length > 0 ? <div className="grid grid-cols-4 gap-1 rounded-lg overflow-hidden">{myRating.photos.slice(0, 4).map((p, i) => <img key={i} src={p.url} className="aspect-square object-cover" referrerPolicy="no-referrer" />)}</div> : null },
            ...(!isHotel ? [{ key: 'friends', icon: <Users size={16} />, label: 'Went With', hasContent: (myRating.friendIds?.length || 0) > 0, content: (myRating.friendIds?.length || 0) > 0 ? <div className="flex flex-wrap gap-1.5">{myRating.friendIds.map((fid) => <span key={fid} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{friendNames[fid] || fid.slice(0, 8)}</span>)}</div> : null }] : []),
          ];
          return (
            <section className="mb-7 space-y-1.5">
              {details.map((d) => (
                <div key={d.key} className="bg-white rounded-xl border border-on-surface/8 overflow-hidden">
                  <button onClick={() => setExpandedDetail(expandedDetail === d.key ? null : d.key)}
                    className="w-full flex items-center gap-3 px-3.5 py-3.5 text-left">
                    <span className={d.hasContent ? 'text-primary' : 'text-on-surface/30'}>{d.icon}</span>
                    <span className={cn("flex-1 text-xs font-semibold", d.hasContent ? 'text-on-surface/70' : 'text-on-surface/40')}>{d.label}</span>
                    {d.hasContent && <span className="text-[9px] text-primary font-medium">Added</span>}
                    <ChevronDown size={14} className={cn("text-on-surface/20 transition-transform", expandedDetail === d.key && "rotate-180")} />
                  </button>
                  <AnimatePresence>
                    {expandedDetail === d.key && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="px-3.5 pb-3 pt-1 border-t border-on-surface/5">
                          {d.hasContent ? (
                            <div>
                              <div className="mb-2">{d.content}</div>
                              <button onClick={() => openAddRestaurantModal(meta, d.key)}
                                className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/70">
                                <Edit3 size={11} /> Edit
                              </button>
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs text-on-surface/30 mb-2">Nothing added yet</p>
                              <button onClick={() => openAddRestaurantModal(meta, d.key)}
                                className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/70">
                                + Add {d.label}
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </section>
          );
        })()}

        {/* Map */}
        <section className="mb-8">
          <div className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
            <div ref={mapContainerRef} className="w-full h-48" />
            <div className="px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-on-surface/45">{place.address}</p>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary font-medium flex-shrink-0 ml-3"
              >
                Open in Maps
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Photo Gallery Bottom Sheet */}
      <AnimatePresence>
        {galleryOpen && photos.length > 0 && (
          <PhotoGallery
            photos={photos}
            communityPhotos={communityPhotos}
            name={place.name}
            initialIndex={photoIndex}
            onClose={() => setGalleryOpen(false)}
          />
        )}
      </AnimatePresence>
      {/* Friends ratings detail sheet */}
      <AnimatePresence>
        {showFriendsDetail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowFriendsDetail(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <div>
                  <h3 className="font-serif font-bold text-lg">Friends' Ratings</h3>
                  <p className="text-xs text-on-surface/40">{place.name}</p>
                </div>
                <button onClick={() => setShowFriendsDetail(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {friendsStats.ratings.map((r) => {
                  const scoreColor = Number(r.score) >= 8 ? 'text-green-600' : Number(r.score) >= 5 ? 'text-yellow-600' : 'text-red-500';
                  return (
                    <div key={r.id} className="bg-white rounded-xl border border-on-surface/8 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCircle size={14} className="text-primary/50" />
                          </div>
                          <span className="text-xs font-semibold text-on-surface/70">Friend</span>
                        </div>
                        <span className={cn("text-lg font-serif font-bold", scoreColor)}>{Number(r.score).toFixed(1)}</span>
                      </div>
                      {r.notes && <p className="text-xs text-on-surface/50 italic mt-1">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
                      {r.visit_date && <p className="text-[10px] text-on-surface/30 mt-1.5">{new Date(r.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Hotel Dining Modal */}
      {place && isHotel && user?.id && (
        <AddHotelDiningModal
          open={addDiningOpen}
          onClose={() => setAddDiningOpen(false)}
          hotelPlaceId={place.id}
          hotelName={place.name}
          hotelAddress={place.address}
          userId={user.id}
          onSaved={refreshHotelDining}
        />
      )}
    </div>
  );
};
