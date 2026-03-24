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
  Heart,
  Share2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  UserCheck,
  Loader2,
  Navigation,
  Bookmark,
  ListPlus,
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

export const RestaurantDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hoursOpen, setHoursOpen] = useState(false);
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
        <button onClick={() => navigate(-1)} className="text-primary font-bold">Go Back</button>
      </div>
    );
  }

  const priceStr = priceLevelToString(place.priceLevel);
  const cuisine = getCuisineLabel(place.types);
  const isMichelin = place.rating >= 4.7 && place.userRatingCount > 500;
  const photos = place.photoUrls.length > 0 ? place.photoUrls : (place.photoUrl ? [place.photoUrl] : []);
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}&destination_place_id=${place.id}`;

  return (
    <div className="pb-32 bg-surface min-h-screen">
      {/* ── Hero with Photo Carousel ── */}
      <div className="relative h-[38vh] sm:h-[50vh] lg:h-[60vh] w-full overflow-hidden">
        {photos.length > 0 ? (
          <img
            src={photos[photoIndex]}
            alt={place.name}
            className="h-full w-full object-cover transition-all duration-500"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-full w-full bg-muted flex items-center justify-center">
            <MapPin size={64} className="text-on-surface/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/20" />

        {/* Photo arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 bg-black/30 backdrop-blur-sm rounded-full text-white/90 z-10"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-black/30 backdrop-blur-sm rounded-full text-white/90 z-10"
            >
              <ChevronRight size={16} />
            </button>
            <div className="absolute bottom-20 sm:bottom-28 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIndex(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === photoIndex ? 'bg-white w-4' : 'bg-white/40'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Top nav */}
        <div className="absolute top-4 left-4 right-4 sm:top-6 sm:left-6 sm:right-6 flex items-center justify-between z-10">
          <button
            onClick={() => navigate(-1)}
            className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white/90"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex gap-2">
            <button className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white/90">
              <Share2 size={18} />
            </button>
            <button className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white/90">
              <Heart size={18} />
            </button>
          </div>
        </div>

        {/* Restaurant info overlay */}
        <div className="absolute bottom-4 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8">
          <div className="flex items-center gap-2 mb-2 text-white/80">
            <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider">{cuisine}</span>
            <span className="text-white/40">·</span>
            <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider">{priceStr}</span>
            {isMichelin && (
              <>
                <span className="text-white/40">·</span>
                <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                  <Star size={10} className="fill-white text-white" />
                  Michelin
                </span>
              </>
            )}
          </div>
          <h1 className="text-xl sm:text-3xl lg:text-5xl font-serif font-bold text-white mb-1.5 leading-tight">{place.name}</h1>
          <div className="flex items-center gap-1.5 text-white/60">
            <MapPin size={13} />
            <span className="text-[11px] sm:text-sm font-medium truncate">{place.address}</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="px-4 sm:px-6 lg:px-8 pt-4 relative z-20 max-w-4xl mx-auto">

        {/* ── Action Buttons Row ── */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1 py-2.5 sm:py-3 bg-primary text-white rounded-xl sm:rounded-2xl shadow-md active:scale-95 transition-transform"
          >
            <Navigation size={16} className="sm:w-5 sm:h-5" />
            <span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider">Directions</span>
          </a>
          <button className="flex flex-col items-center gap-1 py-2.5 sm:py-3 bg-white text-on-surface rounded-xl sm:rounded-2xl shadow-sm border border-muted active:scale-95 transition-transform">
            <Bookmark size={16} className="sm:w-5 sm:h-5" />
            <span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider">Wishlist</span>
          </button>
          <button className="flex flex-col items-center gap-1 py-2.5 sm:py-3 bg-white text-on-surface rounded-xl sm:rounded-2xl shadow-sm border border-muted active:scale-95 transition-transform">
            <Star size={16} className="sm:w-5 sm:h-5" />
            <span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider">Rate</span>
          </button>
          <button className="flex flex-col items-center gap-1 py-2.5 sm:py-3 bg-white text-on-surface rounded-xl sm:rounded-2xl shadow-sm border border-muted active:scale-95 transition-transform">
            <ListPlus size={16} className="sm:w-5 sm:h-5" />
            <span className="text-[9px] sm:text-xs font-bold uppercase tracking-wider">List</span>
          </button>
        </div>

        {/* ── Rating Cards ── */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          {/* Google */}
          <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-sm border border-muted text-center">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-1.5">
              <Star size={12} className="text-primary fill-primary sm:w-4 sm:h-4" />
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mb-0.5">Google</p>
            <p className="text-xl sm:text-3xl font-serif font-bold leading-none">{place.rating}</p>
            <div className="flex gap-px justify-center mt-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  size={8}
                  className={s <= Math.round(place.rating) ? 'fill-primary text-primary' : 'text-muted'}
                />
              ))}
            </div>
            <p className="text-[9px] text-on-surface/40 mt-0.5">{formatReviewCount(place.userRatingCount)}</p>
          </div>

          {/* Friends */}
          <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-sm border border-muted text-center">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-secondary/10 flex items-center justify-center mx-auto mb-1.5">
              <UserCheck size={12} className="text-secondary sm:w-4 sm:h-4" />
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mb-0.5">Friends</p>
            <p className="text-xl sm:text-3xl font-serif font-bold leading-none text-on-surface/20">—</p>
            <p className="text-[9px] text-on-surface/30 mt-1">No ratings</p>
          </div>

          {/* Community */}
          <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-sm border border-muted text-center">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-1.5">
              <Users size={12} className="text-accent sm:w-4 sm:h-4" />
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mb-0.5">Community</p>
            <p className="text-xl sm:text-3xl font-serif font-bold leading-none text-on-surface/20">—</p>
            <p className="text-[9px] text-on-surface/30 mt-1">No ratings</p>
          </div>
        </div>

        {/* ── Hours Dropdown ── */}
        {place.hours.length > 0 && (
          <section className="mb-4">
            <button
              onClick={() => setHoursOpen(!hoursOpen)}
              className="w-full bg-white rounded-xl sm:rounded-2xl px-3 sm:px-4 py-3 shadow-sm border border-muted flex items-center justify-between active:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <Clock size={16} className="text-primary flex-shrink-0" />
                <span className="text-xs sm:text-sm font-bold">Hours</span>
                {place.isOpen !== null && (
                  <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${place.isOpen ? 'text-green-600' : 'text-red-500'}`}>
                    {place.isOpen ? 'Open' : 'Closed'}
                  </span>
                )}
                <span className="text-[10px] sm:text-xs text-on-surface/50 truncate">{getTodayHours(place.hours)}</span>
              </div>
              <ChevronDown size={16} className={`text-on-surface/40 flex-shrink-0 transition-transform duration-200 ${hoursOpen ? 'rotate-180' : ''}`} />
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
                  <div className="bg-white rounded-b-xl sm:rounded-b-2xl -mt-1.5 pt-3 pb-2.5 px-3 sm:px-4 border border-t-0 border-muted shadow-sm space-y-1.5">
                    {place.hours.map((line, i) => {
                      const [day, ...timeParts] = line.split(': ');
                      const time = timeParts.join(': ');
                      const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                      const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                      return (
                        <div key={i} className={`flex justify-between text-xs sm:text-sm ${isToday ? 'font-bold text-on-surface' : 'text-on-surface/50'}`}>
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

        {/* ── Contact ── */}
        {(place.phone || place.website) && (
          <section className="mb-4">
            <div className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-sm border border-muted space-y-2.5">
              {place.phone && (
                <a href={`tel:${place.phone}`} className="flex items-center gap-2.5 text-on-surface/60 hover:text-primary transition-colors">
                  <Phone size={16} className="text-primary flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium">{place.phone}</span>
                </a>
              )}
              {place.website && (
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-on-surface/60 hover:text-primary transition-colors">
                  <Globe size={16} className="text-primary flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                </a>
              )}
              <div className="flex items-center gap-2.5 text-on-surface/60">
                <MapPin size={16} className="text-primary flex-shrink-0" />
                <span className="text-xs sm:text-sm font-medium">{place.address}</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Map ── */}
        <section className="mb-6">
          <h3 className="text-base sm:text-lg font-serif font-bold mb-2">Location</h3>
          <div
            ref={mapContainerRef}
            className="w-full h-40 sm:h-56 lg:h-72 rounded-xl sm:rounded-2xl overflow-hidden shadow-sm"
          />
          <p className="text-[10px] sm:text-xs text-on-surface/40 mt-1.5">{place.address}</p>
        </section>
      </main>
    </div>
  );
};
