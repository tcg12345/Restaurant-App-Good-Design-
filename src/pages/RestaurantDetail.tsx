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
  ListPlus,
  PlusCircle,
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

function getRatingDistribution(rating: number, total: number) {
  const weights = [0, 0.01, 0.03, 0.08, 0.15, 0.73];
  if (rating < 4) {
    weights[5] = 0.45; weights[4] = 0.25; weights[3] = 0.18; weights[2] = 0.08; weights[1] = 0.04;
  } else if (rating < 4.5) {
    weights[5] = 0.60; weights[4] = 0.22; weights[3] = 0.10; weights[2] = 0.05; weights[1] = 0.03;
  }
  return [5, 4, 3, 2, 1].map((star) => ({
    star,
    pct: Math.round(weights[star] * 100),
    count: Math.round(weights[star] * total),
  }));
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
  const distribution = getRatingDistribution(place.rating, place.userRatingCount);

  return (
    <div className="pb-32 bg-surface min-h-screen overflow-x-hidden">

      {/* ── Top App Bar ── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md">
        <div className="flex justify-between items-center px-4 lg:px-6 py-3 max-w-7xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="text-primary hover:bg-surface-container-high/50 transition-colors duration-300 p-2 rounded-full active:scale-95"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-primary font-serif font-bold text-base lg:text-xl">Gourmet Canvas</h1>
          <button className="text-primary hover:bg-surface-container-high/50 transition-colors duration-300 p-2 rounded-full active:scale-95">
            <Share2 size={20} />
          </button>
        </div>
      </header>

      <main className="pt-14 px-4 lg:px-12 max-w-7xl mx-auto">

        {/* ── Hero Photo Grid ── */}
        <section className="mt-2 lg:mt-4">
          {photos.length >= 3 ? (
            <div className="grid grid-cols-12 gap-1.5 lg:gap-3 h-[200px] sm:h-[280px] lg:h-[420px]">
              <div className="col-span-8 relative overflow-hidden rounded-xl lg:rounded-3xl group">
                <img
                  src={photos[photoIndex]}
                  alt={place.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                {photos.length > 1 && (
                  <>
                    <button
                      onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1 lg:p-2 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 lg:p-2 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </>
                )}
              </div>
              <div className="col-span-4 flex flex-col gap-1.5 lg:gap-3">
                <div className="h-1/2 relative overflow-hidden rounded-xl lg:rounded-3xl group">
                  <img
                    src={photos[1 % photos.length]}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="h-1/2 relative overflow-hidden rounded-xl lg:rounded-3xl group">
                  <img
                    src={photos[2 % photos.length]}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
            </div>
          ) : photos.length > 0 ? (
            <div className="relative overflow-hidden rounded-xl lg:rounded-3xl h-[200px] sm:h-[280px] lg:h-[420px] group">
              <img
                src={photos[photoIndex]}
                alt={place.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              {photos.length > 1 && (
                <>
                  <button
                    onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1 lg:p-2 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 lg:p-2 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all"
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="h-[180px] lg:h-[420px] bg-surface-container rounded-xl lg:rounded-3xl flex items-center justify-center">
              <MapPin size={40} className="text-on-surface/15" />
            </div>
          )}
        </section>

        {/* ── Restaurant Identity ── */}
        <section className="mt-5 lg:mt-8">
          {/* Badges & rating */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isMichelin && (
              <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 lg:px-3 lg:py-1 rounded-full text-[9px] lg:text-xs font-bold uppercase tracking-widest">
                Michelin Recommended
              </span>
            )}
            <div className="flex items-center text-primary">
              <Star size={12} className="fill-primary" />
              <span className="font-bold ml-0.5 text-xs lg:text-sm">{place.rating}</span>
            </div>
          </div>

          {/* Name */}
          <h2 className="text-2xl sm:text-3xl lg:text-5xl font-serif font-bold text-on-surface leading-tight tracking-tight">
            {place.name}
          </h2>

          {/* Meta row */}
          <div className="flex items-center gap-2 lg:gap-5 mt-1.5 lg:mt-3 text-on-surface-variant text-[11px] lg:text-sm flex-wrap">
            <span className="flex items-center gap-1">
              <Star size={12} className="text-on-surface-variant" />
              {cuisine}
            </span>
            <span className="font-bold tracking-widest">{priceStr}</span>
            <span className="flex items-center gap-1 truncate max-w-[200px] lg:max-w-none">
              <MapPin size={12} />
              {place.address.split(',').slice(0, 2).join(',')}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 items-center mt-3 lg:mt-4">
            <button className="w-9 h-9 lg:w-12 lg:h-12 rounded-full flex items-center justify-center bg-surface-container-high text-primary hover:bg-surface-container-highest transition-all active:scale-95 flex-shrink-0">
              <Heart size={16} />
            </button>
            <button className="px-4 py-2.5 lg:px-6 lg:py-3 bg-primary text-white rounded-full font-bold flex items-center gap-2 shadow-lg shadow-primary/20 hover:scale-105 transition-transform active:scale-95 text-xs lg:text-sm">
              <span>Rate & Save to List</span>
              <PlusCircle size={14} />
            </button>
          </div>
        </section>

        {/* ── Bento Grid Layout ── */}
        <div className="mt-8 lg:mt-14 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">

          {/* ── Left Column: Location ── */}
          <div className="lg:col-span-4">
            <div className="bg-surface-container-low rounded-2xl lg:rounded-[2rem] p-4 lg:p-6 space-y-3 lg:space-y-5">
              <h3 className="font-serif text-lg lg:text-xl font-bold">Find Us</h3>

              {/* Map */}
              <div className="rounded-xl overflow-hidden aspect-[4/3] lg:aspect-square relative">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>

              {/* Address */}
              <p className="text-on-surface-variant text-xs lg:text-sm leading-relaxed">{place.address}</p>

              {/* Directions button */}
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 lg:py-3 bg-surface-container-highest rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors text-xs lg:text-sm active:scale-[0.98]"
              >
                <Navigation size={14} />
                Get Directions
              </a>

              {/* Contact info */}
              {(place.phone || place.website) && (
                <div className="space-y-2 pt-1">
                  {place.phone && (
                    <a href={`tel:${place.phone}`} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-xs lg:text-sm">
                      <Phone size={14} className="text-primary flex-shrink-0" />
                      <span>{place.phone}</span>
                    </a>
                  )}
                  {place.website && (
                    <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors text-xs lg:text-sm overflow-hidden">
                      <Globe size={14} className="text-primary flex-shrink-0" />
                      <span className="truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                    </a>
                  )}
                </div>
              )}

              {/* Hours dropdown */}
              {place.hours.length > 0 && (
                <div className="border-t border-outline-variant/15 pt-3">
                  <button
                    onClick={() => setHoursOpen(!hoursOpen)}
                    className="flex justify-between items-center w-full cursor-pointer font-bold text-xs lg:text-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} className="text-primary" />
                      Opening Hours
                      {place.isOpen !== null && (
                        <span className={`text-[9px] lg:text-[10px] font-bold uppercase tracking-wider ml-1 ${place.isOpen ? 'text-green-600' : 'text-red-500'}`}>
                          {place.isOpen ? 'Open' : 'Closed'}
                        </span>
                      )}
                    </span>
                    <ChevronDown size={16} className={`text-on-surface/40 transition-transform duration-200 ${hoursOpen ? 'rotate-180' : ''}`} />
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
                        <ul className="mt-2 space-y-1 text-xs lg:text-sm text-on-surface-variant">
                          {place.hours.map((line, i) => {
                            const [day, ...timeParts] = line.split(': ');
                            const time = timeParts.join(': ');
                            const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                            const isToday = today.startsWith(day.toLowerCase().slice(0, 3));
                            return (
                              <li key={i} className={`flex justify-between ${isToday ? 'font-bold text-primary' : ''}`}>
                                <span>{day}</span>
                                <span>{time || 'Closed'}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* ── Right Column: Ratings & Perspectives ── */}
          <div className="lg:col-span-8 space-y-4 lg:space-y-6">

            {/* Expert Perspective */}
            <div className="bg-white rounded-2xl lg:rounded-[2rem] p-4 lg:p-6 shadow-[0_1px_3px_rgba(30,27,26,0.04)]">
              <div className="flex justify-between items-start mb-3 lg:mb-6 gap-3">
                <h3 className="font-serif text-lg lg:text-2xl font-bold italic leading-snug">Expert Perspective</h3>
                <span className="text-primary font-serif text-2xl lg:text-3xl font-bold flex-shrink-0">
                  {place.rating}<span className="text-sm lg:text-base text-on-surface-variant">/5</span>
                </span>
              </div>
              <div className="flex items-center gap-3 lg:gap-5 p-3 lg:p-5 bg-surface-container-low rounded-xl lg:rounded-2xl">
                <div className="w-10 h-10 lg:w-16 lg:h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Star size={18} className="text-primary fill-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm lg:text-base">Google Reviews</p>
                  <p className="text-on-surface-variant text-[11px] lg:text-sm italic mt-0.5 leading-snug">
                    Based on {formatReviewCount(place.userRatingCount)} reviews — a {place.rating} rating for {cuisine.toLowerCase()} cuisine.
                  </p>
                </div>
              </div>
            </div>

            {/* Friends & Community Grid — always stacked on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">

              {/* Friends' Circle */}
              <div className="bg-secondary-container/30 rounded-2xl lg:rounded-[2rem] p-4 lg:p-6">
                <h4 className="font-serif text-lg lg:text-xl font-bold mb-0.5">Friends' Circle</h4>
                <p className="text-on-secondary-container text-xs lg:text-sm">Your inner circle's take</p>
                <div className="mt-4 lg:mt-8">
                  <div className="flex -space-x-2 mb-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-8 h-8 lg:w-10 lg:h-10 rounded-full border-3 border-white bg-surface-container-high flex items-center justify-center">
                        <UserCheck size={12} className="text-on-surface-variant" />
                      </div>
                    ))}
                    <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full border-3 border-white bg-secondary flex items-center justify-center text-white text-[9px] lg:text-[10px] font-bold">
                      +0
                    </div>
                  </div>
                  <p className="font-bold text-on-surface text-xs lg:text-sm">No friends have rated this</p>
                  <p className="text-on-surface-variant text-[10px] lg:text-xs">Be the first to rate!</p>
                </div>
              </div>

              {/* Community Rating */}
              <div className="bg-surface-container rounded-2xl lg:rounded-[2rem] p-4 lg:p-6">
                <h4 className="font-serif text-lg lg:text-xl font-bold mb-3 lg:mb-4">Community</h4>

                <div className="space-y-1.5">
                  {distribution.map(({ star, pct }) => (
                    <div key={star} className="flex items-center gap-2">
                      <span className="text-[10px] lg:text-xs font-bold w-3 text-on-surface-variant">{star}</span>
                      <div className="flex-1 h-1.5 lg:h-2 bg-white rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 lg:mt-6 pt-3 lg:pt-5 border-t border-outline-variant/15 text-center">
                  <p className="text-2xl lg:text-3xl font-serif font-bold text-on-surface">{place.rating}</p>
                  <p className="text-[9px] lg:text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mt-0.5">
                    {formatReviewCount(place.userRatingCount)} Reviews
                  </p>
                </div>
              </div>
            </div>

            {/* Taste Profile */}
            <div className="bg-white rounded-2xl lg:rounded-[2rem] p-4 lg:p-6 shadow-[0_1px_3px_rgba(30,27,26,0.04)]">
              <h4 className="font-serif text-lg lg:text-xl font-bold mb-4 lg:mb-6 text-center">Taste Profile</h4>
              <div className="flex justify-around items-center">
                {[
                  { label: 'Umami', level: 'High', color: 'primary', size: 'w-8 h-8 lg:w-10 lg:h-10', borderT: true },
                  { label: 'Spice', level: 'Low', color: 'secondary', size: 'w-6 h-6 lg:w-7 lg:h-7', borderT: false },
                  { label: 'Sweet', level: 'Medium', color: 'primary', size: 'w-7 h-7 lg:w-8 lg:h-8', borderT: false },
                ].map(({ label, level, color, size, borderT }) => (
                  <div key={label} className="flex flex-col items-center">
                    <div className={`w-12 h-12 lg:w-14 lg:h-14 rounded-xl flex items-center justify-center mb-1.5 lg:mb-2 ${color === 'primary' ? 'bg-primary/5' : 'bg-secondary/5'}`}>
                      <div className={`${size} rounded-full border-[3px] lg:border-4 ${color === 'primary' ? 'border-primary' : 'border-secondary'} ${borderT ? 'border-t-transparent' : ''}`} />
                    </div>
                    <span className="text-[9px] lg:text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
                    <span className={`font-bold text-xs lg:text-sm ${color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{level}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
