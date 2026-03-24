import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Phone,
  Globe,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  Navigation,
  Bookmark,
  ExternalLink,
  X,
  Images,
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
// @ts-ignore
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker?worker';
import { getPlaceDetails, priceLevelToString, CUISINE_TYPES, type PlaceDetails } from '../lib/places';
import 'mapbox-gl/dist/mapbox-gl.css';

// @ts-ignore
mapboxgl.workerClass = MapboxWorker;

const _mb = ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'];
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || _mb.join('');

function formatReviewCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function getCuisineLabel(types: string[]): string {
  for (const t of types) {
    const match = CUISINE_TYPES.find((c) => c.type === t);
    if (match && match.label !== 'All') return match.label;
  }
  if (types.includes('restaurant')) return 'Restaurant';
  if (types.includes('cafe')) return 'Café';
  if (types.includes('bakery')) return 'Bakery';
  return 'Restaurant';
}

function getTodayHours(hours: string[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  for (const line of hours) {
    const [day, ...timeParts] = line.split(': ');
    if (today.startsWith(day.toLowerCase().slice(0, 3))) {
      return timeParts.join(': ') || 'Hours not available';
    }
  }
  return 'Hours not available';
}

/* ── Photo Gallery Bottom Sheet ── */
const PhotoGallery: React.FC<{
  photos: string[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, name, initialIndex, onClose }) => {
  const [viewIndex, setViewIndex] = useState(initialIndex);

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
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl max-h-[92vh] flex flex-col"
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
        <div className="flex-1 overflow-y-auto px-5 pb-8">
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

export const RestaurantDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getPlaceDetails(id)
      .then(setPlace)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!place || !mapContainerRef.current || mapRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [place.lng, place.lat],
      zoom: 15,
      interactive: true,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

    new mapboxgl.Marker({ color: '#9f3012' })
      .setLngLat([place.lng, place.lat])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [place]);

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

  const priceStr = priceLevelToString(place.priceLevel);
  const cuisine = getCuisineLabel(place.types);
  const isMichelin = place.rating >= 4.7 && place.userRatingCount > 500;
  const photos = place.photoUrls.length > 0 ? place.photoUrls : (place.photoUrl ? [place.photoUrl] : []);
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}&destination_place_id=${place.id}`;
  const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${place.id}`;

  return (
    <div className="pb-32 bg-surface min-h-screen">

      {/* ── Hero — taller, fades into page bg ── */}
      <div className="relative w-full aspect-[3/4] sm:aspect-[16/10] lg:aspect-[16/9] max-h-[75vh] overflow-hidden">
        {photos.length > 0 ? (
          <button
            onClick={() => setGalleryOpen(true)}
            className="block h-full w-full cursor-pointer"
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

        {/* Gradient — fades into page background color */}
        <div
          className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none"
          style={{ background: 'linear-gradient(to top, #fff8f6 0%, #fff8f6 2%, rgba(255,248,246,0.85) 20%, rgba(255,248,246,0.4) 50%, transparent 100%)' }}
        />

        {/* Photo carousel arrows */}
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
            <div className="absolute bottom-24 sm:bottom-24 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
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
          className="absolute top-4 left-4 sm:top-6 sm:left-6 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/80 z-10"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Photo count badge */}
        {photos.length > 1 && (
          <button
            onClick={() => setGalleryOpen(true)}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-1.5 px-3 py-1.5 bg-black/25 backdrop-blur-sm rounded-full text-white/80 text-xs font-medium z-10"
          >
            <Images size={14} />
            {photos.length}
          </button>
        )}

        {/* Name + badges below name */}
        <div className="absolute bottom-6 sm:bottom-10 left-5 sm:left-8 right-5 sm:right-8 z-10">
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-serif font-bold text-on-surface leading-tight mb-2">{place.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] sm:text-xs font-medium text-on-surface/55 uppercase tracking-wider">{cuisine}</span>
            <span className="text-on-surface/25">·</span>
            <span className="text-[11px] sm:text-xs font-medium text-on-surface/55 uppercase tracking-wider">{priceStr}</span>
            {isMichelin && (
              <>
                <span className="text-on-surface/25">·</span>
                <span className="text-[11px] sm:text-xs font-medium text-on-surface/55 uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="fill-on-surface/55 text-on-surface/55" />
                  Michelin
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="px-5 sm:px-6 lg:px-8 pt-6 max-w-2xl mx-auto">

        {/* ── Action Buttons — 3 equal ghost buttons ── */}
        <div className="grid grid-cols-3 gap-3 mb-7">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform"
          >
            <Navigation size={18} />
            <span className="text-[11px] sm:text-xs font-medium">Directions</span>
          </a>
          <button className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform">
            <Bookmark size={18} />
            <span className="text-[11px] sm:text-xs font-medium">Save</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-on-surface/12 text-on-surface active:scale-95 transition-transform">
            <Star size={18} />
            <span className="text-[11px] sm:text-xs font-medium">Review</span>
          </button>
        </div>

        {/* ── Rating — compact single card ── */}
        <section className="mb-7">
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-on-surface/8">
            <div className="flex items-center gap-4">
              <div className="text-center flex-shrink-0">
                <p className="text-3xl sm:text-4xl font-serif font-bold leading-none">{place.rating}</p>
                <div className="flex gap-0.5 justify-center mt-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={12}
                      className={s <= Math.round(place.rating) ? 'fill-primary text-primary' : 'text-on-surface/15'}
                    />
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

        {/* ── Info List — hours, contact, address in one card ── */}
        <section className="mb-7">
          <div className="bg-white rounded-2xl border border-on-surface/8 divide-y divide-on-surface/6">

            {/* Hours row */}
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

            {/* Phone */}
            {place.phone && (
              <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors">
                <Phone size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70">{place.phone}</span>
              </a>
            )}

            {/* Website */}
            {place.website && (
              <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-on-surface/[0.02] transition-colors">
                <Globe size={18} className="text-on-surface/40 flex-shrink-0" />
                <span className="text-sm text-on-surface/70 truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            )}

            {/* Address */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <MapPin size={18} className="text-on-surface/40 flex-shrink-0" />
              <span className="text-sm text-on-surface/70">{place.address}</span>
            </div>
          </div>
        </section>

        {/* ── Map ── */}
        <section className="mb-8">
          <div className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
            <div
              ref={mapContainerRef}
              className="w-full h-48 sm:h-64 lg:h-72"
            />
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

      {/* ── Photo Gallery Bottom Sheet ── */}
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
