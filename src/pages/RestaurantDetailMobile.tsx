import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, Share2, Heart,
  StickyNote, DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, Plus, TrendingUp, TrendingDown, Minus, RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type UserProfile as UP, type CommunityPhoto, type HotelDining, type DiningType, type ExpertRecommendation } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { Link } from 'react-router-dom';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
import { PhotoGallery } from '../components/PhotoGallery';

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

/* PhotoGallery is now a shared component — see ../components/PhotoGallery.tsx */

export const RestaurantDetailMobile: React.FC = () => {
  const {
    place, loading, error, navigate,
    photoIndex, setPhotoIndex,
    hoursOpen, setHoursOpen,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    hotelDiningOptions, refreshHotelDining,
    visitHistory, visitCount,
  } = useRestaurantDetail();

  const { openWishlistModal, isWishlisted, getRating, openAddRestaurantModal } = useLists();
  const { conversations, sendMessage } = useChat();
  const { user } = useAuth();
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [sendToChatOpen, setSendToChatOpen] = useState(false);
  const [chatSent, setChatSent] = useState(false);
  const [diningFilter, setDiningFilter] = useState<DiningType | 'all'>('all');
  const [addDiningOpen, setAddDiningOpen] = useState(false);
  const [diningRatings, setDiningRatings] = useState<Record<string, number>>({});
  const [expandedExpertId, setExpandedExpertId] = useState<string | null>(null);

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

        {/* Action buttons — Rate, Wishlist, Rate Again */}
        <div className={cn("grid gap-2 mb-3", place && getRating(place.id) ? "grid-cols-3" : "grid-cols-2")}>
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
          {place && getRating(place.id) && (
            <button
              onClick={() => openAddRestaurantModal({
                id: place.id, name: place.name,
                image: place.photoUrl || '',
                cuisine, price: priceStr,
                address: place.address,
              }, 'new-visit')}
              className="flex items-center justify-center gap-1.5 py-3 rounded-2xl font-medium text-sm active:scale-[0.98] transition-transform bg-primary/10 text-primary border border-primary/20"
            >
              <Plus size={14} />
              Re-rate
            </button>
          )}
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

        {/* Action row — Directions, Website, Photos, Send */}
        <div className="grid grid-cols-4 gap-2 mb-7">
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
          <button
            onClick={() => setSendToChatOpen(true)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform"
          >
            <Send size={18} />
            <span className="text-[11px] font-medium">Send</span>
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

        {/* Expert Picks */}
        {expertRecommendations.length > 0 && (
          <section className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                <Star size={13} className="text-amber-600 fill-amber-600" />
              </div>
              <h3 className="text-sm font-serif font-bold text-on-surface">Expert Picks</h3>
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{expertRecommendations.length}</span>
            </div>
            <div className="space-y-3">
              {expertRecommendations.map((rec) => {
                const isExpanded = expandedExpertId === rec.id;
                const scoreColor = Number(rec.rating) >= 8 ? 'text-green-600' : Number(rec.rating) >= 5 ? 'text-yellow-600' : 'text-red-500';
                return (
                  <motion.div
                    key={rec.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-amber-200/60 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                      className="w-full px-4 py-3.5 active:bg-amber-50/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                          <UserCircle size={18} className="text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/user/${rec.expert_username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-semibold text-on-surface hover:text-primary truncate"
                            >
                              {rec.expert_name}
                            </Link>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Expert</span>
                          </div>
                          <p className={cn("text-sm mt-1", isExpanded ? "" : "line-clamp-2", "text-on-surface/60")}>{rec.recommendation_text}</p>
                        </div>
                        <div className="flex flex-col items-center flex-shrink-0 ml-1">
                          <span className={cn("text-xl font-serif font-bold", scoreColor)}>{Number(rec.rating).toFixed(1)}</span>
                          <span className="text-[8px] text-on-surface/30 font-semibold uppercase">/ 10</span>
                        </div>
                      </div>
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                            <div className="px-4 pb-3 pt-0.5">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600/70 mb-2">Highlight Dishes</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rec.highlight_dishes.map((dish) => (
                                  <span key={dish} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200/50">
                                    {dish}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
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

        {/* Visit History Timeline */}
        {myRating && visitHistory.length > 0 && place && (
          <section className="mb-7">
            <div className="flex items-center gap-2 mb-3 px-1">
              <RotateCcw size={14} className="text-on-surface/30" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30">Visit History</h3>
              <span className="text-[10px] text-on-surface/20 font-medium">{visitHistory.length + 1} visits</span>
            </div>

            {/* Current rating - highlighted */}
            <div className="relative pl-6 mb-1">
              <div className="absolute left-[9px] top-3 bottom-0 w-0.5 bg-on-surface/8" />
              <div className="absolute left-0 top-2.5 w-[19px] h-[19px] rounded-full bg-primary flex items-center justify-center z-10">
                <Star size={10} className="text-white fill-white" />
              </div>
              <div className="bg-primary/[0.04] border border-primary/15 rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-lg font-serif font-bold", myRating.score >= 8 ? "text-green-600" : myRating.score >= 5 ? "text-yellow-600" : "text-red-500")}>{myRating.score.toFixed(1)}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">Current</span>
                  {visitHistory.length > 0 && (() => {
                    const prev = visitHistory[0];
                    const diff = myRating.score - prev.score;
                    if (diff > 0.1) return <span className="flex items-center gap-0.5 text-[10px] text-green-600 font-medium"><TrendingUp size={10} />+{diff.toFixed(1)}</span>;
                    if (diff < -0.1) return <span className="flex items-center gap-0.5 text-[10px] text-red-500 font-medium"><TrendingDown size={10} />{diff.toFixed(1)}</span>;
                    return <span className="flex items-center gap-0.5 text-[10px] text-on-surface/30 font-medium"><Minus size={10} />Same</span>;
                  })()}
                </div>
                {myRating.visitDate && <p className="text-[11px] text-on-surface/45">{new Date(myRating.visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
                {myRating.notes && <p className="text-[11px] text-on-surface/50 italic mt-1 line-clamp-2">"{myRating.notes}"</p>}
                {myRating.wouldReturn !== undefined && (
                  <p className="text-[10px] mt-1 font-medium">{myRating.wouldReturn ? <span className="text-green-600">Would return</span> : <span className="text-red-500">Wouldn't return</span>}</p>
                )}
              </div>
            </div>

            {/* Previous visits */}
            {visitHistory.map((visit, idx) => {
              const isExpanded = expandedVisit === visit.id;
              const prevVisit = visitHistory[idx + 1];
              const scoreDiff = prevVisit ? visit.score - prevVisit.score : 0;
              return (
                <div key={visit.id} className="relative pl-6 mb-1">
                  {idx < visitHistory.length - 1 && <div className="absolute left-[9px] top-3 bottom-0 w-0.5 bg-on-surface/8" />}
                  <div className={cn("absolute left-[3px] top-2.5 w-[13px] h-[13px] rounded-full border-2 z-10",
                    visit.score >= 8 ? "border-green-400 bg-green-50" : visit.score >= 5 ? "border-yellow-400 bg-yellow-50" : "border-red-400 bg-red-50")} />
                  <button onClick={() => setExpandedVisit(isExpanded ? null : visit.id)}
                    className="w-full text-left bg-white border border-on-surface/8 rounded-xl p-3 active:bg-on-surface/[0.02] transition-colors">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-serif font-bold", visit.score >= 8 ? "text-green-600" : visit.score >= 5 ? "text-yellow-600" : "text-red-500")}>{visit.score.toFixed(1)}</span>
                      {prevVisit && Math.abs(scoreDiff) > 0.1 && (
                        scoreDiff > 0
                          ? <TrendingUp size={10} className="text-green-500" />
                          : <TrendingDown size={10} className="text-red-400" />
                      )}
                      <span className="flex-1 text-[11px] text-on-surface/40">
                        {visit.visit_date ? new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}
                      </span>
                      <ChevronDown size={12} className={cn("text-on-surface/20 transition-transform", isExpanded && "rotate-180")} />
                    </div>
                    {!isExpanded && visit.notes && <p className="text-[10px] text-on-surface/35 italic mt-1 line-clamp-1">"{visit.notes}"</p>}
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="bg-white border border-t-0 border-on-surface/8 rounded-b-xl px-3 pb-3 -mt-1 pt-2 space-y-1.5">
                          {visit.notes && <p className="text-[11px] text-on-surface/50 italic">"{visit.notes}"</p>}
                          {visit.tags && visit.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {visit.tags.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-on-surface/5 text-on-surface/40 font-medium">{t}</span>)}
                            </div>
                          )}
                          {visit.photos && visit.photos.length > 0 && (
                            <div className="flex gap-1 overflow-x-auto no-scrollbar">
                              {visit.photos.slice(0, 4).map((p, i) => <img key={i} src={p.url} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />)}
                            </div>
                          )}
                          <p className="text-[10px] font-medium">{visit.would_return ? <span className="text-green-600">Would return</span> : <span className="text-red-500">Wouldn't return</span>}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </section>
        )}

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

      {/* ── Send to Chat Sheet ── */}
      <AnimatePresence>
        {sendToChatOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]" onClick={() => setSendToChatOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[70] bg-surface rounded-t-3xl flex flex-col overflow-hidden max-h-[60vh]"
            >
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Send to Chat</h3>
                <button onClick={() => setSendToChatOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {conversations.length === 0 ? (
                  <div className="text-center py-12">
                    <MessageCircle size={28} className="mx-auto text-on-surface/15 mb-2" />
                    <p className="text-sm text-on-surface/35">No conversations yet</p>
                    <p className="text-xs text-on-surface/25 mt-1">Start a chat from the Messages page first</p>
                    <button onClick={() => { setSendToChatOpen(false); navigate('/messages'); }}
                      className="mt-3 text-primary text-xs font-semibold">Go to Messages</button>
                  </div>
                ) : (
                  <div className="space-y-1 pt-2">
                    <div className="flex gap-2 mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 self-center">Sharing:</span>
                      <span className="text-xs font-semibold text-on-surface/60 truncate">{place.name}</span>
                      {myRating && <span className="text-[10px] text-green-500 font-semibold self-center">+ Your Review</span>}
                    </div>
                    {conversations.map((conv) => (
                      <button key={conv.id}
                        onClick={() => {
                          const shared: SharedRestaurant = {
                            restaurantId: place.id,
                            name: place.name,
                            image: place.photoUrl || '',
                            cuisine,
                            price: priceStr,
                            address: place.address,
                            ...(myRating ? {
                              score: myRating.score,
                              notes: myRating.notes,
                              wouldReturn: myRating.wouldReturn,
                              tags: myRating.tags,
                              isReview: true,
                            } : { isReview: false }),
                          };
                          sendMessage(conv.id, '', shared);
                          setChatSent(true);
                          setTimeout(() => { setChatSent(false); setSendToChatOpen(false); }, 1200);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-on-surface/3 transition-colors text-left">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {conv.isGroup
                            ? <Users size={14} className="text-primary" />
                            : <span className="text-sm font-bold text-primary">{(conv.name || 'C').charAt(0).toUpperCase()}</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface/70 truncate">{conv.name || 'Direct Message'}</p>
                          <p className="text-[11px] text-on-surface/35">{conv.participantIds.length} participant{conv.participantIds.length !== 1 ? 's' : ''}</p>
                        </div>
                        <Send size={14} className="text-on-surface/25" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <AnimatePresence>
                {chatSent && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-surface/95 flex flex-col items-center justify-center rounded-t-3xl">
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
                      <Check size={28} className="text-green-500" />
                    </div>
                    <p className="text-sm font-semibold text-on-surface/70">Sent!</p>
                  </motion.div>
                )}
              </AnimatePresence>
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
