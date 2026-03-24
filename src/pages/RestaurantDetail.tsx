import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
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
  Users,
  UserCheck,
  Loader2,
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

export const RestaurantDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
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

  // Initialize map when place data loads
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

  return (
    <div className="pb-32 bg-surface min-h-screen">
      {/* Hero Section with Photo Carousel */}
      <div className="relative h-[55vh] sm:h-[60vh] w-full overflow-hidden">
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
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-black/40" />

        {/* Photo navigation arrows */}
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 glass rounded-full text-on-surface shadow-xl z-10"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 glass rounded-full text-on-surface shadow-xl z-10"
            >
              <ChevronRight size={20} />
            </button>
            <div className="absolute bottom-32 sm:bottom-36 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIndex(i)}
                  className={`w-2 h-2 rounded-full transition-all ${i === photoIndex ? 'bg-white w-5' : 'bg-white/50'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Top navigation buttons */}
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-10">
          <button
            onClick={() => navigate(-1)}
            className="p-3 glass rounded-full text-on-surface shadow-xl"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex gap-4">
            <button className="p-3 glass rounded-full text-on-surface shadow-xl">
              <Share2 size={24} />
            </button>
            <button className="p-3 glass rounded-full text-on-surface shadow-xl">
              <Heart size={24} />
            </button>
          </div>
        </div>

        {/* Restaurant info overlay */}
        <div className="absolute bottom-8 sm:bottom-12 left-6 sm:left-8 right-6 sm:right-8">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            {isMichelin && (
              <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
                <Star size={16} className="fill-primary text-primary" />
                <span className="text-xs font-bold uppercase tracking-widest text-primary">Michelin Starred</span>
              </div>
            )}
            <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-on-surface">{priceStr}</span>
            </div>
            <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-on-surface">{cuisine}</span>
            </div>
          </div>
          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-on-surface mb-3 leading-tight">{place.name}</h1>
          <div className="flex items-center gap-4 sm:gap-6 text-on-surface/60 flex-wrap">
            <div className="flex items-center gap-2">
              <MapPin size={18} />
              <span className="text-sm font-medium">{place.address}</span>
            </div>
            <div className="flex items-center gap-2">
              <Star size={18} className="fill-primary text-primary" />
              <span className="text-sm font-bold text-on-surface">
                {place.rating} ({formatReviewCount(place.userRatingCount)} Reviews)
              </span>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 sm:px-8 -mt-4 relative z-20">
        {/* Ratings Section */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {/* Google Rating */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-muted">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Star size={20} className="text-primary fill-primary" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">Google</p>
                <p className="text-xs text-on-surface/40">Rating</p>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-serif font-bold">{place.rating}</span>
              <span className="text-sm text-on-surface/40">/ 5</span>
            </div>
            <div className="flex gap-0.5 mt-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  size={14}
                  className={s <= Math.round(place.rating) ? 'fill-primary text-primary' : 'text-muted'}
                />
              ))}
            </div>
            <p className="text-xs text-on-surface/40 mt-1">{formatReviewCount(place.userRatingCount)} reviews</p>
          </div>

          {/* Friends Rating */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-muted">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center">
                <UserCheck size={20} className="text-secondary" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">Friends</p>
                <p className="text-xs text-on-surface/40">Rating</p>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-serif font-bold text-on-surface/20">—</span>
            </div>
            <p className="text-xs text-on-surface/30 mt-3">No friend ratings yet</p>
          </div>

          {/* Community Rating */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-muted">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Users size={20} className="text-accent" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">Community</p>
                <p className="text-xs text-on-surface/40">Rating</p>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-serif font-bold text-on-surface/20">—</span>
            </div>
            <p className="text-xs text-on-surface/30 mt-3">No community ratings yet</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left Column — Main Content */}
          <div className="lg:col-span-2 space-y-10">
            {/* Hours */}
            {place.hours.length > 0 && (
              <section>
                <h2 className="text-2xl font-serif font-bold mb-4 flex items-center gap-3">
                  <Clock size={22} className="text-primary" />
                  Hours
                  {place.isOpen !== null && (
                    <span className={`text-sm font-sans font-bold uppercase tracking-wider ${place.isOpen ? 'text-green-600' : 'text-red-500'}`}>
                      {place.isOpen ? '• Open Now' : '• Closed'}
                    </span>
                  )}
                </h2>
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-muted">
                  <div className="space-y-2.5">
                    {place.hours.map((line, i) => {
                      const [day, ...timeParts] = line.split(': ');
                      const time = timeParts.join(': ');
                      const isToday = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase().startsWith(day.toLowerCase().slice(0, 3));
                      return (
                        <div key={i} className={`flex justify-between text-sm ${isToday ? 'font-bold text-on-surface' : 'text-on-surface/60'}`}>
                          <span>{day}</span>
                          <span>{time}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Contact Info */}
            {(place.phone || place.website) && (
              <section>
                <h2 className="text-2xl font-serif font-bold mb-4">Contact</h2>
                <div className="space-y-4">
                  {place.phone && (
                    <a href={`tel:${place.phone}`} className="flex items-center gap-4 text-on-surface/60 hover:text-primary transition-colors">
                      <Phone size={20} className="text-primary" />
                      <span className="text-sm font-medium">{place.phone}</span>
                    </a>
                  )}
                  {place.website && (
                    <a href={place.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 text-on-surface/60 hover:text-primary transition-colors">
                      <Globe size={20} className="text-primary" />
                      <span className="text-sm font-medium truncate">{place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                    </a>
                  )}
                  <div className="flex items-center gap-4 text-on-surface/60">
                    <MapPin size={20} className="text-primary flex-shrink-0" />
                    <span className="text-sm font-medium">{place.address}</span>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Right Column — Map */}
          <div>
            <section className="space-y-4">
              <h3 className="text-2xl font-serif font-bold">Location</h3>
              <div
                ref={mapContainerRef}
                className="aspect-square sm:aspect-video lg:aspect-square rounded-3xl overflow-hidden shadow-inner"
              />
              <p className="text-sm text-on-surface/50">{place.address}</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};
