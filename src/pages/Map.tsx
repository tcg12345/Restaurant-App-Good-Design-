import React, { useState, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { Search, Star, Heart, Navigation, SlidersHorizontal, Bookmark, Users, MapPinned, ChevronDown } from 'lucide-react';
import MapGL, { Marker, NavigationControl } from 'react-map-gl';
import { cn } from '../lib/utils';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

const MOCK_MARKERS = [
  { id: '1', name: 'Lumière', lat: 40.7128, lng: -74.0060, rating: 4.9, price: '$$$$' },
  { id: '2', name: 'Alchemist', lat: 40.7282, lng: -73.9942, rating: 4.7, price: '$$$' },
  { id: '3', name: 'Sakura Zen', lat: 40.7589, lng: -73.9851, rating: 4.8, price: '$$$$' },
];

const FILTERS = [
  { icon: Bookmark, label: 'Hitlist', active: false },
  { icon: Users, label: 'Anyone', hasDropdown: true, active: false },
  { icon: MapPinned, label: 'Nearby', active: false },
];

export const Map: React.FC = () => {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const mapRef = useRef<any>(null);

  // Sheet height: 0 = collapsed (peek), 1 = fully open
  const sheetY = useMotionValue(0);
  const PEEK_HEIGHT = 130;
  const SHEET_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600;
  const dragRange = SHEET_HEIGHT - PEEK_HEIGHT;

  // Map sheetY (0 = collapsed, dragRange = open) to translateY
  const translateY = useTransform(sheetY, [0, dragRange], [dragRange, 0]);

  const snapSheet = (open: boolean) => {
    animate(sheetY, open ? dragRange : 0, {
      type: 'spring',
      damping: 30,
      stiffness: 200,
      mass: 0.8,
    });
  };

  const flyToMarker = useCallback((marker: typeof MOCK_MARKERS[0]) => {
    setSelectedMarker(marker.id);
    mapRef.current?.flyTo({
      center: [marker.lng, marker.lat],
      zoom: 15,
      duration: 1000,
    });
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-muted">
      {/* Real Mapbox Map */}
      <div className="absolute inset-0">
        <MapGL
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: -73.99,
            latitude: 40.735,
            zoom: 12.5,
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          attributionControl={false}
        >
          <NavigationControl position="top-left" showCompass={false} />

          {MOCK_MARKERS.map((marker) => (
            <Marker
              key={marker.id}
              longitude={marker.lng}
              latitude={marker.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                flyToMarker(marker);
              }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={{ scale: 1.2 }}
                className={cn(
                  "p-2.5 rounded-full shadow-xl cursor-pointer transition-colors duration-200",
                  selectedMarker === marker.id
                    ? "bg-primary text-white"
                    : "bg-white text-on-surface hover:bg-primary/10"
                )}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={selectedMarker === marker.id ? "white" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </motion.div>

              {selectedMarker === marker.id && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 glass px-4 py-2 rounded-2xl whitespace-nowrap shadow-2xl pointer-events-none"
                >
                  <p className="text-sm font-serif font-bold text-on-surface">{marker.name}</p>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-primary mt-1">
                    <Star size={10} className="fill-primary" />
                    <span>{marker.rating}</span>
                    <span className="text-on-surface/40">•</span>
                    <span>{marker.price}</span>
                  </div>
                </motion.div>
              )}
            </Marker>
          ))}
        </MapGL>
      </div>

      {/* Floating Action Buttons */}
      <div className="absolute right-6 top-6 flex flex-col gap-4 z-30">
        <button
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                mapRef.current?.flyTo({
                  center: [pos.coords.longitude, pos.coords.latitude],
                  zoom: 14,
                  duration: 1500,
                });
              });
            }
          }}
          className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors"
        >
          <Navigation size={20} />
        </button>
        <button className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors">
          <Heart size={20} />
        </button>
      </div>

      {/* Bottom Sheet */}
      <motion.div
        style={{ y: translateY, height: SHEET_HEIGHT }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.1}
        onDragEnd={(_, info) => {
          const currentVal = sheetY.get();
          const velocity = info.velocity.y;
          if (velocity < -300 || (currentVal > dragRange * 0.3 && velocity <= 0)) {
            snapSheet(true);
          } else if (velocity > 300 || (currentVal < dragRange * 0.7 && velocity >= 0)) {
            snapSheet(false);
          } else {
            snapSheet(currentVal > dragRange * 0.5);
          }
        }}
        onDrag={(_, info) => {
          const currentVal = sheetY.get();
          const newVal = currentVal - info.delta.y;
          sheetY.set(Math.max(0, Math.min(dragRange, newVal)));
        }}
        dragListener={true}
        dragMomentum={false}
        className="absolute bottom-0 left-0 right-0 glass rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 border-t border-white/40 flex flex-col"
      >
        {/* Handle */}
        <div className="w-full flex flex-col items-center pt-4 pb-4 cursor-grab active:cursor-grabbing flex-shrink-0">
          <div className="w-12 h-1.5 bg-on-surface/10 rounded-full" />
        </div>

        {/* Search Bar & Filters */}
        <div className="px-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
            <button className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors">
              <Search size={20} className="text-on-surface/70" />
            </button>
            <button className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors">
              <SlidersHorizontal size={18} className="text-on-surface/70" />
            </button>
            {FILTERS.map((filter) => (
              <button
                key={filter.label}
                className={cn(
                  "flex items-center gap-2 px-5 py-3 rounded-full border-2 border-on-surface/10 whitespace-nowrap flex-shrink-0 transition-colors hover:bg-muted",
                  filter.active && "bg-primary/10 border-primary/30 text-primary"
                )}
              >
                <filter.icon size={16} className={filter.active ? "text-primary" : "text-on-surface/50"} />
                <span className="text-xs font-bold uppercase tracking-wider">{filter.label}</span>
                {filter.hasDropdown && <ChevronDown size={14} className="text-on-surface/40" />}
              </button>
            ))}
          </div>
        </div>

        {/* Results List */}
        <div className="px-6 flex-1 overflow-y-auto no-scrollbar pb-32">
          <div className="space-y-6">
            {MOCK_MARKERS.map((marker) => (
              <div
                key={marker.id}
                className={cn(
                  "flex gap-4 group cursor-pointer rounded-2xl p-2 -mx-2 transition-colors",
                  selectedMarker === marker.id && "bg-primary/5"
                )}
                onClick={() => flyToMarker(marker)}
              >
                <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0">
                  <img
                    src={`https://images.unsplash.com/photo-${1414235077428 + parseInt(marker.id) * 100000000000}?auto=format&fit=crop&q=80&w=200`}
                    alt={marker.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 py-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-serif font-bold text-lg">{marker.name}</h3>
                    <div className="flex items-center gap-1 text-primary">
                      <Star size={12} className="fill-primary" />
                      <span className="text-xs font-bold">{marker.rating}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2">Modern French • {marker.price}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-wider">Michelin</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Top Rated</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
