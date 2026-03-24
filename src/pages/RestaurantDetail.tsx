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

/* Generate simple rating distribution from total count */
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
    <div className="pb-32 bg-surface min-h-screen">

      {/* ── Top App Bar ── */}
      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md">
        <div className="flex justify-between items-center px-4 md:px-6 py-3 max-w-7xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="text-primary hover:bg-surface-container-high/50 transition-colors duration-300 p-2 rounded-full active:scale-95"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-primary font-serif font-bold text-lg md:text-2xl">Gourmet Canvas</h1>
          <button className="text-primary hover:bg-surface-container-high/50 transition-colors duration-300 p-2 rounded-full active:scale-95">
            <Share2 size={22} />
          </button>
        </div>
      </header>

      <main className="pt-16 px-4 md:px-8 lg:px-12 max-w-7xl mx-auto">

        {/* ── Hero Photo Grid ── */}
        <section className="mt-3 md:mt-4 relative">
          {photos.length >= 3 ? (
            <div className="grid grid-cols-12 gap-2 md:gap-4 h-[260px] md:h-[440px]">
              {/* Main large photo */}
              <div className="col-span-8 relative overflow-hidden rounded-2xl md:rounded-3xl group">
                <img
                  src={photos[photoIndex]}
                  alt={place.name}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                {/* Photo navigation on main image */}
                {photos.length > 1 && (
                  <>
                    <button
                      onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all md:p-2"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all md:p-2"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
              </div>
              {/* Side photos */}
              <div className="col-span-4 flex flex-col gap-2 md:gap-4">
                <div className="h-1/2 relative overflow-hidden rounded-2xl md:rounded-3xl group">
                  <img
                    src={photos[1 % photos.length]}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="h-1/2 relative overflow-hidden rounded-2xl md:rounded-3xl group">
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
            <div className="relative overflow-hidden rounded-2xl md:rounded-3xl h-[260px] md:h-[440px] group">
              <img
                src={photos[photoIndex]}
                alt={place.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
              {photos.length > 1 && (
                <>
                  <button
                    onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all md:p-2"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/70 backdrop-blur-sm rounded-full text-on-surface/80 active:scale-90 transition-all md:p-2"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="h-[200px] md:h-[440px] bg-surface-container rounded-2xl md:rounded-3xl flex items-center justify-center">
              <MapPin size={48} className="text-on-surface/15" />
            </div>
          )}
        </section>

        {/* ── Restaurant Identity ── */}
        <section className="mt-6 md:mt-10 flex flex-col md:flex-row md:justify-between md:items-end gap-4 md:gap-6">
          <div className="flex-1 min-w-0">
            {/* Badges & rating */}
            <div className="flex items-center gap-2 md:gap-3 mb-1.5 flex-wrap">
              {isMichelin && (
                <span className="bg-secondary-container text-on-secondary-container px-2.5 py-0.5 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest">
                  Michelin Recommended
                </span>
              )}
              <div className="flex items-center text-primary">
                <Star size={14} className="fill-primary" />
                <span className="font-bold ml-1 text-sm">{place.rating}</span>
              </div>
            </div>

            {/* Name */}
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-serif font-bold text-on-surface leading-tight tracking-tight">
              {place.name}
            </h2>

            {/* Meta row */}
            <div className="flex items-center gap-3 md:gap-6 mt-2 md:mt-4 text-on-surface-variant text-xs md:text-sm flex-wrap">
              <span className="flex items-center gap-1">
                <Star size={14} className="text-on-surface-variant" />
                {cuisine}
              </span>
              <span className="font-bold tracking-widest">{priceStr}</span>
              <span className="flex items-center gap-1 truncate">
                <MapPin size={14} />
                {place.address.split(',').slice(0, 2).join(',')}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 items-center">
            <button className="w-11 h-11 md:w-14 md:h-14 rounded-full flex items-center justify-center bg-surface-container-high text-primary hover:bg-surface-container-highest transition-all active:scale-95">
              <Heart size={20} />
            </button>
            <button className="px-5 py-3 md:px-8 md:py-4 bg-primary text-white rounded-full font-bold flex items-center gap-2 md:gap-3 shadow-lg shadow-primary/20 hover:scale-105 transition-transform active:scale-95 text-sm md:text-base">
              <span>Rate & Save to List</span>
              <PlusCircle size={18} />
            </button>
          </div>
        </section>

        {/* ── Bento Grid Layout ── */}
        <div className="mt-10 md:mt-16 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">

          {/* ── Left Column: Location ── */}
          <div className="md:col-span-4 space-y-6 md:space-y-8">
            {/* Find Us Card */}
            <div className="bg-surface-container-low rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 space-y-4 md:space-y-6">
              <h3 className="font-serif text-xl md:text-2xl font-bold">Find Us</h3>

              {/* Map */}
              <div className="rounded-xl md:rounded-2xl overflow-hidden aspect-square relative shadow-inner">
                <div
                  ref={mapContainerRef}
                  className="w-full h-full"
                />
              </div>

              {/* Address */}
              <p className="text-on-surface-variant text-sm leading-relaxed">{place.address}</p>

              {/* Directions button */}
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 md:py-4 bg-surface-container-highest rounded-xl md:rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors text-sm active:scale-[0.98]"
              >
                <Navigation size={16} />
                Get Directions
              </a>

              {/* Contact info */}
              {(place.phone || place.website) && (
                <div className="space-y-2.5 pt-2">
                  {place.phone && (
                    <a href={`tel:${place.phone}`} className="flex items-center gap-2.5 text-on-surface-variant hover:text-primary transition-colors text-sm">
                      <Phone size={16} className="text-primary flex-shrink-0" />
                      <span>{place.phone}</span>
                    </a>
                  )}
                  {place.website && (
                    <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-on-surface-variant hover:text-primary transition-colors text-sm">
                      <Globe size={16} className="text-primary flex-shrink-0" />
                      <span className="truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                    </a>
                  )}
                </div>
              )}

              {/* Hours dropdown */}
              {place.hours.length > 0 && (
                <div>
                  <button
                    onClick={() => setHoursOpen(!hoursOpen)}
                    className="flex justify-between items-center w-full cursor-pointer font-bold py-2 border-t border-outline-variant/20 mt-2 pt-4 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Clock size={16} className="text-primary" />
                      Opening Hours
                      {place.isOpen !== null && (
                        <span className={`text-[10px] font-bold uppercase tracking-wider ml-1 ${place.isOpen ? 'text-green-600' : 'text-red-500'}`}>
                          {place.isOpen ? 'Open' : 'Closed'}
                        </span>
                      )}
                    </span>
                    <ChevronDown size={18} className={`text-on-surface/40 transition-transform duration-200 ${hoursOpen ? 'rotate-180' : ''}`} />
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
                        <ul className="mt-3 space-y-1.5 text-sm text-on-surface-variant">
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
          <div className="md:col-span-8 space-y-6 md:space-y-8">

            {/* Google Rating as "Expert Perspective" */}
            <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 shadow-[0_1px_3px_rgba(30,27,26,0.04)]">
              <div className="flex justify-between items-center mb-5 md:mb-8">
                <h3 className="font-serif text-2xl md:text-3xl font-bold italic">Expert Perspective</h3>
                <span className="text-primary font-serif text-3xl md:text-4xl font-bold">
                  {place.rating}<span className="text-base md:text-lg text-on-surface-variant">/5</span>
                </span>
              </div>
              <div className="flex items-center gap-4 md:gap-6 p-4 md:p-6 bg-surface-container-low rounded-2xl md:rounded-3xl">
                <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Star size={24} className="text-primary fill-primary md:w-8 md:h-8" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-base md:text-xl">Google Reviews</p>
                  <p className="text-on-surface-variant text-xs md:text-sm italic mt-0.5">
                    Based on {formatReviewCount(place.userRatingCount)} reviews, this restaurant earns a stellar {place.rating} rating for its {cuisine.toLowerCase()} cuisine and dining experience.
                  </p>
                </div>
              </div>
            </div>

            {/* Friends & Community Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">

              {/* Friends' Circle */}
              <div className="bg-secondary-container/30 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 flex flex-col justify-between min-h-[200px] md:min-h-[280px]">
                <div>
                  <h4 className="font-serif text-xl md:text-2xl font-bold mb-1">Friends' Circle</h4>
                  <p className="text-on-secondary-container text-sm">Your inner circle's take</p>
                </div>
                <div className="mt-6 md:mt-12">
                  <div className="flex -space-x-3 mb-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-10 h-10 md:w-12 md:h-12 rounded-full border-4 border-white bg-surface-container-high flex items-center justify-center">
                        <UserCheck size={14} className="text-on-surface-variant" />
                      </div>
                    ))}
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-full border-4 border-white bg-secondary flex items-center justify-center text-white text-[10px] md:text-xs font-bold">
                      +0
                    </div>
                  </div>
                  <p className="font-bold text-on-surface text-sm">No friends have rated this</p>
                  <p className="text-on-surface-variant text-xs mt-0.5">Be the first to rate!</p>
                </div>
              </div>

              {/* Community Rating */}
              <div className="bg-surface-container rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8">
                <h4 className="font-serif text-xl md:text-2xl font-bold mb-4 md:mb-6">Community</h4>

                {/* Rating bars */}
                <div className="space-y-2">
                  {distribution.map(({ star, pct }) => (
                    <div key={star} className="flex items-center gap-3">
                      <span className="text-xs font-bold w-3 text-on-surface-variant">{star}</span>
                      <div className="flex-1 h-2 bg-white rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Score */}
                <div className="mt-6 md:mt-8 pt-5 md:pt-8 border-t border-outline-variant/15 text-center">
                  <p className="text-3xl md:text-4xl font-serif font-bold text-on-surface">{place.rating}</p>
                  <p className="text-[10px] md:text-xs uppercase tracking-widest font-bold text-on-surface-variant mt-1">
                    {formatReviewCount(place.userRatingCount)} Reviews
                  </p>
                </div>
              </div>
            </div>

            {/* Taste Profile */}
            <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 shadow-[0_1px_3px_rgba(30,27,26,0.04)]">
              <h4 className="font-serif text-xl md:text-2xl font-bold mb-6 md:mb-8 text-center">Taste Profile</h4>
              <div className="flex justify-around items-center gap-3 md:gap-4">
                {[
                  { label: 'Umami', level: 'High', color: 'primary', size: 'w-10 h-10 md:w-12 md:h-12', borderT: true },
                  { label: 'Spice', level: 'Low', color: 'secondary', size: 'w-7 h-7 md:w-8 md:h-8', borderT: false },
                  { label: 'Sweet', level: 'Medium', color: 'primary', size: 'w-8 h-8 md:w-10 md:h-10', borderT: false },
                ].map(({ label, level, color, size, borderT }) => (
                  <div key={label} className="flex flex-col items-center">
                    <div className={`w-14 h-14 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center mb-2 md:mb-3 ${color === 'primary' ? 'bg-primary/5' : 'bg-secondary/5'}`}>
                      <div className={`${size} rounded-full border-4 ${color === 'primary' ? 'border-primary' : 'border-secondary'} ${borderT ? 'border-t-transparent' : ''}`} />
                    </div>
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
                    <span className={`font-bold text-sm ${color === 'primary' ? 'text-primary' : 'text-secondary'}`}>{level}</span>
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
