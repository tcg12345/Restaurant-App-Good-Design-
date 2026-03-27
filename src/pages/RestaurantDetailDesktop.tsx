import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, Search, Share2, Heart,
  StickyNote, DollarSign, CalendarDays, Tag, Image, Edit3,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useRestaurantDetail, formatReviewCount, getTodayHours, getCuisineLabel } from './useRestaurantDetail';
import { useLists } from '../contexts/ListsContext';
import { getProfilesByIds } from '../lib/supabase-community';
import { priceLevelToString } from '../lib/places';

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

/* ── Photo Gallery Bottom Sheet ── */
const PhotoGallery: React.FC<{
  photos: string[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, name, initialIndex, onClose }) => {
  const [viewIndex, setViewIndex] = useState(initialIndex);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

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
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl flex flex-col"
        style={{ maxHeight: '92%' }}
      >
        {/* Handle + header */}
        <div className="flex-shrink-0 pt-3 pb-2 px-5">
          <div className="w-10 h-1 rounded-full bg-on-surface/15 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h2 className="text-base font-serif font-bold">Photos</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-on-surface/5 transition-colors"
            >
              <X size={20} className="text-on-surface/50" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex-shrink-0 px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
            <input
              type="text"
              placeholder="Search photos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
        </div>

        {/* Featured photo */}
        <div className="flex-shrink-0 px-5 pb-3">
          <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
            <img
              src={photos[viewIndex]}
              alt={`${name} photo ${viewIndex + 1}`}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
              {viewIndex + 1} / {photos.length}
            </div>
          </div>
        </div>

        {/* Thumbnail grid */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button
                key={i}
                onClick={() => setViewIndex(i)}
                className={`relative aspect-square rounded-xl overflow-hidden ${i === viewIndex ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''}`}
              >
                <img
                  src={url}
                  alt={`${name} photo ${i + 1}`}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export const RestaurantDetailDesktop: React.FC = () => {
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
  } = useRestaurantDetail();

  const { openRatingModal, openWishlistModal, isWishlisted, getRating, openAddRestaurantModal } = useLists();
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [friendNames, setFriendNames] = useState<Record<string, string>>({});

  const myRating = place ? getRating(place.id) : undefined;

  useEffect(() => {
    if (!myRating?.friendIds?.length) return;
    getProfilesByIds(myRating.friendIds).then((profiles) => {
      const names: Record<string, string> = {};
      Object.values(profiles).forEach((p) => { names[p.user_id] = p.display_name || `@${p.username}`; });
      setFriendNames(names);
    });
  }, [myRating?.friendIds]);

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
            <span className="text-xs font-semibold text-on-surface/70 uppercase tracking-wider">{cuisine}</span>
            <span className="text-on-surface/35">·</span>
            <span className="text-xs font-semibold text-on-surface/70 uppercase tracking-wider">{priceStr}</span>
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

        {/* Action buttons — Rate, Wishlist */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => place && openRatingModal({
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

        {/* Action row — Directions, Website, Photos */}
        <div className="grid grid-cols-3 gap-3 mb-7">
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
        </div>

        {/* My Rating details */}
        {myRating && place && (() => {
          const meta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine, price: priceStr, address: place.address };
          const details = [
            { key: 'notes', icon: <StickyNote size={16} />, label: 'Notes', hasContent: !!myRating.notes, content: myRating.notes ? <p className="text-xs text-on-surface/60 italic">"{myRating.notes}"</p> : null },
            { key: 'price', icon: <DollarSign size={16} />, label: 'Price', hasContent: !!myRating.price, content: myRating.price ? <p className="text-xs text-on-surface/60">{myRating.price}</p> : null },
            { key: 'date', icon: <CalendarDays size={16} />, label: 'Visit Date', hasContent: !!myRating.visitDate, content: myRating.visitDate ? <p className="text-xs text-on-surface/60">{new Date(myRating.visitDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p> : null },
            { key: 'tags', icon: <Tag size={16} />, label: 'Tags', hasContent: myRating.tags?.length > 0, content: myRating.tags?.length > 0 ? <div className="flex flex-wrap gap-1">{myRating.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{t}</span>)}</div> : null },
            { key: 'photos', icon: <Image size={16} />, label: 'Photos', hasContent: myRating.photos?.length > 0, content: myRating.photos?.length > 0 ? <div className="grid grid-cols-4 gap-1 rounded-lg overflow-hidden">{myRating.photos.slice(0, 4).map((p, i) => <img key={i} src={p.url} className="aspect-square object-cover" referrerPolicy="no-referrer" />)}</div> : null },
            { key: 'friends', icon: <Users size={16} />, label: 'Went With', hasContent: (myRating.friendIds?.length || 0) > 0, content: (myRating.friendIds?.length || 0) > 0 ? <div className="flex flex-wrap gap-1.5">{myRating.friendIds.map((fid) => <span key={fid} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{friendNames[fid] || fid.slice(0, 8)}</span>)}</div> : null },
          ];
          return (
            <section className="mb-7">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">My Rating</h3>
                <span className={cn("text-lg font-serif font-bold", myRating.score >= 8 ? 'text-green-600' : myRating.score >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                  {myRating.score.toFixed(1)}<span className="text-[10px] text-on-surface/30 font-normal"> / 10</span>
                </span>
              </div>
              <div className="space-y-1.5">
                {details.map((d) => (
                  <div key={d.key} className="bg-white rounded-xl border border-on-surface/8 overflow-hidden">
                    <button onClick={() => setExpandedDetail(expandedDetail === d.key ? null : d.key)}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left">
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
                                <button onClick={() => openAddRestaurantModal(meta)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/70">
                                  <Edit3 size={11} /> Edit
                                </button>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs text-on-surface/30 mb-2">Nothing added yet</p>
                                <button onClick={() => openAddRestaurantModal(meta)}
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
              </div>
            </section>
          );
        })()}

        {/* Ratings — Google, Friends, Community side by side */}
        <section className="mb-7">
          <div className="grid grid-cols-3 gap-3">
            {/* Google */}
            <div className="bg-white rounded-2xl p-5 border border-on-surface/8 flex flex-col items-center text-center">
              <p className="text-3xl font-serif font-bold leading-none">{place.rating}</p>
              <div className="flex gap-0.5 justify-center mt-1.5 mb-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} size={11} className={s <= Math.round(place.rating) ? 'fill-primary text-primary' : 'text-on-surface/15'} />
                ))}
              </div>
              <p className="text-xs font-medium text-on-surface">Google</p>
              <p className="text-[11px] text-on-surface/45 mt-0.5">{formatReviewCount(place.userRatingCount)} ratings</p>
            </div>

            {/* Friends */}
            <button onClick={() => friendsStats.totalRatings > 0 && setShowFriendsDetail(true)}
              className="bg-white rounded-2xl p-5 border border-on-surface/8 flex flex-col items-center text-center hover:border-primary/20 transition-colors">
              {friendsStats.totalRatings > 0 ? (
                <>
                  <p className="text-3xl font-serif font-bold leading-none text-primary">{friendsStats.avgScore.toFixed(1)}</p>
                  <p className="text-[10px] text-on-surface/35 font-medium mt-0.5 mb-2">/ 10</p>
                </>
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <UserCircle size={22} className="text-primary/50" />
                </div>
              )}
              <p className="text-xs font-medium text-on-surface">Friends</p>
              <p className="text-[11px] text-on-surface/45 mt-0.5">{friendsStats.totalRatings > 0 ? `${friendsStats.totalRatings} rating${friendsStats.totalRatings !== 1 ? 's' : ''}` : 'No ratings yet'}</p>
            </button>

            {/* Community */}
            <div className="bg-white rounded-2xl p-5 border border-on-surface/8 flex flex-col items-center text-center">
              {communityStats.totalRatings > 0 ? (
                <>
                  <p className="text-3xl font-serif font-bold leading-none text-violet-600">{communityStats.avgScore.toFixed(1)}</p>
                  <p className="text-[10px] text-on-surface/35 font-medium mt-0.5 mb-2">/ 10</p>
                </>
              ) : (
                <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mb-2">
                  <Users size={22} className="text-violet-400" />
                </div>
              )}
              <p className="text-xs font-medium text-on-surface">Community</p>
              <p className="text-[11px] text-on-surface/45 mt-0.5">{communityStats.totalRatings > 0 ? `${communityStats.totalRatings} rating${communityStats.totalRatings !== 1 ? 's' : ''}` : 'No ratings yet'}</p>
            </div>
          </div>
        </section>

        {/* Hours */}
        {place.hours.length > 0 && (
          <section className="mb-3">
            <div className="bg-white rounded-2xl border border-on-surface/8">
              <button
                onClick={() => setHoursOpen(!hoursOpen)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-on-surface/[0.02] transition-colors"
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
              <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-on-surface/[0.02] transition-colors">
                <Phone size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70">{place.phone}</span>
              </a>
            )}

            {place.website && (
              <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 hover:bg-on-surface/[0.02] transition-colors">
                <Globe size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            )}

            <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 hover:bg-on-surface/[0.02] transition-colors">
              <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
              <span className="text-sm text-on-surface/70 flex-1">{place.address}</span>
              <Navigation size={14} className="text-primary flex-shrink-0" />
            </a>
          </div>
        </section>

        {/* Map */}
        <section className="mb-8">
          <div className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
            <div ref={mapContainerRef} className="w-full h-72" />
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

      {/* Photo Gallery Modal */}
      <AnimatePresence>
        {galleryOpen && photos.length > 0 && (
          <PhotoGallery
            photos={photos}
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
                      {r.notes && <p className="text-xs text-on-surface/50 italic mt-2">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/60">{t}</span>)}
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
    </div>
  );
};
