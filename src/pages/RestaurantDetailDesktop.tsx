import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, Share2, Heart,
  DollarSign, CalendarDays, Tag, Image, Edit3, MessageCircle, Check, Send, Building2, Plus, TrendingUp, TrendingDown, Minus, RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { useChat, type SharedRestaurant } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { getProfilesByIds, getCommunityStats, type CommunityPhoto, type HotelDining, type DiningType, type ExpertRecommendation } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';
import { AddHotelDiningModal } from '../components/AddHotelDiningModal';
import { PhotoGallery } from '../components/PhotoGallery';
import { Link } from 'react-router-dom';

/** Parse hours array to find next opening time when currently closed */
function getNextOpenTime(hours: string[]): string {
  if (!hours || hours.length === 0) return '';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayIdx = now.getDay();

  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (todayIdx + offset) % 7;
    const dayName = days[dayIdx];
    const entry = hours.find((h) => h.startsWith(dayName));
    if (!entry) continue;
    if (/closed/i.test(entry)) continue;
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

export const RestaurantDetailDesktop: React.FC = () => {
  const {
    place, loading, error, navigate,
    photoIndex, setPhotoIndex,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine,
    photos, directionsUrl, mapsUrl,
    communityStats, friendsStats, communityPhotos, expertRecommendations,
    showFriendsDetail, setShowFriendsDetail,
    hotelDiningOptions, refreshHotelDining,
    visitHistory, visitCount,
  } = useRestaurantDetail();
  // Hours default to open — it's the most frequently checked info. Tracked
  // locally so the shared hook can keep its collapsed default elsewhere.
  const [hoursOpen, setHoursOpen] = useState(true);

  const { openWishlistModal, isWishlisted, getRating, openAddRestaurantModal } = useLists();
  const { conversations, sendMessage } = useChat();
  const { user } = useAuth();
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
    <div className="pb-16 bg-surface min-h-screen">

      {/* ── Hero — wide cinematic banner ── */}
      <div className="relative w-full aspect-[16/9] max-h-[65vh] overflow-hidden">
        {photos.length > 0 ? (
          <button
            onClick={() => setGalleryOpen(true)}
            className="block h-full w-full cursor-pointer absolute inset-0"
          >
            <img
              src={photos[photoIndex]}
              alt={place.name}
              className="h-full w-full object-cover transition-all duration-500"
              referrerPolicy="no-referrer"
            />
          </button>
        ) : (
          <div className="h-full w-full bg-muted flex items-center justify-center">
            <MapPin size={64} className="text-on-surface/20" />
          </div>
        )}

        {/* Gradient — fades into page background */}
        <div
          className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none"
          style={{ background: 'linear-gradient(to top, #fff8f6 0%, #fff8f6 2%, rgba(255,248,246,0.85) 20%, rgba(255,248,246,0.4) 50%, transparent 100%)' }}
        />

        {/* Carousel arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length); }}
              className="absolute left-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length); }}
              className="absolute right-6 top-1/2 -translate-y-1/2 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
            >
              <ChevronRight size={20} />
            </button>
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                  className={`h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-on-surface/70 w-5' : 'bg-on-surface/20 w-1.5'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-6 left-6 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors z-10"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Top-right actions */}
        <div className="absolute top-6 right-6 flex items-center gap-2 z-10">
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: place.name, url: window.location.href });
              } else {
                navigator.clipboard.writeText(window.location.href);
              }
            }}
            className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 hover:bg-black/40 transition-colors"
          >
            <Share2 size={18} />
          </button>
          {photos.length > 1 && (
            <button
              onClick={() => setGalleryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 text-xs font-medium hover:bg-black/40 transition-colors"
            >
              <Images size={14} />
              {photos.length}
            </button>
          )}
        </div>
      </div>

      {/* ── Content — centered with max-width ── */}
      <main className="px-3 pt-2 max-w-2xl mx-auto">

        {/* Name + badges */}
        <div className="mb-6">
          <h1 className="text-4xl lg:text-5xl font-serif font-bold text-on-surface leading-tight mb-2">{place.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-on-surface/70 uppercase tracking-wider">{isHotel ? 'Hotel' : cuisine}</span>
            {!isHotel && priceStr && (
              <>
                <span className="text-on-surface/35">·</span>
                <span className="text-xs font-semibold text-on-surface/70 uppercase tracking-wider">{priceStr}</span>
              </>
            )}
            {place.isOpen !== null && (
              <>
                <span className="text-on-surface/35">·</span>
                {place.isOpen ? (
                  <span className="text-xs font-semibold text-green-600">Open</span>
                ) : (
                  <span className="text-xs font-semibold text-red-500">
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

        {/* Action buttons — Rate, Wishlist, Rate Again */}
        <div className={cn("grid gap-2 mb-3", place && getRating(place.id) ? "grid-cols-3" : "grid-cols-2")}>
          <button
            onClick={() => place && openAddRestaurantModal({
              id: place.id, name: place.name,
              image: place.photoUrl || '',
              cuisine, price: priceStr,
              address: place.address,
            })}
            className={`flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-medium text-sm transition-colors ${
              place && getRating(place.id) ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100' : 'bg-primary text-white hover:bg-primary/90'
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
              className="flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-medium text-sm transition-colors bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
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
            className={`flex items-center justify-center gap-1.5 py-3.5 rounded-2xl font-medium text-sm transition-colors border ${
              place && isWishlisted(place.id) ? 'bg-secondary/10 text-secondary border-secondary/30 hover:bg-secondary/20' : 'bg-white text-on-surface/60 border-on-surface/12 hover:bg-on-surface/[0.03]'
            }`}
          >
            <Heart size={16} className={place && isWishlisted(place.id) ? 'fill-secondary' : ''} />
            {place && isWishlisted(place.id) ? 'Saved' : 'Wishlist'}
          </button>
        </div>

        {/* Action row — Directions, Website, Photos, Send */}
        <div className="grid grid-cols-4 gap-3 mb-7">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface hover:bg-on-surface/[0.03] transition-colors"
          >
            <Navigation size={18} />
            <span className="text-xs font-medium">Directions</span>
          </a>
          {place.website ? (
            <a
              href={place.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface hover:bg-on-surface/[0.03] transition-colors"
            >
              <Globe size={18} />
              <span className="text-xs font-medium">Website</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/8 text-on-surface/30">
              <Globe size={18} />
              <span className="text-xs font-medium">Website</span>
            </div>
          )}
          <button
            onClick={() => setGalleryOpen(true)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface hover:bg-on-surface/[0.03] transition-colors"
          >
            <Images size={18} />
            <span className="text-xs font-medium">Photos</span>
          </button>
          <button
            onClick={() => setSendToChatOpen(true)}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface hover:bg-on-surface/[0.03] transition-colors"
          >
            <Send size={18} />
            <span className="text-xs font-medium">Send</span>
          </button>
        </div>

        {/* ── Ratings — flowing inline stats, no cards ──
            Desktop mirrors mobile: a single large primary score
            (Community preferred over Google) with secondary sources
            flowing on a single muted line. Friends stays clickable. */}
        <section className="mb-10">
          {(() => {
            const hasCommunity = communityStats.totalRatings > 0;
            const primaryScore = hasCommunity ? communityStats.avgScore.toFixed(1) : String(place.rating);
            const primaryCount = hasCommunity
              ? `avg from ${communityStats.totalRatings} ${communityStats.totalRatings === 1 ? 'rating' : 'ratings'}`
              : `from ${formatReviewCount(place.userRatingCount)} Google reviews`;
            const primaryLabel = hasCommunity ? (isHotel ? 'Breakfast' : 'Community') : 'Google';
            const primaryColor = hasCommunity
              ? (isHotel ? 'text-amber-600' : 'text-on-surface')
              : 'text-on-surface';
            return (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 mb-2">{primaryLabel}</p>
                <div className="flex items-baseline gap-4">
                  <span className={cn('text-5xl font-serif font-bold leading-none', primaryColor)}>{primaryScore}</span>
                  <span className="text-base text-on-surface/50">{primaryCount}</span>
                </div>
              </>
            );
          })()}

          {(() => {
            const hasCommunity = communityStats.totalRatings > 0;
            const secondary: React.ReactNode[] = [];
            if (hasCommunity) {
              secondary.push(
                <span key="google" className="inline-flex items-baseline gap-1.5">
                  <Star size={13} className="fill-primary text-primary self-center" />
                  <span className="font-serif font-bold text-on-surface">{place.rating}</span>
                  <span className="text-on-surface/45">Google ({formatReviewCount(place.userRatingCount)})</span>
                </span>
              );
            }
            if (!isHotel && friendsStats.totalRatings > 0) {
              secondary.push(
                <button
                  key="friends"
                  type="button"
                  onClick={() => setShowFriendsDetail(true)}
                  className="inline-flex items-baseline gap-1.5 text-primary hover:text-primary/80 transition-colors"
                >
                  <span className="font-serif font-bold">{friendsStats.avgScore.toFixed(1)}</span>
                  <span>from {friendsStats.totalRatings} friend{friendsStats.totalRatings === 1 ? '' : 's'}</span>
                  <ChevronRight size={13} className="self-center" />
                </button>
              );
            }
            if (secondary.length === 0) return null;
            return (
              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                {secondary.map((node, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-on-surface/20">·</span>}
                    {node}
                  </React.Fragment>
                ))}
              </div>
            );
          })()}

          {!isHotel && friendsStats.totalRatings === 0 && communityStats.totalRatings === 0 && (
            <p className="mt-4 text-sm text-on-surface/45">No community or friend ratings yet · be the first</p>
          )}
        </section>

        {/* ── Hotel Dining — flat list with dividers, no per-row cards ── */}
        {isHotel && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">Hotel Dining</h3>
              {user?.id && (
                <button onClick={() => setAddDiningOpen(true)} className="text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors">
                  + Add Option
                </button>
              )}
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3 -mx-1 px-1">
              {([{ value: 'all' as const, label: 'All' }, { value: 'restaurant' as const, label: 'Restaurants' }, { value: 'breakfast' as const, label: 'Breakfast' }, { value: 'bar' as const, label: 'Bars' }, { value: 'room_service' as const, label: 'Room Service' }, { value: 'pool_bar' as const, label: 'Pool Bar' }, { value: 'rooftop' as const, label: 'Rooftop' }] as const).map((f) => (
                <button key={f.value} onClick={() => setDiningFilter(f.value)}
                  className={cn("px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0",
                    diningFilter === f.value ? "bg-primary text-white" : "bg-transparent text-on-surface/50 hover:text-on-surface/70"
                  )}>
                  {f.label}
                </button>
              ))}
            </div>

            {hotelDiningOptions.length === 0 ? (
              <div className="py-10 text-center">
                <Building2 size={24} className="mx-auto text-on-surface/15 mb-2" />
                <p className="text-sm text-on-surface/35">No dining options added yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-on-surface/[0.06]">
                {hotelDiningOptions
                  .filter((d) => diningFilter === 'all' || d.dining_type === diningFilter)
                  .map((d) => {
                    const score = diningRatings[d.restaurant_place_id];
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/restaurant/${d.restaurant_place_id}`)}
                          className="w-full flex items-start justify-between gap-3 py-4 text-left hover:bg-on-surface/[0.02] transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <h4 className="font-serif font-bold text-base truncate">{d.restaurant_name}</h4>
                            <p className={cn(
                              "mt-0.5 text-xs font-bold uppercase tracking-[0.15em]",
                              d.dining_type === 'restaurant' ? "text-primary/70" :
                              d.dining_type === 'breakfast' ? "text-amber-600" :
                              d.dining_type === 'bar' ? "text-violet-600" :
                              d.dining_type === 'rooftop' ? "text-sky-600" :
                              "text-on-surface/50"
                            )}>
                              {d.dining_type.replace('_', ' ')}
                            </p>
                          </div>
                          {score != null && (
                            <span className={cn("text-xl font-serif font-bold flex-shrink-0 pt-0.5", score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                              {score.toFixed(1)}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
        )}

        {/* ── Expert Picks — flat list with dividers, no per-item cards ── */}
        {expertRecommendations.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-2">
              <Star size={14} className="text-amber-600 fill-amber-600 flex-shrink-0" />
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-amber-700">Expert Picks</h3>
              <span className="text-xs font-semibold text-on-surface/30">· {expertRecommendations.length}</span>
            </div>
            <ul className="divide-y divide-on-surface/[0.06]">
              {expertRecommendations.map((rec) => {
                const isExpanded = expandedExpertId === rec.id;
                const scoreColor = Number(rec.rating) >= 8 ? 'text-green-600' : Number(rec.rating) >= 5 ? 'text-yellow-600' : 'text-red-500';
                return (
                  <li key={rec.id}>
                    <button
                      onClick={() => setExpandedExpertId(isExpanded ? null : rec.id)}
                      className="w-full py-4 text-left hover:bg-on-surface/[0.02] transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              to={`/user/${rec.expert_username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-base font-serif font-bold text-on-surface hover:text-primary truncate"
                            >
                              {rec.expert_name}
                            </Link>
                            <span className="text-xs font-bold uppercase tracking-[0.15em] text-amber-600">Expert</span>
                          </div>
                          <p className={cn("text-sm mt-1 leading-relaxed text-on-surface/65", isExpanded ? "" : "line-clamp-2")}>{rec.recommendation_text}</p>
                        </div>
                        <div className="flex items-baseline gap-1 flex-shrink-0 pt-0.5">
                          <span className={cn("text-2xl font-serif font-bold leading-none", scoreColor)}>{Number(rec.rating).toFixed(1)}</span>
                          <span className="text-xs text-on-surface/30 font-semibold">/10</span>
                        </div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && rec.highlight_dishes && rec.highlight_dishes.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="pt-3">
                              <p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-600/70 mb-2">Highlight Dishes</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rec.highlight_dishes.map((dish) => (
                                  <span key={dish} className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">
                                    {dish}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Hours — flat accordion, no card wrapper ── */}
        {place.hours.length > 0 && (
          <section className="mb-10">
            <button
              onClick={() => setHoursOpen(!hoursOpen)}
              className="w-full flex items-center gap-3 py-1 text-left hover:opacity-70 transition-opacity"
            >
              <Clock size={18} className="text-on-surface/40 flex-shrink-0" />
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {place.isOpen !== null && (
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wider",
                    place.isOpen ? 'text-green-600' : 'text-red-500'
                  )}>
                    {place.isOpen ? 'Open' : 'Closed'}
                  </span>
                )}
                <span className="text-sm text-on-surface/60 truncate">· {getTodayHours(place.hours)}</span>
              </div>
              <ChevronDown size={16} className={cn("text-on-surface/30 flex-shrink-0 transition-transform duration-200", hoursOpen && "rotate-180")} />
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
                  <div className="pt-3 pl-8 space-y-1.5">
                    {place.hours.map((line, i) => {
                      const [day, ...timeParts] = line.split(': ');
                      const time = timeParts.join(': ');
                      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                      const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                      return (
                        <div key={i} className={cn("flex justify-between text-sm", isToday ? 'font-semibold text-on-surface' : 'text-on-surface/45')}>
                          <span>{day}</span>
                          <span>{time}</span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {/* ── Contact & Address — flat divider rows, no card wrapper ── */}
        <section className="mb-10">
          <ul className="divide-y divide-on-surface/[0.06]">
            {place.phone && (
              <li>
                <a href={`tel:${place.phone}`} className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity">
                  <Phone size={18} className="text-on-surface/40 flex-shrink-0" />
                  <span className="text-sm text-on-surface/70">{place.phone}</span>
                </a>
              </li>
            )}
            {place.website && (
              <li>
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity">
                  <Globe size={18} className="text-on-surface/40 flex-shrink-0" />
                  <span className="text-sm text-on-surface/70 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                </a>
              </li>
            )}
            <li>
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-3 hover:opacity-70 transition-opacity">
                <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70 flex-1">{place.address}</span>
                <Navigation size={14} className="text-primary flex-shrink-0" />
              </a>
            </li>
          </ul>
        </section>

        {/* ── My Rating Details — flowing vertical layout, no cards ── */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: isHotel ? 'Hotel Breakfast' : cuisine, price: isHotel ? '' : priceStr, address: place.address };
          const hasNotes = !!myRating.notes;
          const hasTags = (myRating.tags?.length || 0) > 0;
          const hasPhotos = (myRating.photos?.length || 0) > 0;
          const hasDate = !!myRating.visitDate;
          const hasPrice = !isHotel && !!myRating.price;
          const hasFriends = !isHotel && (myRating.friendIds?.length || 0) > 0;
          const hasAny = hasNotes || hasTags || hasPhotos || hasDate || hasPrice || hasFriends;
          return (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40">My Rating Details</h3>
                <button
                  onClick={() => openAddRestaurantModal(meta, 'notes')}
                  className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary hover:text-primary/80"
                >
                  <Edit3 size={13} /> Edit
                </button>
              </div>

              {hasAny ? (
                <div className="space-y-6">
                  {hasNotes && (
                    <p className="text-base leading-relaxed italic text-on-surface/75 font-serif">
                      "{myRating.notes}"
                    </p>
                  )}

                  {hasTags && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 mb-2 flex items-center gap-1.5">
                        <Tag size={13} /> Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {myRating.tags.map((t) => (
                          <span key={t} className="text-xs font-medium px-3 py-1 rounded-full bg-primary/8 text-primary/80">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasPhotos && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40 mb-2 flex items-center gap-1.5">
                        <Image size={13} /> Photos
                      </p>
                      <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                        {myRating.photos.map((p, i) => (
                          <img
                            key={i}
                            src={p.url}
                            className="w-28 h-28 rounded-xl object-cover flex-shrink-0 snap-start"
                            referrerPolicy="no-referrer"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {(hasDate || hasPrice || hasFriends) && (
                    <ul className="space-y-3">
                      {hasDate && (
                        <li className="flex items-center gap-3 text-sm">
                          <CalendarDays size={15} className="text-on-surface/35 flex-shrink-0" />
                          <span className="text-on-surface/45 w-20 flex-shrink-0">Visited</span>
                          <span className="text-on-surface/75">{new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                        </li>
                      )}
                      {hasPrice && (
                        <li className="flex items-center gap-3 text-sm">
                          <DollarSign size={15} className="text-on-surface/35 flex-shrink-0" />
                          <span className="text-on-surface/45 w-20 flex-shrink-0">Price</span>
                          <span className="text-on-surface/75">{myRating.price}</span>
                        </li>
                      )}
                      {hasFriends && (
                        <li className="flex items-start gap-3 text-sm">
                          <Users size={15} className="text-on-surface/35 flex-shrink-0 mt-0.5" />
                          <span className="text-on-surface/45 w-20 flex-shrink-0 pt-0.5">With</span>
                          <span className="flex flex-wrap gap-1.5">
                            {myRating.friendIds.map((fid) => (
                              <span key={fid} className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/8 text-primary/80">
                                {friendNames[fid] || fid.slice(0, 8)}
                              </span>
                            ))}
                          </span>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-sm text-on-surface/35">No personal details added yet · click Edit to add notes, tags, photos</p>
              )}
            </section>
          );
        })()}

        {/* ── Visit History Timeline — minimal dots + 1px rail ── */}
        {myRating && visitHistory.length > 0 && place && (() => {
          const dotColor = (score: number) =>
            score >= 8 ? 'bg-green-500' : score >= 5 ? 'bg-yellow-500' : 'bg-red-500';
          const textColor = (score: number) =>
            score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500';
          return (
            <section className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <RotateCcw size={14} className="text-on-surface/30 flex-shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface/40">Visit History</h3>
                <span className="text-xs text-on-surface/30">· {visitHistory.length + 1} visits</span>
              </div>

              <div className="relative">
                <div className="absolute left-[3.5px] top-2 bottom-2 w-px bg-on-surface/10" />

                <ul className="space-y-6">
                  <li className="relative pl-7">
                    <div className={cn("absolute left-0 top-2 w-2 h-2 rounded-full ring-4 ring-surface", dotColor(myRating.score))} />
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={cn("text-xl font-serif font-bold leading-none", textColor(myRating.score))}>
                        {myRating.score.toFixed(1)}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Current</span>
                      {(() => {
                        const prev = visitHistory[0];
                        if (!prev) return null;
                        const diff = myRating.score - prev.score;
                        if (diff > 0.1) return <span className="inline-flex items-center gap-0.5 text-xs text-green-600 font-medium"><TrendingUp size={11} />+{diff.toFixed(1)}</span>;
                        if (diff < -0.1) return <span className="inline-flex items-center gap-0.5 text-xs text-red-500 font-medium"><TrendingDown size={11} />{diff.toFixed(1)}</span>;
                        return <span className="inline-flex items-center gap-0.5 text-xs text-on-surface/35 font-medium"><Minus size={11} />Same</span>;
                      })()}
                    </div>
                    {myRating.visitDate && (
                      <p className="mt-1 text-[13px] text-on-surface/45">
                        {new Date(myRating.visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                    {myRating.notes && (
                      <p className="mt-1.5 text-sm italic text-on-surface/55 leading-relaxed line-clamp-2">"{myRating.notes}"</p>
                    )}
                    {myRating.wouldReturn !== undefined && (
                      <p className="mt-1 text-xs font-semibold">
                        {myRating.wouldReturn
                          ? <span className="text-green-600">Would return</span>
                          : <span className="text-red-500">Wouldn't return</span>}
                      </p>
                    )}
                  </li>

                  {/* Previous visits — each expandable inline; collapsed rows
                      still show a 2-line notes preview and first-3 tag chips
                      so people can skim without tapping. */}
                  {visitHistory.map((visit, idx) => {
                    const isExpanded = expandedVisit === visit.id;
                    const prevVisit = visitHistory[idx + 1];
                    const scoreDiff = prevVisit ? visit.score - prevVisit.score : 0;
                    return (
                      <li key={visit.id} className="relative pl-7">
                        <div className={cn("absolute left-0 top-2 w-2 h-2 rounded-full ring-4 ring-surface", dotColor(visit.score))} />
                        <button
                          onClick={() => setExpandedVisit(isExpanded ? null : visit.id)}
                          className="w-full text-left hover:opacity-70 transition-opacity"
                        >
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className={cn("text-lg font-serif font-bold leading-none", textColor(visit.score))}>
                              {visit.score.toFixed(1)}
                            </span>
                            {prevVisit && Math.abs(scoreDiff) > 0.1 && (
                              scoreDiff > 0
                                ? <TrendingUp size={13} className="text-green-500" />
                                : <TrendingDown size={13} className="text-red-400" />
                            )}
                            <span className="text-[13px] text-on-surface/45">
                              {visit.visit_date ? new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'}
                            </span>
                            <ChevronDown size={14} className={cn("ml-auto text-on-surface/25 transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
                          </div>
                          {!isExpanded && visit.notes && (
                            <p className="mt-1 text-[13px] italic text-on-surface/45 leading-relaxed line-clamp-2">"{visit.notes}"</p>
                          )}
                          {!isExpanded && visit.tags && visit.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {visit.tags.slice(0, 3).map((t) => (
                                <span key={t} className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/8 text-primary/70">{t}</span>
                              ))}
                              {visit.tags.length > 3 && (
                                <span className="text-xs text-on-surface/35 self-center">+{visit.tags.length - 3}</span>
                              )}
                            </div>
                          )}
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
                              <div className="pt-2 space-y-2">
                                {visit.notes && (
                                  <p className="text-sm italic text-on-surface/55 leading-relaxed">"{visit.notes}"</p>
                                )}
                                {visit.tags && visit.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {visit.tags.map((t) => (
                                      <span key={t} className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/8 text-primary/75">{t}</span>
                                    ))}
                                  </div>
                                )}
                                {visit.photos && visit.photos.length > 0 && (
                                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                                    {visit.photos.slice(0, 8).map((p, i) => (
                                      <img key={i} src={p.url} className="w-20 h-20 rounded-lg object-cover flex-shrink-0 snap-start" referrerPolicy="no-referrer" />
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs font-semibold">
                                  {visit.would_return
                                    ? <span className="text-green-600">Would return</span>
                                    : <span className="text-red-500">Wouldn't return</span>}
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })()}

        {/* ── Map — full-bleed with caption, no card wrapper. The map
            container itself renders mapbox; a transparent overlay button
            sits above it to catch taps and route to the full /map page
            (the mapbox instance below stays visible). ── */}
        <section className="mb-10">
          <div className="relative w-full h-96 rounded-2xl overflow-hidden">
            <div ref={mapContainerRef} className="absolute inset-0" />
            <button
              type="button"
              onClick={() => navigate('/map', {
                state: {
                  focus: {
                    id: place.id,
                    name: place.name,
                    lat: place.lat,
                    lng: place.lng,
                    address: place.address,
                    fullAddress: place.fullAddress || place.address,
                    photoUrl: place.photoUrl,
                    priceLevel: place.priceLevel,
                    rating: place.rating,
                    types: place.types,
                    userRatingCount: place.userRatingCount,
                  },
                },
              })}
              aria-label="Open full map"
              className="absolute inset-0 z-10 hover:bg-on-surface/5 transition-colors"
            />
          </div>
          <div className="pt-3 flex items-center justify-between">
            <p className="text-[13px] text-on-surface/45 truncate flex-1">{place.address}</p>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary flex-shrink-0 ml-3"
            >
              Open in Maps
              <ExternalLink size={12} />
            </a>
          </div>
        </section>
      </main>

      {/* Photo Gallery Modal */}
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

      {/* Friends ratings detail modal */}
      <AnimatePresence>
        {showFriendsDetail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setShowFriendsDetail(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl max-h-[70vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-on-surface/6 flex-shrink-0">
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
                    <div key={r.id} className="bg-white rounded-xl border border-on-surface/8 p-4">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCircle size={16} className="text-primary/50" />
                          </div>
                          <span className="text-sm font-semibold text-on-surface/70">Friend</span>
                        </div>
                        <span className={cn("text-xl font-serif font-bold", scoreColor)}>{Number(r.score).toFixed(1)}</span>
                      </div>
                      {r.notes && <p className="text-[13px] text-on-surface/50 italic mt-2 leading-relaxed">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.tags.map((t) => <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
                        </div>
                      )}
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
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-on-surface/6 flex-shrink-0">
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
                    <button onClick={() => { setSendToChatOpen(false); navigate('/messages'); }}
                      className="mt-3 text-primary text-xs font-semibold">Go to Messages</button>
                  </div>
                ) : (
                  <div className="space-y-1 pt-2">
                    <div className="flex gap-2 mb-3">
                      <span className="text-xs font-bold uppercase tracking-widest text-on-surface/35 self-center">Sharing:</span>
                      <span className="text-[13px] font-semibold text-on-surface/60 truncate">{place.name}</span>
                      {myRating && <span className="text-xs text-green-500 font-semibold self-center">+ Your Review</span>}
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
