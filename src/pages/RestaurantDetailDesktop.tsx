import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Star, MapPin, Clock, Phone, Globe,
  ChevronLeft, ChevronRight, ChevronDown, Loader2,
  Navigation, ExternalLink, X, Images, Users, UserCircle, ListPlus,
} from 'lucide-react';
import { useRestaurantDetail, formatReviewCount, getTodayHours } from './useRestaurantDetail';
import 'mapbox-gl/dist/mapbox-gl.css';

/* ── Photo Gallery Modal (desktop-style centered modal) ── */
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
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl max-w-3xl w-full mx-8 max-h-[85vh] flex flex-col shadow-2xl"
      >
        <div className="flex-shrink-0 pt-4 pb-3 px-6 flex items-center justify-between border-b border-on-surface/8">
          <h2 className="text-lg font-serif font-bold">Photos</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-on-surface/5 transition-colors">
            <X size={20} className="text-on-surface/50" />
          </button>
        </div>
        <div className="flex-shrink-0 px-6 py-4">
          <div className="relative rounded-2xl overflow-hidden aspect-[16/10]">
            <img src={photos[viewIndex]} alt={`${name} photo ${viewIndex + 1}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
              {viewIndex + 1} / {photos.length}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
          <div className="grid grid-cols-5 gap-2">
            {photos.map((url, i) => (
              <button
                key={i}
                onClick={() => setViewIndex(i)}
                className={`relative aspect-square rounded-xl overflow-hidden transition-all ${i === viewIndex ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'hover:opacity-80'}`}
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

export const RestaurantDetailDesktop: React.FC = () => {
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
    <div className="pb-16 bg-surface min-h-screen">

      {/* ── Hero — wide cinematic banner ── */}
      <div className="relative w-full aspect-[16/9] max-h-[55vh] overflow-hidden">
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

        {/* Photo count badge */}
        {photos.length > 1 && (
          <button
            onClick={() => setGalleryOpen(true)}
            className="absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 text-xs font-medium hover:bg-black/40 transition-colors z-10"
          >
            <Images size={14} />
            {photos.length}
          </button>
        )}
      </div>

      {/* ── Content — centered with max-width ── */}
      <main className="px-8 pt-2 max-w-2xl mx-auto">

        {/* Name + badges */}
        <div className="mb-6">
          <h1 className="text-4xl lg:text-5xl font-serif font-bold text-on-surface leading-tight mb-2">{place.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-on-surface/55 uppercase tracking-wider">{cuisine}</span>
            <span className="text-on-surface/25">·</span>
            <span className="text-xs font-medium text-on-surface/55 uppercase tracking-wider">{priceStr}</span>
            {isMichelin && (
              <>
                <span className="text-on-surface/25">·</span>
                <span className="text-xs font-medium text-on-surface/55 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="fill-on-surface/55 text-on-surface/55" />
                  Michelin
                </span>
              </>
            )}
          </div>
        </div>

        {/* Add to List — full-width primary button */}
        <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-white font-medium text-sm hover:bg-primary/90 transition-colors mb-3">
          <ListPlus size={18} />
          Add to List
        </button>

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
            <div className="bg-white rounded-2xl p-5 border border-on-surface/8 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <UserCircle size={22} className="text-primary/50" />
              </div>
              <p className="text-xs font-medium text-on-surface">Friends</p>
              <p className="text-[11px] text-on-surface/45 mt-0.5">No ratings yet</p>
            </div>

            {/* Community */}
            <div className="bg-white rounded-2xl p-5 border border-on-surface/8 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mb-2">
                <Users size={22} className="text-violet-400" />
              </div>
              <p className="text-xs font-medium text-on-surface">Community</p>
              <p className="text-[11px] text-on-surface/45 mt-0.5">No ratings yet</p>
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
            )}

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

            <div className="flex items-center gap-3 px-4 py-3.5">
              <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
              <span className="text-sm text-on-surface/70">{place.address}</span>
            </div>
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
    </div>
  );
};
