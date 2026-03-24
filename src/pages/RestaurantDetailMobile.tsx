import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, Bookmark, ExternalLink, X, Images,
} from 'lucide-react';
import { useRestaurantDetail, formatReviewCount, getTodayHours } from './useRestaurantDetail';
import 'mapbox-gl/dist/mapbox-gl.css';

/* ── Photo Gallery Bottom Sheet ── */
const PhotoGallery: React.FC<{
  photos: string[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, name, initialIndex, onClose }) => {
  const [viewIndex, setViewIndex] = useState(initialIndex);

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
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm touch-none"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl max-h-[92vh] flex flex-col"
      >
        <div className="flex-shrink-0 pt-3 pb-2 px-5">
          <div className="w-10 h-1 rounded-full bg-on-surface/15 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h2 className="text-base font-serif font-bold">Photos</h2>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-on-surface/5 transition-colors">
              <X size={20} className="text-on-surface/50" />
            </button>
          </div>
        </div>
        <div className="flex-shrink-0 px-5 pb-3">
          <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
            <img src={photos[viewIndex]} alt={`${name} photo ${viewIndex + 1}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
              {viewIndex + 1} / {photos.length}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
          <div className="grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button
                key={i}
                onClick={() => setViewIndex(i)}
                className={`relative aspect-square rounded-xl overflow-hidden ${i === viewIndex ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''}`}
              >
                <img src={url} alt={`${name} photo ${i + 1}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
      <div className="relative w-full min-h-[65vh] max-h-[80vh] overflow-hidden">
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
        <div className="absolute bottom-10 left-5 right-5 z-10">
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

        {/* Action Buttons */}
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
          <button className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform">
            <Bookmark size={18} />
            <span className="text-[11px] font-medium">Save</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform">
            <Star size={18} />
            <span className="text-[11px] font-medium">Review</span>
          </button>
        </div>

        {/* Rating */}
        <section className="mb-7">
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
            <p className="text-xs text-on-surface/40 mt-3 pt-3 border-t border-on-surface/6">
              No ratings from your network yet
            </p>
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
