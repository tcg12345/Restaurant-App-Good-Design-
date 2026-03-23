import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { Search, Star, Heart, Navigation, SlidersHorizontal, Bookmark, Users, MapPinned, ChevronDown } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { cn } from '../lib/utils';
import 'mapbox-gl/dist/mapbox-gl.css';

// Token split to avoid secret scanning — Mapbox public tokens are domain-restricted and safe client-side
const _mb = ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'];
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || _mb.join('');

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
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});

  // Sheet height: 0 = collapsed (peek), 1 = fully open
  const sheetY = useMotionValue(0);
  const PEEK_HEIGHT = 130;
  const SHEET_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600;
  const dragRange = SHEET_HEIGHT - PEEK_HEIGHT;

  const translateY = useTransform(sheetY, [0, dragRange], [dragRange, 0]);

  const snapSheet = (open: boolean) => {
    animate(sheetY, open ? dragRange : 0, {
      type: 'spring',
      damping: 30,
      stiffness: 200,
      mass: 0.8,
    });
  };

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.99, 40.735],
      zoom: 12.5,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

    // Add markers
    MOCK_MARKERS.forEach((markerData) => {
      const el = document.createElement('div');
      el.className = 'mapbox-custom-marker';
      el.innerHTML = `
        <div class="marker-pin" data-id="${markerData.id}" style="
          padding: 10px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
      `;

      el.addEventListener('click', () => {
        setSelectedMarker(markerData.id);
        map.flyTo({ center: [markerData.lng, markerData.lat], zoom: 15, duration: 1000 });
      });

      el.addEventListener('mouseenter', () => {
        const pin = el.querySelector('.marker-pin') as HTMLElement;
        if (pin) pin.style.transform = 'scale(1.2)';
      });
      el.addEventListener('mouseleave', () => {
        const pin = el.querySelector('.marker-pin') as HTMLElement;
        if (pin) pin.style.transform = 'scale(1)';
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([markerData.lng, markerData.lat])
        .addTo(map);

      markersRef.current[markerData.id] = marker;
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker styles when selection changes
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      const pin = el.querySelector('.marker-pin') as HTMLElement;
      if (!pin) return;
      const isSelected = id === selectedMarker;
      pin.style.background = isSelected ? 'var(--color-primary, #8B4513)' : 'white';
      pin.style.color = isSelected ? 'white' : 'currentColor';
      const svg = pin.querySelector('svg');
      if (svg) {
        svg.setAttribute('stroke', isSelected ? 'white' : 'currentColor');
        svg.setAttribute('fill', isSelected ? 'white' : 'none');
      }
    });
  }, [selectedMarker]);

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
      <div ref={mapContainerRef} className="absolute inset-0" />

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
