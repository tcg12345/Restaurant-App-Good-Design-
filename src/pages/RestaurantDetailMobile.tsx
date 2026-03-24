import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, ListPlus,
} from 'lucide-react';
import { useRestaurantDetail, formatReviewCount, getTodayHours } from './useRestaurantDetail';
import 'mapbox-gl/dist/mapbox-gl.css';

/* ── Photo Gallery — mobile bottom sheet ── */
const PhotoGallery: React.FC<{
  photos: string[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, name, initialIndex, onClose }) => {
  const [viewIndex, setViewIndex] = useState(initialIndex);
  const thumbsRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  /* Auto-scroll the thumbnail strip to keep selected thumb visible */
  useEffect(() => {
    const strip = thumbsRef.current;
    if (!strip) return;
    const thumb = strip.children[viewIndex] as HTMLElement | undefined;
    if (thumb) {
      thumb.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [viewIndex]);

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
        style={{ maxHeight: '85vh' }}
      >
        {/* Drag handle */}
        <div className="flex-shrink-0 pt-3 px-5">
          <div className="w-10 h-1 rounded-full bg-on-surface/15 mx-auto" />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3">
          <h2 className="text-base font-serif font-bold">Photos</h2>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-full active:bg-on-surface/5 transition-colors">
            <X size={20} className="text-on-surface/50" />
          </button>
        </div>

        {/* Featured photo with nav arrows */}
        <div className="flex-shrink-0 px-4 pb-3 relative">
          <div className="relative rounded-2xl overflow-hidden aspect-[4/3] bg-on-surface/5">
            <img
              src={photos[viewIndex]}
              alt={`${name} photo ${viewIndex + 1}`}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />

            {/* Counter badge */}
            <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full">
              {viewIndex + 1} / {photos.length}
            </div>

            {/* Prev / Next arrows */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={() => setViewIndex((i) => (i - 1 + photos.length) % photos.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/30 backdrop-blur-sm rounded-full text-white/80"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => setViewIndex((i) => (i + 1) % photos.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/30 backdrop-blur-sm rounded-full text-white/80"
                >
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Horizontal thumbnail strip */}
        <div className="flex-shrink-0 pb-6 pt-1">
          <div
            ref={thumbsRef}
            className="flex gap-2 px-4 overflow-x-auto scrollbar-hide"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            {photos.map((url, i) => (
              <button
                key={i}
                onClick={() => setViewIndex(i)}
                className={`flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden transition-all ${
                  i === viewIndex
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface scale-105'
                    : 'opacity-60'
                }`}
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

export const RestaurantDetailMobile: React.FC = () => {
  const {
    place, loading, error, navigate,
    photoIndex, setPhotoIndex,
    hoursOpen, setHoursOpen,
    galleryOpen, setGalleryOpen,
    mapContainerRef,
    priceStr, cuisine, isMichelin,
    photos, directionsUrl, mapsUrl,
  } = useRestaurantDetail();

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
      <div className="relative w-full overflow-hidden" style={{ height: '65vh', maxHeight: '80vh' }}>
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

        {/* Photo count badge */}
        {photos.length > 1 && (
          <button
            onClick={() => setGalleryOpen(true)}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 text-xs font-medium z-10"
          >
            <Images size={14} />
            {photos.length}
          </button>
        )}

        {/* Name + badges — anchored at very bottom, white on dark gradient */}
        <div className="absolute bottom-10 left-5 right-5 z-10 pointer-events-none">
          <h1 className="text-2xl font-serif font-bold text-white leading-tight mb-1.5 drop-shadow-lg">{place.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-white/75 uppercase tracking-wider">{cuisine}</span>
            <span className="text-white/35">·</span>
            <span className="text-[11px] font-medium text-white/75 uppercase tracking-wider">{priceStr}</span>
            {isMichelin && (
              <>
                <span className="text-white/35">·</span>
                <span className="text-[11px] font-medium text-white/75 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="fill-white/75 text-white/75" />
                  Michelin
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="px-5 pt-6">

        {/* Add to List — full-width primary button */}
        <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-white font-medium text-sm active:scale-[0.98] transition-transform mb-3">
          <ListPlus size={18} />
          Add to List
        </button>

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

        {/* Ratings — Google, Friends, Community */}
        <section className="mb-7 space-y-3">
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

          {/* Friends */}
          <div className="bg-white rounded-2xl p-4 border border-on-surface/8">
            <div className="flex items-center gap-4">
              <div className="text-center flex-shrink-0 w-14">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <UserCircle size={20} className="text-primary/50" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface">Friends</p>
                <p className="text-xs text-on-surface/45 mt-0.5">No friends have rated this place yet</p>
              </div>
            </div>
          </div>

          {/* Community */}
          <div className="bg-white rounded-2xl p-4 border border-on-surface/8">
            <div className="flex items-center gap-4">
              <div className="text-center flex-shrink-0 w-14">
                <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mx-auto">
                  <Users size={20} className="text-violet-400" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface">Community</p>
                <p className="text-xs text-on-surface/45 mt-0.5">No community ratings yet</p>
              </div>
            </div>
          </div>
        </section>

        {/* Info List */}
        <section className="mb-7">
          <div className="bg-white rounded-2xl border border-on-surface/8 divide-y divide-on-surface/6">
            {place.hours.length > 0 && (
              <div>
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
            )}

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

            <div className="flex items-center gap-3 px-4 py-3.5">
              <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
              <span className="text-sm text-on-surface/70">{place.address}</span>
            </div>
          </div>
        </section>

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
            name={place.name}
            initialIndex={photoIndex}
            onClose={() => setGalleryOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
